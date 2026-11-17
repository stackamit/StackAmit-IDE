# AI Plugin Security

The catalogue is trusted and static. Renderer code receives metadata only. Provider secrets remain outside the browser bundle and are not returned by catalogue endpoints.

Cloud credentials must be encrypted at rest with an environment-managed master key and scoped to an authenticated user. Because the current application has no end-user accounts, this vault is intentionally not implemented as an unauthenticated shared store.
