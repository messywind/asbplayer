# syntax=docker/dockerfile:1

FROM node:22.17.1-bookworm-slim AS build

WORKDIR /app
RUN corepack enable

COPY . .
RUN yarn install --immutable

ARG VITE_APP_GIT_COMMIT=docker
RUN VITE_APP_GIT_COMMIT="${VITE_APP_GIT_COMMIT}" yarn workspace @project/client exec vite build


FROM node:22.17.1-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3939 \
    DATA_DIR=/data \
    PUBLIC_DIR=/app/client/dist

WORKDIR /app

COPY --from=build /app/client/dist ./client/dist
COPY server ./server

RUN mkdir -p /data \
    && chown -R node:node /app /data

USER node

VOLUME ["/data"]
EXPOSE 3939

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3939/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server/server.mjs"]
