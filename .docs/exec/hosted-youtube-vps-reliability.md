# Hosted YouTube VPS Reliability

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with [`.docs/PLANS.md`](/Users/axel/Desktop/Code_Projects/Personal/Siphon/.docs/PLANS.md).

## Purpose / Big Picture

After this change, hosted YouTube requests on Dokploy and other VPS deployments will use a controlled, inspectable retry policy instead of the current ad hoc fallback chain. The API will be able to try a direct hosted client sequence first, optionally replay the same sequence through a YouTube-only proxy, and return enough context to tell whether a failure came from client choice, a bot wall, or IP reputation. The visible proof is a hosted YouTube request whose logs show a deterministic attempt trail and, when configured, a single proxy replay instead of looping or ending on `TV_EMBEDDED`.

## Progress

- [x] (2026-03-09 21:05Z) Re-read the current YouTube service, env parsing, match transport propagation, helper service, and Dokploy env surfaces.
- [x] (2026-03-09 21:10Z) Wrote this ExecPlan and refreshed `working_list.md` for the implementation.
- [x] (2026-03-09 21:25Z) Added `api/src/processing/services/youtube-policy.js`, parsed the new hosted env surface in `api/src/core/env.js`, and covered queue/classification behavior with deterministic unit tests.
- [x] (2026-03-09 21:40Z) Refactored `api/src/processing/services/youtube.js` to consume the hosted policy queue, emit structured attempt context, and attach late proxy choices to successful results.
- [x] (2026-03-09 21:42Z) Propagated late YouTube `proxyToUse` and `requestIP` values through `resolveMatchData()` and added a test seam for transport propagation.
- [x] (2026-03-09 21:48Z) Added helper-only proxy env passthrough, updated deployment/docs surfaces, and recorded the new hosted defaults in `AGENTS.md`.
- [x] (2026-03-09 21:55Z) Ran targeted Node 20 tests for the new policy/transport behavior and then `rtk npm run test:api`; the new tests passed and the full API suite still failed only in the existing live extractor set.

## Surprises & Discoveries

- Observation: the current `youtube.js` retry model only retries bot-style `LOGIN_REQUIRED` or `UNPLAYABLE` responses plus thrown `/player` fetch failures. Any other non-`OK` playability status becomes a terminal `content.video.unavailable`.
  Evidence: `api/src/processing/services/youtube.js` currently returns immediately from the `playability.status !== "OK"` branch after logging `youtubeStatus`, `youtubeReason`, and `youtubeClient`.

- Observation: the stream layer already preserves `proxyToUse` end to end, but `resolveMatchData()` only knows about proxies chosen before the service call.
  Evidence: `api/src/stream/manage.js` recreates a `ProxyAgent` from stored `proxyToUse`, while `api/src/processing/match.js` initializes `proxyToUse` only from global match-time proxy settings.

- Observation: the current `youtubei.js` dependency supports `TV`, `WEB_CREATOR`, `WEB_EMBEDDED`, and `TV_EMBEDDED`, so changing the hosted client order does not require a dependency upgrade.
  Evidence: `api/node_modules/youtubei.js/dist/src/utils/Constants.js` lists those clients in `SUPPORTED_CLIENTS`.

- Observation: the host default `node` binary is Node 19, which cannot run the current `youtubei.js` package because that package uses JSON import attributes.
  Evidence: a direct `node --test ...` run failed with `SyntaxError: Unexpected token 'with'` from `youtubei.js`, while the same tests passed once rerun under Node 20 via `nvm use 20`.

- Observation: the new hosted attempt logging is visible in the existing live YouTube suite and now shows the full `transport/session/client` trail.
  Evidence: the `youtube/inexistent video` case logged `direct/public/IOS -> direct/session/WEB -> direct/public/ANDROID -> direct/session/WEB_CREATOR -> direct/public/MWEB -> direct/public/TV` before returning the final unavailable response.

- Observation: `rtk npm run test:api` still exits non-zero because of the repository's existing live extractor failures across multiple services, not because of the new deterministic tests.
  Evidence: the run finished with `total fails: 25`, with failures in `bilibili`, `facebook`, `instagram`, `loom`, `rutube`, `soundcloud`, `twitter`, `vimeo`, `xiaohongshu`, and the existing ignored YouTube `no_matching_format` cases.

## Decision Log

- Decision: add a pure policy module instead of continuing to encode retry decisions inline in `youtube.js`.
  Rationale: the current failure mode is mostly policy, not extraction mechanics, and deterministic tests are only practical once queue building and failure classification are pure functions.
  Date/Author: 2026-03-09 / Codex

