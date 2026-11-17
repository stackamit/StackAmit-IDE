# AI Provider Setup

The existing server-side provider setup remains valid for OpenAI, Gemini, Ollama and OpenAI-compatible endpoints. Use the existing `server/.env.example` settings and verify providers through the Model Hub health check.

Ollama can also be accessed through the trusted Electron main-process bridge. Browser local-endpoint access must remain explicit and restricted; a remote Express server cannot reach a user's loopback Ollama service.
