/**
 * Consent-driven local runtime installer.
 *
 * When the interactive runner needs a toolchain that isn't installed (e.g. GCC
 * for C), the UI shows a popup asking permission; on consent it calls
 * installRuntime() here. We drive an OS package manager (winget preferred,
 * Chocolatey fallback) with a FIXED, allow-listed package id per language — the
 * client only ever sends a language key, never a command — so no user input is
 * interpolated into the shell.
 *
 * Real elevation is handled by the package manager itself: winget raises the
 * normal Windows UAC prompt, which is the "by user permission" gate.
 *
 * Guarded by env.localRunEnabled (off in production unless explicitly enabled).
 */
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { env } from '../config/env.js';
import { IS_WIN, probeCommand, resolveCommand } from './runtimes.js';
import { executionEnv } from './executionEnv.js';

const execFileP = promisify(execFile);

// Package ids are overridable via env so a deployment can retarget without a
// code change. Defaults chosen for winget's public catalog.
const INSTALL_PLANS = {
  python: {
    label: 'Python 3',
    winget: process.env.WINGET_ID_PYTHON || 'Python.Python.3.12',
    choco: process.env.CHOCO_ID_PYTHON || 'python',
  },
  javascript: {
    label: 'Node.js (LTS)',
    winget: process.env.WINGET_ID_NODE || 'OpenJS.NodeJS.LTS',
    choco: process.env.CHOCO_ID_NODE || 'nodejs-lts',
  },
  c: {
    label: 'GCC (MinGW-w64)',
    winget: process.env.WINGET_ID_MINGW || 'BrechtSanders.WinLibs.POSIX.UCRT',
    choco: process.env.CHOCO_ID_MINGW || 'mingw',
  },
  cpp: {
    label: 'G++ (MinGW-w64)',
    winget: process.env.WINGET_ID_MINGW || 'BrechtSanders.WinLibs.POSIX.UCRT',
    choco: process.env.CHOCO_ID_MINGW || 'mingw',
  },
  java: {
    label: 'OpenJDK 21',
    winget: process.env.WINGET_ID_JDK || 'Microsoft.OpenJDK.21',
    choco: process.env.CHOCO_ID_JDK || 'openjdk',
  },
  // Plans for the expanded language registry. Ids follow the same policy as
  // above: fixed, allow-listed, overridable via env when a catalog id drifts —
  // and the package manager's own failure output is surfaced honestly.
  go: {
    label: 'Go',
    winget: process.env.WINGET_ID_GO || 'GoLang.Go',
    choco: process.env.CHOCO_ID_GO || 'go',
  },
  rust: {
    label: 'Rust (rustup)',
    winget: process.env.WINGET_ID_RUST || 'Rustlang.Rustup',
    choco: process.env.CHOCO_ID_RUST || 'rust-installer',
  },
  csharp: {
    label: '.NET SDK',
    winget: process.env.WINGET_ID_DOTNET || 'Microsoft.DotNet.SDK.8',
    choco: process.env.CHOCO_ID_DOTNET || 'dotnet-sdk',
  },
  php: {
    label: 'PHP',
    winget: process.env.WINGET_ID_PHP || 'PHP.PHP.8.3',
    choco: process.env.CHOCO_ID_PHP || 'php',
  },
  ruby: {
    label: 'Ruby (RubyInstaller)',
    winget: process.env.WINGET_ID_RUBY || 'RubyInstaller.Ruby.MSYS2',
    choco: process.env.CHOCO_ID_RUBY || 'ruby',
  },
  kotlin: {
    label: 'Kotlin compiler',
    winget: process.env.WINGET_ID_KOTLIN || 'JetBrains.Kotlin',
    choco: process.env.CHOCO_ID_KOTLIN || 'kotlin',
  },
};

let pmCache;

/** Detect an available package manager: 'winget' | 'choco' | null. */
export async function detectPackageManager(force = false) {
  if (pmCache !== undefined && !force) return pmCache;
  if (await probeCommand('winget', ['--version'])) pmCache = 'winget';
  else if (await probeCommand('choco', ['--version'])) pmCache = 'choco';
  else pmCache = null;
  return pmCache;
}

