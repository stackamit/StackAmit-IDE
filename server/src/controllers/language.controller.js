import { env } from '../config/env.js';
import { LANGUAGES, listLanguageMetadata } from '../config/languages.js';
import { resolveProvider } from '../config/executionProvider.js';
import { getEffectiveSettings } from '../services/settings.service.js';

/**
 * GET /api/languages
 * Returns the supported languages and runtime versions for the *configured*
 * provider. When the provider exposes a live runtime list we cross-check it so
 * the UI can flag anything the provider cannot currently run.
 */
export async function listLanguages(_req, res) {
  const provider = resolveProvider();
  const languages = listLanguageMetadata(env.executionProvider);
  const settings = await getEffectiveSettings();

  if (!provider) {
    return res.json({ provider: env.executionProvider, configured: false, available: false, snippetEnabled: settings.snippetEnabled, languages });
  }

  const availableIds = await collectProviderIds(provider);
  const enriched = languages.map((meta) => {
    if (!availableIds) return { ...meta, supported: true };
    const lang = LANGUAGES.find((l) => l.key === meta.key);
    // A null per-provider entry means the language simply cannot run there —
    // report it as unsupported instead of crashing or pretending.
    if (provider.name === 'piston') {
      return { ...meta, supported: lang.piston ? availableIds.has(String(lang.piston.language)) : false };
    }
    return { ...meta, supported: Boolean(meta.runtimeId) && availableIds.has(meta.runtimeId) };
  });

  res.json({
    provider: provider.name,
    configured: true,
    available: Boolean(availableIds),
    snippetEnabled: settings.snippetEnabled,
    languages: enriched,
  });
}

async function collectProviderIds(provider) {
  try {
    const runtimes = await provider.listSupported();
    if (!Array.isArray(runtimes) || runtimes.length === 0) return null;
    if (provider.name === 'piston') {
      return new Set(runtimes.map((r) => r.language));
    }
    // wandbox entries key on `name`
    return new Set(runtimes.map((r) => r.name || r.id));
  } catch {
    return null;
  }
}
