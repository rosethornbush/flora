FROM node:24-alpine AS dependencies
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=flora-pnpm,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile --store-dir=/pnpm/store \
    && find node_modules -type f \( -name '*.map' -o -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' \) -delete \
    && rm -rf node_modules/@mastra/*/dist/docs

FROM node:24-alpine
WORKDIR /app
RUN apk add --no-cache ffmpeg tzdata \
    && mkdir /data && chown node:node /data
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
ENV NODE_ENV=production \
    FLORA_DATABASE_URL=file:/data/mastra.db \
    FLORA_ATTACHMENTS_DIR=/data/attachments \
    CODEX_AUTH_FILE=/data/oauth.json \
    FLORA_OAUTH_PORT=8080
USER node
EXPOSE 8080
CMD ["node", "--import", "tsx", "src/discord/index.ts"]