/**
 * Describe what installing `languageKey` would do, so the popup can show the
 * exact command for informed consent.
 */
export async function getInstallPlan(languageKey) {
  const plan = INSTALL_PLANS[languageKey];
  const tool = await detectPackageManager();
  if (!plan) return { supported: false, language: languageKey, tool };
  const command =
    tool === 'winget'
      ? `winget install --id ${plan.winget} -e`
      : tool === 'choco'
        ? `choco install ${plan.choco} -y`
        : null;
  return {
    supported: true,
    language: languageKey,
    label: plan.label,
    tool,
    command,
    needsPackageManager: !tool,
  };
}

function runTool(cmd, args, emit) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(resolveCommand(cmd), args, {
        windowsHide: true,
        env: executionEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      emit(`Failed to start ${cmd}: ${err.message}\n`);
      return resolve({ code: -1 });
    }
    proc.stdout.on('data', (d) => emit(String(d)));
    proc.stderr.on('data', (d) => emit(String(d)));
    proc.on('error', (err) => {
      emit(`Error: ${err.message}\n`);
      resolve({ code: -1 });
    });
    proc.on('close', (code) => resolve({ code }));
  });
}

/**
 * After an install, the running server's PATH is stale (captured at boot). On
 * Windows, re-read Machine+User PATH from the registry so detection can see the
 * freshly installed toolchain without a server restart.
 */
async function refreshPathFromRegistry(emit) {
  if (!IS_WIN) return;
  try {
    const script =
      "$m=[Environment]::GetEnvironmentVariable('Path','Machine');" +
      "$u=[Environment]::GetEnvironmentVariable('Path','User');" +
      "Write-Output ($m + [IO.Path]::PathSeparator + $u)";
    const { stdout } = await execFileP('powershell.exe', ['-NoProfile', '-Command', script], {
      windowsHide: true,
      timeout: 15000,
      env: executionEnv(),
    });
    const fresh = (stdout || '').trim();
    if (fresh) {
      process.env.PATH = fresh;
      process.env.Path = fresh; // Windows env var is case-insensitive but Node caches both
      emit('\nRefreshed PATH from the system environment.\n');
    }
  } catch (err) {
    emit(`\n(Note) Could not refresh PATH automatically: ${err.message}. Restart the server if the new tool isn't detected.\n`);
  }
}

// Executables that mark a language's toolchain as present in a bin directory.
const TOOL_EXES = {
  python: ['python.exe', 'python3.exe'],
  javascript: ['node.exe'],
  c: ['gcc.exe'],
  cpp: ['g++.exe'],
  java: ['java.exe', 'javac.exe'],
};

// Where the supported package managers typically drop these toolchains, so we
// can wire them into PATH ourselves when an installer doesn't register them.
function searchPatternsFor(languageKey) {
  const la = process.env.LOCALAPPDATA || '';
  const common = [`${la}\\Microsoft\\WinGet\\Links`, 'C:\\ProgramData\\chocolatey\\bin'];
  switch (languageKey) {
    case 'c':
    case 'cpp':
      return [
        ...common,
        'C:\\msys64\\*\\bin',
        'C:\\mingw64\\bin',
        'C:\\TDM-GCC-64\\bin',
        'C:\\tools\\mingw64\\bin',
        'C:\\Program Files\\LLVM\\bin',
        `${la}\\Microsoft\\WinGet\\Packages\\*\\*\\bin`,
        `${la}\\Microsoft\\WinGet\\Packages\\*\\bin`,
      ];
    case 'java':
      return [
        ...common,
        'C:\\Program Files\\Microsoft\\*\\bin',
        'C:\\Program Files\\Eclipse Adoptium\\*\\bin',
        'C:\\Program Files\\Java\\*\\bin',
        'C:\\Program Files\\*\\bin',
      ];
    case 'python':
      return [...common, 'C:\\Python*\\', `${la}\\Programs\\Python\\*\\`, `${la}\\Programs\\Python\\*\\Scripts`];
    case 'javascript':
      return [...common, 'C:\\Program Files\\nodejs'];
    default:
      return common;
  }
}

