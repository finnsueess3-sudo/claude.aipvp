# NINJA BATTLE — Multiplayer 2D Platformer

Real-time multiplayer fighting game running on Cloudflare Workers + Pages.

```
frontend/   ← HTML/CSS/JS game (hosted on Cloudflare Pages)
worker/     ← WebSocket server with Durable Objects (Cloudflare Workers)
.github/    ← Auto-deploy via GitHub Actions
```

---

## Setup in 5 steps

### 1. Fork / clone this repo to GitHub

### 2. Create a Cloudflare account
Go to https://dash.cloudflare.com and sign up (free).

### 3. Get your API token
- Cloudflare Dashboard → My Profile → API Tokens
- Create Token → "Edit Cloudflare Workers" template
- Copy the token

### 4. Add GitHub Secrets
In your GitHub repo: Settings → Secrets → Actions → New secret

| Secret name        | Value                                      |
|--------------------|--------------------------------------------|
| `CF_API_TOKEN`     | Your Cloudflare API token                  |
| `CF_ACCOUNT_ID`    | Cloudflare Dashboard → right sidebar       |
| `CF_WORKER_URL`    | `ninja-battle-server.<your-subdomain>.workers.dev` |

> The worker URL is known after first deploy. Do first push, check worker URL in Cloudflare dashboard, then add it as secret and push again.

### 5. Push to main
```bash
git add .
git commit -m "initial deploy"
git push origin main
```

GitHub Actions will:
1. Deploy the Worker (WebSocket server) to Cloudflare Workers
2. Deploy the frontend to Cloudflare Pages

Your game will be live at: `https://ninja-battle.pages.dev`

---

## Local development

```bash
# Backend (Worker)
cd worker
npx wrangler dev --local

# Frontend — just open in browser
open frontend/index.html
# Change WS_URL in game.js to: ws://localhost:8787/ws
```

---

## Controls

| Key | Action |
|-----|--------|
| A/D or ←/→ | Move |
| W / ↑ / Space | Jump (double jump supported) |
| J or Z | Attack |
| K or X | Special attack (more damage, cooldown) |

---

## Architecture

```
Browser → Cloudflare Worker (HTTP upgrade) → Durable Object (per room)
                                                    ↓
                                         broadcasts state to all players
```

Each game room = 1 Durable Object instance. All players in the same room
connect to the same DO, which runs a 20Hz broadcast loop.
