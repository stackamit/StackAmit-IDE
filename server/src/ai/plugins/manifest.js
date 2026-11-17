import { z } from 'zod';

export const pluginManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/),
  name: z.string().min(1).max(100),
  description: z.string().max(1000),
  provider: z.enum(['openai', 'gemini', 'ollama', 'compatible']),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  author: z.string().min(1).max(120),
  icon: z.string().url().optional().nullable(),
  authType: z.enum(['api_key', 'oauth_pkce', 'local_endpoint', 'compatible_endpoint']),
  capabilities: z.array(z.enum(['chat', 'streaming', 'code-generation', 'model-discovery'])).max(12),
  permissions: z.array(z.enum(['network', 'local_endpoint'])).max(4),
  endpoint: z.object({ baseUrl: z.string().url().optional(), documentationUrl: z.string().url() }).strict(),
  supportedModels: z.array(z.string().max(200)).max(100),
  firstParty: z.literal(true),
}).strict();

export function validatePluginManifest(manifest) { return pluginManifestSchema.parse(manifest); }
