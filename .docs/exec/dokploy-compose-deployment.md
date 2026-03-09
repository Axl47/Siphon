# Dokploy Compose Deployment for Siphon

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with [`.docs/PLANS.md`](/Users/axel/Desktop/Code_Projects/Personal/Siphon/.docs/PLANS.md).

## Purpose / Big Picture

After this change, Siphon can be deployed to Dokploy as a single Docker Compose application with two public services: a static web frontend and a processing API. A new contributor should be able to build the stack locally with Docker Compose, then mirror the same topology in Dokploy by attaching domains and mounted secret files in the Dokploy UI. The visible proof is that the web app loads from one container on port `3005`, the API responds on its own container, and the web app can test its connection against the configured public API URL.

## Progress

- [x] (2026-03-08 23:05Z) Inspected the existing root Dockerfile, web/api package setup, frontend build-time environment requirements, and cobalt deployment docs to determine the Dokploy deployment shape.
- [x] (2026-03-08 23:10Z) Locked the deployment decisions for this implementation: two public subdomains, API-key-required auth, Dokploy-managed domains, Dokploy-mounted key files, and build-time frontend API configuration.
- [x] (2026-03-08 23:19Z) Created the Dokploy Compose assets at the repository root and under `deploy/dokploy/`.
- [x] (2026-03-08 23:21Z) Updated repository documentation so a novice can deploy the stack on Dokploy without reading the compose internals.
- [x] (2026-03-08 23:21Z) Updated `AGENTS.md` with deployment-specific discovery notes.
- [x] (2026-03-08 23:30Z) Validated Compose rendering, the web build-stage contract, the API deploy bundle, and the API runtime contract with a sample key file.
- [x] (2026-03-09 14:40Z) Added `yt-session-generator` to the Dokploy Compose stack and documented it as the default hosted YouTube mitigation.
- [x] (2026-03-09 15:20Z) Replaced the stock `yt-session-generator` image with a tiny Dokploy wrapper image that patches nodriver startup to use `no_sandbox=True`, based on VPS logs showing Chromium failing to connect when launched as root.
- [x] (2026-03-09 15:55Z) Switched `YOUTUBE_SESSION_SERVER` interpolation from `${VAR:-default}` to `${VAR-default}` so Dokploy users can disable the session server by setting an explicit empty value during troubleshooting.
- [x] (2026-03-09 16:10Z) Changed the session-generator healthcheck to `/update` and made the API depend on `service_healthy` so the API does not race the helper server's startup and emit a misleading `ECONNREFUSED`.
- [x] (2026-03-09 16:50Z) Replaced the Chromium-based `yt-session-generator` wrapper with a browserless Node workspace package (`packages/yt-session-service`) that generates `{ visitorData, poToken }` directly and exposes `/token`, `/update`, and `/health`.
- [ ] Run full `docker compose build` / `docker compose up` validation once Docker is available on the host. Completed: `docker compose config`; remaining: actual image build and container launch through Docker.

## Surprises & Discoveries

- Observation: the frontend is a static SvelteKit build that hard-fails if `SIPHON_DEFAULT_API_URL` is missing during build.
  Evidence: `web/vite.config.ts` throws when `process.env.SIPHON_DEFAULT_API_URL` is absent, and `web/src/lib/siphon/api.ts` also assumes the default API URL exists.

- Observation: the repository excludes `.env` files from the Docker build context.
  Evidence: `.dockerignore` contains `.env` and `.env.*`, which means Dokploy must inject variables through Compose interpolation rather than relying on checked-in env files.

- Observation: the API already exposes a simple health-checkable route.
  Evidence: `api/src/core/api.js` returns server info JSON from `GET /`, so the compose health check can target `http://localhost:9000/`.

- Observation: the host machine does not currently have a reachable Docker daemon, so `docker compose build` cannot be executed here even though the Compose file itself renders correctly.
  Evidence: `docker compose --env-file deploy/dokploy/dokploy.env.example build web api` failed with `Cannot connect to the Docker daemon at unix:///Users/axel/.docker/run/docker.sock`.

