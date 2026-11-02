# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:22-bookworm-slim

# ---- build: install, verify data + tests, build the front end ----
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Tests include a check that data/trip.json matches the committed workbook.
RUN npm test && npm run build && npm prune --omit=dev

# ---- runtime ----
FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/state.db
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
COPY --from=build /app/data/trip.json ./data/trip.json
COPY --from=build /app/dist/web ./dist/web
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Node 22.18+ runs TypeScript directly (type stripping), so there is no compile step.
CMD ["node", "server/main.ts"]
