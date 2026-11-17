# StackAmit-IDE — Runtime Verification, Desktop Execution Stabilization & Offline Windows Release

Final verification report. Everything below reflects **actual runs on this
machine** (Windows, 2026-10-21). Statuses are honest: `PASS` only when the
scenario genuinely executed and asserted, `NOT SEPARATELY LIVE-TESTED` where
only the deterministic/mock path covers it, and `BLOCKED` where a real-world
condition could not be reproduced here. No online feature is ever presented as
working offline, and syntax highlighting is never presented as execution.

Test totals on this machine:

| Suite | Command | Result |
|---|---|---|
| Server unit + runner matrix (deterministic) | `server` → `npm test` | **210 tests, 164 pass, 0 fail, 46 skipped** (the 46 are the live integration opt-in) |
| Server live integration (real provider) | `RUN_INTEGRATION=1 node --test tests/integration.test.js` | **46 tests, 46 pass, 0 fail** |
| Client + Electron (vitest, real child spawns) | `client` → `npx vitest run` | **18 files, 220 tests, 220 pass** |
| Electron typecheck | `client` → `npm run typecheck:electron` | **clean** |
| Renderer production build | `client` → `npm run build` | **success** |
| Packaged app offline execution (CDP) | `node .e2e-preview/p6-offline.mjs` | **all 3 local runtimes ran from inside `app.asar`** |

---

## A. Online runners — the real registry, one entry per runner

The desktop/web online path is the backend at `POST /api/code/run`, backed by the
Wandbox provider. The capability registry (`client/src/languages/languageCapabilities.js`)
declares exactly **18 languages with a live-verified remote `run` key**. Each was
checked against the **live provider** and against a deterministic matrix that
pins request mapping and result normalization (`server/tests/runner-matrix.test.js`,
`server/tests/integration.test.js`).

Legend — **valid** = real program produced expected output; **invalid** = broken
program rejected with a real compiler/runtime message; **stdin**, **timeout**,
**empty**, **non-zero** scenarios.

| # | Runner (reg. key) | Catalog id live | Valid run (live) | Invalid run (live) | Notes |
|---|---|---|---|---|---|
| 1 | python | ✔ | ✔ real output + stdin | ✔ | CPython; stdin verified live |
| 2 | javascript | ✔ | ✔ real Node stdin | ✔ | stdin verified live |
| 3 | typescript | ✔ | *matrix only* | ✔ (compile error) | tsc→Node; not a separate live "hello" run |
| 4 | c | ✔ | ✔ compile + execute | ✔ | MinGW |
| 5 | cpp | ✔ | ✔ compile + execute | ✔ | |
| 6 | java | ✔ | ✔ compile + execute + stdin | ✔ | stdin verified live |
| 7 | csharp | ✔ | ✔ real execute | ✔ | cold container ≈ 38s |
| 8 | go | ✔ | ✔ real execute | ✔ | cold container ≈ 45s |
| 9 | rust | ✔ | ✔ real execute | ✔ | cold container ≈ 29s |
| 10 | php | ✔ | ✔ real execute | ✔ | **see C1** — parse errors arrive on stdout |
| 11 | ruby | ✔ | ✔ real execute + stdin | ✔ | stdin verified live |
| 12 | perl | ✔ | ✔ real execute + stdin | ✔ | stdin verified live |
| 13 | lua | ✔ | ✔ real execute | ✔ | |
| 14 | julia | ✔ | ✔ real execute | ✔ | slow compile-on-run |
| 15 | haskell | ✔ | ✔ real execute | ✔ | |
| 16 | sql | ✔ | ✔ real execute (sqlite3) | ✔ | |
| 17 | shell | ✔ | ✔ real execute + stdin | ✔ | bash; stdin verified live |
| 18 | pascal | ✔ | ✔ real execute | ✔ | FPC |

Cross-cutting live scenarios (all **PASS**):
- provider **timeout** surfaced as `UPSTREAM_TIMEOUT` (not an outage),
- **empty output** run completes with empty stdout,
- **non-zero exit** reported as a runtime error carrying that code,
- catalog still lists **every** registered wandbox compiler id.

**Honest summary of A:** all 18 runners are live-reachable, map to the correct
catalog id, and are live-verified to reject broken code with a real message.
17 of 18 are live-verified on a **positive** execution; **TypeScript's positive
run is covered by the deterministic matrix, not a separate live hello**, so it is
not claimed as live-positive here. The 121-case matrix passes for all 18.

---

## B. Local runtimes — the packaged desktop app, offline

Local execution lives entirely in the Electron **main process**
(`client/electron/services/localRun.ts` + `runtimeProbe.ts`); it spawns the user's
own toolchain directly (no shell wrapper, so SIGKILL terminates on Windows), scrubs
the child environment to an allow-list, and writes sources to a throwaway temp dir.
Verified twice: by real child-spawn tests (`client/electron/__tests__/localRun.test.ts`,
30 tests) **and** by driving the **installed/unpacked production binary** over CDP
(`.e2e-preview/p6-offline.mjs`).

