import test from 'node:test';
import assert from 'node:assert/strict';
import { createOllamaProvider } from '../src/ai/providers/ollamaProvider.js';
import { createOpenAiProvider } from '../src/ai/providers/openaiProvider.js';
import { createGeminiProvider } from '../src/ai/providers/geminiProvider.js';
import { listProviderMetadata } from '../src/ai/providerRegistry.js';

const streamResponse = (text, headers = {}) => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close(); } }), { status: 200, headers });

test('provider registry exposes the four supported provider contracts', () => {
  assert.deepEqual(listProviderMetadata().map((p) => p.id), ['ollama', 'openai', 'gemini', 'compatible']);
});

test('Ollama parses installed models and streamed deltas', async () => {
  const original = global.fetch;
  global.fetch = async (url) => url.endsWith('/api/tags') ? new Response(JSON.stringify({ models: [{ name: 'qwen2.5-coder:7b' }, { name: 'llama3.2:3b' }] })) : streamResponse('{"message":{"content":"hello"}}\n{"done":true,"eval_count":2}\n');
  try {
    const provider = createOllamaProvider({ enabled: true, baseUrl: 'http://127.0.0.1:11434', defaultModel: '' });
    assert.equal((await provider.listModels()).length, 2);
    const chunks = []; await provider.stream({ model: 'qwen2.5-coder:7b', messages: [], onDelta: (value) => chunks.push(value) }); assert.deepEqual(chunks, ['hello']);
  } finally { global.fetch = original; }
});

test('Ollama reports unavailable without throwing from health checks', async () => {
  const original = global.fetch; global.fetch = async () => { throw new Error('offline'); };
  try { const result = await createOllamaProvider({ enabled: true, baseUrl: 'http://127.0.0.1:11434', defaultModel: '' }).healthCheck(); assert.equal(result.available, false); }
  finally { global.fetch = original; }
});

test('OpenAI streaming uses server-side credentials and parses response deltas', async () => {
  const original = global.fetch; global.fetch = async (_url, init) => { assert.equal(init.headers.Authorization, 'Bearer test-secret'); return streamResponse('event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"ok"}\n\nevent: response.completed\ndata: {"type":"response.completed"}\n\n'); };
  try { const chunks = []; await createOpenAiProvider({ enabled: true, apiKey: 'test-secret', baseUrl: 'https://api.openai.com/v1', defaultModel: '' }).stream({ model: 'gpt-test', messages: [], onDelta: (value) => chunks.push(value) }); assert.deepEqual(chunks, ['ok']); }
  finally { global.fetch = original; }
});

test('Gemini invalid credentials become an unavailable health result', async () => {
  const original = global.fetch; global.fetch = async () => new Response(JSON.stringify({ error: { message: 'invalid key' } }), { status: 401 });
  try { const result = await createGeminiProvider({ enabled: true, apiKey: 'invalid', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: '' }).healthCheck(); assert.equal(result.available, false); assert.equal(result.code, 'AI_AUTH_FAILED'); }
  finally { global.fetch = original; }
});

test('Gemini model discovery accepts API responses that omit streamGenerateContent', async () => {
  const original = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ models: [
    { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent', 'streamGenerateContent'] },
    { name: 'models/gemini-tts', displayName: 'Gemini TTS', supportedGenerationMethods: [] },
  ] }));
  try {
    await assert.deepEqual(await createGeminiProvider({ enabled: true, apiKey: 'test', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: '' }).listModels(), [{ id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' }]);
  } finally { global.fetch = original; }
});

test('Gemini health is unavailable when the configured key returns no text models', async () => {
  const original = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ models: [] }));
  try {
    const result = await createGeminiProvider({ enabled: true, apiKey: 'test', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: '' }).healthCheck();
    assert.equal(result.available, false);
    assert.equal(result.code, 'AI_MODELS_UNAVAILABLE');
  } finally { global.fetch = original; }
});

test('Gemini keeps the API key in the official request header for model listing and streaming', async () => {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: init.headers });
    if (String(url).endsWith('/models')) return new Response(JSON.stringify({ models: [{ name: 'models/gemini-test', displayName: 'Gemini Test', supportedGenerationMethods: ['generateContent'] }] }));
    return streamResponse('data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\n\n');
  };
  try {
    const provider = createGeminiProvider({ enabled: true, apiKey: 'test-secret', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: '' });
    assert.equal((await provider.listModels())[0].id, 'gemini-test');
    const chunks = [];
    await provider.stream({ model: 'gemini-test', messages: [{ role: 'user', content: 'hello' }], onDelta: (value) => chunks.push(value) });
    assert.deepEqual(chunks, ['ok']);
    assert.equal(calls.every((call) => call.headers['x-goog-api-key'] === 'test-secret'), true);
    assert.equal(calls.every((call) => !call.url.includes('test-secret')), true);
  } finally { global.fetch = original; }
});
