# Siphon Web Refactor Phase 1

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with `.docs/PLANS.md`.

## Purpose / Big Picture

After this change, the `web/` app will behave like Siphon instead of a lightly rebranded cobalt client. A user will be able to configure their self-hosted instance, paste or share a URL, inspect a Siphon-owned quality picker, download the selected media through their own instance, and see the result persisted in a searchable local history with preserved metadata. The visible proof is the primary `/` route: it must present the new Siphon main screen, quality selection, downloading, completion, history, and settings overlay flow instead of the old sidebar-plus-omnibox cobalt shell.

This change also adds a Siphon-owned `POST /analyze` endpoint to the in-repo API so the frontend can render an analyze-first quality picker without guessing what cobalt might return for a later `POST /` download request.

## Progress

- [x] (2026-03-07 03:25Z) Re-audited the existing `api/` and `web/` implementation against `.docs/siphon_spec.md`.
- [x] (2026-03-07 03:27Z) Confirmed key implementation defaults: keep SvelteKit, add a Siphon analysis endpoint in `api/`, replace the primary UI, and use portable sidecar fallback.
- [x] (2026-03-07 03:29Z) Created `.docs/exec/siphon-web-refactor-phase1.md` and reset `working_list.md` for this refactor.
- [x] (2026-03-07 04:42Z) Implemented the additive `POST /analyze` endpoint, shared response shaping helpers, and unit tests in `api/`.
- [x] (2026-03-07 05:11Z) Added the dedicated `web/src/lib/siphon/` state layer with narrower settings persistence, IndexedDB history, sidecar helpers, and typed API access.
- [x] (2026-03-07 05:29Z) Replaced the primary `/` route and root layout shell with the Siphon experience while keeping legacy routes in the tree.
- [x] (2026-03-07 05:36Z) Added the service worker shell cache, download persistence path, and explicit sidecar export.
- [x] (2026-03-07 05:48Z) Updated `AGENTS.md`, got `corepack pnpm --dir web check` and `corepack pnpm --dir web build` green under Node 20, and started the full API regression suite under Node 20.
- [x] (2026-03-07 06:11Z) Recorded validation status: `corepack pnpm --dir web check` and `corepack pnpm --dir web build` pass under Node 20; the new API unit tests pass; the existing live extractor suite in `corepack pnpm --dir api test` still reports upstream service failures in cases such as Loom and Vimeo, so the full monorepo API suite is not clean yet.
- [x] (2026-03-07 08:02Z) Landed the UI recovery pass: quality options now carry delivery/bitrate metadata, the quality screen keeps its CTA pinned outside the scroll area, settings were reduced to the spec hierarchy, and the Siphon route now uses the spec fonts and tighter card/input geometry.

## Surprises & Discoveries

- Observation: stock cobalt does not expose a quality manifest endpoint; `POST /` is request-and-download oriented and returns a single action result.
  Evidence: `docs/api.md` documents only `POST /`, `POST /session`, `GET /`, and `GET /tunnel`, and `api/src/processing/request.js` only shapes `tunnel`, `redirect`, `local-processing`, `picker`, and `error`.

- Observation: the current web app already has a share target in `web/static/manifest.json`, but it uses a static `GET /?u=...` contract instead of a service-worker-managed `/share` handoff.
  Evidence: `web/static/manifest.json` defines `share_target.action` as `/` with `GET` params `text` and `url` mapped to `u`.

- Observation: a generic PWA cannot reliably save a `.siphon.json` file next to a normal browser download on every platform.
  Evidence: current save behavior in `web/src/lib/download.ts` relies on `a.download`, `window.open`, and `navigator.share`; there is no cross-browser file system handle flow for sibling writes.

## Decision Log

- Decision: keep the existing SvelteKit app and refactor it in place instead of migrating to React.
  Rationale: `web/` already contains the bootstrapping, build pipeline, share-target manifest, and enough reusable transport code to deliver the Siphon product faster and with less risk.
  Date/Author: 2026-03-07 / Codex

- Decision: add a Siphon-owned `POST /analyze` endpoint inside `api/`.
  Rationale: the new UI needs analyze-first quality options and source metadata, which are not available from stock cobalt response contracts.
  Date/Author: 2026-03-07 / Codex

- Decision: use a portable metadata fallback for Phase 1.
  Rationale: IndexedDB plus explicit export preserves the metadata contract without pretending every browser can write a companion file adjacent to the downloaded media.
  Date/Author: 2026-03-07 / Codex

- Decision: hide legacy cobalt navigation from the primary experience, but keep old code in the tree temporarily.
  Rationale: this minimizes migration risk while ensuring `/` becomes the actual Siphon product.
  Date/Author: 2026-03-07 / Codex

## Outcomes & Retrospective