- Observation: the API deployment flow used by the Dockerfile works from the existing workspace install without extra repo changes.
  Evidence: `corepack pnpm deploy --filter=@imput/cobalt-api --prod /tmp/siphon-api-deploy` completed successfully and produced `/tmp/siphon-api-deploy/src/cobalt.js`, `package.json`, and the production dependency tree.

- Observation: the repository was still ignoring `docker-compose.yml`, which would have prevented the Dokploy entrypoint file from being committed.
  Evidence: `git check-ignore -v docker-compose.yml` reported `.gitignore:19:docker-compose.yml` before the ignore rule was removed.

- Observation: the Dokploy deployment path originally assumed the web service listened on port `80`, but the requested public service port is `3005`, so nginx, image metadata, Compose, and the deployment docs all need to stay aligned.
  Evidence: before this adjustment, `deploy/dokploy/nginx.conf`, `deploy/dokploy/web.Dockerfile`, `docker-compose.yml`, and `README.md` all referenced port `80` for the web service.

- Observation: for hosted YouTube, cookies alone may still degrade from `youtube.login` into `fetch.fail` on VPS IPs. The repo already supports an external `yt-session-generator`, and the deployment path is more reliable when that service is present by default.
  Evidence: `docs/examples/docker-compose.example.yml` already includes a commented `yt-session-generator` service, and `api/src/processing/helpers/youtube-session.js` expects `YOUTUBE_SESSION_SERVER` to supply `poToken` and `visitor_data`.

- Observation: the browser-based `yt-session-generator` could start Chromium but still fail to generate a token on the VPS, consistently stalling at `timeout waiting for outgoing API request`. A browserless generator that returns `{ visitorData, poToken }` directly is both simpler to deploy and more responsive under container health checks.
  Evidence: local validation of `packages/yt-session-service/server.mjs` returned a valid `/token` response immediately, while the old wrapper image never moved past `503 Token has not yet been generated` in the same hosted workflow.

## Decision Log

- Decision: deploy Siphon as one Compose application with separate `web` and `api` services instead of a single combined container.
  Rationale: the web app is a static build served well by nginx, while the API needs a Node runtime plus ffmpeg. Splitting them keeps Dokploy routing simple and matches the repository’s architecture.
  Date/Author: 2026-03-08 / Codex

- Decision: keep the frontend on build-time configuration rather than adding runtime environment injection.
  Rationale: the current frontend already requires build-time variables, and adding runtime injection would introduce extra nginx or entrypoint complexity with no user-requested benefit.
  Date/Author: 2026-03-08 / Codex

- Decision: rely on Dokploy UI domain assignment and mounted files instead of embedding Traefik labels or host paths in the compose file.
  Rationale: this keeps the repo deployment assets portable and matches the target Dokploy workflow.
  Date/Author: 2026-03-08 / Codex

## Outcomes & Retrospective

The repository now contains a self-contained Dokploy deployment path: a root Compose file, split web/API Dockerfiles, an nginx config tuned for static-app update behavior, an example Dokploy variable file, and human-facing documentation for variables, mounted files, and domain attachment. The main remaining gap is environmental rather than implementation-related: this machine could not run Docker builds because the Docker daemon was unavailable. The non-Docker validations still confirmed the critical assumptions that the web build accepts Dokploy-style build-time variables, the API deploy bundle can be produced, and the API starts correctly with the Dokploy-style runtime environment plus a mounted-style key file path.

## Context and Orientation

The repository is a monorepo with two deployable products. The API lives in `api/` and starts from `api/src/cobalt.js`; it is an Express server that requires `API_URL` to start and uses `GET /` as a basic server-info endpoint. The web app lives in `web/`, builds with SvelteKit’s static adapter, and writes static files to `web/build`. Because it uses the static adapter, it cannot read runtime environment variables in the browser; instead, values such as `SIPHON_DEFAULT_API_URL` and `SIPHON_HOST` must be present during the image build.

The existing root `Dockerfile` only packages the API and currently uses a Node 24 base image. This implementation will not delete it, but it also will not reuse it for Dokploy because the repository runtime has been validated on Node 20 and the deployment now needs both the web and API services.

