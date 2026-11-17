# StackAmit-IDE AI architecture

Milestone 1 adds a provider-neutral AI boundary without changing Monaco, language runners, terminal, preview, or Electron window ownership.

The web path is `renderer → /api/ai → provider adapter`. Cloud credentials stay in the server environment. The desktop local path is `renderer → preload → validated main-process IPC → loopback Ollama`; the renderer never opens arbitrary local network connections.

Provider adapters implement health checks, model discovery, generation, streaming, cancellation, and capabilities. The model list is runtime-discovered, so Qwen2.5-Coder and Llama are available when installed rather than being hardcoded.

The chat milestone is intentionally advisory: it can read explicitly selected context, but it cannot modify files, execute terminal commands, or invoke autonomous tools.
