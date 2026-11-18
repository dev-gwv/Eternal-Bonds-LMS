# The club's VPS transcoder: Bun + ffmpeg, nothing else.
# Self-contained: this folder is all the VPS needs.
#   docker compose up -d --build
FROM oven/bun:1.3-debian
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN bun install --production
COPY src ./src
ENV WORK_DIR=/work
VOLUME /work
CMD ["bun", "src/main.ts"]
