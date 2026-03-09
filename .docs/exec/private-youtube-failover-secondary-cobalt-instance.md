# Private YouTube Failover to a Secondary Cobalt Instance

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with [`.docs/PLANS.md`](/Users/axel/Desktop/Code_Projects/Personal/Siphon/.docs/PLANS.md).

## Purpose / Big Picture

This change lets a private Siphon deployment keep using its own API as the only client-facing endpoint while quietly retrying failed hosted YouTube requests through a second cobalt-compatible instance. A user still opens the Siphon web app, pastes or shares a YouTube URL, and downloads through the same Siphon domain; the difference is that the API can salvage retryable VPS-side YouTube failures without exposing the fallback instance to the client.

The result is observable in two ways. First, retryable hosted YouTube failures on the primary VPS can now succeed when `YOUTUBE_FALLBACK_API_URL` is configured. Second, browser network traffic and returned URLs continue to point at the local Siphon API domain rather than the fallback origin because the API re-wraps fallback media URLs as local tunnels.

## Progress

- [x] (2026-03-09 22:31Z) Read the relevant environment, request, match, analyze, and stream modules to confirm where a hidden secondary-instance fallback fits.
- [x] (2026-03-09 22:36Z) Added `YOUTUBE_FALLBACK_*` env parsing and validation plus the reusable fallback helper module.
- [x] (2026-03-09 22:39Z) Integrated YouTube fallback into `match.js` and `analyze.js`, including local tunnel re-wrapping and synthetic analyze fallback for remote instances that do not support `/analyze`.
- [x] (2026-03-09 22:40Z) Added deterministic unit and integration-style tests for fallback policy, env validation, and fallback wiring.
- [x] (2026-03-09 22:42Z) Updated deployment/docs examples and captured the implementation-specific discovery about community instances lacking `/analyze`.
- [x] (2026-03-09 22:43Z) Recorded final outcomes and repo-level verification status, including the remaining pre-existing live extractor failures.

## Surprises & Discoveries

- Observation: `resolveMatchData()` is already the safest extension point for late transport data, and it now carries `proxyToUse` and `requestIP` forward from YouTube results.
  Evidence: `api/src/processing/match.js` updates `proxyToUse = r.proxyToUse ?? proxyToUse` and `requestIP = r.requestIP ?? requestIP` before producing the resolved action input.

- Observation: the new Siphon web flow still rejects `local-processing`, so the fallback request should prefer proxy/tunnel-safe outputs rather than depending on browser-side remux support.
  Evidence: `web/src/routes/+page.svelte` currently sets `inlineError = "Local processing downloads are not yet supported in the new Siphon flow."` for `local-processing` responses.

- Observation: public/community cobalt instances do not reliably expose this fork’s custom `/analyze` endpoint.
  Evidence: `curl -X POST https://cobalt.meowing.de/analyze` returned HTTP `405` during implementation, so fallback analyze had to degrade to repeated fallback `POST /` calls that synthesize the Siphon quality list.

## Decision Log

- Decision: Keep the fallback feature deployer-only and disabled by default through `YOUTUBE_FALLBACK_*` env vars rather than exposing any web-facing instance configuration.
  Rationale: the user wants the backend to manage routing privately, and the existing web app should remain unchanged.
  Date/Author: 2026-03-09 / Codex

- Decision: Re-wrap all successful fallback media URLs as local tunnels on the Siphon API domain.
  Rationale: this keeps the fallback instance hidden from clients and preserves Siphon-owned metadata, stats, and transport behavior.
  Date/Author: 2026-03-09 / Codex

- Decision: Keep the fallback helper compatible with upstream/community cobalt instances by synthesizing analyze results from repeated fallback `POST /` calls when remote `/analyze` returns `404` or `405`.
  Rationale: the intended fallback target is a public/community instance, and those instances generally support standard cobalt `POST /` but not this fork’s custom analyze endpoint.
  Date/Author: 2026-03-09 / Codex

## Outcomes & Retrospective

