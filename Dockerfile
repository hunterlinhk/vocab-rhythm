FROM oven/bun:1.4.4 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build
RUN bun install --production --frozen-lockfile

FROM node:22-bookworm-slim AS app
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.output ./.output
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/ops ./ops
COPY --from=build /app/scripts/db-setup.mjs ./scripts/db-setup.mjs
COPY --from=build /app/src/data ./src/data
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
