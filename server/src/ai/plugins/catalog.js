import { validatePluginManifest } from './manifest.js';

const manifests = [
  { id: 'stackamit.openai', name: 'OpenAI', description: 'Connect an OpenAI API key and use verified hosted chat models.', provider: 'openai', version: '1.0.0', author: 'StackAmit', icon: null, authType: 'api_key', capabilities: ['chat', 'streaming', 'code-generation', 'model-discovery'], permissions: ['network'], endpoint: { documentationUrl: 'https://platform.openai.com/docs' }, supportedModels: [], firstParty: true },
  { id: 'stackamit.gemini', name: 'Google Gemini', description: 'Connect a Gemini API key and discover models supported by the official Gemini API.', provider: 'gemini', version: '1.0.0', author: 'StackAmit', icon: null, authType: 'api_key', capabilities: ['chat', 'streaming', 'code-generation', 'model-discovery'], permissions: ['network'], endpoint: { documentationUrl: 'https://ai.google.dev/gemini-api/docs' }, supportedModels: [], firstParty: true },
  { id: 'stackamit.ollama', name: 'Ollama', description: 'Use models installed on a local Ollama server, including Qwen and Llama families.', provider: 'ollama', version: '1.0.0', author: 'StackAmit', icon: null, authType: 'local_endpoint', capabilities: ['chat', 'streaming', 'code-generation', 'model-discovery'], permissions: ['local_endpoint'], endpoint: { documentationUrl: 'https://ollama.com/library' }, supportedModels: [], firstParty: true },
  { id: 'stackamit.openai-compatible', name: 'OpenAI-compatible', description: 'Connect a trusted OpenAI-compatible endpoint with explicit endpoint configuration.', provider: 'compatible', version: '1.0.0', author: 'StackAmit', icon: null, authType: 'compatible_endpoint', capabilities: ['chat', 'streaming', 'model-discovery'], permissions: ['network'], endpoint: { documentationUrl: 'https://platform.openai.com/docs/api-reference' }, supportedModels: [], firstParty: true },
].map(validatePluginManifest);

export function listPluginManifests() { return manifests.map((plugin) => ({ ...plugin, supportedModels: [...plugin.supportedModels] })); }
export function getPluginManifest(id) { return manifests.find((plugin) => plugin.id === id) || null; }
