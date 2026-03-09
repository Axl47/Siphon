<div align="center">
    <br/>
    <p>
        <img src="web/static/icons/siphon-icon.svg" title="siphon" alt="siphon logo" width="100" />
    </p>
    <p>
        media extraction for your own cobalt instance
        <br/>
        SvelteKit frontend + cobalt processing backend
    </p>
    <br/>
</div>

Siphon is a fork of cobalt.tools that is being reshaped into a self-hosted media extraction client. The backend remains compatible with the upstream cobalt API, while the frontend and local developer workflow are being aligned around the Siphon product spec in [`.docs/siphon_spec.md`](.docs/siphon_spec.md).

## Local setup

- Node.js `20.x` is required.
- pnpm `9.x` is required.
- Enable pnpm through Corepack:
  `corepack enable && corepack prepare pnpm@9.6.0 --activate`
- Install workspace dependencies from the repo root:
  `pnpm install --frozen-lockfile`

Frontend development expects [`web/.env.example`](web/.env.example), especially `SIPHON_DEFAULT_API_URL`. API development expects [`api/.env.example`](api/.env.example) and an API key file such as [`api/keys.sample.json`](api/keys.sample.json).

## Dokploy deployment

Siphon now includes a Dokploy-ready Docker Compose deployment at [`docker-compose.yml`](docker-compose.yml). It runs as two services:

- `web`: a static SvelteKit build served by nginx on container port `80`
- `api`: the cobalt-compatible processing API on container port `9000`

The Dokploy-specific container assets live under [`deploy/dokploy/`](deploy/dokploy/). This path is separate from the old root [`Dockerfile`](Dockerfile), which remains an API-only image and is not the recommended Dokploy path.

### Required Dokploy variables

Define these variables in Dokploy before the first deploy:

- `SIPHON_HOST=siphon.example.com`
- `SIPHON_DEFAULT_API_URL=https://api.example.com`
- `API_URL=https://api.example.com/`
- `CORS_URL=https://siphon.example.com`
- `CORS_WILDCARD=0`
- `API_AUTH_REQUIRED=1`
- `API_KEY_URL=file:///run/secrets/siphon-keys.json`

You can start from [`deploy/dokploy/dokploy.env.example`](deploy/dokploy/dokploy.env.example) when filling in Dokploy variables for a project.

### Dokploy mounted files

Use Dokploy Mounted Files instead of baking secrets into the image:

- required: mount `keys.json` read-only to `/run/secrets/siphon-keys.json`
- optional: mount `cookies.json` read-only to `/run/secrets/cookies.json`

If you enable Cloudflare Turnstile later, also define `TURNSTILE_SITEKEY`, `TURNSTILE_SECRET`, and `JWT_SECRET`.

### Dokploy domains

Attach domains in Dokploy's Domains tab instead of putting routing labels in Compose:

- `siphon.example.com` → `web` service port `80`
- `api.example.com` → `api` service port `9000`

### Local Docker validation

From the repository root, validate the same deployment assets locally:

`docker compose --env-file deploy/dokploy/dokploy.env.example config`

`docker compose --env-file deploy/dokploy/dokploy.env.example build web api`

`docker compose --env-file deploy/dokploy/dokploy.env.example up -d`

Because the compose file publishes container ports without fixed host bindings, inspect the assigned local host ports with:

`docker compose port web 80`

`docker compose port api 9000`

Then visit the reported web URL in a browser and `curl` the reported API URL. `GET /` on the API should return server info JSON, and the web app Settings screen should be able to test its connection against the configured API URL.

## Repository layout

This monorepo includes source code for the API, frontend, and related packages:
- [api tree & readme](/api/)
- [web tree & readme](/web/)
- [packages tree](/packages/)

It also includes local documentation in the [`.docs` tree](./.docs/):
- [how to run a cobalt instance](./.docs/run-an-instance.md)
- [how to protect a cobalt instance](./.docs/protect-an-instance.md)
- [cobalt api instance environment variables](./.docs/api-env-variables.md)
- [cobalt api documentation](./.docs/api.md)

## Ethics

Siphon inherits cobalt’s basic model: it makes downloading public content easier, but the end user remains responsible for what they download and how they use it. The processing server works like a proxy and does not turn the project into a piracy tool.

## Contributing

Check the [contribution guidelines here](/CONTRIBUTING.md) before getting started.

## Licenses

For relevant licensing information, see the [api](api/README.md) and [web](web/README.md) READMEs. Unless specified otherwise, the remainder of this repository is licensed under [AGPL-3.0](LICENSE).
