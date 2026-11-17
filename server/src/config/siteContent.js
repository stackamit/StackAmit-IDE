import { DEFAULT_AI_DOCUMENTATION, normalizeAiDocumentation } from './aiDocumentation.js';

/**
 * Default (out-of-the-box) copy for the public pages. The admin can override
 * any of these from the dashboard; stored values are deep-merged over these
 * defaults so a partial override never blanks out a field.
 */
export const DEFAULT_CONTENT = {
  published: true,
  branding: { name: 'StackAmit IDE', tagline: 'Code. Compile. Create.', description: 'A powerful online IDE for developers, with AI assistance and modern tools.', logoUrl: '' },
  navigation: {
    links: [
      { id: 'home', label: 'Home', href: '/', enabled: true, order: 10 },
      { id: 'about', label: 'About', href: '/about', enabled: true, order: 20 },
      { id: 'ai', label: 'AI Tools', href: '/ai', enabled: true, order: 30 },
      { id: 'contact', label: 'Contact', href: '/contact', enabled: true, order: 40 },
      { id: 'support', label: 'Support', href: '/support', enabled: true, order: 50 },
    ],
  },
  footer: {
    copyright: 'All rights reserved.',
    columns: [
      { id: 'product', title: 'Product', links: [
        { id: 'home', label: 'Home', href: '/', enabled: true, order: 10 },
        { id: 'ide', label: 'Launch IDE', href: '/ide', enabled: true, order: 20 },
        { id: 'ai', label: 'AI Tools', href: '/ai', enabled: true, order: 30 },
      ] },
      { id: 'resources', title: 'Resources & Company', links: [
        { id: 'login', label: 'Login', href: '/account/login', enabled: true, order: 10 },
        { id: 'register', label: 'Register', href: '/account/register', enabled: true, order: 20 },
        { id: 'about', label: 'About', href: '/about', enabled: true, order: 30 },
        { id: 'contact', label: 'Contact', href: '/contact', enabled: true, order: 40 },
        { id: 'privacy', label: 'Privacy Policy', href: '/privacy-policy', enabled: true, order: 50 },
        { id: 'terms', label: 'Terms and Conditions', href: '/terms', enabled: true, order: 60 },
        { id: 'support', label: 'Support', href: '/support', enabled: true, order: 70 },
      ] },
      { id: 'community', title: 'Community & Social', links: [] },
    ],
  },
  seo: { title: 'StackAmit-IDE', description: 'Code. Compile. Create.' },
  home: {
    badge: 'Code. Compile. Create.',
    heroTitle: 'The online compiler that feels like a real IDE',
    heroSubtitle:
      'Write, run and share code across 60+ languages and file formats — 18 of them runnable right in your browser. Professional editor, interactive terminal and genuine execution, with no installation and no sign-up.',
    ctaPrimary: 'Launch the IDE',
    ctaSecondary: 'Learn more',
  },
  about: {
    heading: 'About StackAmit-IDE',
    mission: 'Our mission',
    intro:
      'We believe running code should be as simple as opening a tab. StackAmit-IDE is a professional, free online compiler that removes every barrier between an idea and a running program.',
    body:
      'StackAmit-IDE pairs the same Monaco editor that powers VS Code with a genuine server-side execution pipeline, so the feedback you get is exactly what your code produces — compiler errors, runtime output and your program\u2019s stdin handled in one interactive terminal.',
  },
  ai: {
    badge: 'StackAmit-AI',
    heading: 'AI that helps you build, learn and ship',
    intro: 'StackAmit-AI brings secure, practical AI assistance into the StackAmit development workspace without taking control away from you.',
    overview: 'Use AI chat to understand code, generate solutions, refactor files and learn new concepts. Choose a local Ollama model for private offline work or connect a cloud provider when you need hosted model capabilities.',
    mission: 'Our AI mission',
    capabilities: 'Explain and review code\nGenerate code for the active file\nStream responses with Stop and regenerate controls\nApply generated code only after your confirmation\nUse selected code and active-file context with visible consent',
    providers: 'Ollama for local Qwen and Llama models\nOpenAI for hosted GPT models\nGoogle Gemini for hosted Gemini models\nOpenAI-compatible providers for flexible deployments',
    privacy: 'Your API keys remain server-side. StackAmit-AI never receives filesystem or terminal access, and project context is sent only when you enable it in the AI panel.',
    offline: 'Desktop users can run Ollama locally without internet access. The Electron main process validates the loopback boundary before communicating with Ollama.',
    roadmap: 'Personal provider credentials and encrypted BYOK storage\nRicher Markdown and code rendering\nProject-aware assistance with explicit permissions\nOptional MCP and automation integrations',
    cta: 'Open StackAmit-AI in the IDE',
    ctaLabel: 'Launch AI workspace',
  },
  aiDocumentation: DEFAULT_AI_DOCUMENTATION,
  contact: {
    heading: 'Get in touch',
    subtitle:
      "Questions, feedback or partnership ideas about StackAmit-IDE? We'd love to hear from you.",
    email: 'support@stackamit.com',
    responseTime: 'Usually within 1–2 business days',
  },
  privacy: {
    title: 'Privacy Policy',
    intro: 'Your privacy matters. This policy explains how StackAmit-IDE handles information when you use the public website, IDE and account features.',
    body: 'We collect only the information needed to operate requested features. Account information is used for authentication and account lifecycle messages. Source code and editor drafts remain in the relevant browser or desktop workspace unless you explicitly submit them to an execution or AI provider.\n\nWhen you use cloud execution or an AI provider, the relevant request is sent to that service to provide the feature. Provider credentials are not exposed to the renderer. We do not sell personal information.\n\nWe may update this policy as the product changes. Contact Support if you have a privacy question or request.',
  },
  terms: {
    title: 'Terms and Conditions',
    intro: 'These terms describe the responsible use of StackAmit-IDE and its online, offline and AI-assisted development features.',
    body: 'You are responsible for the code, dependencies and data you submit to an execution or AI provider. Do not use the service for unlawful activity, abuse, credential theft, malware distribution or attempts to bypass provider limits.\n\nExecution and cloud AI features may depend on external services and can change or be unavailable. Local desktop features such as supported Ollama workflows may work without internet access.\n\nBy using StackAmit-IDE, you agree to use the product responsibly and to review generated code before relying on it.',
  },
  support: {
    title: 'StackAmit Support',
    intro: 'Need help with the IDE, account, AI providers or execution? Start with the contact form or email our support team.',
    body: 'For the fastest response, include the page or feature where the issue occurred, the language or provider involved, and a safe description of the error. Never include passwords, API keys or private source code in a support request.\n\nFor account issues, use the account email associated with your StackAmit profile. For local Ollama issues, include the Ollama version and whether the service is running on its default local endpoint.',
    email: 'support@stackamit.com',
  },
  social: {
    website: 'https://stackamit.netlify.app',
    facebook: '',
    twitter: '',
    instagram: '',
    linkedin: '',
    github: '',
    youtube: '',
  },
  socialVisibility: { website: true, facebook: true, twitter: true, instagram: true, linkedin: true, github: true, youtube: true },
};

