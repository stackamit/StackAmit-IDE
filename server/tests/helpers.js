/**
 * Shared helpers for backend tests.
 *
 * We stub global.fetch so unit tests exercise the full request → validation →
 * provider-parse path without network, while real execution is covered by an
 * opt-in integration test.
 */

export function jsonResponse(status, bodyObj) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify(bodyObj),
  };
}

/** Install a fetch stub routing by URL substring. Returns a restore fn. */
export function stubFetch(handlers) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    for (const [match, make] of handlers) {
      if (String(url).includes(match)) return jsonResponse(...(await make({ url, opts })));
    }
    return jsonResponse(404, { message: 'unstubbed' });
  };
  return () => {
    globalThis.fetch = original;
  };
}

/** Fresh app instance with a chosen provider configured before import. */
export async function loadApp(provider = 'wandbox') {
  process.env.EXECUTION_PROVIDER = provider;
  process.env.NODE_ENV = 'test';
  // Ensure defaults for limits used by validators.
  process.env.MAX_SOURCE_BYTES = process.env.MAX_SOURCE_BYTES || '65536';
  const mod = await import('../src/app.js');
  return mod.default;
}
