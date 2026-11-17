<div align="center">

# StackAmit-IDE

**Code. Compile. Create.**

A fast, free code editor and compiler that runs in **two modes**: as a
**browser app** (write a program, pick a language, hit **Run**, see the *real*
execution result) and as a **desktop IDE** (Electron) with a real filesystem
workspace, an integrated terminal and a VS Code-style shell — no sign-up, no
Docker.

</div>

---

## 1. Introduction

StackAmit-IDE is a functional online compiler platform (not a mockup). Users can
edit source code in a professional Monaco editor — 61 editor modes across 64
registered languages and file formats, 18 of them executable — supply standard
input, and execute their program through a real code-execution
engine — all without creating an account.

The browser only ever talks to **our own Express API**, which in turn calls a
remote execution provider **server-to-server**. Submitted code is never executed
inside the API process, and no provider secrets reach the client.

StackAmit-IDE also ships as a **desktop app** (Electron). The desktop build
reuses the exact same React renderer, so the full-featured `/ide` shell — file
explorer, multi-file Monaco tabs, integrated terminal, command palette and
theming — behaves identically in the browser and on the desktop. The only
difference is the **storage layer**: the desktop app talks to real files and a
real PTY through a narrow, validated IPC bridge, while the browser uses a
local virtual filesystem plus optional File System Access import/export.

---

## 2. Features

- **Monaco Editor** (VS Code engine): syntax highlighting, line numbers, bracket
  matching, code folding, auto-indent, word wrap, automatic layout.
