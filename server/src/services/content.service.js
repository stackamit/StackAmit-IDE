import { isDatabaseConnected } from '../config/db.js';
import { DEFAULT_CONTENT, resolveContent } from '../config/siteContent.js';
import { normalizeAiDocumentation } from '../config/aiDocumentation.js';
import { readStoredContent, writeStoredContent } from '../models/SiteContent.js';

const CACHE_TTL_MS = 15000;
let cache = { at: 0, value: null };

/** Public page content (defaults merged with any admin overrides). */
export async function getPublicContent() {
  if (!isDatabaseConnected()) return structuredClone(DEFAULT_CONTENT);
  const now = Date.now();
  if (cache.value && now - cache.at < CACHE_TTL_MS) return cache.value;
  try {
    const stored = await readStoredContent();
    if (stored && stored.published === false) return structuredClone(DEFAULT_CONTENT);
    const value = resolveContent(stored);
    if (value.aiDocumentation && value.aiDocumentation.published === false) value.aiDocumentation = null;
    cache = { at: now, value };
    return value;
  } catch {
    return structuredClone(DEFAULT_CONTENT);
  }
}

/** Admin view: the fully-resolved content + whether it is persisted. */
export async function getAdminContent() {
  if (!isDatabaseConnected()) return { content: structuredClone(DEFAULT_CONTENT), persisted: false };
  const stored = await readStoredContent();
  return { content: resolveContent(stored), persisted: true };
}

function sanitize(patch) {
  const clean = {};
  if (typeof patch?.published === 'boolean') clean.published = patch.published;
  if (patch?.socialVisibility && typeof patch.socialVisibility === 'object') clean.socialVisibility = Object.fromEntries(Object.entries(patch.socialVisibility).filter(([key, value]) => ['website', 'facebook', 'twitter', 'instagram', 'linkedin', 'github', 'youtube'].includes(key) && typeof value === 'boolean'));
  if (patch?.branding && typeof patch.branding === 'object') clean.branding = { name: String(patch.branding.name || '').slice(0, 80), tagline: String(patch.branding.tagline || '').slice(0, 160), description: String(patch.branding.description || '').slice(0, 300), logoUrl: String(patch.branding.logoUrl || '').slice(0, 500) };
  if (patch?.navigation && Array.isArray(patch.navigation.links)) clean.navigation = { links: sanitizeLinks(patch.navigation.links) };
  if (patch?.footer && Array.isArray(patch.footer.columns)) clean.footer = { copyright: String(patch.footer.copyright || '').slice(0, 200), columns: patch.footer.columns.slice(0, 3).map((column) => ({ id: String(column.id || '').slice(0, 80), title: String(column.title || '').slice(0, 80), links: sanitizeLinks(column.links) })) };
  if (patch?.seo && typeof patch.seo === 'object') clean.seo = { title: String(patch.seo.title || '').slice(0, 160), description: String(patch.seo.description || '').slice(0, 320) };
  for (const section of ['home', 'about', 'ai', 'contact', 'privacy', 'terms', 'support', 'social']) {
    const src = patch?.[section];
    if (src && typeof src === 'object') {
      clean[section] = {};
      for (const [k, v] of Object.entries(src)) {
        if (typeof v === 'string') clean[section][k] = v.slice(0, 4000);
      }
    }
  }
  if (patch?.aiDocumentation && typeof patch.aiDocumentation === 'object') {
    const doc = normalizeAiDocumentation(patch.aiDocumentation);
    clean.aiDocumentation = {
      ...doc,
      title: String(doc.title || '').slice(0, 180),
      subtitle: String(doc.subtitle || '').slice(0, 500),
      introduction: String(doc.introduction || '').slice(0, 4000),
      published: doc.published !== false,
      cta: { primaryLabel: String(doc.cta?.primaryLabel || '').slice(0, 80), primaryHref: String(doc.cta?.primaryHref || '').slice(0, 500), secondaryLabel: String(doc.cta?.secondaryLabel || '').slice(0, 80), secondaryHref: String(doc.cta?.secondaryHref || '').slice(0, 500) },
      seo: { title: String(doc.seo?.title || '').slice(0, 180), description: String(doc.seo?.description || '').slice(0, 320) },
      sections: doc.sections.slice(0, 50).map((item, index) => ({
        id: String(item.id || `section-${index + 1}`).slice(0, 80), title: String(item.title || '').slice(0, 180), body: String(item.body || '').slice(0, 8000), enabled: item.enabled !== false, order: Number(item.order) || (index + 1) * 10,
        steps: Array.isArray(item.steps) ? item.steps.slice(0, 20).map((step) => ({ title: String(step.title || '').slice(0, 180), description: String(step.description || '').slice(0, 2000), href: String(step.href || '').slice(0, 500) })) : [],
        examples: Array.isArray(item.examples) ? item.examples.slice(0, 10).map((example) => ({ kind: example.kind === 'prompt' ? 'prompt' : 'code', title: String(example.title || '').slice(0, 180), language: String(example.language || 'text').slice(0, 40), content: String(example.content || '').slice(0, 12000) })) : [],
        faqs: Array.isArray(item.faqs) ? item.faqs.slice(0, 20).map((faq) => ({ question: String(faq.question || '').slice(0, 300), answer: String(faq.answer || '').slice(0, 3000) })) : [],
        media: Array.isArray(item.media) ? item.media.slice(0, 10).map((media) => ({ src: String(media.src || '').slice(0, 500), alt: String(media.alt || '').slice(0, 200), caption: String(media.caption || '').slice(0, 500) })) : [],
        blocks: Array.isArray(item.blocks) ? item.blocks.slice(0, 50).map((block, blockIndex) => ({ id: String(block.id || `block-${blockIndex + 1}`).slice(0, 80), type: String(block.type || 'paragraph').slice(0, 30), content: String(block.content || '').slice(0, 12000), title: String(block.title || '').slice(0, 300), visible: block.visible !== false, order: Number(block.order) || (blockIndex + 1) * 10, url: String(block.url || '').slice(0, 500) })) : [],
      })),
    };
  }
  return clean;
}

