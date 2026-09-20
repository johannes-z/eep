FROM oven/bun:1.4.2-alpine

WORKDIR /app

COPY package.json bun.lock ./
COPY packages/server/package.json packages/server/package.json
RUN bun install --frozen-lockfile --production

COPY packages/server/src packages/server/src
COPY packages/server/public packages/server/public
COPY packages/server/scripts packages/server/scripts

RUN bun run --cwd packages/server build

WORKDIR /app/packages/server

ENV HOST=0.0.0.0
ENV PORT=3000
ENV DATA_DIR=/data

VOLUME ["/data"]
EXPOSE 3000

CMD ["bun", "run", "start"]