Dokploy is the target deployment platform. In this repository, “Dokploy-native” means three concrete things: the repo contains a `docker-compose.yml` that defines services only, Dokploy’s web UI attaches public domains to those services, and sensitive files such as `keys.json` are mounted through Dokploy’s mounted-file feature rather than baked into images.

## Plan of Work

First, add a root `docker-compose.yml` that defines two services named `web` and `api`. The compose file must be parameterized with Dokploy variables for all public URLs and any optional security features. The `web` service will build from a new Dockerfile under `deploy/dokploy/web.Dockerfile`, expose port `3005`, and include build arguments for `SIPHON_DEFAULT_API_URL` and `SIPHON_HOST`. The `api` service will build from `deploy/dokploy/api.Dockerfile`, expose port `9000`, and accept runtime environment variables including `API_URL`, `CORS_URL`, `API_AUTH_REQUIRED`, and `API_KEY_URL`.

Next, create the `deploy/dokploy/` directory. The web Dockerfile will use a Node 20 build stage with pnpm 9 to install the monorepo dependencies and build only the web app, then copy the static output into an nginx runtime image. The nginx configuration in `deploy/dokploy/nginx.conf` must serve the static app on port `3005` with a `try_files` fallback to `/404.html`, send `Cache-Control: no-cache` for HTML and service-worker/manifest files, and use a long-lived immutable cache for hashed assets under `/_app/`.

Then create the API Dockerfile. It should build from the monorepo root using Node 20, install the system packages needed by native dependencies and ffmpeg-related modules, and use `pnpm deploy --filter=@imput/cobalt-api --prod` to copy the API runtime into a clean final image. The final stage should run as the `node` user, expose port `9000`, and start the existing API entrypoint with `node src/cobalt`.

Add a third Compose service named `yt-session-generator`, built from `deploy/dokploy/yt-session-generator.Dockerfile`. That image should build and deploy the workspace package `packages/yt-session-service`, which serves `/token`, `/update`, and `/health` and generates `{ visitorData, poToken }` directly in a Node worker process instead of launching Chromium. The API service should depend on it and default `YOUTUBE_SESSION_SERVER` to `http://yt-session-generator:8080/` with `YOUTUBE_SESSION_INNERTUBE_CLIENT=WEB_EMBEDDED` unless the deployer overrides those values. This keeps hosted YouTube behavior aligned with the repository’s documented advanced setup without relying on a brittle headless-browser sidecar.

After the container assets exist, update the human-facing documentation. Add a deployment section to the repository README that explains the Dokploy topology, required variables, and required mounted files. Add a dedicated section or example that names the exact Dokploy variables a user must define and which domains to attach in the Dokploy UI. Update `AGENTS.md` with short notes that explain why the Dokploy deployment does not use the old root Dockerfile and where the deployment assets live.

Finally, validate the setup with non-destructive local checks. Confirm `docker compose config` renders successfully with sample variables, build the individual services if feasible, and verify that the web build still completes with build arguments and the API image still starts with a mounted key file path contract.

## Concrete Steps

Work from the repository root at `/Users/axel/Desktop/Code_Projects/Personal/Siphon`.

1. Create `docker-compose.yml` at the repository root with `web` and `api` services.
2. Create `deploy/dokploy/web.Dockerfile`, `deploy/dokploy/api.Dockerfile`, and `deploy/dokploy/nginx.conf`.
3. Add a Dokploy deployment guide to `README.md`.
4. Add deployment discoveries to `AGENTS.md`.
5. Run:

       docker compose config
       docker compose build web api

   If full image builds are too slow or blocked by the host, run at minimum:

       docker compose config
       docker build -f deploy/dokploy/web.Dockerfile --build-arg SIPHON_DEFAULT_API_URL=https://api.example.com --build-arg SIPHON_HOST=siphon.example.com .
       docker build -f deploy/dokploy/api.Dockerfile .

6. If the images build, start them locally with temporary values and a temporary mounted key file:

       docker compose up -d
       curl http://localhost:9000/

   Expect JSON containing a `cobalt` object and the configured API URL.

