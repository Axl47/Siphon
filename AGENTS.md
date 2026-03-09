# SIPHON AGENTS DOCUMENT

## ExecPlans

When writing complex features or significant refactors, use an ExecPlan (as described in `.docs/PLANS.md`) from design to implementation. Write new plans to `.docs/exec/`. If inside Plan Mode, create the plan in a multiline markdown block, and write it after initiating implementation, so you can use the plan to guide your implementation and refer back to it as needed. If outside Plan Mode, you can write the plan directly and refer to it as needed.

## Rule

Always prefix shell commands with `rtk`.

Examples:

```bash
rtk git status
rtk cargo test
rtk npm run build
rtk pytest -q
rtk proxy <cmd>     # Run raw command without filtering
```

## RTK Verification

```bash
rtk --version
rtk gain
which rtk
```

## Development Details

Whenever new updates are made, this file (`AGENTS.md`) should be updated with any surprising files not apparent from the codebase that could benefit other developers. Focus on the why and when it could be useful.

- `api/src/processing/match.js` now exports `resolveMatchData` alongside the existing default matcher. Use it when you need raw extractor output and cobalt routing decisions without immediately collapsing the result into the legacy `tunnel`/`redirect`/`picker` response body. This is the safest extension point for Siphon-owned API surfaces such as `/analyze`.

- `api/src/processing/match-action.js` now exports `resolveMatchAction`. Reach for it when you need the post-extractor action decision plus the underlying response payload before `createResponse()` wraps it. This is useful for estimating sizes or reusing filename/format decisions in new API flows.

- `web/src/lib/siphon/` is the Phase 1 product layer for the new `/` route. It intentionally does not replace the old cobalt stores and routes. Use it when working on the Siphon main flow, history, sidecars, or connection UX; use the older `web/src/lib/state/*` modules only when touching legacy cobalt routes.

- `web/src/service-worker.ts` only caches the Siphon app shell for offline boot and history visibility. It does not implement background downloads or a POST share-target interception. Check it when debugging stale offline assets or when extending the PWA behavior beyond shell caching.

- `web/src/routes/+page.svelte` now uses a full-height two-row app shell (`topbar` + active screen) with the quality screen rendered as a three-row grid (`header`, scrollable list, pinned footer). Use that structure when touching quality selection or “missing CTA” bugs; the footer is intentionally outside the scroll area so the download action remains reachable on short viewports.

- The Siphon settings overlay is intentionally minimal now: fields, transient connection result, divider, metadata toggle. Do not re-add the old persistent status summary unless the product explicitly asks for richer diagnostics; background heartbeat remains silent.

- `web/src/lib/siphon/history.ts` is the durable memory layer, not just the recent/history query helper. Each successful download already stores its sidecar payload inside IndexedDB via `DownloadRecord.sidecar`, and aggregate export now comes from `buildMemoryExport()` / `exportMemoryArchive()`. Use this file when adding stats, backups, or future “memory” features instead of creating a second storage path.

- `deploy/dokploy/` is the supported container deployment path for this fork. Use `deploy/dokploy/web.Dockerfile`, `deploy/dokploy/api.Dockerfile`, and `deploy/dokploy/nginx.conf` for Dokploy or any split web/API deployment; do not extend the old root `Dockerfile` unless you intentionally want the legacy API-only image.

- The root `docker-compose.yml` is designed for Dokploy UI-managed domains and mounted files. It publishes service ports without fixed host bindings so Dokploy can attach domains cleanly, and local validation should use `docker compose port web 3005` / `docker compose port api 9000` to discover the assigned host ports.

- Hosted YouTube is more brittle from VPS and datacenter IPs than from local development. The Dokploy compose now includes `yt-session-generator` and defaults `YOUTUBE_SESSION_SERVER` to `http://yt-session-generator:8080/` plus `YOUTUBE_SESSION_INNERTUBE_CLIENT=WEB_EMBEDDED`; treat that as the baseline hosted YouTube configuration before reaching for more cookie tweaks.

- `yt-session-generator` now comes from the workspace package `packages/yt-session-service`, not the upstream Chromium-based image. It serves the same `/token` and `/update` contract the API expects, but generates `{ visitorData, poToken }` in a Node worker process so the helper stays responsive while a token refresh is running.

- The Dokploy `yt-session-generator` build now depends on the workspace lockfile because it installs `packages/yt-session-service` with pnpm and deploys only that package into the final image. If Dokploy reports a missing dependency during that build, check that `pnpm-lock.yaml` and `packages/yt-session-service/package.json` were both deployed together.

