# Single image, two deploy artifacts. The server and the worker run this same image with a
# different CMD/entrypoint override (`node dist/server.js` vs `node dist/worker.js`) so both
# processes always ship the same compiled domain/service code — see CONTRIBUTING.md §8.

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=production

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci

FROM base AS build
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM base AS runtime
RUN groupadd --system --gid 1001 drezivo && \
    useradd --system --uid 1001 --gid drezivo --home-dir /app --shell /usr/sbin/nologin drezivo
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER drezivo
EXPOSE 3000

# The worker container overrides this HEALTHCHECK (it has no HTTP listener) via its own
# orchestrator probe (e.g. a liveness check on the lease-claim loop's heartbeat file/log),
# not this Dockerfile's default.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health').then(r=>{if(r.status!==200)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