| Runtime | Discovered version | Discovered path | Verified offline |
|---|---|---|---|
| Python | `Python 3.14.7` | `C:\Python314\python.EXE` | valid, non-zero exit + traceback, stdout/stderr split, **stdin**, timeout kill, Stop kill, spaces+unicode paths, output cap, session cap, env scrub |
| Node.js | `v24.20.0` | `C:\Program Files\nodejs\node.EXE` | valid, throw→exit 1, stdout/stderr split, paths with spaces (`C:\Program Files`) |
| PowerShell | `5.1.19041.6456` | `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.EXE` | valid via `-NoProfile -ExecutionPolicy Bypass -File`, spaces + **non-ASCII** in the project path, timeout kill, Stop kill |

The packaged run was executed **from inside `app.asar`**, loading
`file:///…/resources/app.asar/dist/index.html#/ide`, with **no dev server and no API
server running**. Sample of the real results:
`python_ok` exit 0 stdout `P6_PYTHON_OK` + stderr `to-stderr`; `python_error` exit 1
with a real `ValueError: boom-p6` traceback; `python_stdin` → `got:hello-p6`;
`javascript_ok`/`powershell_ok` exit 0; `powershell_stop` → **stopped=true** (child killed).

**Limitations, stated honestly (B):**
- Only these **three** runtimes run offline in the app. The app never claims every
  language runs offline — compiled languages (C/C++/…), and everything else, remain
  online-only and clearly reported as such.
- Local run needs the runtime **installed and on `PATH`**; if missing, the run returns
  a structured `RUNTIME_MISSING` with an install hint and never pretends to have run.

---

## C. What was broken, and the fix

| ID | Defect | Root cause | Fix |
|---|---|---|---|
| **C1** | The live test *"php rejects broken code"* failed with *"failure carried no compiler/runtime output"*. | PHP-CLI delivers **parse errors on `stdout`** (status `runtime_error`, exit `255`, empty `stderr`/`compileMessage`). The test invariant only looked at compiler/stderr. | Corrected the invariant to treat a **stdout-only failure** as a real failure (asserts non-zero exit + diagnosable text) rather than weakening the check; added matching deterministic matrix cases for every language. |
| **C2** | The packaged desktop app had **no local execution path**, and its "Run" silently depended on an empty `VITE_API_URL` (a `file://` page resolving `/api/...` against the filesystem). | Renderer assumed a dev proxy that does not exist in production. | Added native main-process local run (`localRun.ts`/`runtimeProbe.ts`), a preload bridge, a renderer service (`localRun.js`), and `remoteRunAvailability()` which returns an explicit `NO_API_SERVER` in `file://` with no base. `runActive` now prefers local for the 3 offline runtimes and only reaches the network when a backend is actually configured. |
| **C3** | Early output of a local run could be **lost** — IPC events streamed before the renderer knew the session id. | `start()` emits events while the invoke reply (carrying the id) is still in flight. | Main buffers events into a `replay` array returned **inside** the reply; the renderer replays them before subscribing. Nothing emitted early is dropped. |
| **C4** | A production build pointed at a **non-localhost backend** would be silently blocked by CSP. | `connect-src` was hardcoded to `localhost:5000`. | `build-electron.mjs` bakes the configured `VITE_API_URL` origin into the main-process CSP (`__STACKAMIT_API_ORIGIN__` → `connect-src`); localhost-only when unset. Verified both branches in the built `main.cjs`. |
| **C5** | The rebuilt installer jumped **108 MB → 206 MB**. | `vite build` copies `public/downloads/*.exe` into `dist/`, and electron-builder ships `dist/**/*` — so **the previous installer was embedded inside the new one**. | Added `"!dist/downloads/**"` to the builder `files`. Rebuilt: **206 MB → 103 MB**, `app.asar` 268 MB → 160 MB, confirmed no `Setup.exe` inside the package while `index.html`/`main.cjs`/`preload.cjs` remain. |

Stop, single-run-at-a-time, honest `Stopping…`/`⏹ Stopped`, chunked stdout reassembly,
and the local-vs-remote mode label were wired into `BottomPanel` and `StatusBar`.

---

## D. How it was verified (reproduce)

```powershell
# Server — deterministic matrix + unit (no network)
cd server; npm.cmd test

# Server — LIVE provider (needs internet; ~10 min)
cd server; $env:RUN_INTEGRATION=1; node --test tests/integration.test.js

# Client + Electron (real child spawns for the 3 local runtimes)
cd client; npx.cmd vitest run
cd client; npm.cmd run typecheck:electron
```