/** Expand a `\\`-separated pattern that may contain one or more `*` segments. */
function expandPattern(pattern) {
  const sep = IS_WIN ? '\\' : '/';
  const segs = pattern.split(sep).filter(Boolean);
  let acc = [segs.shift()]; // drive root like 'C:'
  for (const seg of segs) {
    const next = [];
    for (const base of acc) {
      if (seg.includes('*')) {
        let entries = [];
        try {
          entries = readdirSync(base, { withFileTypes: true });
        } catch {
          continue;
        }
        const rx = new RegExp('^' + seg.split('*').join('.*') + '$', 'i');
        for (const d of entries) if (d.isDirectory() && rx.test(d.name)) next.push(path.join(base, d.name));
      } else {
        next.push(path.join(base, seg));
      }
    }
    acc = next;
    if (acc.length > 800) break; // safety bound
  }
  return acc;
}

/**
 * If a package installed its toolchain but didn't register it on PATH, locate
 * it in known folders and prepend those dirs to the server's PATH so the IDE
 * can use it immediately (no restart). Returns the dirs it added.
 */
function augmentPathWithKnownLocations(languageKey, emit) {
  const exes = TOOL_EXES[languageKey] || [];
  if (!exes.length) return [];
  const current = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const currentSet = new Set(current.map((d) => d.toLowerCase()));
  const added = [];
  for (const pattern of searchPatternsFor(languageKey)) {
    for (const dir of expandPattern(pattern)) {
      if (currentSet.has(dir.toLowerCase())) continue;
      if (exes.some((exe) => existsSync(path.join(dir, exe)))) {
        currentSet.add(dir.toLowerCase());
        added.push(dir);
      }
    }
  }
  if (added.length) {
    process.env.PATH = [...added, ...current].join(path.delimiter);
    process.env.Path = process.env.PATH;
    emit(`\nAdded to the IDE's PATH automatically:\n  ${added.join('\n  ')}\n`);
  }
  return added;
}

/**
 * Install the toolchain for `languageKey`, streaming progress through `emit`.
 * Returns { success, language, message }.
 */
export async function installRuntime(languageKey, emit = () => {}) {
  if (!env.localRunEnabled) {
    return { success: false, language: languageKey, message: 'Local runtime installation is disabled on this server.' };
  }
  const plan = INSTALL_PLANS[languageKey];
  if (!plan) {
    return { success: false, language: languageKey, message: `No automatic installer is defined for "${languageKey}".` };
  }
  const tool = await detectPackageManager(true);
  if (!tool) {
    return {
      success: false,
      language: languageKey,
      message: 'Neither winget nor Chocolatey was found. Install a package manager, or install the toolchain manually.',
    };
  }

  const args =
    tool === 'winget'
      ? ['install', '--id', plan.winget, '-e', '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity']
      : ['install', plan.choco, '-y'];

  emit(`$ ${tool} ${args.join(' ')}\n\n`);
  emit(`Installing ${plan.label}. Windows may show a permission (UAC) prompt — please accept it to continue.\n\n`);

  const { code } = await runTool(tool, args, emit);
  await refreshPathFromRegistry(emit);
  const added = augmentPathWithKnownLocations(languageKey, emit);

  if (code === 0) {
    emit(`\n${plan.label} install completed.\n`);
    return {
      success: true,
      language: languageKey,
      pathAdded: added,
      message: `${plan.label} installed successfully${added.length ? " and wired into the IDE's PATH" : ''}.`,
    };
  }
  const hint =
    tool === 'choco'
      ? 'Chocolatey needs an elevated shell — accept the UAC prompt, or install winget.'
      : 'The install may have been cancelled or failed. See the log above.';
  return { success: false, language: languageKey, message: `Installer exited with code ${code}. ${hint}` };
}
