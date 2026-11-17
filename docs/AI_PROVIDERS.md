# AI provider setup

Server-side configuration belongs in `server/.env` or the deployment secret manager:

```dotenv
AI_ENABLED=true
OLLAMA_ENABLED=true
OLLAMA_BASE_URL=http://127.0.0.1:11434
OPENAI_API_KEY=...
GEMINI_API_KEY=...
AI_COMPATIBLE_BASE_URL=https://provider.example/v1
AI_COMPATIBLE_API_KEY=...
```

OpenAI, Gemini, and compatible providers are cloud/server providers. The browser receives only provider metadata and verified model identifiers; it never receives API keys. OpenAI’s official guidance likewise requires API keys to remain server-side: [OpenAI API overview](https://developers.openai.com/api/reference/overview).

The default web API routes are `GET /api/ai/providers`, `GET /api/ai/providers/:provider/health`, `GET /api/ai/providers/:provider/models`, and `POST /api/ai/chat/stream`.