The private YouTube fallback now exists as a deployer-only API feature. The primary Siphon API still handles every request first. When the local hosted YouTube path ends in a retryable VPS-style failure, `match.js` now tries a secondary cobalt-compatible instance, logs the attempt, and re-wraps successful fallback media URLs as local Siphon tunnels so the client never sees the fallback origin directly. `analyze.js` also gained a hidden fallback path; it prefers a real remote `/analyze` when available and otherwise synthesizes a usable Siphon quality list from repeated fallback `POST /` calls.

Deterministic fallback tests pass under Node 20, including env validation, timeout/auth behavior, match fallback, and analyze synthesis. The broader live API suite still exits non-zero because of pre-existing extractor failures in unrelated services such as Loom, Vimeo, and several ignored fixtures, plus the repo’s existing ignored `youtube.no_matching_format` cases. No new regression was observed in the targeted fallback coverage.

## Context and Orientation

The Siphon API receives download requests through `POST /` and analysis requests through `POST /analyze`. The request normalization and response shaping live in `api/src/processing/request.js`. The extractor selection and service-specific fetch logic live in `api/src/processing/match.js`. The `/analyze` path builds the Siphon quality screen payload from extractor results in `api/src/processing/analyze.js`. Local proxy streams, called tunnels in this repository, are created in `api/src/stream/manage.js` and returned to clients through `createResponse()` in `api/src/processing/request.js`.

Hosted YouTube is special because it is more brittle on VPS and datacenter IPs. The current YouTube extractor and retry policy already live in `api/src/processing/services/youtube.js` and `api/src/processing/services/youtube-policy.js`. This plan does not replace that logic. Instead, it adds a last-resort fallback after the primary YouTube path has exhausted its own retries and produced a retryable error such as `youtube.login`, `fetch.fail`, or unsupported-client `content.video.unavailable`.

The fallback instance is another cobalt-compatible API. Siphon will call its `POST /` or `POST /analyze` endpoints with the same normalized request body, optionally adding a configured authorization header. If the fallback succeeds, Siphon must hide the remote instance from the client by wrapping every returned media URL as a new local tunnel on the Siphon API origin.

## Plan of Work

Start in `api/src/core/env.js` by parsing three new optional env vars: `YOUTUBE_FALLBACK_API_URL`, `YOUTUBE_FALLBACK_AUTH_HEADER`, and `YOUTUBE_FALLBACK_TIMEOUT_MS`. Trim and validate the URL once during load, require an `http:` or `https:` scheme, and reject a configured value that resolves to the same origin as `env.apiURL` during validation. Keep the feature disabled when no fallback URL is configured.

Add a new helper module at `api/src/processing/helpers/cobalt-fallback.js`. This file must own the retryable YouTube fallback policy, the HTTP client for the secondary cobalt instance, and the local re-wrapping helpers. It should export `shouldTryYoutubeFallback(errorCode, context)`, `callFallbackAnalyze(request)`, `callFallbackDownload(request)`, `wrapFallbackResponse(response, host)`, and `wrapFallbackUrlAsLocalTunnel(url, meta)`. The HTTP client must speak JSON only, enforce the configured timeout, attach the optional authorization header, and return explicit helper-level errors for timeout, malformed JSON, unsupported status, and network failure. The wrapper helpers must convert remote `tunnel`, `redirect`, and `picker` URLs into local tunnels created by `api/src/stream/manage.js`.

Update `api/src/processing/match.js` so that only the YouTube branch may invoke the fallback. Leave the primary YouTube extractor and retry chain untouched. After the primary path finishes and produces an error, ask `shouldTryYoutubeFallback()` whether the error is retryable. If so, call the secondary cobalt instance with the same normalized request body but force `localProcessing` to `disabled` and `alwaysProxy` to `true`. On success, wrap the remote response as local tunnels and return it through the existing match/match-action flow. On failure, preserve the original local error and append compact fallback diagnostics into the error context and warning logs.

Update `api/src/processing/analyze.js` so `/analyze` can use the same fallback policy. If the local analyze call succeeds, return the current result unchanged. If it fails with a retryable hosted YouTube error and the fallback is configured, call the remote `/analyze`, validate the returned cobalt response, and normalize it into the same Siphon analyze success or picker payload that the web client already understands. If the fallback fails, return the original local error with fallback diagnostics in the context.

