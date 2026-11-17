const section = (id, title, body, extra = {}) => ({
  id,
  title,
  body,
  enabled: true,
  order: extra.order || 10,
  steps: extra.steps || [],
  examples: extra.examples || [],
  faqs: extra.faqs || [],
  media: extra.media || [],
  blocks: extra.blocks || [],
});

export const DEFAULT_AI_DOCUMENTATION = {
  published: true,
  title: 'StackAmit-AI documentation',
  subtitle: 'Configure practical AI assistance inside your development workspace.',
  introduction: 'StackAmit-AI helps you understand, generate and improve code while keeping the developer in control. Guests can use the IDE, editor and runners; StackAmit authentication is required only when an AI request is sent.',
  cta: { primaryLabel: 'Open IDE', primaryHref: '/ide', secondaryLabel: 'Create account', secondaryHref: '/account/register' },
  seo: { title: 'StackAmit-AI documentation', description: 'Learn how to configure and use AI assistance in StackAmit IDE.' },
  sections: [
    section('introduction', 'Introduction to StackAmit AI', 'Use AI chat for explanations, code generation, debugging and refactoring. Responses stream into the IDE and changes are reviewed before they can be applied.', { order: 10, media: [{ src: '/media/ai-guide/ai-guide-public.png', alt: 'StackAmit AI public documentation page', caption: 'The public StackAmit-AI guide is available without signing in.' }] }),
    section('authentication', 'Understanding AI authentication requirements', 'Normal IDE work remains available to guests. Sign in before sending AI requests, opening AI provider settings, installing provider integrations or viewing AI conversations. Your editor content is not submitted automatically after login.', { order: 20 }),
    section('account', 'Creating a StackAmit account', 'Create an account with your email and password, verify the email when prompted, then return to the IDE. Account authentication is separate from administrator authentication.', { order: 30, steps: [{ title: 'Open registration', description: 'Choose Create account to open the public registration form.', href: '/account/register' }, { title: 'Verify your email', description: 'Use the one-time verification link delivered to your email.', href: '/account/verify' }, { title: 'Return to the IDE', description: 'Open the IDE and sign in when an AI action requests it.', href: '/ide' }], media: [{ src: '/media/ai-guide/ai-guide-registration.png', alt: 'StackAmit account registration form', caption: 'The current public registration form.' }, { src: '/media/ai-guide/ai-guide-login.png', alt: 'StackAmit account login form', caption: 'The current public login form.' }] }),
    section('plugins', 'Accessing My Plugins', 'After signing in, open Account Dashboard and choose My Plugins. This area shows reviewed provider integrations available to your account.', { order: 40 }),
    section('install-provider', 'Installing an AI provider plugin', 'Choose Install on a trusted provider catalogue entry. Installation records your preference; it does not download or execute arbitrary code and does not create credentials.', { order: 50 }),
    section('credentials', 'Adding provider credentials or supported authentication', 'Configure your own provider credential from AI Providers. Cloud credentials are encrypted server-side and are never returned to the browser. Ollama uses a local service and does not require a cloud API key.', { order: 60 }),
    section('connectivity', 'Testing provider connectivity', 'Use Test connection after configuring a provider. A provider is usable only when the health check and model discovery succeed for your account or local desktop bridge.', { order: 70 }),
    section('model', 'Selecting the default AI provider and model', 'Select a verified provider and model in AI Providers. Model names are discovered from the provider; catalogue entries alone do not mean a model is installed or available.', { order: 80 }),
    section('chat', 'Opening AI Chat inside the IDE', 'Open the AI panel from the IDE after signing in. Choose the provider and model, then start a conversation. Use Stop to cancel an active stream and Regenerate to retry a response.', { order: 90, media: [{ src: '/media/ai-guide/ai-guide-web-ide.png', alt: 'StackAmit web IDE', caption: 'Guests can open and use the IDE; AI actions require sign-in.' }] }),
    section('generate', 'Generating code using AI', 'Describe the behavior you need, include the target language and constraints, and review the response. StackAmit-AI does not silently overwrite files.', { order: 100, examples: [{ kind: 'prompt', title: 'Generate a function', language: 'text', content: 'Write a Python function that prints even numbers from 0 through a provided limit.' }] }),
    section('explain', 'Explaining existing code', 'Select code or attach the active file explicitly, then ask AI to explain it. The attached context is shown in the chat before you send the request.', { order: 110 }),
    section('debug', 'Debugging and fixing code', 'Include the error message and the smallest relevant code selection. Ask for a diagnosis first, then review any suggested fix before applying it.', { order: 120, examples: [{ kind: 'prompt', title: 'Debug a failure', language: 'text', content: 'Explain why this function raises the error below and propose a minimal fix. Do not change unrelated behavior.' }] }),
    section('refactor', 'Refactoring code', 'Ask for a focused refactor with explicit constraints such as preserving the public API, runtime behavior or complexity. Review the diff before accepting changes.', { order: 130 }),
    section('context', 'Providing editor context to AI', 'Context is opt-in. You can attach the current file, selected code and programming language. Sensitive files and large binary content should remain excluded.', { order: 140 }),
    section('commands', 'Using AI commands and keyboard shortcuts', 'Use the AI entry in the IDE View menu or the configured AI shortcut after signing in. Non-AI command palette actions remain available to guests.', { order: 150 }),
    section('conversations', 'Managing AI conversations', 'Signed-in users can continue their own saved conversations. Conversation ownership is derived from the authenticated session and is never selected by a request parameter.', { order: 160 }),
    section('troubleshooting', 'Troubleshooting common errors', 'If a model is missing, refresh models and confirm the provider is running. For cloud errors, re-test your own credential and check the provider status. A local Ollama workflow requires the Ollama service to be running on the desktop.', { order: 170 }),
    section('privacy', 'API-key security and privacy', 'Never paste keys into chat. Cloud keys stay in the server credential vault and are masked in the UI. AI receives only the context you choose to attach; it has no arbitrary filesystem or terminal access.', { order: 180 }),
    section('faq', 'Frequently asked questions', 'Can guests use the IDE? Yes. Can guests send AI requests? No, StackAmit authentication is required. Does Ollama need a cloud key? No, but the user must still sign in to use StackAmit-AI. Are all catalogue providers active? No; only providers with a working adapter are runtime-supported.', { order: 190, faqs: [{ question: 'Which providers are runtime-supported?', answer: 'OpenAI, Google Gemini, Ollama and OpenAI-compatible endpoints are supported by the current runtime. Other catalogue entries are not automatically active.' }, { question: 'Are my provider keys shared with administrators?', answer: 'No. User credentials are scoped to the authenticated user and are not returned as raw values.' }] }),
    section('admin-ai', 'Using StackAmit server-configured AI as an administrator', 'This workflow is exclusive to administrators. It uses only the providers configured by the deployment in server environment variables; ordinary users cannot access this provider mode or inherit its credentials.', { order: 200, steps: [{ title: 'Sign in as an administrator', description: 'Open the separate administrator sign-in page and authenticate with the configured admin account.', href: '/admin/login' }, { title: 'Open Admin AI', description: 'Choose Admin AI in the admin dashboard. The panel lists only server-configured providers and never displays their secrets.' }, { title: 'Select and test a provider', description: 'Choose a verified provider and discovered model. Test connection reports availability without returning credentials.' }, { title: 'Use the AI tools', description: 'Use the chat actions for explain, generate, debug and refactor, then review all generated output before using it.' }], faqs: [{ question: 'Can a normal StackAmit user use these providers?', answer: 'No. Normal users use only their own user-owned provider configuration. The server-configured admin route is protected by admin authentication on every request.' }] }),
  ],
};

export function normalizeAiDocumentation(value) {
  const source = value && typeof value === 'object' ? value : {};
  const sections = Array.isArray(source.sections) ? source.sections : DEFAULT_AI_DOCUMENTATION.sections;
  return {
    ...DEFAULT_AI_DOCUMENTATION,
    ...source,
    published: source.published !== false,
    cta: { ...DEFAULT_AI_DOCUMENTATION.cta, ...(source.cta || {}) },
    seo: { ...DEFAULT_AI_DOCUMENTATION.seo, ...(source.seo || {}) },
    sections: sections
      .filter((item) => item && typeof item.title === 'string')
      .map((item, index) => ({ ...section(`section-${index + 1}`, '', ''), ...item, id: String(item.id || `section-${index + 1}`), order: Number(item.order) || (index + 1) * 10, enabled: item.enabled !== false, blocks: Array.isArray(item.blocks) ? item.blocks : [] }))
      .sort((a, b) => a.order - b.order),
  };
}
