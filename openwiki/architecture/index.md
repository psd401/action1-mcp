# Files

- [Action1 REST client, auth, retry and errors](action1-client.md) - How Action1Client talks to the Action1 API - OAuth2 token provider, method-aware retry rules, path and URL safety, redirect refusal, timeouts and cancellation, pagination walker, and error-to-hint mapping.
- [Configuration and credentials](configuration.md) - The single validated environment schema (EnvSchema/loadConfig), the ENV_VARS documentation table that drives --help and .env.example, org resolution, and the optional macOS Keychain credential source.
- [Architecture overview](overview.md) - How the action1-mcp server is layered, from process entry points and transports through tool registration, the guarded Action1 REST client, and the generated versus curated tool surface.
- [Runtime, transports and request context](runtime-and-transports.md) - How action1-mcp starts (stdio or stateless Streamable HTTP), the HTTP middleware chain and its startup refusals, the registration policy installed by buildServer, and the per-call request context that ties logs, guard decisions and audit events together.
