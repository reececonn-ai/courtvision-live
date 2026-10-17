# CourtVision Live

CourtVision Live is the online version of the NBA Team Draft app.

## What this repo does

- `/control.html` — commissioner-only control surface
- `/watch.html` — read-only spectator view for laptops and phones
- Cloudflare Worker — serves the app and API
- Durable Object — stores one authoritative state per draft room
- WebSockets — push commissioner changes to spectators in real time
- local browser state is not the shared source of truth anymore

The first milestone is intentionally a live-sync test console. Once deployment is verified, the full CourtVision wheel/bidding workflow will be connected to the same state backend.

## Cloudflare deployment

Cloudflare Workers Builds can deploy directly from this GitHub repo.

1. Open **Cloudflare Dashboard → Workers & Pages**.
2. Choose **Create application**.
3. Choose **GitHub** as the source.
4. Authorize GitHub if prompted.
5. Select **`reececonn-ai/courtvision-live`**.
6. Keep the Worker name as **`courtvision-live`**. It must match `wrangler.jsonc`.
7. Use the default deploy command:
   `npx wrangler deploy`
8. Save and deploy.

This repo includes `wrangler.jsonc`, so Cloudflare will deploy the Worker, static assets, and Durable Object together.

## Required commissioner secret

The Worker will not deploy successfully until the required secret exists:

`CONTROL_PIN`

Set this in Cloudflare as an encrypted Worker secret. Use any PIN/password you want for commissioner writes.

### Dashboard method

Open the Worker in Cloudflare and add a secret named:

`CONTROL_PIN`

Do not put the real PIN into GitHub.

### Wrangler method

```bash
npm install
npx wrangler secret put CONTROL_PIN
```

## URLs after deployment

Cloudflare will provide a `workers.dev` URL.

Examples:

- Commissioner:
  `https://courtvision-live.<your-subdomain>.workers.dev/control.html`
- Spectator:
  `https://courtvision-live.<your-subdomain>.workers.dev/watch.html?room=nba2026`

The room name can be changed. Spectators in the same room see the same live state.

## First live test

1. Open `control.html` on the commissioner laptop.
2. Enter room `nba2026`.
3. Enter the `CONTROL_PIN`.
4. Open the watch link in another browser or phone.
5. Press **PUBLISH LIVE**.
6. Press **DEMO SPIN**.
7. The spectator page should update without refreshing.

## Security model

- Spectators can read room state.
- Writes require `CONTROL_PIN`.
- The PIN is stored only as a Cloudflare Worker secret.
- The control page keeps the entered PIN in session storage for that browser tab/session.
- No commissioner PIN is committed to this repository.

## Next milestone

After the Cloudflare live-sync test passes:

- replace the temporary control form with the CourtVision wheel
- connect real bid/assign/pass actions to the Durable Object
- sync budgets, assignments, Barrel, recap, current team and screen
- preserve an emergency local backup on the commissioner laptop
- optimize commissioner UI for 1080p laptop use
- keep the spectator UI extremely readable on laptop and mobile
