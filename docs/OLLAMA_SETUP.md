# Ollama setup

Install Ollama and start its local service, then install a model, for example:

```text
ollama pull qwen2.5-coder:7b
ollama pull llama3.2:3b
```

Desktop StackAmit-IDE discovers models through the trusted main process and can chat without internet access. Only loopback Ollama URLs are accepted by the desktop bridge. A hosted web server cannot see the user’s local Ollama; configure a server-side Ollama endpoint only when that is intentional and trusted.

The UI does not claim a model is available until `/api/tags` or the desktop IPC equivalent succeeds.
