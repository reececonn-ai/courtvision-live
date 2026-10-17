# CourtVision Live

CourtVision Live is the online version of the NBA Team Draft app.

## Modes

- `/control/` — commissioner interface
- `/watch/` — read-only spectator interface
- `/api/room/:room` — room state API
- `/ws/:room` — live WebSocket connection

## Architecture

- Cloudflare Workers serves the app and API.
- One Durable Object represents one draft room.
- The Durable Object persists the latest draft state.
- Spectators receive live updates over WebSockets.
- The commissioner remains the only client allowed to publish authoritative draft state.
- The browser keeps a local emergency backup as well.

## Local setup

```bash
npm install
npm run dev
```

## Deploy

```bash
npm run deploy
```

Cloudflare setup is documented in `CLOUDFLARE_SETUP.md`.

## Status

Initial online architecture scaffold. The commissioner UI from CourtVision v2 will be migrated into `/control/` and the simplified responsive spectator experience will live at `/watch/`.
