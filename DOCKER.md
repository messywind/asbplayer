# Docker deployment

The image contains both the built web client and the LLM cache/proxy server.
The Node server serves the SPA and `/api/*` from the same origin. Analysis data
is stored in the `asbplayer_data` Docker volume; video and subtitle files remain
in the user's browser and are not uploaded.

## First deployment

```bash
git clone --branch feature/llm-analysis-full git@github.com:messywind/asbplayer.git
cd asbplayer
cp server/.env.example server/.env
```

Edit `server/.env` and set at least:

```dotenv
LLM_API_KEY=your-key
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-chat
```

Build and start:

```bash
VITE_APP_GIT_COMMIT="$(git rev-parse --short HEAD)" docker compose up -d --build
docker compose ps
docker compose logs -f asbplayer
```

By default the service listens only on `127.0.0.1:3939`, ready for an HTTPS
reverse proxy such as Caddy or Nginx. To expose it directly on all interfaces:

```bash
ASBPLAYER_BIND_ADDRESS=0.0.0.0 docker compose up -d
```

Direct public exposure is not recommended because the API spends the configured
LLM account's credits. Put authentication or an access gateway in front of it.

In the web app, set **Cache server URL** to the public HTTPS origin, for example
`https://asb.example.com`.

## Updates

```bash
git fetch origin
git switch feature/llm-analysis-full
git pull --ff-only origin feature/llm-analysis-full
VITE_APP_GIT_COMMIT="$(git rev-parse --short HEAD)" docker compose up -d --build
```

Rebuilding or replacing the container does not delete the named data volume.

## Backup and restore

Create a backup in the current directory:

```bash
docker run --rm \
  -v asbplayer_asbplayer_data:/data:ro \
  -v "$PWD:/backup" \
  alpine tar czf /backup/asbplayer-data.tgz -C /data .
```

The Compose project name controls the volume prefix. Confirm the exact name with
`docker volume ls` before backing up or restoring it.
