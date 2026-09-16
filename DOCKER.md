# Docker deployment

The image contains both the built web client and the LLM cache/proxy server.
The Node server serves the SPA and `/api/*` from the same origin. Accounts,
per-user anime archives, encrypted user API keys, and the globally shared line
cache are stored in SQLite inside the `asbplayer_data` Docker volume. Video and
subtitle files remain in the user's browser and are not uploaded.

## First deployment

```bash
git clone --branch feature/llm-analysis-full git@github.com:messywind/asbplayer.git
cd asbplayer
cp server/.env.example server/.env
```

Edit `server/.env` and set at least:

```dotenv
ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace-with-a-long-random-password
API_KEY_ENCRYPTION_SECRET=replace-with-the-output-of-openssl-rand-hex-32
SECURE_COOKIES=true
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

Log in with the bootstrap administrator account. Use the account button to save
the administrator's own LLM API Key and generate invitation links. Each invited
user supplies their own API Key; the server never returns a saved key to the
browser.

## Updates

```bash
git fetch origin
git switch feature/llm-analysis-full
git pull --ff-only origin feature/llm-analysis-full
VITE_APP_GIT_COMMIT="$(git rev-parse --short HEAD)" docker compose up -d --build
```

Rebuilding or replacing the container does not delete the named data volume or
its `/data/asbplayer.sqlite` database.

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