- The refactor landed as an in-place SvelteKit migration rather than a framework rewrite. The primary `/` route is now a Siphon-owned flow with settings, history, quality selection, download progress, completion, and sidecar export backed by the new `web/src/lib/siphon/` state layer.

- The API now exposes an additive `POST /analyze` surface built on the same extractor pipeline as `POST /`, which reduced drift risk and made it possible to unit-test the Siphon response builders separately from the long-running live extractor suite.

- Remaining gap: picker downloads are only minimally supported in Phase 1 by re-resolving the original source and downloading one selected item. This matches the “single-item only” fallback direction, but it is not yet a rich picker contract.

- Validation gap: the frontend currently has no dedicated test runner configured beyond `svelte-check`, so the requested “where practical” web coverage was not added in this pass. The new API unit tests cover the new backend contract, but UI behavior still needs manual verification or a later Vitest/Playwright setup.

- Follow-up note: the UI recovery pass kept duplicate-looking quality entries visible on purpose and instead exposed the technical differentiators (delivery mode, bitrate, estimated-size marker). This is now the expected behavior of the Siphon picker rather than a temporary debugging aid.

## Context and Orientation

This monorepo contains two relevant applications. `api/` is the Express-based cobalt-compatible processing server. `web/` is a SvelteKit static frontend that is still largely organized around cobalt’s older omnibox and queue user experience.

The current API entrypoint lives in `api/src/core/api.js`. Request parsing and validation for `POST /` are handled by `api/src/processing/request.js` and `api/src/processing/schema.js`. Service-specific extraction happens in `api/src/processing/match.js`, which delegates to individual service modules and then passes their result through `api/src/processing/match-action.js` to shape one of the existing response types. The existing tunnel estimator is important for the new plan because it can provide approximate file sizes when a proxied or ffmpeg-backed tunnel is involved; that logic lives in `api/src/stream/shared.js`.

The current web entrypoint is `web/src/routes/+page.svelte`, rendered inside `web/src/routes/+layout.svelte`. The old route is centered around `web/src/components/save/Omnibox.svelte` and `web/src/lib/api/saving-handler.ts`, which call the existing `POST /` API and either dispatch downloads directly or push work into the queue UI. Settings currently live in a broad cobalt schema in `web/src/lib/state/settings.ts`. The queue and worker code in `web/src/lib/task-manager/` is reusable for direct downloads but is too tightly coupled to the old cobalt UI to remain the main experience.

Phase 1 will introduce a dedicated Siphon frontend layer under `web/src/lib/siphon/`. That layer will own the Siphon flow state machine, the narrower settings store, the IndexedDB history database, sidecar payload generation, and the Siphon-specific API client. The old cobalt UI will not be deleted immediately, but the primary `/` route and the navigation shown in the main shell must stop leading users into it.

## Plan of Work

First, extend the API without breaking existing callers. Add a Siphon analysis schema, a request normalizer, and response types that return normalized source metadata and a list of quality choices. Reuse the existing URL parsing and service matching pipeline so the analysis endpoint can ask the same service modules what media is available. For each supported analysis quality, build a synthetic download request, run the match pipeline, capture filename, estimated size, and normalized format data, then de-duplicate equivalent options. When the source is a picker, return a normalized single-item picker payload instead of forcing the frontend to understand cobalt’s raw picker structure. Add API tests that exercise normal success, picker, error, and de-duplication cases.

Next, create a new Siphon frontend layer. Add `web/src/lib/siphon/` modules for types, settings, history persistence, sidecar payloads, formatting, and the API client. The settings store must import legacy cobalt `connection.instanceUrl` and `connection.apiKey` once, then persist only the smaller `SiphonSettings` object. The history layer must create an IndexedDB database named `siphon-history` with a `downloads` store indexed by timestamp, platform, uploader, and title, and expose helpers for recent items, full history, search, and aggregate totals.

After the state layer exists, replace the main route implementation. Build a single-screen Siphon flow in `web/src/routes/+page.svelte` and supporting `web/src/components/siphon/` components for the main screen, settings overlay, quality selection, downloading view, completion view, and history view. The route should maintain one active request at a time, transition through the plan’s states, and reuse the existing browser save primitives for the actual file handoff. Progress reporting should use byte counts from the fetch stream and the existing tunnel probe capability where available. Completion must persist the download record and sidecar payload into IndexedDB before showing the completion screen.

Then simplify the layout shell. Remove the sidebar and queue popover from the primary layout so the new route owns the user experience. Keep only the global concerns that still matter, such as polyfills and theme metadata. Legacy routes like `/settings` and `/remux` may remain in the tree for now, but the user should no longer arrive there from the primary shell.

Finally, add the offline shell and documentation updates. Introduce a service worker that precaches the app shell assets and allows the app to boot offline so stored history remains visible without the network. Keep the existing manifest share target. Update `AGENTS.md` with any surprising files or behavioral gotchas discovered during implementation, and reflect final validation and outcomes in this ExecPlan.

