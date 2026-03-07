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