/** Deep-merge stored content over defaults (only known string keys). */
function mergeSection(def, stored) {
  const out = { ...def };
  if (stored && typeof stored === 'object') {
    for (const key of Object.keys(def)) {
      const v = stored[key];
      if (typeof v === 'string') out[key] = v;
    }
  }
  return out;
}

export function resolveContent(stored) {
  if (!stored) return structuredClone(DEFAULT_CONTENT);
  const branding = mergeSection(DEFAULT_CONTENT.branding, stored.branding);
  // Migrate the original built-in name only; any other admin-customized name
  // remains fully controlled by the CMS.
  if (branding.name === 'StackAmit') branding.name = 'StackAmit IDE';
  return {
    published: stored.published !== false,
    branding,
    navigation: normalizeNavigation(stored.navigation),
    footer: normalizeFooter(stored.footer),
    socialVisibility: { ...DEFAULT_CONTENT.socialVisibility, ...(stored.socialVisibility || {}) },
    seo: mergeSection(DEFAULT_CONTENT.seo, stored.seo),
    home: mergeSection(DEFAULT_CONTENT.home, stored.home),
    about: mergeSection(DEFAULT_CONTENT.about, stored.about),
    ai: mergeSection(DEFAULT_CONTENT.ai, stored.ai),
    aiDocumentation: normalizeAiDocumentation(stored.aiDocumentation),
    contact: mergeSection(DEFAULT_CONTENT.contact, stored.contact),
    privacy: mergeSection(DEFAULT_CONTENT.privacy, stored.privacy),
    terms: mergeSection(DEFAULT_CONTENT.terms, stored.terms),
    support: mergeSection(DEFAULT_CONTENT.support, stored.support),
    social: mergeSection(DEFAULT_CONTENT.social, stored.social),
  };
}

// Backward-compatible content migration for documents created before the
// privacy, terms and support pages existed. Existing labels, ordering and
// custom URLs are preserved; only missing new defaults and known legacy
// `/about` mappings are corrected.
function normalizeNavigation(section) {
  const current = normalizeLinks(section, DEFAULT_CONTENT.navigation).links;
  const byId = new Map(current.map((link) => [link.id, link]));
  for (const link of DEFAULT_CONTENT.navigation.links) {
    if (!byId.has(link.id)) byId.set(link.id, { ...link });
  }
  return { links: [...byId.values()].sort((a, b) => a.order - b.order) };
}

function normalizeLinks(section, fallback) {
  const links = Array.isArray(section?.links) ? section.links : fallback.links;
  return { links: links.filter((link) => link && typeof link.label === 'string' && typeof link.href === 'string').map((link, index) => ({ id: String(link.id || `link-${index + 1}`), label: link.label, href: link.href, enabled: link.enabled !== false, order: Number(link.order) || (index + 1) * 10 })).sort((a, b) => a.order - b.order) };
}

function normalizeFooter(section) {
  const fallback = DEFAULT_CONTENT.footer.columns;
  const columns = Array.isArray(section?.columns) ? section.columns : fallback;
  return { copyright: typeof section?.copyright === 'string' ? section.copyright.slice(0, 200) : DEFAULT_CONTENT.footer.copyright, columns: [0, 1, 2].map((index) => { const column = columns[index] || fallback[index]; const id = String(column.id || fallback[index].id); const existing = normalizeLinks(column, { links: [] }).links; const defaults = fallback[index].links; const byId = new Map(existing.map((link) => [link.id, link])); for (const link of defaults) { if (!byId.has(link.id)) byId.set(link.id, { ...link }); } const links = [...byId.values()].map((link) => { if ((link.id === 'privacy' || link.id === 'terms') && link.href === '/about') return { ...link, href: link.id === 'privacy' ? '/privacy-policy' : '/terms' }; return link; }).sort((a, b) => a.order - b.order); const title = id === 'product' && /^navigation$/i.test(String(column.title || '')) ? fallback[index].title : String(column.title || fallback[index].title); return { id, title, links }; }) };
}
