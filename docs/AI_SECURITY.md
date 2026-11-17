# AI security boundary

- API keys are read only by the server provider adapters; they are not placed in React state, localStorage, preload, or renderer bundles.
- Electron local Ollama requests are restricted to loopback and validated in the main process.
- Chat input, message count, context size, response size, timeout, and request rate are bounded.
- Sensitive filename patterns such as `.env`, credentials, private keys, and certificates are excluded by the server context sanitizer.
- Context upload is opt-in and visibly labeled in the chat panel.
- AI has no filesystem, terminal, compiler, or autonomous tool permissions in Milestone 1.
- Logs and errors must not include credentials or full project source.
