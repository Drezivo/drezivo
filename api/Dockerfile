# Build this file from the repository root: `docker build -f api/Dockerfile .`.
# Single image, two deploy artifacts. The server and the worker run this same image with a
# different CMD/entrypoint override (`node dist/server.js` vs `node dist/worker.js`) so both
# processes always ship the same compiled domain/service code — see CONTRIBUTING.md §8.

FROM node:22-bookworm-slim AS base
WORKDIR /app

FROM base AS build
ENV NODE_ENV=development

# The root lockfile is authoritative. Keep the workspace manifests separate from the source
# copy so dependency installation remains cacheable and the image cannot accidentally use a
# nested api lockfile that does not exist in this monorepo.
COPY package.json package-lock.json ./
COPY api/package.json api/package.json
COPY contracts/package.json contracts/package.json
COPY app/package.json app/package.json
COPY web/package.json web/package.json
COPY docs/package.json docs/package.json
RUN npm ci --ignore-scripts

COPY contracts contracts
COPY api api
RUN npm run build --workspace @drezivo/contracts
RUN npm run build --workspace @drezivo/api
RUN npm prune --omit=dev --ignore-scripts

FROM base AS runtime
ENV NODE_ENV=production
RUN groupadd --system --gid 1001 drezivo && \
    useradd --system --uid 1001 --gid drezivo --home-dir /app --shell /usr/sbin/nologin drezivo
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/api/package.json ./api/package.json
COPY --from=build /app/api/node_modules ./api/node_modules
COPY --from=build /app/api/dist ./api/dist
COPY --from=build /app/contracts/package.json ./contracts/package.json
COPY --from=build /app/contracts/node_modules ./contracts/node_modules
COPY --from=build /app/contracts/dist ./contracts/dist
USER drezivo
WORKDIR /app/api
EXPOSE 3000

# The worker container overrides this HEALTHCHECK (it has no HTTP listener) via its own
# orchestrator probe (e.g. a liveness check on the lease-claim loop's heartbeat file/log),
# not this Dockerfile's default.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health').then(r=>{if(r.status!==200)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
