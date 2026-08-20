FROM node:20-bookworm-slim AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5000
ENV TZ=Asia/Muscat
ENV APP_TIMEZONE=Asia/Muscat
ENV BACKUP_DIR=/data/backups/eltizam-db
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl postgresql-client tzdata \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
VOLUME ["/data/backups"]
EXPOSE 5000
CMD ["node", "dist/index.cjs"]