During this implementation, the following commands were run successfully instead of the Docker build steps:

       docker compose --env-file deploy/dokploy/dokploy.env.example config
       source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && set -a && source deploy/dokploy/dokploy.env.example && set +a && corepack pnpm --dir web build
       source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && corepack pnpm deploy --filter=@imput/cobalt-api --prod /tmp/siphon-api-deploy
       source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && API_URL=https://api.example.com/ CORS_URL=https://siphon.example.com CORS_WILDCARD=0 API_AUTH_REQUIRED=1 API_KEY_URL=file:///Users/axel/Desktop/Code_Projects/Personal/Siphon/api/keys.sample.json corepack pnpm --dir api start
       curl http://127.0.0.1:9000/

## Validation and Acceptance

The deployment is acceptable when all of the following are true:

1. `docker compose config` succeeds from the repository root with no interpolation errors.
2. The `web` image builds successfully when given `SIPHON_DEFAULT_API_URL` and `SIPHON_HOST` as build arguments.
3. The `api` image builds successfully and starts on port `9000`.
4. `GET /` on the API returns HTTP 200 with the server info JSON.
5. The nginx configuration serves the static app and does not cache `index.html`, `service-worker.js`, `404.html`, `manifest.json`, or `version.json` aggressively.
6. The README tells a novice exactly which Dokploy variables, mounted files, and domains to configure.

Status after this implementation:

- Items 1, 4, 5, and 6 have been verified directly through file inspection and local commands.
- Items 2 and 3 are implemented and partially verified through the corresponding host-side build/runtime commands, but still need a real Docker daemon to confirm image creation end to end.

For Dokploy itself, acceptance means that `siphon.example.com` loads the Siphon web app, `api.example.com/` returns the API JSON, the Settings screen can test its connection successfully, and unauthorized direct POST requests to the API are rejected when `API_AUTH_REQUIRED=1` and a key file is mounted.

## Idempotence and Recovery

All planned file additions are additive and safe to re-run. If a Docker build fails, fix the Dockerfile and rebuild; there is no migration or destructive step. If a Dokploy deployment fails because of bad variables, the recovery path is to update the Dokploy variables or mounted files and redeploy the same Compose application. No repo state needs to be reset to retry.

## Artifacts and Notes

Important file and behavior references for this work:

    web/vite.config.ts
        Throws when SIPHON_DEFAULT_API_URL is missing during build.

    web/svelte.config.js
        Uses adapter-static and outputs to web/build.

    api/src/core/api.js
        Serves GET / and starts the main API routes.

    .dockerignore
        Excludes .env files from build context; deployment must use Dokploy variables instead.

## Interfaces and Dependencies

At the end of this work, these deployment interfaces must exist:

- A root `docker-compose.yml` with `web` and `api` services.
- `deploy/dokploy/web.Dockerfile` that accepts:

      ARG SIPHON_DEFAULT_API_URL
      ARG SIPHON_HOST

- `deploy/dokploy/api.Dockerfile` that produces a runtime image for `@imput/cobalt-api`.
- `deploy/dokploy/yt-session-generator.Dockerfile` that builds and deploys the workspace package `@siphon/yt-session-service`.
- `deploy/dokploy/nginx.conf` that defines SPA/static serving and cache headers.
- A documented Dokploy variable contract including:

      WEB_PORT=3005
      API_PORT=9000
      YT_SESSION_HOST_PORT=3006
      YT_SESSION_CONTAINER_PORT=8080
      SIPHON_HOST=siphon.example.com
      SIPHON_DEFAULT_API_URL=https://api.example.com
      API_URL=https://api.example.com/
      CORS_URL=https://siphon.example.com
      API_AUTH_REQUIRED=1
      API_KEY_URL=file:///run/secrets/siphon-keys.json
      YOUTUBE_SESSION_SERVER=http://yt-session-generator:8080/
      YOUTUBE_SESSION_INNERTUBE_CLIENT=WEB_EMBEDDED

Revision note: created this ExecPlan before implementation to capture the final Dokploy deployment shape and the repository constraints that drive it.

Revision note: updated after implementation to record the added deployment assets, successful non-Docker validation steps, and the remaining Docker-daemon-dependent validation gap.
