FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

FROM base AS build
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml /app/
COPY packages/yt-session-service /app/packages/yt-session-service

RUN corepack enable && corepack prepare pnpm@9.6.0 --activate
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --filter @siphon/yt-session-service... --prod --frozen-lockfile
RUN pnpm deploy --filter=@siphon/yt-session-service --prod /prod/yt-session-service

FROM node:20-alpine AS runtime
WORKDIR /app

COPY --from=build --chown=node:node /prod/yt-session-service /app

USER node

EXPOSE 8080
CMD ["node", "server.mjs"]