- Decision: keep the proxy override YouTube-specific via `YOUTUBE_PROXY_URL` and helper-specific `YT_SESSION_*_PROXY` env vars.
  Rationale: only hosted YouTube is failing, and broadening proxy routing for all external traffic would make deployment behavior harder to reason about and debug.
  Date/Author: 2026-03-09 / Codex

- Decision: remove `TV_EMBEDDED` from the default hosted fallback chain and use `WEB_CREATOR` as the secondary session-backed web client.
  Rationale: the most recent VPS failures terminate on `TV_EMBEDDED` with an explicit unsupported-device reason, while `WEB_CREATOR` is available in the current dependency and stays in the web-family session lane.
  Date/Author: 2026-03-09 / Codex

- Decision: keep the existing high-resolution session bootstrap for the initial attempt and apply the new hosted queue for retries.
  Rationale: some high-resolution requests still need a session-backed client before format selection, so replacing the initial heuristic outright would risk regressing the local/high-res path while solving the hosted retry problem.
  Date/Author: 2026-03-09 / Codex

## Outcomes & Retrospective

The hosted YouTube API path now has a pure retry-policy module, explicit env-driven hosted client pools, a YouTube-only proxy replay surface, helper-only proxy env passthrough, and structured attempt context in the final error response. The deterministic unit tests added for this work passed under Node 20, and the full API suite still ended with the repository's existing live extractor failures rather than a new regression in the added coverage. The main remaining risk is still environmental: a real VPS may still require residential routing even with the improved hosted client order and one-shot proxy replay.

## Context and Orientation

The hosted YouTube path starts in `api/src/processing/match.js`, which resolves the request host, selects the service implementation, and chooses a per-request transport via `dispatcher`, `requestIP`, and `proxyToUse`. The YouTube extractor itself lives in `api/src/processing/services/youtube.js`. That file currently combines Innertube setup, `/player` fetches, playability handling, codec/format selection, HLS fallback, and retry decisions in one module. It already returns some diagnostic context in error responses, but it does not yet understand a first-class proxy replay or a structured attempt queue.

The late media tunnel path lives in `api/src/stream/manage.js`. It stores `requestIP` and `proxyToUse` in each created tunnel and recreates the same transport when a stream is fetched or transplanted later. That means a proxy selected inside `youtube.js` can reach the tunnel layer as long as `resolveMatchData()` copies it out of the service result before `resolveMatchAction()` wraps the response.

The session token helper is the workspace package in `packages/yt-session-service/`. Its `server.mjs` process spawns `worker.mjs` to generate `{ visitorData, poToken }` and serves `/token`, `/update`, and `/health`. It currently inherits normal process proxy variables, but it has no helper-only override surface yet.

## Plan of Work

First, add a new module at `api/src/processing/services/youtube-policy.js`. This module must be pure. It will parse the new hosted env lists, derive default hosted pools from existing envs, build ordered attempt queues, expose helpers for retry classification, and format attempt-trail strings. The queue format is a small object with `client`, `transportMode`, and `sessionMode`. The queue builder must interleave public and session attempts while both remain, then append remaining public attempts, then append one proxy replay of the same queue when `YOUTUBE_PROXY_URL` is configured.

Second, extend `api/src/core/env.js` so the main env object exposes `ytHostedVideoClients`, `ytHostedAudioClients`, `ytHostedSessionClients`, and `ytProxyURL`. The parser must accept comma-separated lists, trim whitespace, dedupe while preserving order, and validate every client against `youtubei.js` supported clients. When a new hosted list is not set, the parser must derive defaults from `CUSTOM_INNERTUBE_CLIENT` and `YOUTUBE_SESSION_INNERTUBE_CLIENT` so current deployments remain backwards compatible.

Third, refactor `api/src/processing/services/youtube.js` to consume the new policy module. The file should keep all extraction behavior, but it must stop making retry decisions directly from hard-coded fallback arrays. Each request should carry its current attempt descriptor and an ordered attempt trail through recursive retries. When a new attempt uses `transportMode=proxy`, the request must create a `ProxyAgent` from `env.ytProxyURL` for metadata and media URL probing, and successful results must expose `proxyToUse` so tunnel creation reuses that route. The final error response must include `youtubeAttemptTrail`, `youtubeTransportMode`, `youtubeSessionMode`, and `youtubeProxyUsed` in addition to the legacy fields.

