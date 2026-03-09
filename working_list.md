# Working List

## Pending

- [ ] None.

## In Progress

- [~] None.

## Done

- [x] Inspect the current YouTube match/analyze/stream/env seams and confirm the fallback can be hidden behind the existing API domain.
- [x] Implement the fallback helper/env surface in `api/src/processing/helpers/cobalt-fallback.js` and `api/src/core/env.js`.
- [x] Integrate YouTube fallback into `api/src/processing/match.js` and `api/src/processing/analyze.js`, including synthetic analyze fallback for community instances without `/analyze`.
- [x] Add deterministic tests for fallback policy, env validation, and match/analyze fallback behavior.
- [x] Update deployment/docs/examples in `api/.env.example`, `docs/api-env-variables.md`, `docker-compose.yml`, `deploy/dokploy/dokploy.env.example`, and `AGENTS.md`.
- [x] Run repo-level verification and note the remaining pre-existing live extractor failures for handoff.
