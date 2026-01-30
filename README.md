# Moltbot Railway Template (1‑click deploy)

This repo packages **Moltbot** for Railway with a small **/setup** web wizard so users can deploy and onboard **without running any commands**.

## What you get

- **Moltbot Gateway + Control UI** (served at `/` and `/moltbot`)
- A friendly **Setup Wizard** at `/setup` (protected by a password)
- Persistent state via **Railway Volume** (so config/credentials/memory survive redeploys)
- One-click **Export backup** (so users can migrate off Railway later)

## How it works (high level)

- The container runs a wrapper web server.
- The wrapper protects `/setup` with `SETUP_PASSWORD`.
- During setup, the wrapper runs `moltbot onboard --non-interactive ...` inside the container, writes state to the volume, and then starts the gateway.
- After setup, **`/` is Moltbot**. The wrapper reverse-proxies all traffic (including WebSockets) to the local gateway process.

## Railway deploy instructions (what you'll publish as a Template)

In Railway Template Composer:

1) Create a new template from this GitHub repo.
2) Set the following variables:

Required:
- `SETUP_PASSWORD` — user-provided password to access `/setup`

Recommended:
- `MOLTBOT_STATE_DIR=/data/.moltbot` (matches volume mount below)
- `MOLTBOT_WORKSPACE_DIR=/data/workspace` (matches volume mount below)

Optional:
- `MOLTBOT_GATEWAY_TOKEN` — if not set, the wrapper generates one. In a template, set this using a generated Railway reference for better security.

Notes:
- This template pins Moltbot to a known-good version by default via Docker build arg `MOLTBOT_VERSION`.

3) **Add a Volume:**
   - Click "Volumes" in the left sidebar
   - Click "New Volume"
   - Name it: `data` (or any name you prefer)
   - Click "Create volume"

4) **Connect the Volume to your service:**
   - In your service → Settings → Volumes
   - Click "Connect Volume"
   - Select the `data` volume you just created
   - Mount path: `/data`

5) Enable **Public Networking** (HTTP). Railway will assign a domain.
6) Deploy.

Then:
- Visit `https://<your-app>.up.railway.app/setup`
- Complete setup
- Visit `https://<your-app>.up.railway.app/` and `/moltbot`

## Getting chat tokens (so you don’t have to scramble)

### Telegram bot token
1) Open Telegram and message **@BotFather**
2) Run `/newbot` and follow the prompts
3) BotFather will give you a token that looks like: `123456789:AA...`
4) Paste that token into `/setup`

### Discord bot token
1) Go to the Discord Developer Portal: https://discord.com/developers/applications
2) **New Application** → pick a name
3) Open the **Bot** tab → **Add Bot**
4) Copy the **Bot Token** and paste it into `/setup`
5) Invite the bot to your server (OAuth2 URL Generator → scopes: `bot`, `applications.commands`; then choose permissions)

## Local smoke test

```bash
docker build -t moltbot-railway-template .

docker run --rm -p 8080:8080 \
  -e PORT=8080 \
  -e SETUP_PASSWORD=test \
  -e MOLTBOT_STATE_DIR=/data/.moltbot \
  -e MOLTBOT_WORKSPACE_DIR=/data/workspace \
  -v $(pwd)/.tmpdata:/data \
  moltbot-railway-template

# open http://localhost:8080/setup (password: test)
```
