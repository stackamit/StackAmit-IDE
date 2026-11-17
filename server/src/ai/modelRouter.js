import { aiConfig } from './aiConfig.js';
import { AiError } from './aiErrors.js';
import { getProvider } from './providerRegistry.js';

export function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > aiConfig.maxMessages) throw new AiError('A valid message history is required.', { code: 'AI_INVALID_MESSAGES', status: 400 });
  return messages.map((message) => {
    const role = message?.role;
    const content = typeof message?.content === 'string' ? message.content : '';
    if (!['system', 'user', 'assistant'].includes(role) || !content || content.length > aiConfig.maxMessageChars) throw new AiError('AI messages are invalid or too large.', { code: 'AI_INVALID_MESSAGES', status: 400 });
    return { role, content };
  });
}

export function resolveProvider(request = {}) {
  const providerId = request.provider || request.providerName;
  if (!aiConfig.enabled) throw new AiError('AI features are disabled on this server.', { code: 'AI_DISABLED', status: 503 });
  const provider = getProvider(providerId);
  if (!provider) throw new AiError('Unknown AI provider.', { code: 'AI_PROVIDER_UNKNOWN', status: 400 });
  if (!provider.configured) throw new AiError('This AI provider is not configured on the server.', { code: 'AI_NOT_CONFIGURED', status: 503, provider: providerId });
  return { providerName: providerId, provider, model: request.model || null };
}