New/updated tests:
- `client/electron/__tests__/localRun.test.ts` (30) — real python/node/powershell
  spawns: exit codes, stdout/stderr split, stdin, output truncation, timeout kill,
  Stop kill, session cap, **spaces + non-ASCII paths**, env scrubbing.
- `client/electron/__tests__/runtimeProbe.test.ts` (12) — PATH/PATHEXT discovery,
  version capture (stdout **or** stderr), cache/force.
- `client/electron/__tests__/ipc.test.ts` (10) — sender-trust rejection, `RunStart`
  unsupported-language / outside-workspace-root rejection, stdin/stop arg shape,
  external-browser allow-list, thrown→envelope wrapping (no spawn in any path).
- `client/src/services/__tests__/localRun.test.js` (14) — renderer bridge contract
  incl. `NO_BRIDGE` vs `NO_SESSION` and replay delivery.
- `client/src/hooks/__tests__/useIdeActions.test.jsx` (25) — local-first routing,
  `NO_API_SERVER` guard, Stop aborts remote, stdin, mount-time runtime detection.
- `client/src/languages/__tests__/languageCapabilities.test.js` (+1) — pins the
  offline-run registry keys against the main-process `LOCAL_PLANS` (fails if the UI
  ever claims an offline runtime that cannot actually run).

---

## E. Installer

- **Previous known-good installer preserved** (recoverable):
  `\.installer-backup-20261021\StackAmit-IDE-Setup-1.0.0-prev.exe` (+ `info-prev.json`).
  Source-level recovery backup also at `\.recovery-backup-20261021\`.
- **New installer (v1.1.0, the fixed build):**
  - `client\release\StackAmit-IDE Setup 1.1.0.exe`  (NSIS x64, ~103 MB)
  - staged for download: `client\public\downloads\StackAmit-IDE-Setup.exe`
    (`info.json` → version `1.1.0`)
  - unpacked app: `client\release\win-unpacked\StackAmit-IDE.exe`
- Version bumped `1.0.0 → 1.1.0` to keep the two installer files distinguishable on
  disk. node-pty rebuilt for `win32/x64` and asar-unpacked; production loads `file://`
  (verified), never the Vite dev URL.

---

## F. Remaining issues & honest limitations

- **Online run from the packaged desktop app**: the shipped build has an empty
  `VITE_API_URL` by design, so the desktop app is **offline-first** and refuses remote
  run with `NO_API_SERVER`. Online execution is verified from the **web workspace** and
  the backend/live integration suite; enabling it in the desktop build requires
  packaging with a concrete `VITE_API_URL` (C4 already makes CSP allow it). *Not*
  re-tested here as a live desktop-online run — **BLOCKED** in this environment (no
  deployed API origin to point at).
- **Literal "disable the network adapter"**: not performed (needs admin, would disrupt
  the whole machine). Offline behaviour was proven the meaningful way — the packaged app
  ran all three local runtimes with **no dev server and no API server** running, from
  inside `app.asar`.
- **HTML Live Preview / relaunch after reboot** in the packaged app: the preview server
  and window lifecycle are unit-tested (`previewServer.test.ts`, workspace tests) and the
  app was confirmed to launch cleanly, but a full manual "preview an HTML file, reboot,
  relaunch" pass in the installed app was **NOT TESTED** in this session.
- **TypeScript positive remote run**: covered by the deterministic matrix and live
  compile-failure path, not a separate live hello (see A).

---

## G. Copy-paste next steps for the maintainer

```powershell
# 1) Full green gate (deterministic only — safe, no network)
cd c:\Users\amitk\Desktop\StackAmit-IDE\client ; npx.cmd vitest run ; npm.cmd run typecheck:electron
cd ..\server ; npm.cmd test

# 2) Live provider check (needs internet; ~10 min) — do not run offline
cd ..\server ; $env:RUN_INTEGRATION=1 ; node --test tests/integration.test.js ; $env:RUN_INTEGRATION=$null

# 3) Rebuild the Windows installer with the current (fixed) config
cd ..\client ; npm.cmd run dist:win
#    → release\StackAmit-IDE Setup 1.1.0.exe  and  public\downloads\StackAmit-IDE-Setup.exe

# 4) Offline smoke of the PACKAGED app (no dev/API server running)
cd ..\client ; Start-Process .\release\win-unpacked\StackAmit-IDE.exe -ArgumentList "--remote-debugging-port=9222"
cd .. ; node .e2e-preview/p6-offline.mjs           # prints the local-run matrix + a screenshot
Get-Process StackAmit-IDE -ErrorAction SilentlyContinue | Stop-Process -Force

# 5) To ship a DESKTOP build that can also run ONLINE languages, set the API origin
#    before packaging — CSP is baked from it automatically:
#    $env:VITE_API_URL = "https://api.your-host.example" ; cd client ; npm.cmd run dist:win
```
