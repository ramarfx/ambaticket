FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN bun run build

# Test jalan di Node, bukan Bun: di bawah Vitest, runtime Bun memberi namespace
# zod yang kosong. Build dan runtime tetap Bun.
FROM node:24-slim AS test
WORKDIR /app
COPY --from=build /app ./
COPY drizzle ./drizzle
COPY test ./test
COPY vitest.config.ts vitest.config.e2e.ts ./
CMD ["sh", "-c", "npx vitest run && npx vitest run --config ./vitest.config.e2e.ts"]

FROM oven/bun:1-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle

USER bun
EXPOSE 3000
CMD ["bun", "dist/main.js"]
