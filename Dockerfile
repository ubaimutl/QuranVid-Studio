FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && mkdir /data && chown node:node /data
COPY --from=build /app/out ./out
COPY --from=build /app/public ./public
COPY --from=build /app/server ./server
COPY --from=build /app/lib ./lib
COPY tsconfig.json LICENSE THIRD_PARTY_NOTICES.md ./
ENV NODE_ENV=production QURANVID_HOST=0.0.0.0 QURANVID_PORT=4310 QURANVID_DATA_DIR=/data
USER node
EXPOSE 4310
CMD ["node", "--import", "tsx", "server/index.ts"]
