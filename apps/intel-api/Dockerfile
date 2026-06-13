# syntax=docker/dockerfile:1
# Multi-stage: pnpm workspace build → distroless runtime (bundled, no node_modules)

FROM node:20-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json eslint.config.mjs ./
COPY packages/intel-schema/package.json packages/intel-schema/
COPY apps/intel-api/package.json apps/intel-api/
RUN pnpm install --frozen-lockfile
COPY packages/intel-schema packages/intel-schema
COPY apps/intel-api apps/intel-api
RUN pnpm turbo build --filter=intel-api

FROM gcr.io/distroless/nodejs20-debian12:nonroot
WORKDIR /app
COPY --from=build /repo/apps/intel-api/dist/index.cjs ./index.cjs
ENV NODE_ENV=production
EXPOSE 8080
CMD ["index.cjs"]
