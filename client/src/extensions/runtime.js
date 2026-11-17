/**
 * Applies the set of active extensions to a live Monaco editor and tears them
 * down on change. `sync(ids, ctx)` is idempotent: it activates newly-active
 * extensions and disposes the ones no longer active. Each activate returns a
 * `{ dispose() }` handle; failures are logged, never thrown to the UI.
 */
import { extensionById } from './registry.js';

export function createExtensionRuntime() {
  const active = new Map(); // id -> { dispose }

  return {
    sync(ids, ctx) {
      const want = new Set(ids);

      // Deactivate anything no longer wanted.
      for (const [id, handle] of active) {
        if (!want.has(id)) {
          try {
            handle.dispose();
          } catch (err) {
            console.warn(`[ext:${id}] dispose failed:`, err?.message || err);
          }
          active.delete(id);
        }
      }

      // Activate newly-wanted extensions.
      for (const id of ids) {
        if (active.has(id)) continue;
        const ext = extensionById(id);
        if (!ext) continue;
        try {
          active.set(id, ext.activate(ctx) || { dispose() {} });
        } catch (err) {
          console.warn(`[ext:${id}] activate failed:`, err?.message || err);
          active.set(id, { dispose() {} });
        }
      }
    },

    disposeAll() {
      for (const [, handle] of active) {
        try {
          handle.dispose();
        } catch {
          /* ignore */
        }
      }
      active.clear();
    },
  };
}

export default createExtensionRuntime;
