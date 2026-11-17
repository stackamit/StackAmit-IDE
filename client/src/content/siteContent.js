import { COMPANY_URL, APP_TAGLINE } from '../config.js';

/**
 * Built-in copy for the public pages. The server returns the admin-overridden
 * version of this same shape; the hook deep-merges server data over these
 * defaults so any missing field still renders sensible content (and the pages
 * look identical if the API is unreachable).
 */
export const DEFAULT_CONTENT = {
  published: true,
  branding: { name: 'StackAmit IDE', tagline: 'Code. Compile. Create.', description: 'A powerful online IDE for developers, with AI assistance and modern tools.', logoUrl: '' },
  navigation: { links: [
    { id: 'home', label: 'Home', href: '/', enabled: true, order: 10 },
    { id: 'about', label: 'About', href: '/about', enabled: true, order: 20 },
    { id: 'ai', label: 'AI Tools', href: '/ai', enabled: true, order: 30 },
    { id: 'contact', label: 'Contact', href: '/contact', enabled: true, order: 40 },
    { id: 'support', label: 'Support', href: '/support', enabled: true, order: 50 },
  ] },
  footer: { copyright: 'All rights reserved.', columns: [
    { id: 'product', title: 'Product', links: [{ id: 'home', label: 'Home', href: '/', enabled: true, order: 10 }, { id: 'ide', label: 'Launch IDE', href: '/ide', enabled: true, order: 20 }, { id: 'ai', label: 'AI Tools', href: '/ai', enabled: true, order: 30 }] },
    { id: 'resources', title: 'Resources & Company', links: [{ id: 'login', label: 'Login', href: '/account/login', enabled: true, order: 10 }, { id: 'register', label: 'Register', href: '/account/register', enabled: true, order: 20 }, { id: 'about', label: 'About', href: '/about', enabled: true, order: 30 }, { id: 'contact', label: 'Contact', href: '/contact', enabled: true, order: 40 }, { id: 'privacy', label: 'Privacy Policy', href: '/privacy-policy', enabled: true, order: 50 }, { id: 'terms', label: 'Terms and Conditions', href: '/terms', enabled: true, order: 60 }, { id: 'support', label: 'Support', href: '/support', enabled: true, order: 70 }] },
    { id: 'community', title: 'Community & Social', links: [] },
  ] },
  seo: { title: 'StackAmit-IDE', description: 'Code. Compile. Create.' },
  home: {
    badge: APP_TAGLINE,
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
      "StackAmit-IDE pairs the same Monaco editor that powers VS Code with a genuine server-side execution pipeline, so the feedback you get is exactly what your code produces — compiler errors, runtime output and your program's stdin handled in one interactive terminal.",
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
  aiDocumentation: {
    published: true,
    title: 'StackAmit-AI documentation',
    subtitle: 'Configure practical AI assistance inside your development workspace.',
    introduction: 'Guests can use the editor, terminal and runners. Sign in only when you want to send an AI request or manage AI features.',
    cta: { primaryLabel: 'Open IDE', primaryHref: '/ide', secondaryLabel: 'Create account', secondaryHref: '/account/register' },
    seo: { title: 'StackAmit-AI documentation', description: 'Learn how to configure and use AI assistance in StackAmit IDE.' },
    sections: [
      ['introduction', 'Introduction to StackAmit AI', 'Use AI chat for explanations, generation, debugging and refactoring.'],
      ['authentication', 'Understanding AI authentication requirements', 'Guests can use normal IDE features; StackAmit authentication is required before AI requests.'],
      ['account', 'Creating a StackAmit account', 'Register, verify your email and return to the IDE.'],
      ['plugins', 'Accessing My Plugins', 'Use the signed-in dashboard to browse reviewed provider integrations.'],
      ['install-provider', 'Installing an AI provider plugin', 'Installation records your provider preference and does not execute arbitrary code.'],
      ['credentials', 'Adding provider credentials or supported authentication', 'Use your own provider credentials. Ollama does not require a cloud key.'],
      ['connectivity', 'Testing provider connectivity', 'Run a health check and refresh verified models before using a provider.'],
      ['model', 'Selecting the default AI provider and model', 'Choose a verified provider and discovered model.'],
      ['chat', 'Opening AI Chat inside the IDE', 'Open the AI panel after signing in and choose a provider/model.'],
      ['generate', 'Generating code using AI', 'Describe the desired behavior and review generated code before applying it.'],
      ['explain', 'Explaining existing code', 'Attach selected code or the active file explicitly before asking for an explanation.'],
      ['debug', 'Debugging and fixing code', 'Provide the error and smallest relevant selection, then review the fix.'],
      ['refactor', 'Refactoring code', 'State constraints and review the diff before accepting a refactor.'],
      ['context', 'Providing editor context to AI', 'Context is opt-in and visibly attached; sensitive files remain excluded.'],
      ['commands', 'Using AI commands and keyboard shortcuts', 'Use the AI View action or shortcut after signing in.'],
      ['conversations', 'Managing AI conversations', 'Saved conversations are scoped to your authenticated account.'],
      ['troubleshooting', 'Troubleshooting common errors', 'Refresh models, confirm credentials and check the local Ollama service.'],
      ['privacy', 'API-key security and privacy', 'Keys remain protected server-side and AI receives only explicitly attached context.'],
      ['faq', 'Frequently asked questions', 'Runtime-supported providers are OpenAI, Gemini, Ollama and OpenAI-compatible endpoints.'],
    ].map(([id, title, body], index) => ({ id, title, body, enabled: true, order: (index + 1) * 10, steps: [], examples: [], faqs: [], media: [] })),
  },
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
    website: COMPANY_URL,
    facebook: '',
    twitter: '',
    instagram: '',
    linkedin: '',
    github: '',
    youtube: '',
  },
  socialVisibility: { website: true, facebook: true, twitter: true, instagram: true, linkedin: true, github: true, youtube: true },
};

/** Deep-merge a partial server payload over the defaults (string fields only). */
export function mergeContent(base, patch) {
  const out = structuredClone(base);
  if (!patch || typeof patch !== 'object') return out;
  if (typeof patch.published === 'boolean') out.published = patch.published;
  if (patch.branding) out.branding = { ...out.branding, ...patch.branding };
  if (patch.navigation?.links) out.navigation = { links: patch.navigation.links };
  if (patch.footer?.columns) out.footer = { ...out.footer, columns: [0, 1, 2].map((index) => patch.footer.columns[index] || out.footer.columns[index]) };
  if (typeof patch.footer?.copyright === 'string') out.footer.copyright = patch.footer.copyright;
  if (patch.socialVisibility) out.socialVisibility = { ...out.socialVisibility, ...patch.socialVisibility };
  if (patch.seo) out.seo = { ...out.seo, ...patch.seo };
  for (const section of Object.keys(base)) {
    const src = patch[section];
    if (src && typeof src === 'object') {
      for (const key of Object.keys(base[section])) {
        if (typeof src[key] === 'string') out[section][key] = src[key];
      }
    }
  }
  if (patch.aiDocumentation === null) out.aiDocumentation = null;
  else if (patch.aiDocumentation && typeof patch.aiDocumentation === 'object') {
    out.aiDocumentation = { ...out.aiDocumentation, ...patch.aiDocumentation, cta: { ...out.aiDocumentation.cta, ...(patch.aiDocumentation.cta || {}) }, seo: { ...out.aiDocumentation.seo, ...(patch.aiDocumentation.seo || {}) }, sections: Array.isArray(patch.aiDocumentation.sections) ? patch.aiDocumentation.sections : out.aiDocumentation.sections };
  }
  return out;
}
