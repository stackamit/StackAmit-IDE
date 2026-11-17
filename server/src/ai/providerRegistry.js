import { aiConfig, publicAiConfig } from './aiConfig.js';
import { publicProvider } from './baseProvider.js';
import { createCompatibleProvider } from './providers/compatibleProvider.js';
import { createGeminiProvider } from './providers/geminiProvider.js';
import { createOllamaProvider } from './providers/ollamaProvider.js';
import { createOpenAiProvider } from './providers/openaiProvider.js';

export function providerInstances() {
  return {
    ollama: createOllamaProvider(),
    openai: createOpenAiProvider(),
    gemini: createGeminiProvider(),
    compatible: createCompatibleProvider(),
  };
}

export function getProvider(id) {
  return providerInstances()[id] || null;
}

export function listProviderMetadata() {
  const config = publicAiConfig();
  return Object.entries(config.providers).map(([id, item]) => publicProvider(id, { ...item, name: id === 'ollama' ? 'Ollama' : id === 'openai' ? 'OpenAI' : id === 'gemini' ? 'Google Gemini' : 'OpenAI-compatible' }));
}

export function modelDefaults() {
  return {
    ollama: aiConfig.ollama.defaultModel || null,
    openai: aiConfig.openai.defaultModel || null,
    gemini: aiConfig.gemini.defaultModel || null,
    compatible: aiConfig.compatible.defaultModel || null,
  };
}
