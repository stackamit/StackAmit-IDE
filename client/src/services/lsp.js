/**
 * Renderer access to the desktop language-server bridges.
 *
 * The window never spawns anything: it asks the Electron main process
 * (through the narrow `window.stackamit.lsp` bridge) to start a bridge for a
 * language + workspace root, and gets back a loopback WebSocket URL to drive
 * standard LSP traffic over. Outside the desktop app there is no bridge, so
 * every call reports honestly that this is desktop-only, and the editor
 * stays on its basic (highlighting + snippets) experience.
 */

const bridge = () => (typeof window !== 'undefined' ? window.stackamit?.lsp : undefined) || null;

/** True when this renderer can reach main-process language servers. */
export function isDesktopLsp() {
  return Boolean(bridge());
}

const NO_BRIDGE = {
  ok: false,
  code: 'NO_DESKTOP_BRIDGE',
  message: 'Language servers are only available in the desktop app (the browser build cannot spawn tools).',
};

/**
 * Start (or reuse) the bridge; resolves { wsUrl, tool, version, reused, jdkHome }
 * or { code }. `jdkPath`/`toolPath` are user-configured absolute paths and
 * `reprobe` drops the main process's cached tool/JDK discovery (right after an
 * install or when a path was just edited).
 */
export async function lspStart({ language, root, toolPath, jdkPath, reprobe }) {
  const b = bridge();
  if (!b) return NO_BRIDGE;
  try {
    return await b.start({
      language,
      root: root || null,
      toolPath: toolPath || null,
      jdkPath: jdkPath || null,
      reprobe: Boolean(reprobe),
    });
  } catch (err) {
    return { ok: false, code: 'IPC_FAILED', message: `Language server request failed: ${err?.message || err}` };
  }
}

/** Stop the bridge for a language + root (kills its children). */
export async function lspStop({ language, root }) {
  const b = bridge();
  if (!b) return NO_BRIDGE;
  try {
    return await b.stop({ language, root: root || null });
  } catch (err) {
    return { ok: false, code: 'IPC_FAILED', message: `Could not stop the language server: ${err?.message || err}` };
  }
}

/** Current bridge state for a language + root. */
export async function lspStatus({ language, root }) {
  const b = bridge();
  if (!b) return NO_BRIDGE;
  try {
    return await b.status({ language, root: root || null });
  } catch (err) {
    return { ok: false, code: 'IPC_FAILED', message: `Could not query the language server: ${err?.message || err}` };
  }
}
