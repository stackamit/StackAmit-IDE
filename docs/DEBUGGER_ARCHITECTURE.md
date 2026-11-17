# Debugger Architecture

## Current status

StackAmit IDE supports real Python debugging when the selected runtime can
import `debugpy`. The renderer uses an allow-listed debug command bridge; it
never opens a DAP socket directly. Python is the only debugger-capable language
advertised by this implementation.

## Execution boundaries

### Web IDE

The browser uses the configured remote batch provider for batch execution. When
the server reports a compatible runtime, interactive execution uses
`/api/interactive`; the child process runs on the API server, not on the user's
computer. Python is launched through the server's detected `python`, `python3`,
or `py` command and receives a restricted environment.

### Electron Desktop IDE

The Electron main process uses the local runtime discovery and execution bridge.
Python is launched using the detected local Python executable, with the
renderer communicating only through the existing preload/IPC boundary. The
Electron runner already uses an explicit environment allow-list.

## Debug-session contract

The client-side contract is defined in
`client/src/debug/debugSession.js` and stored separately in
`client/src/store/debugStore.js`. A session contains:

- `debugSessionId` and originating `executionId`
- language and source-file identity
- lifecycle state: `starting`, `running`, `paused`, `stopped`, `terminated`, `failed`
- breakpoint, frame, stack, variable, watch, output, and error fields

Events must include both `debugSessionId` and `executionId`. Events from another
session, another execution, malformed events, or ended sessions are rejected.
Normal Run output never writes to the debug store.

Supported future event names are:

`debugStarted`, `debugOutput`, `debugPaused`, `debugContinued`,
`breakpointHit`, `stackTrace`, `variables`, `debugTerminated`, and
`debugError`.

The active adapter implementation is split by environment:

- Web: `/api/debug` is an authenticated WebSocket. The server starts
  `python -m debugpy --listen 127.0.0.1:<private-port> --wait-for-client`, owns
  the DAP TCP connection, and forwards only validated debugger operations.
- Electron: the main process starts the detected local Python runtime and
  `debugpy`, owns the loopback DAP connection, and exposes only capability,
  start, request, stop and event IPC methods through preload.

Supported operations are breakpoint configuration, exception breakpoints,
configuration completion, continue, pause, next, step-in, step-out, stack
trace, scopes, variables, threads, evaluate, terminate and disconnect.

## Python readiness

The verified development runtime is Python 3.12.0. At implementation time it
did not have an importable `debugpy` module, so capability discovery correctly
reports Python debugging unavailable until it is provisioned.

A future real Python debugger will require:

1. Provision `debugpy` in the server Python environment used by the API, and
   install it in the user's selected desktop Python environment. Do not install
   silently on every launch.
2. A server-side isolated worker remains recommended for hostile multi-tenant
   deployments; the current bridge has process, output, timeout and environment
   limits but is not an OS sandbox.
3. Session and execution ownership checks are enforced before forwarding
   events.
4. Transport authentication and cancellation are enforced for both bridges.
5. Monaco breakpoint gutter markers and current-line decoration work for the
   active document; adapter verification and advanced frame decorations remain
   incremental follow-up work.

The server must not expose its process environment to debuggee code. The
current Phase 1 environment boundary is implemented in
`server/src/services/executionEnv.js` and is used by interactive execution and
local lint processes.

## DAP transport

`server/src/debug/dapTransport.js` and the Electron equivalent implement
Content-Length framing, partial packet buffering, multiple messages per packet,
bounded message sizes, request correlation, timeouts and cleanup. The browser
and Electron renderer send operation names through their trusted bridge; they
cannot send arbitrary shell commands or connect to debugpy.

## Known limitations

- Server-side execution is not an OS-level sandbox.
- A real end-to-end debug session requires `debugpy` to be installed in the
  selected runtime. Without it, Start Debugging remains disabled and the UI
  shows the exact setup requirement.
- WebSocket authentication uses the normal end-user session. Admin and guest
  sessions are not silently converted into user debug sessions.
- The current editor integration supports normal line breakpoints and core
  stack/variable/evaluate panels; conditional breakpoints, launch profiles,
  multi-process debugging and remote source maps are not implemented.
- Remote batch cancellation cannot guarantee cancellation at the upstream provider.
- Web and server runner language registries have different scopes; the client
  advertises 64 language capabilities while the server has 18 documented online
  runners. This discrepancy is retained for compatibility and should be
  documented in capability responses before debugger work begins.
