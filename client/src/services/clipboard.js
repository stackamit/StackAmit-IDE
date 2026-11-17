/**
 * Clipboard access for the sandboxed renderer.
 *
 * The desktop window runs with `nodeIntegration` off and a context-isolated
 * preload, so it has no clipboard of its own: copy/paste in the terminal and the
 * Output panel goes through the narrow `window.stackamit.clipboard` bridge, whose
 * handlers use the main-process Electron `clipboard` module. Outside the desktop
 * app there is no bridge, so the browser's own async clipboard is used where it
 * exists and every failure is swallowed into an honest { ok:false } rather than
 * throwing (Electron also blocks `document.execCommand`).
 */

const bridge = () => (typeof window !== 'undefined' ? window.stackamit?.clipboard : undefined) || null;

/** Write plain text to the system clipboard. */
export async function copyText(text) {
  const value = String(text ?? '');
  const b = bridge();
  if (b?.writeText) {
    try {
      return await b.writeText(value);
    } catch (err) {
      return { ok: false, code: 'IPC_FAILED', message: `Could not copy: ${err?.message || err}` };
    }
  }
  // Browser fallback (needs a user gesture and a secure context).
  try {
    await navigator.clipboard.writeText(value);
    return { ok: true };
  } catch {
    return { ok: false, code: 'CLIPBOARD_UNAVAILABLE', message: 'Clipboard access is unavailable here.' };
  }
}

/** Read plain text from the system clipboard. */
export async function pasteText() {
  const b = bridge();
  if (b?.readText) {
    try {
      const res = await b.readText();
      return res && res.ok ? { ok: true, text: String(res.text ?? '') } : { ok: false, code: res?.code || 'CLIPBOARD_UNAVAILABLE', message: res?.message || 'Could not read the clipboard.' };
    } catch (err) {
      return { ok: false, code: 'IPC_FAILED', message: `Could not paste: ${err?.message || err}` };
    }
  }
  try {
    const text = await navigator.clipboard.readText();
    return { ok: true, text };
  } catch {
    return { ok: false, code: 'CLIPBOARD_UNAVAILABLE', message: 'Clipboard access is unavailable here.' };
  }
}
