# Working List

## Pending
- [ ] Review the new `/` flow manually against the Siphon acceptance scenarios
- [ ] Decide whether to stabilize or quarantine the currently failing live extractor cases in `corepack pnpm --dir api test`
- [ ] Add dedicated web tests if this route needs automated UI/state coverage beyond `svelte-check`

## In Progress
- [~] Review the recovered quality/settings UX manually on small-height and mobile-width viewports

## Done
- [x] Audit the existing `api/` and `web/` architecture against `.docs/siphon_spec.md`
- [x] Confirm implementation decisions: keep SvelteKit, add a Siphon analysis endpoint, replace primary UI, and use portable sidecar fallback
- [x] Create and maintain the Phase 1 ExecPlan in `.docs/exec/siphon-web-refactor-phase1.md`
- [x] Add the Siphon `POST /analyze` API contract, endpoint, and unit tests
- [x] Build the Siphon web state layer, settings store, IndexedDB history persistence, and sidecar helpers
- [x] Replace the primary `/` route with the Siphon flow screens and hide legacy navigation on the root route
- [x] Add download completion persistence, sidecar export, and offline shell support
- [x] Update developer documentation in `AGENTS.md` for the new flow
- [x] Run `corepack pnpm --dir web check` and `corepack pnpm --dir web build` under Node 20 via `nvm`
- [x] Record that the new API unit tests pass while the full live extractor suite still has unrelated failing cases
- [x] Recover the quality screen CTA with a pinned footer and add technical tags for duplicate-looking options
- [x] Simplify the settings overlay to the field/test/toggle hierarchy and align the route typography with the Siphon spec