Fourth, update `api/src/processing/match.js` so YouTube results can override `proxyToUse` and `requestIP` after the service returns. This is the bridge that makes late proxy selection flow into `match-action.js` and `stream/manage.js`.

Fifth, update `packages/yt-session-service/server.mjs` to copy `YT_SESSION_HTTP_PROXY`, `YT_SESSION_HTTPS_PROXY`, and `YT_SESSION_NO_PROXY` into the standard proxy env vars before the helper spawns its worker. Then update `docker-compose.yml`, `deploy/dokploy/dokploy.env.example`, `api/.env.example`, `docs/api-env-variables.md`, and `AGENTS.md` so the new defaults and deployment guidance are visible to contributors and deployers.

## Concrete Steps

Work from `/Users/axel/Desktop/Code_Projects/Personal/Siphon`.

1. Add `api/src/processing/services/youtube-policy.js` and `api/src/processing/services/youtube-policy.test.js`.
2. Extend `api/src/core/env.js` to parse and validate the new hosted YouTube env surface.
3. Refactor `api/src/processing/services/youtube.js` to use the policy module and emit richer attempt context.
4. Update `api/src/processing/match.js` to preserve late `proxyToUse` and `requestIP`.
5. Update the session helper proxy env handling in `packages/yt-session-service/server.mjs`.
6. Update the deployment/docs files named in the user request and add the new discovery notes to `AGENTS.md`.
7. Run:

       rtk npm run test:api

8. Record the outcome in both this ExecPlan and `working_list.md`.

Commands run during implementation:

       rtk proxy zsh -lc 'source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && node --test api/src/processing/services/youtube-policy.test.js api/src/processing/match.test.js'
       rtk proxy zsh -lc 'source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && npm run test:api'

## Validation and Acceptance

The change is acceptable when all of the following are true:

1. The new policy tests pass and prove that:
   - default hosted video queues exclude `TV_EMBEDDED`
   - default hosted session queues are `WEB,WEB_CREATOR`
   - env-provided queues preserve order
   - unsupported-device `ERROR` responses are retryable
   - bot-wall `LOGIN_REQUIRED` responses remain retryable
   - private/age/region failures remain terminal
   - proxy replay happens at most once
2. A deterministic test proves that a YouTube service result containing `proxyToUse` is carried forward by `resolveMatchData()`.
3. `rtk npm run test:api` succeeds, or any remaining failures are confirmed to be pre-existing live extractor failures unrelated to this change.
4. Hosted logs show `youtubeAttemptTrail` entries in `transport/session/client` form and never reach `TV_EMBEDDED` unless explicitly configured.
5. A hosted deployment with `YOUTUBE_PROXY_URL` can show a direct queue followed by one proxy queue in logs.

## Idempotence and Recovery

All file changes in this plan are additive or local refactors. Re-running the test suite is safe. If a hosted retry change causes regressions, the main rollback path is to unset the new env vars so the service falls back to derived defaults; no data migration is involved. If the helper-only proxy envs cause issues, removing `YT_SESSION_*_PROXY` restores the current behavior.

## Artifacts and Notes

Key files for this work:

    api/src/processing/services/youtube.js
        Main YouTube extractor and current retry logic.

    api/src/processing/match.js
        Initial per-request dispatcher/proxy selection and response shaping.

    api/src/stream/manage.js
        Tunnel creation and late transport reuse.

    packages/yt-session-service/server.mjs
        Browserless helper process and worker launcher.

## Interfaces and Dependencies

At the end of the implementation, these env interfaces must exist:

    YOUTUBE_HOSTED_VIDEO_CLIENTS
    YOUTUBE_HOSTED_AUDIO_CLIENTS
    YOUTUBE_HOSTED_SESSION_CLIENTS
    YOUTUBE_PROXY_URL
    YT_SESSION_HTTP_PROXY
    YT_SESSION_HTTPS_PROXY
    YT_SESSION_NO_PROXY

The policy module must export stable helpers that can be used directly from tests. The minimum exported surface is:

    getDefaultHostedClientPools(...)
    getHostedAttemptQueue(...)
    classifyYouTubeFailure(...)

Revision note: created at implementation start to capture the final hosted YouTube reliability scope, the default hosted client decisions, and the requirement for a YouTube-only proxy replay.

Revision note: updated after implementation to record the new policy module, the added Node 20 test requirement, the successful deterministic test coverage, and the unchanged live extractor failure baseline from the full API suite.
