import '../config/env.js';

const bool = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
};

const num = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const aiConfig = {
  enabled: bool(process.env.AI_ENABLED, true),
  timeoutMs: num(process.env.AI_TIMEOUT_MS, 60000),
  maxMessages: num(process.env.AI_MAX_MESSAGES, 30),
  maxMessageChars: num(process.env.AI_MAX_MESSAGE_CHARS, 50000),
  maxContextChars: num(process.env.AI_MAX_CONTEXT_CHARS, 80000),
  maxResponseChars: num(process.env.AI_MAX_RESPONSE_CHARS, 250000),
  rateWindowMs: num(process.env.AI_RATE_LIMIT_WINDOW_MS, 60000),
  rateMax: num(process.env.AI_RATE_LIMIT_MAX, 20),
  ollama: {
    enabled: bool(process.env.OLLAMA_ENABLED, false),
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
    defaultModel: process.env.OLLAMA_DEFAULT_MODEL || '',
  },
  openai: {
    enabled: Boolean(process.env.OPENAI_API_KEY),
    apiKey: process.env.OPENAI_API_KEY || '',
    baseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    defaultModel: process.env.OPENAI_DEFAULT_MODEL || '',
  },
  gemini: {
    enabled: Boolean(process.env.GEMINI_API_KEY),
    apiKey: process.env.GEMINI_API_KEY || '',
    baseUrl: (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, ''),
    defaultModel: process.env.GEMINI_DEFAULT_MODEL || '',
  },
  compatible: {
    enabled: Boolean(process.env.AI_COMPATIBLE_BASE_URL),
    name: process.env.AI_COMPATIBLE_NAME || 'OpenAI-compatible',
    apiKey: process.env.AI_COMPATIBLE_API_KEY || '',
    baseUrl: (process.env.AI_COMPATIBLE_BASE_URL || '').replace(/\/+$/, ''),
    defaultModel: process.env.AI_COMPATIBLE_DEFAULT_MODEL || '',
  },
};

export function publicAiConfig() {
  return {
    enabled: aiConfig.enabled,
    timeoutMs: aiConfig.timeoutMs,
    providers: {
      ollama: { configured: aiConfig.ollama.enabled, local: true, baseUrl: aiConfig.ollama.enabled ? aiConfig.ollama.baseUrl : null },
      openai: { configured: aiConfig.openai.enabled, local: false, baseUrl: aiConfig.openai.enabled ? aiConfig.openai.baseUrl : null },
      gemini: { configured: aiConfig.gemini.enabled, local: false, baseUrl: aiConfig.gemini.enabled ? aiConfig.gemini.baseUrl : null },
      compatible: { configured: aiConfig.compatible.enabled, local: false, baseUrl: aiConfig.compatible.enabled ? aiConfig.compatible.baseUrl : null },
    },
  };
}
