---
type: Architecture
title: Action1 REST client, auth, retry and errors
description: "How Action1Client talks to the Action1 API - OAuth2 token provider, method-aware retry rules, path and URL safety, redirect refusal, timeouts and cancellation, pagination walker, and error-to-hint mapping."
tags: [client, oauth2, retry, http, upstream]
openwiki:
  roles: [architecture, integration]
  change_kinds: [lifecycle, security, upstream-api]
  source_paths: [src/client/action1Client.ts, src/client/auth.ts, src/client/retry.ts, src/client/errors.ts, src/client/pagination.ts, src/client/endpointInfo.ts]
  symbols: [Action1Client, RequestOptions, TokenProvider, withRetry, shouldRetry, assertSafeApiPath, Action1ApiError, Action1AuthError, Action1TimeoutError, deriveHint, paginate, parsePageEnvelope, fetchEndpointInfo]
  test_paths: [tests/unit/action1Client.test.ts, tests/unit/action1Client401Retry.test.ts, tests/unit/clientReliability.test.ts, tests/unit/auth.test.ts, tests/unit/retry.test.ts, tests/unit/pagination.test.ts, tests/unit/errorsHint.test.ts, tests/security/redirect.test.ts, tests/security/errorRedaction.test.ts]
  invariants: ["A non-GET/HEAD request is never retried after it may have reached Action1 (only 429 and pre-send network errors).", "Redirects are never followed (redirect: error).", "The resolved URL must keep the ACTION1_BASE_URL origin and base path.", "Token cache is either fully updated or untouched."]
  validation_commands: ["bunx vitest run tests/unit/action1Client.test.ts tests/unit/clientReliability.test.ts tests/unit/auth.test.ts tests/security/redirect.test.ts --reporter=dot"]
---

# Action1 REST client, auth, retry and errors

`Action1Client` (`src/client/action1Client.ts`) is the only code that talks to `ACTION1_BASE_URL`. One instance is shared by every tool of a server (stdio: one per process; HTTP: one shared across per-request servers, see [Runtime and transports](runtime-and-transports.md)). It holds no per-request state; per-call state comes from the `AsyncLocalStorage` request context.

## Request pipeline

<!-- openwiki: mermaid parse failed and this diagram was converted to a text fence so it does not break rendering. Fix the diagram source and restore the mermaid fence. Parser error: Heuristic: a semicolon inside a label breaks rendering; rephrase the label. -->
```text
flowchart TD
  A["request(path, opts)"] --> B["buildUrl: assertSafeApiPath + origin/base-path pin"]
  B --> C["AbortSignal.any: caller signal, MCP request signal, timeout"]
  C --> D["withRetry(doRequest)"]
  D --> E["tokens.getAccessToken (abortable)"]
  E --> F{"approved mutation?"}
  F -- yes --> G["noteExecutionSent: destructive_executed audit (once, before first send)"]
  F -- no --> H["fetch redirect:error"]
  G --> H
  H --> I{"status"}
  I -- 401 --> J["invalidate token, retry once for any method"]
  I -- "!ok" --> K["Action1ApiError + hint + retryAfterMs"]
  I -- 204 --> L["undefined"]
  I -- JSON --> M["parsed body"]
  I -- text --> N["text; CSV/JSON masked when ACTION1_REDACT_PII"]
```

*Caption: the whole call, including token wait and back-off sleeps, shares one `ACTION1_REQUEST_TIMEOUT_MS` budget.*

### Invariants worth knowing

- **Path safety**: `assertSafeApiPath` rejects empty segments, dot segments (also `%2e`), segments decoding to `/` or `\`, raw backslashes and control characters. `buildUrl` uses the single-argument `new URL(base + path)` form on purpose (the two-argument form lets `//evil` override the host) and re-checks origin and base path. Tools call `assertSafeApiPath` *before* the destructive guard so a dry-run preview never shows a path the client would refuse.
- **Retry policy** (`shouldRetry`): 429 always; status 0 (wrapped network error) retries transient errors for GET/HEAD but only *pre-send* errors for other methods; 5xx only for GET/HEAD. `RequestOptions.retry: false` disables retries (used by `startAction` so a lost response cannot start an action twice). `withRetry` uses exponential back-off (base 250 ms, max 4 s, 5 attempts) with ±25 % jitter; server `Retry-After` is honoured verbatim, capped at 60 s (`RETRY_AFTER_CEILING_MS`).
- **401 handling**: invalidate the token and re-issue once (`retriedAfter401`), safe for every method because a 401 is rejected before processing.
- **Timeouts**: `Action1TimeoutError` for the budget; caller cancellation surfaces as `AbortError`. Mutation timeouts say the request "may already have been processed".
- **Text bodies**: non-JSON answers (CSV exports) pass `redactPiiInBody` when PII masking is on, because key-based masking in `jsonResult` cannot see them.

## `TokenProvider` (`src/client/auth.ts`)

OAuth2 `client_credentials`, refresh-token renewal with fallback, renewal five minutes before expiry (`REFRESH_LEAD_MS`), concurrent callers share one in-flight promise, up to 3 bounded retries for transient token failures (credential errors are not retried), token requests refuse redirects so the secret only goes to `ACTION1_BASE_URL`. `state()` (`cached` | `failing` | `not_acquired`) feeds `/readyz` without any network call. Contract: `cache` is either fully updated or untouched; `abortable()` lets one caller stop waiting without cancelling the shared fetch.

## Errors (`src/client/errors.ts`)

`Action1ApiError` (HTTP status; status 0 = network or refused redirect), `Action1AuthError`, `Action1TimeoutError`. `deriveHint(status, url, method)` produces actionable guidance (for example 403 hints that name the missing role permission such as `view_vulnerabilities` or `view_audit`), and `toToolErrorText()` is what `runTool` in `src/tools/helpers.ts` returns to the model. Bodies and paths are redacted before they reach text or logs (`redactPath`, [Redaction and audit](../security/redaction-and-audit.md)).

## Pagination and endpoint lookup

- `client.paginate()` / `paginate()` walk `limit`/`from` lists and stop on `pageHasMore`, `maxItems` or abort; `parsePageEnvelope` tolerates the envelope variants Action1 uses (bare array, `items`, next-page links). Tool-level cursors are a different layer: see [Output shaping and pagination](../domain/output-and-pagination.md).
- `fetchEndpointInfo` reads the canonical `GET /endpoints/managed/{org}/{id}` and falls back to scanning the list on 403/404 (the `/general` suffix in `self` URLs is a UI artifact that returns 403).

## Change guidance

- Add a client option -> `RequestOptions` + `doRequest`; keep audit-before-first-send and the retry matrix; add a case to `tests/unit/clientReliability.test.ts`.
- Anything that sends credentials must pass `redirect: "error"`; `tests/security/redirect.test.ts` scans for every credential-carrying `fetch`, including `scripts/live-shape-check.mjs`.
- Calling a path not in the vendored spec requires an entry in `src/codegen/spec/known-undocumented-endpoints.json` (see [Codegen and spec](../workflows/codegen-and-spec.md)).
- Narrow check: the command in front matter; broader `bun run test:security` only when redaction or redirect behaviour changed.
der `bun run test:security` only when redaction or redirect behaviour changed.