- The Dokploy Compose file forwards `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, and `YT_SESSION_UPDATE_INTERVAL` into `yt-session-generator`. If a hosted YouTube fix involves routing traffic through a proxy, make sure the helper service gets the same proxy envs as the API or the token path and media path will behave differently.

- In Dokploy Compose interpolation, `${VAR:-default}` makes an empty string fall back to the default. The deployment uses `${YOUTUBE_SESSION_SERVER-default}` instead so setting `YOUTUBE_SESSION_SERVER` to `""` actually disables the session generator for debugging.

- `yt-session-generator` returns `503` on `/token` until it has actually produced a token. The Dokploy healthcheck therefore targets `/token` and uses a longer `start_period`, so the API waits for an actual token instead of starting as soon as the helper HTTP server binds.

- The token helper now has separate retry and steady-state intervals plus a configurable worker heap cap (`YT_SESSION_RETRY_INTERVAL`, `YT_SESSION_UPDATE_INTERVAL`, `YT_SESSION_WORKER_HEAP_MB`). Startup failures should retry quickly, while successful token refreshes should happen less often to avoid repeated large-memory runs.

- `packages/yt-session-service/server.mjs` intentionally launches the worker with a direct `node --max-old-space-size=... worker.mjs` argv instead of inheriting `NODE_OPTIONS`. In practice, inherited container or Dokploy `NODE_OPTIONS` can interfere with the worker heap budget and make cold-start PoToken generation much less reliable.

- `api/src/processing/helpers/youtube-session.js` does not rely only on the 5-minute background poll anymore. If a YouTube request needs a session token and none is cached yet, it now fetches `/token` on demand before giving up. Use that behavior when debugging helpers that warm up after the API has already started.

- `api/src/processing/services/youtube.js` now tracks an Innertube cache key that includes session mode, `visitor_data`, `poToken`, and YouTube-cookie usage. Without that, a later session-backed WEB_EMBEDDED retry can accidentally reuse an earlier IOS-shaped Innertube context and surface misleading `This video is unavailable` errors even though the helper token itself is valid.

- Public YouTube requests can behave worse on VPS IPs when browser-exported YouTube cookies are enabled. The service now retries `/player` once without YouTube cookies after a `fetch.fail`, so public videos can still work even if mounted cookies are too “hot” for the datacenter IP.

- For hosted YouTube failures that still return `youtube.login` or `fetch.fail`, the YouTube service now retries with alternate Innertube clients (`ANDROID`, `MWEB`, `TV_EMBEDDED`, and `YTMUSIC_ANDROID` for audio-first cases) before surfacing the final API error. This makes the retry loop materially different instead of replaying the same `IOS` client request.

- If `YOUTUBE_SESSION_SERVER` is configured, the YouTube service now also retries bot/login and fetch failures with a forced session-backed request before falling back across alternate public clients. That makes the session helper matter for standard `1080p` hosted requests instead of only for the old `>1080p` paths.

- Final YouTube `content.video.unavailable` responses now include diagnostic context for the last attempted client and playability status/reason. Use that curl-visible context and the matching warning log before changing more deployment variables; it is the fastest way to tell whether the VPS is seeing a bot wall, a client-specific restriction, or a real unavailable video.

## Sub Agents

Use sub-agents where appropriate to break down complex changes into manageable pieces, and to allow for more focused implementation and testing. For example, if implementing a new feature that requires both backend and frontend changes, you might create separate sub-agents for each layer of the stack, but before then use an exploring agent (or multiple) to get context on the codebase and research the best approaches for the feature, outline the specific steps needed for implementation into a final exec plan, and spin up task subagents that handle the implementation. This allows for more efficient development and testing, as each sub-agent can focus on a specific aspect of the implementation, and can be tested independently before being integrated into the larger codebase.

## Final Output

When asking the user to verify implemented changes, output a checklist they can fill to make sure everything works as intended. Describe what they should see, how it should work, and what they need to manually test. The user will then fill in the checklist and provide feedback on any issues they encounter, which can be used to further refine the implementation.

If the user asked for multiple changes and only some were implemented, make sure to clearly indicate which ones were completed, which ones were not fully realized, and which ones are still pending. For example:

```txt
- [x] Implement app scaffold (completed with basic layout and navigation)
- [~] Implement feature A (stub implementation completed)
- [ ] Implement feature B (pending due to X reason)
```

Include a commit message after each implementation or fix, following the Conventional Commits specifications. If it's a large change, follow this format:

```txt
feat(update): add startup update prompt choices and sectioned changelog pipeline
- feat(update): gate startup updates behind user choice (Yes/No/Remind Later)
- feat(update): persist per-release prompt decisions (ignore until newer, 24h remind-later)
- refactor(update): split updater flow into eligibility check and install phases
- feat(update): parse GitHub release body into sectioned changelog blocks for in-app prompt
- test(update): add updater decision/state-store/changelog parser coverage
- feat(ci): generate release notes sections from commit metadata and publish via body_path
- feat(ci): support multi-section changelog from Conventional Commit lines in commit body
- fix(navigation): clamp bottom navbar sizing to prevent tiny rendering on some phones
- fix(navigation): make top-level tab swipe detection more reliable in Explore
- fix(search): move Explore apply+navigate to app scope to prevent canceled loads on slower devices
- docs(readme): document updater prompt behavior and changelog contract
```
