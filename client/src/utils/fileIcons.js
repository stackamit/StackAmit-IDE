/**
 * File/folder icon mapping for the Explorer, used by the `file-icons`
 * extension. Returns a real lucide-react icon component plus a Tailwind color
 * class based on the file name/extension — the same idea as VS Code's
 * materialicon theme, but self-contained (no external icon fonts).
 */
import {
  File as FileIcon, FileJson, FileCode, FileCode2, FileText, FileCog, FileArchive,
  FileSpreadsheet, FileAudio, FileVideo, Braces, Image as ImageIcon, Settings,
  Terminal, Lock, Scroll, FileType, Cpu, Binary, Coffee, Database, Globe, FileDigit,
} from 'lucide-react';

// extension -> [Icon, colorClass]
const BY_EXT = {
  js: [FileCode2, 'text-yellow-400'],
  mjs: [FileCode2, 'text-yellow-400'],
  cjs: [FileCode2, 'text-yellow-400'],
  jsx: [FileCode2, 'text-cyan-400'],
  ts: [Braces, 'text-sky-400'],
  mts: [Braces, 'text-sky-400'],
  cts: [Braces, 'text-sky-400'],
  tsx: [Braces, 'text-teal-400'],
  json: [FileJson, 'text-amber-400'],
  jsonc: [FileJson, 'text-amber-400'],
  html: [FileCode, 'text-orange-400'],
  htm: [FileCode, 'text-orange-400'],
  css: [FileCog, 'text-blue-400'],
  scss: [FileCog, 'text-pink-400'],
  sass: [FileCog, 'text-pink-400'],
  less: [FileCog, 'text-purple-400'],
  md: [FileText, 'text-slate-300'],
  markdown: [FileText, 'text-slate-300'],
  txt: [FileText, 'text-slate-400'],
  py: [FileType, 'text-emerald-400'],
  // Java gets its own glyph: it is the project's flagship language, and sharing
  // the generic code icon with a dozen others made every .java file look
  // "wrong" in the Explorer.
  java: [Coffee, 'text-rose-400'],
  jar: [FileArchive, 'text-rose-300'],
  war: [FileArchive, 'text-rose-300'],
  class: [FileDigit, 'text-rose-400/80'],
  kt: [FileType, 'text-orange-400'],
  kts: [FileType, 'text-orange-400'],
  c: [FileType, 'text-indigo-400'],
  h: [FileType, 'text-indigo-300'],
  cpp: [FileType, 'text-blue-300'],
  cc: [FileType, 'text-blue-300'],
  cxx: [FileType, 'text-blue-300'],
  hpp: [FileType, 'text-blue-200'],
  hh: [FileType, 'text-blue-200'],
  cs: [FileType, 'text-violet-400'],
  go: [FileType, 'text-cyan-300'],
  rs: [FileType, 'text-orange-300'],
  php: [FileType, 'text-indigo-300'],
  rb: [FileType, 'text-rose-300'],
  swift: [FileType, 'text-orange-500'],
  sql: [Database, 'text-sky-300'],
  sh: [Terminal, 'text-green-400'],
  bash: [Terminal, 'text-green-400'],
  bat: [Terminal, 'text-lime-400'],
  cmd: [Terminal, 'text-lime-400'],
  ps1: [Terminal, 'text-sky-300'],
  yml: [FileCog, 'text-yellow-300'],
  yaml: [FileCog, 'text-yellow-300'],
  xml: [FileCode, 'text-orange-300'],
  svg: [ImageIcon, 'text-violet-400'],
  png: [ImageIcon, 'text-violet-400'],
  jpg: [ImageIcon, 'text-violet-400'],
  jpeg: [ImageIcon, 'text-violet-400'],
  gif: [ImageIcon, 'text-violet-400'],
  webp: [ImageIcon, 'text-violet-400'],
  ico: [ImageIcon, 'text-violet-400'],
  zip: [FileArchive, 'text-orange-300'],
  tar: [FileArchive, 'text-orange-300'],
  gz: [FileArchive, 'text-orange-300'],
  rar: [FileArchive, 'text-orange-300'],
  '7z': [FileArchive, 'text-orange-300'],
  csv: [FileSpreadsheet, 'text-emerald-300'],
  xlsx: [FileSpreadsheet, 'text-emerald-400'],
  xls: [FileSpreadsheet, 'text-emerald-400'],
  mp3: [FileAudio, 'text-fuchsia-400'],
  wav: [FileAudio, 'text-fuchsia-400'],
  mp4: [FileVideo, 'text-fuchsia-300'],
  webm: [FileVideo, 'text-fuchsia-300'],
  lock: [Lock, 'text-slate-400'],
  toml: [Settings, 'text-slate-300'],
  ini: [Settings, 'text-slate-300'],
  cfg: [Settings, 'text-slate-300'],
  conf: [Settings, 'text-slate-300'],
  properties: [Settings, 'text-slate-300'],
  env: [Lock, 'text-yellow-500'],
  // Build files: the Java project markers the language server also recognises.
  gradle: [Cpu, 'text-emerald-300'],
  pro: [Cpu, 'text-slate-300'],
  mk: [Terminal, 'text-slate-300'],
  log: [Scroll, 'text-slate-500'],
};

