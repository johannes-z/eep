FROM oven/bun:1.4.2-alpine AS build

WORKDIR /app

COPY package.json bun.lock ./
COPY packages/addon/package.json packages/addon/package.json
COPY packages/server/package.json packages/server/package.json
RUN bun install --frozen-lockfile

COPY packages/server/src packages/server/src
COPY packages/server/public packages/server/public
COPY packages/server/scripts packages/server/scripts

RUN bun run --cwd packages/server build

FROM oven/bun:1.4.2-alpine

WORKDIR /app
COPY package.json bun.lock ./
COPY packages/addon/package.json packages/addon/package.json
COPY packages/server/package.json packages/server/package.json
RUN bun install --frozen-lockfile --production
COPY --from=build /app/packages/server/dist packages/server/dist

WORKDIR /app/packages/server

ENV HOST=0.0.0.0
ENV PORT=3000
ENV DATA_DIR=/data

VOLUME ["/data"]
EXPOSE 3000

CMD ["bun", "run", "start"]