- **64 language / file-format entries (61 Monaco editor modes)** in one capability
  registry: 60 with real syntax highlighting (7 backed by Monaco language
  services, 37 by Monaco's bundled grammars, 16 by custom Monarch grammars we
  wrote), 18 with **verified remote execution**, 12 with real linting, 9 with
  real formatting, 22 with starter snippets. See
  [Language Support — Capability Matrix](#14-language-support--capability-matrix)
  for what each language actually offers — highlighting is never sold as
  IntelliSense or as a compiler.
- **Real execution** with actual `stdout`, `stderr`, compiler diagnostics, exit
  status, and success/failure distinction.
- **Offline desktop execution**: the packaged desktop app runs **Python,
  JavaScript and PowerShell locally** through the Electron main process — no dev
  server, no API server, no internet. It spawns the user's own toolchain (child
  process, no shell), scrubs the child environment to an allow-list, separates
  `stdout`/`stderr`, honours `stdin`, reports the real exit code, enforces a time
  limit, and Stop actually kills the process. Every other language still uses
  online execution and is labelled as such — the app never claims to run
  everything offline, and highlighting is never presented as execution. See
  [Offline local execution](#offline-local-execution-no-server).
- **Java dependencies (Desktop Mode)**: a curated **100-library Maven catalog**
  with import detection and a dedicated panel. Added libraries are resolved
  (transitively) from Maven Central into `~/.m2/repository` and placed on both
  the compile and runtime classpath — nothing downloads without an explicit Add,
  and dependency-free Java runs exactly as before. Web Mode honestly reports that
  its provider cannot add Maven libraries. See
  [Java dependencies & the 100-library catalog](#12c-java-dependencies--the-100-library-catalog-desktop-mode).
- **Interactive terminal console** (replaces the old stdin panel): type input
  lines straight at the prompt — they are queued as the program's stdin — and
  read `stdout` / `stderr` / compiler output in one monospace, plain-text
  surface. Includes `/run`, `/clear`, `/stdin`, `/reset-stdin`, `/help` commands
  and a Stop (interrupt) control.
- **Per-language drafts** that survive language switches and page reloads.
- **Customize IDE panel**: theme, font size, font family, tab size, word wrap,
  minimap, line numbers and ligatures — all persisted locally per browser.
- **Local persistence** (no account for users): autosaved drafts, theme, editor
  preferences, layout split.
- **Dark theme by default** with an optional light theme (no flash on load).
- **Keyboard shortcuts**: `Ctrl/⌘ + Enter` run, `Ctrl/⌘ + S` save locally,
  `Ctrl/⌘ + Shift + F` format.
- **Resizable editor/console split** (drag or arrow keys).
- **Full IDE shell at `/ide`** (web *and* desktop): VS Code-style activity bar,
  collapsible file explorer (create / rename / delete / refresh), multi-file
  Monaco editor with tabs and dirty indicators, breadcrumbs, a resizable bottom
  panel (Terminal / Problems / Output), a status bar, a top menu and a command
  palette (`F1`) with quick-open (`Ctrl+P`), plus keyboard shortcuts throughout.
- **Installable extensions** (activity bar → Extensions): a curated set of
  first-party feature modules you can install / enable per need — Prettier
  formatting, Todo Tree annotations, Sticky Scroll, Indent Guides, Color
  Highlight, Whitespace Visibility and an Extra Color Themes pack (Monokai,
  Dracula, Solarized Light). Each drives real Monaco APIs and the choice is
  persisted. These are built-in modules, not a third-party VS Code marketplace
  (foreign extensions are incompatible with this custom renderer).
- **Bundled Monaco, no CDN**: the TypeScript/JSON/CSS/HTML editors run on
  language workers emitted as local chunks — the editor works fully offline.
- **Integrated terminal**: xterm.js backed by a real `node-pty` PTY on the
  desktop (when available), with an honest unavailable state in the browser.
- **Three themes** (`StackAmit Dark Modern` default, a light variant, plus a
  high-contrast option) persisted across sessions.
- **Public marketing pages**: Home, About and Contact Us (responsive, themed).
  Their copy is **admin-editable** from the dashboard and served by the API, with
  the built-in text as the fallback so pages render even if the backend is offline.
- **Contact inbox**: the Contact form submits to the API and stores each enquiry
  in MongoDB for the admin to read (mark read/unread, reply, delete). When the
  database is offline the form honestly falls back to the visitor's mail client —
  a message is never silently dropped.
- **Configurable social links**: the admin sets the company's social URLs
  (Facebook, X, Instagram, LinkedIn, GitHub, YouTube, website); the footer and
  Contact page render only the channels that are actually filled in.
- **Admin dashboard** (single, env-provisioned administrator): sign in at the
  direct `/login` route — there is **no register button and no login link**
  anywhere in the UI. The dashboard shows live system/usage stats, an execution
  audit log (metadata only — never source/input), snippet management, a
  **public-page content editor**, the **contact-message inbox**, and
  admin-editable site settings such as the announcement banner.
- **Company branding**: the company logo and a `StackAmit` link
  (https://stackamit.netlify.app) appear in the site/IDE navigation and footer.
- **Optional snippet sharing** (public, unpredictable, expiring links) backed by
  MongoDB — degrades gracefully when the database is offline.
- **Hardened API**: Helmet, strict CORS, rate limiting, byte-size limits, request
  timeouts, bounded concurrency, structured logging with secret redaction.
- **No user accounts, no Docker.** Admin auth is JWT-based and optional.

---

## 3. Architecture Overview

```
Browser / Electron renderer (React + Vite + Monaco)
        │  one shared /ide shell; the storage provider is chosen at runtime
        ├── Desktop (Electron): window.stackamit IPC bridge ──▶ secure fs + node-pty
        │                                                       (main process)
        └── Web: localStorage virtual FS + File System Access (import/save)
        │
        │  HTTPS/JSON  (execution still only ever goes to OUR API)
        ▼
Express API  ── validation (Zod) ── rate limit ── concurrency guard
        │            │                     │
        │            │                     └── MongoDB Atlas (optional snippets)
        ▼            ▼
   Execution Provider adapter (interface)
        ├── piston   (self-hosted / whitelisted Piston-compatible API)
        └── wandbox  (public Wandbox service — default, works immediately)
```

- The **execution provider** is isolated behind a small interface
  (`health()`, `listSupported()`, `run()`). Adding a provider or language is a
  local change; nothing else needs rewriting.
- The provider is selected by the `EXECUTION_PROVIDER` environment variable.
- A **failure is never presented as success**: if the provider is down, the UI
  shows an honest error and the Run button always recovers.

---

## 4. Screenshots

> Placeholders until genuine screenshots are added.

| Workspace | Output |
| --- | --- |
| `<docs/screenshots/workspace.png>` | `<docs/screenshots/output.png>` |

---

## 5. Technology Stack

**Frontend:** React 18, Vite 5, JavaScript (ESM), `monaco-editor` (bundled,
**no CDN**), `@monaco-editor/react`, Zustand, `@xterm/xterm` (+ fit / web-links
addons), Tailwind CSS 3, React Router 6, Axios, Lucide React.

**Desktop:** Electron 33, TypeScript (main / preload / services, bundled to
CommonJS with esbuild), `contextBridge` IPC, `node-pty` (optional native PTY),
`electron-builder` (NSIS Windows installer).

**Backend:** Node.js, Express 4, MongoDB Atlas via Mongoose 8, Zod, Helmet,
CORS, express-rate-limit, Pino / pino-http.

**Execution:** a configurable Piston-compatible adapter and a Wandbox adapter
behind a common provider interface.

---

## 6. Repository Structure

```
StackAmit-IDE/
├── package.json          # root dev scripts (concurrently, desktop shortcuts)
├── .gitignore
├── client/               # React + Vite frontend AND Electron desktop app
│   ├── .env.example
│   ├── index.html
│   ├── vite.config.js     # base './', dev proxy /api -> :5000, vitest config
│   ├── package.json       # "main" + electron-builder "build" config + scripts
│   ├── scripts/
│   │   ├── build-electron.mjs  # esbuild: TS main/preload -> CommonJS
│   │   └── dev-electron.mjs    # build + Vite + wait-on + launch Electron
│   ├── electron/
│   │   ├── main.ts             # BrowserWindow, CSP, navigation hardening
│   │   ├── preload.ts          # contextBridge -> window.stackamit
│   │   ├── ipc.ts              # IPC handlers w/ sender-origin validation
│   │   ├── shared/ipc.ts       # channel names + Result<T> types
│   │   ├── services/
│   │   │   ├── workspaceFs.ts  # authorized-root fs + path-traversal guard
│   │   │   └── terminal.ts     # node-pty (lazy) + PTY_UNAVAILABLE fallback
│   │   └── tsconfig.json
│   └── src/
│       ├── App.jsx  main.jsx  index.css
│       ├── monaco/             # monacoSetup (bundled workers, no CDN) + themes
│       ├── components/
│       │   ├── {editor,console,layout,ui}/   # original web IDE
│       │   └── ide/            # ActivityBar, FileExplorer, EditorTabs,
│       │                       # MonacoHost, BottomPanel, TerminalPanel,
│       │                       # AiChatPanel, CommandOverlay, TopMenu, IdeShell
│       ├── store/ideStore.js   # Zustand IDE state (docs, tabs, layout, theme)
│       ├── hooks/              # useEditorPrefs, useTheme, useIdeActions, useIdeTheme
│       ├── languages/          # languageCapabilities.js (single source of truth),
│       │                       # customLanguages.js (16 Monarch grammars), snippets.js
│       ├── pages/              # Workspace, IdeApp, SnippetView, Home, About, ...
│       ├── services/           # api.js (OUR API) + workspace.js (storage bridge)
│       └── utils/              # languageDefaults, langForFile, monacoModels, fileIcons
└── server/               # Express API
    ├── .env.example
    ├── src/
    │   ├── app.js  server.js
    │   ├── config/         # env, db, logger, languages (18 runners), executionProvider
    │   ├── controllers/    # health, language, code, snippet, admin, site
    │   ├── middleware/      # rateLimiter, errorHandler
    │   ├── models/         # Snippet, ExecutionLog, ContactMessage, Settings, SiteContent
    │   ├── routes/
    │   ├── services/       # execution.service + providers/{piston,wandbox,http},
    │   │                   # runtimes.js (local toolchain probes),
    │   │                   # interactive.service.js (local interactive WS runs),
    │   │                   # lint.service.js (real syntax diagnostics),
    │   │                   # runtimeInstaller.js (consent-driven winget/choco plans)
    │   ├── utils/          # ApiError
    │   └── validators/     # code.validator (Zod)
    └── tests/              # node:test + supertest suites + opt-in live integration
```

---

## 7. Prerequisites

- **Node.js ≥ 18** (tested on Node 24) and **npm**.
- A modern browser. **Monaco and its language workers are bundled into the
  build — there is no CDN dependency**, so the editor works offline.
- Internet access for **code execution in web mode** (the default provider is a
  public service). Desktop mode can still edit/save/run against the same API.
- **Optional:** a free **MongoDB Atlas** cluster for snippet sharing. The editor
  and execution work fully without it.
- **Desktop app only:** Node + npm are enough to run and package. The integrated
  **terminal uses `node-pty`**, a native module that must be rebuilt against
  Electron's ABI — that needs **VS Build Tools** (Windows) / a C++ toolchain.
  Without it the app still runs; the terminal shows an honest "unavailable"
  state and everything else works. See [Desktop app](#12b-desktop-app-electron).
- **Not required:** Docker, Redis, or any local compiler toolchain.

---

## 8. Installation

Clone/download the repo, then install dependencies for all three package
manifests (root, server, client).

### Windows (PowerShell)

> If script execution is blocked, call npm via `npm.cmd`, or run
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` first.

```powershell
cd StackAmit-IDE
npm install                 # root (concurrently)
npm --prefix server install
npm --prefix client install
```

### Git Bash / Linux / macOS

```bash
cd StackAmit-IDE
npm install
npm --prefix server install
npm --prefix client install
```

Or simply: `npm run install:all`.

### Configure environment

```bash
# PowerShell
Copy-Item server/.env.example server/.env
Copy-Item client/.env.example client/.env

# Git Bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```

Defaults work out of the box (Wandbox provider, no database).

---

## 9. MongoDB Atlas setup (optional)

Only needed for snippet sharing. Basic editing and execution do **not** depend
on it, and the app degrades gracefully if Atlas is unreachable.

1. Create a free M0 cluster at <https://www.mongodb.com/atlas>.
2. Create a database user + password, and allow your IP (or `0.0.0.0/0` for
   trials) under Network Access.
3. Copy the connection string and set it in `server/.env`:
   ```
   MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/stackamit?retryWrites=true&w=majority
   ```
4. Leave `MONGODB_URI=` empty to disable persistence entirely.

Expired snippets are removed automatically via a Mongo TTL index. Standard input
and program output are **never** stored.

---

## 10. Execution Provider setup

The provider is selected with `EXECUTION_PROVIDER`.

### Wandbox (default — works immediately)

```
EXECUTION_PROVIDER=wandbox
WANDBOX_API_URL=https://wandbox.org/api
```

A genuine, long-maintained public compile/run service. No key required. It is a
**shared public endpoint** with rate limits and occasional availability
hiccups — fine for learning and demos, but see [Known limitations](#15).

### Piston (recommended for production)

The official public Piston instance (`emkc.org`) became **whitelist-only in
2026** and will return `401`. For production, host your own Piston (or a
whitelisted deployment) and point the API at it:

```
EXECUTION_PROVIDER=piston
PISTON_API_URL=https://your-piston-host.example
PISTON_RUN_PATH=/api/v2/run
PISTON_RUNTIMES_PATH=/api/v2/runtimes
EXECUTION_API_KEY=            # if your instance requires auth
EXECUTION_API_KEY_HEADER=      # custom header name (else Authorization: Bearer)
```

Runtime versions in `server/src/config/languages.js` should be checked against
your instance's `/runtimes` (or `runtimes`) output and adjusted.

### No provider configured

If `EXECUTION_PROVIDER` names an unknown provider, the API returns a clear
setup message and **never fabricates output**. The editor remains usable.

---

## 11. Environment Variables

### Backend (`server/.env`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | Runtime mode |
| `PORT` | `5000` | API port |
| `CLIENT_URL` | `http://localhost:5173` | Allowed CORS origin |
| `MONGODB_URI` | *(empty)* | Atlas connection string (optional) |
| `EXECUTION_PROVIDER` | `wandbox` | `wandbox` \| `piston` |
| `PISTON_API_URL` | `https://emkc.org/api/v2/piston` | Piston base URL |
| `PISTON_RUN_PATH` / `PISTON_RUNTIMES_PATH` | `/execute` / `/runtimes` | Piston paths |
| `WANDBOX_API_URL` | `https://wandbox.org/api` | Wandbox base URL |
| `EXECUTION_API_KEY` / `EXECUTION_API_KEY_HEADER` | *(empty)* | Server-only provider auth |
| `EXECUTION_TIMEOUT_MS` | `15000` | Upstream timeout |
| `MAX_SOURCE_BYTES` | `65536` | Source size limit |
| `MAX_STDIN_BYTES` | `16384` | Stdin size limit |
| `MAX_OUTPUT_BYTES` | `65536` | Output truncation cap |
| `EXECUTION_RATE_LIMIT_WINDOW_MS` / `EXECUTION_RATE_LIMIT_MAX` | `60000` / `10` | Execution rate limit |
| `MAX_CONCURRENT_EXECUTIONS` | `3` | In-flight upstream request cap |
| `SNIPPET_ENABLED` / `SNIPPET_DEFAULT_TTL_DAYS` | `true` / `30` | Snippet sharing |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | *(empty)* | Single admin account (enables `/login`) |
| `ADMIN_JWT_SECRET` | *(empty)* | Signs admin session tokens. **Required in production**; auto-generated ephemeral secret in dev |
| `ADMIN_TOKEN_TTL_HOURS` | `12` | Admin session lifetime |

### Frontend (`client/.env`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_URL` | *(empty)* | API base URL. A relative `/api` is for the Vite web proxy only; packaged Electron releases require the verified absolute HTTPS backend origin. |
| `VITE_FOOTER_ATTRIBUTION` | `Built by StackAmit` | Footer text |

> **Never** put provider secrets in a `VITE_` variable — they are embedded in the
> public browser bundle.

For a packaged desktop release, provide the deployed backend origin at build
time as `VITE_API_URL=<verified-production-api-origin>`. The Windows release command
rejects the development-only `/api` value instead of producing an installer
that will always show `API offline`. The backend must also allow the packaged
desktop authentication origin according to the existing CORS/session policy.

---

## 12. Running the app

### Two terminals (documented workflow)

```bash
# Terminal 1 — backend
cd server
npm run dev          # http://localhost:5000

# Terminal 2 — frontend
cd client
npm run dev          # http://localhost:5173
```

### One command (from the repo root)

```bash
npm run dev          # starts server + client via concurrently
```

Open **http://localhost:5173** — the Vite dev server proxies `/api/*` to the
backend, so no CORS configuration is needed in development.

The new full IDE lives at **`/ide`** (the original single-file workspace is
still served at `/editor`). On the desktop build the app opens straight into
`/ide`.

---

## 12b. Desktop app (Electron)

The desktop app is the **same renderer** running inside Electron, with a real
filesystem and a real terminal behind a hardened IPC bridge.

### Scripts

| Command (repo root) | Command (in `client/`) | What it does |
| --- | --- | --- |
| `npm run dev:desktop` | `npm run dev:electron` | Build main/preload, start Vite, wait for it, launch Electron pointed at the dev server |
| — | `npm run build:electron` | Bundle `electron/main.ts` + `preload.ts` to CommonJS via esbuild |
| — | `npm run typecheck:electron` | `tsc --noEmit` over the Electron TypeScript |
| `npm run build:desktop` | `npm run build:electron` | Same as above, from the root |
| — | `npm run rebuild` | Rebuild `node-pty` against Electron's ABI (needs VS Build Tools) |
| `npm run dist:win` | `npm run dist:win` | `vite build` + typecheck + electron build + `electron-builder --win` (NSIS installer) |

### Developer mode

```powershell
cd client
npm run dev:electron
```

This builds the main/preload bundles, starts Vite on `http://localhost:5173`,
waits for it to be ready, then launches Electron with `ELECTRON_START_URL` set.
The renderer loads over `http://`, and code changes hot-reload as usual.

### Enabling the real integrated terminal

`node-pty` is optional. On a machine **without** a C++ toolchain the terminal
panel simply reports that a local terminal requires the desktop app with
`node-pty` available. To get a working PTY:

```powershell
cd client
npm run rebuild        # requires Visual Studio Build Tools (C++ workload)
```

Then relaunch. With the rebuilt module present, the Terminal tab spawns your
system shell (`COMSPEC`/`cmd.exe`, PowerShell when configured) and streams I/O
over IPC to xterm.js.

### Offline local execution (no server)

The `Run` action in the **packaged desktop app** executes Python, JavaScript and
PowerShell **entirely offline** via the Electron main process
(`electron/services/localRun.ts` + `runtimeProbe.ts`). The renderer chooses the
path from a single registry (`languageCapabilities.js` → `localRun`):

- A language the main process can run locally never reaches for the network, so
  `Run` keeps working with no backend and no connection.
- Any other language routes to online execution, and `remoteRunAvailability()`
  returns an explicit `NO_API_SERVER` message when the build has no configured
  API origin — the old silent `/api/...`-against-`file://` failure is gone.
- The main process owns every spawn decision: the renderer only ever sends a
  language key, source and (optionally) a saved file path that must live inside
  an opened workspace root. Duplicate `Run` presses are ignored while a run is
  active; `Stop` terminates the child; results stream back over a validated IPC
  channel with early output replayed so nothing is lost.

To ship a build that can *also* run online languages from the desktop app, set
`VITE_API_URL` to your deployed API origin before packaging — the main-process
CSP `connect-src` bakes that origin in automatically (see
`scripts/build-electron.mjs`), so the packaged app can reach its backend without
relaxing the policy. Left unset, the desktop app is offline-first by design.

The full verification of all three runtimes running inside the installed
`app.asar` is in **`VERIFICATION-REPORT.md`** at the repo root.

### Packaging a Windows installer

```powershell
cd client
npm run dist:win
```

Artifacts land in `client/release/` — `StackAmit-IDE Setup <version>.exe` (NSIS)
plus a `win-unpacked/` directory. `node-pty` is placed in `app.asar.unpacked` so
its native binary loads at runtime.

> **Code signing / exe icon on Windows:** by default `electron-builder` extracts
> the `winCodeSign` tool package, which contains macOS symlinks that Windows can
> only unpack with **administrator** rights or **Developer Mode**. This project
> ships with `win.signAndEditExecutable: false`, so packaging (and the installer)
> succeeds without elevation using the default Electron icon. To brand the
> executable with your own icon and signature, install Developer Mode / run
> elevated, add `client/build/icon.ico`, set `win.icon`, and re-enable
> `signAndEditExecutable`.

---

## 12c. Java dependencies & the 100-library catalog (Desktop Mode)

Java can now use third-party libraries — but real dependency resolution is a
**Desktop Mode** feature, and it is deliberately not pretended at in Web Mode.

### What runs where

| Mode | Java execution | External Maven dependencies |
| --- | --- | --- |
| **Desktop** | your installed JDK (`javac`/`java`), offline | **Yes** — resolved from Maven Central into `~/.m2/repository` and placed on the compile + runtime classpath |
| **Web** | the configured remote provider (Wandbox) | **No** — the provider compiles against the JDK standard library only and cannot add arbitrary Maven artifacts |

In Web Mode an external import (anything that is not the JDK or your own
project's packages) is met with an honest Output-panel message telling you to
open the project in Desktop Mode — never a silent failure and never a pretend
"resolving…" that downloads nothing. The interactive local JVM is kept
dependency-free on purpose, so no server-side download surface is introduced.

### The flow (Desktop)

1. **Detect** — as you edit, StackAmit scans the open Java files' `import` /
   `import static` / `import a.b.*` statements (commented-out and string-literal
   imports are ignored) and classifies each as JDK, project-local, a known
   catalog library, or unknown.
2. **Add** — nothing is downloaded automatically. Detected catalog libraries
   appear as *suggestions* you can **Add** (or dismiss); you can also browse the
   catalog and add by hand. Additions are stored **per project** (persisted) and
   listed in the panel.
3. **Resolve** — the **Resolve** action walks the POMs for the added
   coordinates, downloads the JARs into `~/.m2/repository`, and returns an
   absolute classpath. Progress streams to the panel and the Output tab.
4. **Compile + run** — every added JAR is passed to both `javac -cp` and the
   run (`java -cp <outDir>;<jars>`), so the compile and runtime classpath are
   always identical. Dependency-free Java is untouched: when nothing is added,
   no resolve happens, no classpath flag is emitted, and the run is byte-for-byte
   what it was before this feature.

### The panel

Activity bar → **Java Dependencies** (Package icon). Three tabs:

- **Browse** — the curated **100-library catalog** (searchable, category
  filtered). Each entry shows its verified `groupId:artifactId:version`, license,
  and whether it is `verified` against Maven Central or still `pending`.
- **Added** — this project's managed dependencies, with **Resolve**, a
  **Clear cache** action (removes only these coordinates' files, never the whole
  `~/.m2`), and surfaced resolve errors.
- **Detected** — suggestions from your imports (Add / Dismiss) plus any unknown
  import that needs a manual coordinate.

The catalog lives in
[`client/src/data/javaLibraryCatalog.js`](client/src/data/javaLibraryCatalog.js)
(import → dependency mapping is driven by each entry's `packages[]`). It was
live-verified against Maven Central with
[`scripts/verify-java-catalog.mjs`](scripts/verify-java-catalog.mjs);
any entry that could not be verified is marked `pending`, never fabricated.

### Cache & offline

Resolved artifacts are cached in the standard local repository
(`~/.m2/repository`), shared with any Maven build you already run there. Once a
coordinate is cached, re-resolving is an **offline cache hit** (no network). The
panel shows a cached/offline indicator, and a Resolve can be forced offline. A
run always compiles into a **fresh scratch `outDir`**, so stale `.class` files
are never reused.

### Resolution semantics & limits

- Scopes: **compile** and **runtime** dependencies are followed; **provided**,
  **test**, **system** and **optional** dependencies are skipped (matching how
  a plain `javac`/`java` classpath works).
- Version mediation is Maven **nearest-wins**; POM parents, `<dependencyManagement>`
  and `${property}` interpolation are honored.
- This is best-effort mediation, not a full Maven client. Exotic builds —
  BOM imports, version ranges, multi-module reactors, classifiers/`shade`, or
  plugins — may not resolve. For those, add the JAR manually and place it on
  the classpath yourself, or open the project in a real Maven/Gradle setup.

### Security

- Coordinates are validated against a strict `groupId:artifactId:version[:classifier]`
  regex **before** any network or filesystem use; invalid coordinates never
  reach either.
- Downloads are **HTTPS-only** to `repo1.maven.org` (Maven Central); TLS is
  never disabled. Per-file size caps (2 MiB per POM, 80 MiB per JAR) and a
  24-level transitive-depth guard bound the work.
- Writes are atomic and path-traversal-safe (the coordinate→path mapping cannot
  escape `~/.m2`). A downloaded JAR is only ever used as a classpath *path* —
  **it is never executed at install time**. All spawns use argument arrays (no
  shell), and no secrets are carried in coordinates or exposed to the renderer.

> **Currently fixed to Maven Central.** The base URL, cache root and the size /
> depth caps are constants in
> [`client/electron/services/javaDeps.ts`](client/electron/services/javaDeps.ts)
> (not user-facing environment variables). Mirror / private-repository support is
> an internal parameter, not an end-user setting in this release.

---

## 13. API Documentation

Base URL: `http://localhost:5000`.

### `GET /api/health`
App + dependency status (no secrets).
```json
{ "status": "ok", "uptimeSeconds": 42,
  "database": { "connected": false, "state": "disconnected" },
  "execution": { "configured": true, "provider": "wandbox", "available": true } }
```

### `GET /api/languages`
Languages + runtime versions for the configured provider (cross-checked against
the provider's live list; `supported:false` is set when unavailable).
```json
{ "provider": "wandbox", "configured": true, "available": true, "snippetEnabled": true,
  "languages": [ { "key": "python", "label": "Python", "monaco": "python",
                   "fileName": "main.py", "version": "CPython 3.11",
                   "starter": "...", "supported": true } ] }
```

### `GET /api/execution/status`
```json
{ "configured": true, "provider": "wandbox", "available": true }
```

### `POST /api/code/run`
Request:
```json
{ "language": "python", "sourceCode": "print(1+1)", "stdin": "" }
```
Successful run (HTTP 200):
```json
{ "success": true, "status": "completed", "stdout": "2\n", "stderr": "",
  "compileMessage": "", "exitCode": 0, "executionTimeMs": 120,
  "language": "python", "provider": "wandbox" }
```
A program that compiles and runs but exits non-zero is a **real result**:
HTTP 200 with `success:false` and `status` = `compile_error` | `runtime_error` |
`timeout`. Validation and infrastructure failures use proper status codes:

| Situation | HTTP | `code` |
| --- | --- | --- |
| Empty/oversized source, bad stdin, invalid language, malformed JSON | 400 | `VALIDATION_ERROR` / `INVALID_JSON` |
| Rate limit exceeded | 429 | `RATE_LIMIT_EXCEEDED` |
| Provider unreachable | 502 | `PROVIDER_UNAVAILABLE` |
| Provider auth required / misconfigured | 503 | `PROVIDER_UNAVAILABLE` |
| Upstream timeout | 504 | `UPSTREAM_TIMEOUT` |

### `POST /api/snippets` *(optional feature)*
```json
{ "language": "python", "sourceCode": "...", "title": "Demo", "isPublic": true }
```
→ `201` with `{ "id": "...", "shareUrl": "/snippet/<id>", "expiresAt": "..." }`.
Returns `503 DATABASE_UNAVAILABLE` when Atlas is offline.

### `GET /api/snippets/:id`
Returns the snippet **only** if sharing is enabled and it is public; otherwise
`404`.

### `GET /api/site/settings` *(public)*
Non-sensitive, admin-controlled settings the IDE renders.
```json
{ "success": true, "data": { "announcementBanner": "", "snippetEnabled": true, "maintenanceMessage": "" } }
```

### `GET /api/site/content` *(public)*
Admin-managed copy for the Home / About / Contact pages and social links, merged
over built-in defaults so it always returns a complete object.

### `POST /api/site/contact` *(public, rate-limited)*
Stores a contact-form enquiry (`{ name, email, subject?, message }`) in MongoDB
for the admin inbox. Returns `201` on success, or `503 DATABASE_UNAVAILABLE`
when the database is offline (the frontend then falls back to the visitor's
mail client so no message is lost).

### Admin API (`/api/admin`)
A single env-provisioned administrator. There is **no registration**.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/admin/login` | — (rate-limited) | Verifies credentials, returns `{ token }` (JWT) + sets an `HttpOnly` cookie |
| `POST` | `/api/admin/logout` | — | Clears the session cookie |
| `GET` | `/api/admin/me` | Bearer / cookie | Confirms the session |
| `GET` | `/api/admin/dashboard` | admin | Usage stats (30d) + subsystem status |
| `GET` | `/api/admin/executions` | admin | Recent audit rows — **metadata only, never source/input** |
| `GET`/`PATCH` | `/api/admin/settings` | admin | Read / update site settings |
| `GET`/`PATCH` | `/api/admin/content` | admin | Read / overwrite public-page data (Home, About, Contact, social) |
| `GET` | `/api/admin/messages` | admin | Contact-form inbox (with unread count) |
| `PATCH`/`DELETE` | `/api/admin/messages/:id` | admin | Mark a message read/unread, or delete it |
| `GET` | `/api/admin/snippets` | admin | List shared snippets (metadata) |
| `DELETE` | `/api/admin/snippets/:id` | admin | Remove a snippet |

Protected calls return `401 UNAUTHORIZED` without a valid session; settings
writes return `503 DATABASE_UNAVAILABLE` when MongoDB is offline.

---

## 13b. Frontend Routes, Admin & Branding

| Route | Access | Description |
| --- | --- | --- |
| `/` | public | **Home** — marketing landing page |
| `/about` | public | **About** the product & company |
| `/contact` | public | **Contact Us** (validated form → stored in the admin inbox; mail-client fallback if the DB is offline) |
| `/editor` | public | The original single-file workspace (Monaco + terminal console + customization) |
| `/ide` | public | The full VS Code-style IDE shell — activity bar, file explorer, multi-file tabs, bottom panel, integrated terminal, command palette, installable extensions, AI panel placeholder. Opens at app start on desktop. |
| `/snippet/:id` | public | Shared-snippet viewer |
| `/login` | direct URL only | **Admin sign-in.** No button or link points here — open it deliberately. |
| `/admin` | admin (protected) | **Dashboard** — stats, execution audit, snippets, **public-page editor**, **contact inbox**, site settings |

- **Admin credentials** come from `server/.env` (`ADMIN_USERNAME`, `ADMIN_PASSWORD`,
  `ADMIN_JWT_SECRET`). In production the server refuses to boot without
  `ADMIN_JWT_SECRET`. Sessions are JWTs sent as `Authorization: Bearer` and also
  mirrored in an `HttpOnly` cookie.
- **Company navigation**: every visible **StackAmit** brand and the footer links
  point to https://stackamit.netlify.app; Home/About/Contact are wired in both the
  site header and the IDE navbar/footer.
- **Logo**: drop your image at **`client/public/logo.jpg`** and it is used in the
  header, footer, IDE and login automatically. If the file is absent the brand
  falls back to the built-in icon, so nothing looks broken.

---

## 14. Language Support — Capability Matrix

One source of truth: **`client/src/languages/languageCapabilities.js`** (64
entries). Editor, file detection, language selector, Run menu, snippets,
formatting and the status bar all read from it — there is no second hardcoded
language list anywhere in the app.

Honest totals (each row below is generated from the registry, not typed by hand
— `node .e2e-preview/matrix.mjs` regenerates it):

| Capability | Count | What "verified" means here |
| --- | --- | --- |
| Registered languages / editor modes | **64** entries over **61** Monaco language ids | JSX, TSX and SVG are documented *editor modes* of JavaScript/TypeScript/XML, not extra languages |
| Syntax highlighting | **60** | 7 Monaco language services + 37 bundled grammars + 16 custom Monarch grammars we wrote; 1 entry (Plain Text) has no grammar by definition |
| Basic autocomplete (keywords, snippets, word-based) | **54** | Real Monaco `CompletionItemProvider`s; **22** languages ship starter snippets |
| Semantic IntelliSense | **7** | JavaScript, TypeScript, JSON, CSS, SCSS, Less, HTML — the only language workers bundled. Everything else is honestly labelled *basic*, never "IntelliSense" |
| Formatting / linting | **9** formatted (4 language-service + 5 Prettier), **12** linted (4 native Monaco + 8 server-side local syntax checks) | Server lint runs the *installed* local toolchain in `-fsyntax-only` style mode; no fake diagnostics |
| Verified online execution | **18** | Python, C, C++, Java, JavaScript, TypeScript, Go, Rust, C#, PHP, Ruby, Perl, Lua, Julia, Haskell, SQL, Shell, Pascal — each ran a real program through the live provider on 2026-10-21 |
| Verified local execution (packaged desktop app, offline) | **3** | Python (valid / non-zero / stdin / stdout-stderr split / timeout+Stop kill / spaces+unicode paths), Node.js and PowerShell all ran **inside the installed `app.asar`** with no dev or API server (verified over CDP); **22** toolchains are probed and **18** have an interactive plan, but a language is only "local" once its toolchain is installed |
| Live preview participants | **5** | HTML, CSS, SCSS, Less, JavaScript in the static Go-Preview surface |
| Languages with a documented local toolchain + install id | **24** | `winget` package ids shown in the UI; nothing is installed without an explicit consent popup |

### Semantic language services (Monaco workers)

| Language | Editor mode | Files | Highlighting | IntelliSense | Format / lint | Online run | Local toolchain | Preview |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| JavaScript | `javascript` | .js .mjs .cjs | language service | Semantic | language-service / native | yes | `node` | yes |
| TypeScript | `typescript` | .ts | language service | Semantic | language-service / native | yes | `node` | — |
| JSON | `json` | .json .jsonc | language service | Semantic | prettier / native | — | — | — |
| CSS | `css` | .css | language service | Semantic | language-service / native | — | — | yes |
| SCSS / Sass | `scss` | .scss .sass | language service | Semantic | prettier | — | — | yes |
| Less | `less` | .less | language service | Semantic | prettier | — | — | yes |
| HTML | `html` | .html .htm | language service | Semantic | language-service | — | — | yes |
| JSX *(editor mode)* | `javascript` | .jsx | language service | Semantic | language-service / native | yes | — | — |
| TSX *(editor mode)* | `typescript` | .tsx | language service | Semantic | language-service / native | yes | — | — |

### Verified online execution (remote batch provider)

| Language | Editor mode | Files | Highlighting | IntelliSense | Format / lint | Online run | Local toolchain |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Python | `python` | .py .pyw .pyi | bundled | Basic + snippets | server lint | yes | `python` |
| C | `c` | .c .h | bundled | Basic + snippets | server lint | yes | `gcc` |
| C++ | `cpp` | .cpp .cc .cxx .hpp .hh .inl | bundled | Basic + snippets | server lint | yes | `g++` |
| Java | `java` | .java | bundled | Basic + snippets | server lint | yes | `java` |
| C# | `csharp` | .cs | bundled | Basic + snippets | — | yes | `dotnet` |
| Go | `go` | .go | bundled | Basic + snippets | server lint | yes | `go` |
| Rust | `rust` | .rs | bundled | Basic + snippets | — | yes | `rustc` |
| PHP | `php` | .php .php4 .php5 .phtml | bundled | Basic + snippets | server lint | yes | `php` |
| Ruby | `ruby` | .rb | bundled | Basic + snippets | server lint | yes | `ruby` |
| Julia | `julia` | .jl | bundled | Basic | — | yes | `julia` |
| Perl | `perl` | .pl .pm .pod | bundled | Basic + snippets | — | yes | `perl` |
| Lua | `lua` | .lua | bundled | Basic + snippets | — | yes | `lua` |
| Haskell | `haskell` | .hs .lhs | custom Monarch | Basic + snippets | — | yes | `runghc` |
| SQL (SQLite) | `sql` | .sql | bundled | Basic + snippets | — | yes | `sqlite3` |
| Shell (Bash) | `shell` | .sh .bash .zsh | bundled | Basic + snippets | server lint | yes | `bash` |
| Pascal | `pascal` | .pas .pp .inc | bundled | Basic | — | yes | `fpc` |

`bundled` = Monaco's own shipped grammar. The Java starter intentionally uses
`class Main` (package-private) so it compiles whether the provider names the file
`Main.java` (Piston) or `prog.java` (Wandbox). TypeScript, C# and SQL have a
remote runner but **no interactive local plan** — they need a compiler pipeline
or a database server, and we do not fake it.

### Editing + documented local toolchain (no verified online runner)

| Language | Editor mode | Files | Highlighting | IntelliSense | Local toolchain |
| --- | --- | --- | --- | --- | --- |
| Kotlin | `kotlin` | .kt .kts | bundled | Basic + snippets | `kotlinc` |
| Dart | `dart` | .dart | bundled | Basic | `dart` |
| F# | `fsharp` | .fs .fsi .fsx .fsscript | bundled | Basic + snippets | `dotnet` |
| Elixir | `elixir` | .ex .exs | bundled | Basic + snippets | `elixir` |
| PowerShell | `powershell` | .ps1 .psm1 .psd1 | bundled | Basic + snippets | `pwsh` / `powershell` |
| Groovy | `groovy` | .groovy .gvy .gy .gradle | custom Monarch | Basic | `groovy` |

These are runnable **locally** if you install the toolchain (the desktop
interactive runner has a plan for Kotlin and PowerShell); they are *not*
advertised as runnable online because the public provider's images for them were
broken during the 2026-10-21 probe.

### Editing only (highlighting, file detection, editor behaviour)

| Language | Editor mode | Files | Highlighting | Snippets |
| --- | --- | --- | --- | --- |
| Swift | `swift` | .swift | bundled | — |
| R | `r` | .r .rd | bundled | — |
| Scala | `scala` | .scala .sc | bundled | yes |
| Objective-C | `objective-c` | .m .mm | bundled | — |
| Visual Basic .NET | `vb` | .vb .vbs | bundled | — |
| Clojure | `clojure` | .clj .cljs .cljc .edn | bundled | yes |
| Erlang | `erlang` | .erl .hrl .es | custom Monarch | — |
| OCaml | `ocaml` | .ml .mli | custom Monarch | — |
| PL/SQL | `plsql` | .pls .plsql .pck .bdy .spc | custom Monarch | — |
| Fortran | `fortran` | .f .for .f77 .f90 .f95 .f03 .f08 | custom Monarch | — |
| COBOL | `cobol` | .cob .cbl .cpy | custom Monarch | — |
| Assembly (x86) | `asm` | .asm .s .nasm | custom Monarch | — |
| MATLAB | `matlab` | .mlx .mat .mex .fig | custom Monarch | — |
| Vue | `vue` | .vue | custom Monarch | — |
| Svelte | `svelte` | .svelte | custom Monarch | — |
| Astro | `astro` | .astro | custom Monarch | — |
| Markdown | `markdown` | .md .markdown | bundled | yes |
| YAML | `yaml` | .yml .yaml | bundled | — |
| XML | `xml` | .xml | bundled | — |
| SVG *(editor mode)* | `xml` | .svg | bundled | — |
| TOML | `toml` | .toml | custom Monarch | — |
| INI / Properties | `ini` | .ini .cfg .properties | bundled | — |
| Dockerfile | `dockerfile` | Dockerfile Containerfile | bundled | — |
| Makefile | `makefile` | .mk Makefile GNUmakefile | custom Monarch | — |
| Terraform / HCL | `hcl` | .tf .hcl | bundled | — |
| Nginx configuration | `nginx` | .conf | custom Monarch | — |
| Protocol Buffers | `proto` | .proto | bundled | — |
| WebAssembly Text | `wat` | .wat .wast | custom Monarch | — |
| GraphQL | `graphql` | .graphql .gql | bundled | — |
| Solidity | `sol` | .sol | bundled | — |
| Batch | `bat` | .bat .cmd | bundled | yes |
| Tcl | `tcl` | .tcl | bundled | — |
| Plain Text | `plaintext` | .txt | none | — |

> **Reading the matrix:** *Highlighting* only promises tokenized colors, bracket
> pairs, comment toggling and correct file detection. It never implies a
> compiler. The in-app **Languages & Capabilities** view (activity bar → BookOpen
> icon, or Run menu → *Languages & Capabilities…*) renders exactly these registry
> fields, filters by *All / Runnable online / Runnable locally / Web preview /
> Setup required*, and shows the install command for anything missing.

---

## 15. Testing

### Backend (Node's built-in test runner + supertest)
```bash
cd server
npm test                 # deterministic, provider is stubbed (no network)
```
Covers: health, languages, execution status, empty/invalid/oversized input,
malformed JSON, real result parsing, honest compile-error handling, provider
unavailability, DB-offline degradation, admin authentication (valid/invalid
credentials, protected routes, bearer-token access), admin settings, and the
public site-settings endpoint.

**Integration** (hits the real execution provider; requires network):
```bash
cd server
RUN_INTEGRATION=1 npm run test:integration    # Git Bash
$env:RUN_INTEGRATION=1; npm run test:integration   # PowerShell
node ../.e2e-preview/run-live-integration.ps1      # PowerShell helper (sets the vars for you)
```
Verifies real execution for **all 18 registered runners** (Python, C, C++, Java,
Node, Go, Rust, C#, PHP, Ruby, Perl, Lua, Julia, Haskell, SQL, Shell, Pascal),
stdin handling, compile-error reporting, and that every registered Wandbox
compiler id is still listed by the live provider catalog. The public provider
needs 180s for cold GHC/rustc/dotnet compiles, so the suite raises
`EXECUTION_TIMEOUT_MS` and spaces its requests; only *transport-level* failures
(`PROVIDER_UNAVAILABLE`) are retried — a compile error or wrong output is a real
failure and is never retried away. **These are only reported as passing when
they actually run green.**

### Frontend / desktop (Vitest + Testing Library)
```bash
cd client
npm test                 # jsdom + node environment, 18 files / 220 tests
```
Covers the interactive `Terminal` component, the **capability registry** (no
over-claimed IntelliSense / runner / extension, every registered extension
routes to the entry that declares it, shared grammars only via documented
editor-mode variants), **16 custom Monarch grammars against the real
`monaco-editor` package** (`monaco.editor.tokenize()` must actually produce
comment / keyword / string / number tokens with zero `invalid` output — this
harness is what caught the phantom `solidity`/`protobuf` language ids),
language-service registration, snippet registration and tab-stop limits, the
registry-derived run defaults (`languageDefaults`), file →
Monaco-language / run-key detection (`langForFile`), the **web storage
abstraction** (virtual-filesystem CRUD, rename subtree, non-empty delete guard,
localStorage persistence), and the **Electron filesystem guard** (`workspaceFs`):
path-traversal / outside-root rejection, illegal-name rejection, create-clobber
rejection, and non-recursive delete protection. Electron TypeScript is
separately type-checked with `npm run typecheck:electron`.

**Local runtime smoke** (only runs what this machine actually has installed):
```bash
node .e2e-preview/local-smoke.mjs   # boots the real interactive WS service
```
On the development machine this verified Python (including typing a live stdin
line), Node.js and PowerShell through the same code path the desktop app uses;
languages whose toolchain is absent are reported as skipped, never as passing.

---

## 16. Known Limitations & Provider Quotas

- The default **Wandbox** provider is a shared public service: rate-limited,
  latency-variable, and occasionally unavailable. StackAmit-IDE surfaces these
  as clear, retryable errors — it never fakes success. Cold compiles (Rust, Haskell,
  C#) can exceed 60s and time out under the default `EXECUTION_TIMEOUT_MS`; the
  live integration suite raises it to 180s for exactly that reason.
- **Only 18 of the 64 registry entries can execute remotely.** Everything else is
  explicitly marked *no runner* in the registry, the selector, the status bar and
  the Languages view. Languages whose provider images were broken during the
  2026-10-21 probe (Swift, Elixir, Erlang, OCaml, Scala, Mono/VB) are deliberately
  **not** registered as runners rather than being advertised and failing.
- **Semantic IntelliSense exists for 7 editor modes only** (JS/TS/JSON/CSS/SCSS/Less/HTML)
  — the language workers Monaco actually bundles. Pyright, TypeScript-Server and
  clangd are recorded in the registry as `lsServer` *candidates* and are not
  shipped: wiring them means managing per-platform server binaries, which this
  project deliberately avoids.
- **No debugger integration** is claimed for any language. Live Preview covers
  static HTML/CSS/JS (plus Vite/React dev-server projects in the desktop
  workspace); it does not run arbitrary programs from the browser — a browser
  cannot start local processes, so *local* execution requires the desktop app and
  the installed toolchain.
- **Windows is the reference platform** for local toolchains: runtime probes,
  interactive plans and the consent-driven installer use `winget` (Chocolatey
  fallback) package ids. `bash` for Shell is probed as Git Bash/WSL, `pwsh` falls
  back to `powershell.exe`, and the PowerShell plan passes `-ExecutionPolicy
  Bypass` for the generated temp script only. Nothing is auto-installed.
- **Application-side limits** (size, rate, concurrency, timeouts) reduce abuse and
  load but do **not** guarantee provider-side protection. For production, use a
  dedicated, authenticated provider you control.
- **Monaco is bundled, not CDN-loaded** — the editor needs no internet. Only
  *execution* (web mode) and the optional admin/snippet features do.
- The desktop **integrated terminal requires `node-pty`**, which must be rebuilt
  against Electron's ABI (`npm run rebuild`) using a C++ toolchain. Without it
  the terminal is honestly disabled; editing, running, saving and packaging all
  still work.
- In-browser **formatting** is real for JavaScript/TypeScript/JSON/HTML/CSS/SCSS/Less
  (Monaco language services) and the curated **Prettier extension** covers JS, TS,
  JSON, CSS, SCSS, Less, HTML, Markdown and YAML (it overrides *Format Document*
  when installed). The registry marks the 5 formats without a Monaco formatter as
  `formatter: 'prettier'`; every other language shows an honest
  "no formatter configured" message rather than a fake one.
- **Windows packaging without elevation** uses the default Electron icon and no
  code signature (via `win.signAndEditExecutable: false`). Branding/signing needs
  Developer Mode or an elevated shell — see [Desktop app](#12b-desktop-app-electron).
- Snippet sharing requires MongoDB; without it, drafts live only in the browser.
- **Java dependency resolution is Desktop-only.** Web Mode cannot add Maven
  dependencies (the remote provider compiles against the JDK standard library
  only), so an external import there gets an honest "open this in Desktop Mode"
  message rather than a fake resolve. Desktop resolution is best-effort Maven
  mediation — BOMs, version ranges, multi-module builds, classifiers/`shade` and
  plugins may need a manual JAR. Feeding the resolved classpath to the Java
  language server (to clear red squiggles on not-yet-resolved imports) is out of
  scope for this release.

---

## 17. Deployment Guidance

- **API:** deploy `server/` to any Node host (Render, Fly, Railway, a VM). Set
  `NODE_ENV=production`, `PORT`, `CLIENT_URL` (your frontend origin), a
  provider you control (`EXECUTION_PROVIDER=piston` + `PISTON_API_URL`), and
  optionally `MONGODB_URI`.
- **Frontend:** run `npm run build` in `client/` and serve `client/dist/` from any
  static host/CDN. Set `VITE_API_URL` to your deployed API origin at build time.
- Keep secrets **server-side only**. Enable HTTPS. Tune limits to your provider.
- **Desktop:** produce the Windows installer with `npm run dist:win` (from the
  root or `client/`) and distribute `client/release/StackAmit-IDE Setup *.exe`.
  Point `VITE_API_URL` at your deployed API before building so the packaged app
  reaches the right backend. macOS/Linux targets are configured by extending the
  `build` section in `client/package.json`.

---

## 18. Security Considerations

- Untrusted code runs only on the isolated remote provider, never in the API
  process. No local `exec`/`spawn` fallback exists in the **batch** Run path.
- **Local interactive runs are a separate, explicitly-gated feature**: disabled
  entirely in production unless `LOCAL_RUN_ENABLED=true`, origin-allow-listed,
  capped by concurrent-session and output limits, idle-reaped, and confined to a
  throwaway temp directory that is removed on close. Commands come from a fixed
  per-language plan table — the client only ever sends a language key, never a
  command line. **This is a convenience for a developer's own machine, not a
  multi-user sandbox**: a plain child process gives no filesystem/network/CPU
  isolation, so a public deployment must keep it off and use a properly isolated
  provider.
- Providers are called server-to-server; the browser cannot supply arbitrary
  URLs or runtime versions (client versions are ignored in favor of the registry).
- Zod allowlists languages and enforces byte limits; `express.json` caps payload
  size; responses are truncated.
- Helmet security headers, strict CORS allowlist, and rate limiting on execution.
- Pino redacts `authorization`, URIs, source code, and stdin from logs.
- Compiler/program output is rendered as plain text — never as HTML.
- `.env` files are git-ignored; only `.env.example` files (no secrets) ship.

### Desktop (Electron) hardening

- The renderer runs with `contextIsolation: true`, `nodeIntegration: false` and
  `sandbox: true`. No Node primitives are exposed to page code — the only OS
  access is the narrow `window.stackamit` bridge defined in the preload script.
- **A remote code-execution `exec`/`spawn` fallback still does not exist**; the
  integrated terminal is a deliberate, user-initiated shell session, not part of
  the "Run" path.
- Every IPC handler validates the **sender frame origin** against a trust list
  (the dev `http://localhost` origin, or the packaged `file://` index) and
  returns a structured `{ ok:false, code:'UNTRUSTED_SENDER' }` otherwise.
- Filesystem access is confined to **authorized roots** added only via native
  Open/Save dialogs. Each path is canonicalized with `realpath` (following
  symlinks) and must resolve inside a root, blocking `..` traversal and
  symlink-escape; illegal filename characters are rejected and destructive ops
  refuse recursive directory deletes unless explicitly confirmed.
- Navigation is restricted (`will-navigate` deny), popups are denied and external
  `http(s)` links open in the OS browser via `shell.openExternal`. A restrictive
  **Content-Security-Policy** is applied on every response (`default-src 'self'`,
  `object-src 'none'`, `frame-ancestors 'none'`, `worker-src 'self' blob: file:`).
  `connect-src` is localhost-only by default and additionally allows the backend
  origin baked in from `VITE_API_URL` at build time, so a packaged app can reach
  its own API without opening the policy to arbitrary hosts.

---

## 19. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| "engine offline" pill / `PROVIDER_UNAVAILABLE` | Public provider down or Piston needs auth | Retry; switch to a self-hosted provider; set `EXECUTION_API_KEY` |
| `401` from Piston | Public Piston is whitelist-only | Self-host Piston and set `PISTON_API_URL` |
| `DATABASE_UNAVAILABLE` when sharing | No/failed Atlas connection | Set `MONGODB_URI` or use local drafts |
| Editor shows a blank canvas | Stale `dist` / worker chunk | Rebuild (`npm run build`); Monaco is bundled, no CDN needed |
| Terminal tab says local terminal unavailable | `node-pty` not built for Electron | Run `npm run rebuild` with VS Build Tools, then relaunch |
| `electron-builder` fails extracting `winCodeSign` (symlink privilege) | No admin / Developer Mode | Keep `signAndEditExecutable: false`, or enable Developer Mode to brand/sign the exe |
| CORS error in console | Wrong `CLIENT_URL` | Match the frontend origin exactly |
| `npm : cannot be loaded` (PowerShell) | Script policy | Use `npm.cmd …` or `Set-ExecutionPolicy RemoteSigned` |
| Java run says a dependency "is not on the classpath" | Nothing added/resolved yet | Java Dependencies panel → **Add** the library, then **Resolve** (Desktop Mode only) |
| External Java import fails to compile in Web Mode | The remote provider has no Maven dependencies | Open the project in **Desktop Mode** and resolve it there — Web Mode cannot add libraries |
| Java resolve fails / a coordinate is stale | Offline, bad coordinate, or a cached artifact is broken | Check the network, fix the `groupId:artifactId:version`, or **Clear cache** for that coordinate and re-resolve |

---

## 20. AI foundation

Milestone 1 supports runtime-discovered Ollama models, OpenAI, Google Gemini, and OpenAI-compatible providers. Desktop Ollama traffic stays behind the trusted Electron main process; cloud credentials remain server-side. See [docs/AI_ARCHITECTURE.md](docs/AI_ARCHITECTURE.md), [docs/AI_PROVIDERS.md](docs/AI_PROVIDERS.md), [docs/OLLAMA_SETUP.md](docs/OLLAMA_SETUP.md), and [docs/AI_SECURITY.md](docs/AI_SECURITY.md).

## 21. License / Attribution

Built by **StackAmit** — *Code. Compile. Create.*
