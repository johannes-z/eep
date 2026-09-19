FROM oven/bun:1.4.2-alpine

WORKDIR /app

COPY package.json ./
RUN bun install --production

COPY src ./src
COPY public ./public

RUN bun run build

ENV HOST=0.0.0.0
ENV PORT=3000
ENV DATA_DIR=/data

VOLUME ["/data"]
EXPOSE 3000

CMD ["bun", "run", "start"]
