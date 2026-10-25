# syntax=docker/dockerfile:1
# Multi-stage: pnpm workspace build → distroless runtime (bundled, no node_modules).
# One image, two roles: `index.cjs` serves the API + GitHub webhook;
# `index.cjs job <start|resume|fix> <runId>` runs one pipeline step (Cloud Run Job).

FROM node:20-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json eslint.config.mjs ./
COPY packages/intel-schema/package.json packages/intel-schema/
COPY apps/agent-nick/package.json apps/agent-nick/
RUN pnpm install --frozen-lockfile --filter agent-nick...
COPY packages/intel-schema packages/intel-schema
COPY apps/agent-nick apps/agent-nick
RUN pnpm turbo build --filter=agent-nick

FROM gcr.io/distroless/nodejs20-debian12:nonroot
WORKDIR /app
COPY --from=build /repo/apps/agent-nick/dist/index.cjs ./index.cjs
ENV NODE_ENV=production
EXPOSE 8080
CMD ["index.cjs"]
