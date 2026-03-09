FROM node:20-alpine AS build
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

ARG SIPHON_DEFAULT_API_URL
ARG SIPHON_HOST

ENV SIPHON_DEFAULT_API_URL="${SIPHON_DEFAULT_API_URL}"
ENV SIPHON_HOST="${SIPHON_HOST}"

WORKDIR /app
COPY . /app

RUN corepack enable && corepack prepare pnpm@9.6.0 --activate

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

RUN pnpm --dir web build

FROM nginx:1.27-alpine AS web

COPY deploy/dokploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/build /usr/share/nginx/html

EXPOSE 3005
CMD ["nginx", "-g", "daemon off;"]