function sanitizeLinks(links) {
  return (Array.isArray(links) ? links : []).slice(0, 50).map((link, index) => ({ id: String(link?.id || `link-${index + 1}`).slice(0, 80), label: String(link?.label || '').trim().slice(0, 80), href: String(link?.href || '').trim().slice(0, 500), enabled: link?.enabled !== false, order: Number(link?.order) || (index + 1) * 10 }));
}

/** Merge a partial patch with the current resolved content and persist. */
export async function saveAdminContent(patch) {
  if (!isDatabaseConnected()) {
    const err = new Error('Page content persistence needs MongoDB (database offline).');
    err.status = 503;
    err.code = 'DATABASE_UNAVAILABLE';
    throw err;
  }
  const clean = sanitize(patch);
  const current = resolveContent(await readStoredContent());
  const next = {
    published: clean.published ?? current.published,
    branding: { ...current.branding, ...(clean.branding || {}) },
    socialVisibility: { ...current.socialVisibility, ...(clean.socialVisibility || {}) },
    navigation: clean.navigation || current.navigation,
    footer: clean.footer || current.footer,
    seo: { ...current.seo, ...(clean.seo || {}) },
    home: { ...current.home, ...(clean.home || {}) },
    about: { ...current.about, ...(clean.about || {}) },
    ai: { ...current.ai, ...(clean.ai || {}) },
    aiDocumentation: clean.aiDocumentation || current.aiDocumentation,
    contact: { ...current.contact, ...(clean.contact || {}) },
    privacy: { ...current.privacy, ...(clean.privacy || {}) },
    terms: { ...current.terms, ...(clean.terms || {}) },
    support: { ...current.support, ...(clean.support || {}) },
    social: { ...current.social, ...(clean.social || {}) },
    updatedAt: new Date(),
  };
  const saved = await writeStoredContent(next);
  cache = { at: 0, value: null };
  return { content: resolveContent(saved), persisted: true };
}