Add tests next to the existing API processing tests. The helper module needs unit tests for retry eligibility, auth header injection, timeouts, malformed payload handling, and URL wrapping. The match and analyze modules need integration-style tests that prove local success does not trigger fallback, retryable YouTube failures do, terminal failures do not, and successful fallback URLs are always rewritten to the local API origin.

Finish by updating `api/.env.example`, `docs/api-env-variables.md`, `docker-compose.yml`, `deploy/dokploy/dokploy.env.example`, and `AGENTS.md` so deployers know the feature is private, disabled by default, limited to YouTube, and still uses the fallback instance’s IP rather than the end-user’s IP.

## Concrete Steps

From the repository root `/Users/axel/Desktop/Code_Projects/Personal/Siphon`, run the focused fallback tests under Node 20:

    rtk proxy npx -y node@20 --test api/src/processing/helpers/cobalt-fallback.test.js api/src/processing/match.test.js api/src/processing/analyze.test.js api/src/processing/services/youtube-policy.test.js

Expect all focused tests to pass.

For broader verification, run:

    rtk proxy sh -lc 'cd api && npx -y node@20 --test src/**/*.test.js'
    rtk proxy sh -lc 'cd api && npx -y node@20 src/util/test'

When the feature is configured in a deployment, restart the API and then exercise a YouTube URL that fails on the primary VPS path. Expect the API logs to show a fallback attempt and the final client-visible download URL to remain on your Siphon domain.

## Validation and Acceptance

Acceptance is behavioral. With no `YOUTUBE_FALLBACK_API_URL`, the API must behave exactly as before. With `YOUTUBE_FALLBACK_API_URL` set, a hosted YouTube request that fails locally with a retryable bot-wall or unsupported-client error should trigger one fallback attempt. If the fallback succeeds, the returned download URL must still be a local Siphon tunnel. If the fallback fails or returns an unsupported payload, the client should still receive the original local error plus compact fallback diagnostics in the error context.

The automated proof is the focused Node 20 fallback tests plus the broader API suite. The manual proof is to open the web app, request a YouTube download that normally fails on the VPS, and confirm the browser only talks to the Siphon API origin while the server logs show fallback success.

## Idempotence and Recovery

All env parsing and fallback integration are additive and safe to re-run. If the fallback configuration is invalid, validation should fail fast at API startup rather than partially enabling the feature. If the fallback instance is down or malformed, Siphon must fall back to its original local error path without affecting non-YouTube services.

## Artifacts and Notes

Expected diagnostic shape on a final error after a failed fallback:

    {
      "status": "error",
      "error": {
        "code": "error.api.content.video.unavailable",
        "context": {
          "service": "YouTube",
          "youtubeFallbackAttempted": true,
          "youtubeFallbackUsed": false,
          "youtubeFallbackInstanceHost": "fallback.example",
          "youtubeFallbackErrorCode": "error.api.fetch.fail"
        }
      }
    }

Expected success behavior on fallback:

    the API returns `status: "tunnel"` or `status: "picker"` as usual,
    and every URL in the response points at the local `API_URL` origin rather than the remote fallback origin.

## Interfaces and Dependencies

In `api/src/core/env.js`, extend the loaded environment object with:

    ytFallbackApiURL?: string
    ytFallbackAuthHeader?: string
    ytFallbackTimeoutMs: number

In `api/src/processing/helpers/cobalt-fallback.js`, define and export:

    export function shouldTryYoutubeFallback(errorCode, context)
    export async function callFallbackAnalyze(request)
    export async function callFallbackDownload(request)
    export function wrapFallbackUrlAsLocalTunnel(url, meta)
    export function wrapFallbackResponse(response, host)

`wrapFallbackResponse()` must accept cobalt-compatible fallback responses with `status` values of `tunnel`, `redirect`, `picker`, or `local-processing` and return a response object that is safe to hand back to Siphon’s existing response path without exposing the fallback origin.

Revision note: updated after implementation to record the compatibility discovery that public/community cobalt instances generally lack `/analyze`, which is why the helper now synthesizes fallback analyze results from repeated `POST /` calls.