// exact file names -> [Icon, colorClass]
const BY_NAME = {
  'package.json': [FileJson, 'text-red-400'],
  'package-lock.json': [Lock, 'text-rose-400'],
  'tsconfig.json': [Braces, 'text-blue-400'],
  'jsconfig.json': [Braces, 'text-yellow-400'],
  dockerfile: [Cpu, 'text-sky-400'],
  containerfile: [Cpu, 'text-sky-400'],
  makefile: [Terminal, 'text-slate-300'],
  'pom.xml': [Coffee, 'text-rose-400'],
  'build.gradle': [Coffee, 'text-emerald-300'],
  'build.gradle.kts': [Coffee, 'text-emerald-300'],
  'settings.gradle': [Coffee, 'text-emerald-400/80'],
  gradlew: [Terminal, 'text-emerald-400'],
  'gradlew.bat': [Terminal, 'text-lime-400'],
  'manifest.mf': [Coffee, 'text-rose-300'],
  '.gitignore': [Binary, 'text-slate-400'],
  '.gitattributes': [Binary, 'text-slate-400'],
  '.env': [Lock, 'text-yellow-500'],
  '.editorconfig': [Settings, 'text-slate-300'],
  'readme.md': [Scroll, 'text-slate-200'],
  license: [Scroll, 'text-slate-300'],
  'index.html': [Globe, 'text-orange-400'],
};

/**
 * Extension of a file name, or '' when there is none. A leading dot is part of
 * the name, not an extension separator (`.env`, `.gitignore` -> no extension),
 * so those files resolve through BY_NAME instead of through a bogus suffix.
 */
function extOf(name) {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return '';
  return name.slice(dot + 1).toLowerCase();
}

/**
 * Returns { Icon, className } for a file name. Always defined, and never
 * undefined-fielded: a missing `name` (older workspace providers) falls back to
 * the generic page icon instead of rendering nothing at all.
 */
export function fileIconMeta(name = '') {
  const safe = String(name || '');
  const lower = safe.toLowerCase();
  if (BY_NAME[lower]) {
    const [Icon, className] = BY_NAME[lower];
    return { Icon, className };
  }
  // Dot-files without a real extension (.bashrc, .profile) are configurations.
  const withoutDot = lower.replace(/^\.+/, '');
  if (withoutDot && !extOf(withoutDot) && BY_NAME[withoutDot]) {
    const [Icon, className] = BY_NAME[withoutDot];
    return { Icon, className };
  }
  const ext = extOf(safe);
  if (ext && BY_EXT[ext]) {
    const [Icon, className] = BY_EXT[ext];
    return { Icon, className };
  }
  return { Icon: FileIcon, className: 'text-slate-400' };
}

// Special folder colors (e.g. src, node_modules, dist) for the enabled pack.
// Both `.git` and the bare `git` spelling are listed because the lookup uses
// the real directory name, and `.git` is the one that actually exists on disk.
const FOLDERS = {
  node_modules: 'text-rose-400/80',
  src: 'text-brand-400',
  dist: 'text-slate-400',
  build: 'text-slate-400',
  target: 'text-slate-400',
  out: 'text-slate-400',
  bin: 'text-lime-400',
  lib: 'text-emerald-300',
  libs: 'text-emerald-300',
  public: 'text-emerald-400/80',
  assets: 'text-violet-400/80',
  components: 'text-cyan-400',
  hooks: 'text-fuchsia-400',
  pages: 'text-amber-400',
  utils: 'text-lime-400',
  services: 'text-sky-400',
  styles: 'text-pink-400',
  test: 'text-emerald-400',
  tests: 'text-emerald-400',
  __tests__: 'text-emerald-400',
  git: 'text-orange-400',
  '.git': 'text-orange-400',
  gradle: 'text-emerald-300',
  '.gradle': 'text-emerald-400/80',
  '.mvn': 'text-rose-400/80',
  '.idea': 'text-violet-400',
  '.vscode': 'text-sky-400',
};

/** Returns a Tailwind color class for a folder name (defaults to amber). */
export function folderColorClass(dirName = '') {
  return FOLDERS[dirName.toLowerCase()] || 'text-amber-400/80';
}
