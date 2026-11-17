# User-owned AI providers

StackAmit IDE stores cloud-provider credentials per end-user. A user’s key is encrypted with AES-256-GCM before it is written to MongoDB. API responses contain only a masked suffix; the raw key is never returned to the browser, admin APIs, or logs.

## Server configuration

Set `AI_CREDENTIAL_ENCRYPTION_KEY` in `server/.env` to a stable 32-byte secret. It may be represented as 64 hexadecimal characters or base64. Generate one with a secret manager or:

```text
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Changing this key makes previously stored credentials undecryptable. Rotate it only with a planned decrypt/re-encrypt migration.

## Supported user connections

- OpenAI, Gemini, and OpenAI-compatible endpoints require the authenticated user to save their own key.
- Ollama remains local and can be used without a cloud key. Desktop Ollama traffic stays behind the existing Electron bridge.
- A cloud request never falls back to `OPENAI_API_KEY`, `GEMINI_API_KEY`, or another server-level provider key.

User endpoints are mounted under `/api/user/ai`, require `requireUser`, and apply CSRF protection to mutations. Ownership is derived from the authenticated session; request bodies cannot select another user.

## Plugin installation

Provider plugin installation stores only a reviewed manifest reference and per-user installation state. It does not download or execute arbitrary code, and it does not contain credentials.

## Current scope

The runtime adapters currently reused by user routing are Ollama, OpenAI, Gemini, and OpenAI-compatible. Additional provider catalogue entries should not be presented as connected until an official adapter, model discovery, streaming behavior, and tests are implemented.