## Concrete Steps

From the repository root, implement and validate the work with these commands:

    pnpm --dir api test
    pnpm --dir web check
    pnpm --dir web build

For manual verification during implementation:

    pnpm --dir api start
    pnpm --dir web dev

With both servers running, open the local web app, configure an instance URL and API key in the new settings overlay, paste a supported URL, choose a returned quality option, and confirm that the completion view persists into history after reload.

## Validation and Acceptance

Acceptance is behavioral.

The API is correct when `POST /analyze` returns normalized `ok`, `picker`, and `error` responses for the same authenticated environment that already supports `POST /`, and the new API tests cover those cases.

The frontend is correct when the `/` route shows the Siphon main screen, settings overlay, quality picker, downloading progress view, completion view, and history view, and when a completed download appears in both Recent and History after a reload.

Offline behavior is correct when the app shell still opens without the network and displays the stored history, while new analysis/download attempts fail cleanly with an instance-unreachable message.

## Idempotence and Recovery

The `POST /analyze` endpoint is additive and can be implemented without changing the existing `POST /` behavior. If a quality probe implementation proves too fragile for one service, the safe fallback is to omit the unavailable option rather than returning misleading data.

Frontend persistence must tolerate reruns. Re-opening IndexedDB should not require manual cleanup. If the stored history schema changes during implementation, bump the IndexedDB version and write a migration inside the new Siphon history layer.

The service worker should be safe to refresh repeatedly during development. If it serves stale assets, unregister it from the browser devtools and reload; do not require repository file deletion for recovery.

## Artifacts and Notes

Important implementation artifacts to capture as work proceeds:

    - `POST /analyze` sample JSON for a successful video response.
    - `POST /analyze` sample JSON for a picker response.
    - Output of `pnpm --dir api test`.
    - Output of `pnpm --dir web check`.
    - Output of `pnpm --dir web build`.

## Interfaces and Dependencies

In `api/src/processing/schema.js`, add a Siphon analysis schema that accepts:

    {
      url: string,
      youtubeVideoCodec?: "h264" | "av1" | "vp9",
      youtubeVideoContainer?: "auto" | "mp4" | "webm" | "mkv",
      audioFormat?: "best" | "mp3" | "ogg" | "wav" | "opus",
      allowH265?: boolean,
      tiktokFullAudio?: boolean
    }

In `api/`, add response-shaping helpers that return:

    type SiphonAnalyzeResponse =
      | {
          status: "ok";
          source: {
            url: string;
            platform: string;
            title: string | null;
            uploader: string | null;
            uploadDate: string | null;
            duration: string | null;
            thumbnailUrl: string | null;
          };
          options: Array<{
            id: string;
            label: string;
            videoQuality: string;
            downloadMode: "auto" | "audio" | "mute";
            format: string | null;
            codec: string | null;
            resolution: string | null;
            fps: number | null;
            estimatedSizeBytes: number | null;
            downloadRequest: Record<string, unknown>;
          }>;
        }
      | {
          status: "picker";
          source: { ...same fields... };
          pickerItems: Array<{
            id: string;
            type: "photo" | "video" | "gif";
            thumb: string | null;
            title: string | null;
          }>;
          options: [];
        }
      | {
          status: "error";
          error: {
            code: string;
            context?: Record<string, unknown>;
          };
        };

In `web/src/lib/siphon/types.ts`, define at minimum:

    export type SiphonSettings = {
      instanceUrl: string;
      apiKey: string;
      saveMetadata: boolean;
    };

    export type SiphonFlowState =
      | { screen: "main" }
      | { screen: "resolving"; url: string }
      | { screen: "quality"; analysis: SiphonAnalyzeSuccess }
      | { screen: "downloading"; job: DownloadJobState }
      | { screen: "complete"; record: DownloadRecord }
      | { screen: "history"; query: string }
      | { screen: "settings" };

    export type DownloadRecord = {
      id: string;
      timestamp: number;
      sourceUrl: string;
      platform: string;
      title: string | null;
      uploader: string | null;
      uploadDate: string | null;
      duration: string | null;
      selectedQuality: string;
      resolution: string | null;
      fps: number | null;
      format: string;
      codec: string;
      fileSize: number;
      filename: string;
      metadata: Record<string, unknown>;
      sidecar: SidecarPayload;
    };

    export type SidecarPayload = {
      siphon: {
        version: 1;
        downloadedAt: string;
        instanceUrl: string;
      };
      source: {
        url: string;
        platform: string;
        title: string | null;
        uploader: string | null;
        uploadDate: string | null;
        duration: string | null;
      };
      output: {
        quality: string;
        resolution: string | null;
        fps: number | null;
        format: string;
        codec: string;
        fileSize: number;
        filename: string;
      };
    };

Revision note: created at implementation start to guide the Phase 1 refactor and capture the repo-specific decisions required to make the spec executable.
