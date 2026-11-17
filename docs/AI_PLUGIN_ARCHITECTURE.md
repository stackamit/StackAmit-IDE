# StackAmit-AI Plugin Architecture

Milestone 2.5 extends the existing provider registry and model router. A plugin is a validated first-party manifest and provider adapter; it is not executable renderer code and cannot spawn processes or access files.

The initial catalogue is exposed by `GET /api/ai/plugins`. Provider health, models, streaming and chat continue to use the existing `/api/ai/providers/*` and `/api/ai/chat/stream` contracts.

The current repository has admin authentication but no end-user identity system. Per-user web credential connections therefore require the account/vault phase before connection mutation endpoints are enabled.
