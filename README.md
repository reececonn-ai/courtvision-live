# CourtVision Live

CourtVision Live is the online version of the NBA Team Draft app.

## What this repo does

- `/control.html` — commissioner control surface
- `/watch.html` — read-only spectator view for laptops and phones
- Cloudflare Worker — serves the app and API
- Durable Object — stores one authoritative state per draft room
- WebSockets — push commissioner changes to spectators in real time

## Commissioner setup is automatic

You do **not** need to create a Cloudflare secret.

1. Open `/control.html`.
2. CourtVision automatically creates a unique draft room.
3. Choose a commissioner PIN/password with at least 6 characters.
4. Press **PUBLISH LIVE**.
5. That first successful publish permanently claims that draft room with your PIN.
6. Use the same PIN whenever you return to that room.

The PIN is not committed to GitHub and is not placed in the spectator URL. CourtVision stores a PBKDF2-derived verifier inside that room's Cloudflare Durable Object.

If a legacy Cloudflare `CONTROL_PIN` secret exists, it remains usable as a recovery credential, but it is no longer required.

## Spectator link

The commissioner page creates the spectator link automatically:

`/watch.html?room=<your-unique-room>`

Send that link to everyone in the Zoom meeting. It is read-only and adapts to laptop and mobile screens.

## Cloudflare deployment

Cloudflare Workers Builds can deploy directly from this GitHub repo.

1. Open **Cloudflare Dashboard → Workers & Pages**.
2. Connect/select **`reececonn-ai/courtvision-live`**.
3. Worker name: **`courtvision-live`**
4. Deploy command: `npx wrangler deploy`
5. Deploy.

After GitHub integration is active, pushes to `main` should trigger new Cloudflare deployments.

## First live test

1. Open the deployed `/control.html`.
2. Enter a memorable commissioner PIN with at least 6 characters.
3. Click **PUBLISH LIVE**.
4. Click **OPEN SPECTATOR VIEW**.
5. Open that watch URL on a phone or second browser.
6. Press **DEMO SPIN**.
7. The spectator page should change from the wheel screen to a team reveal automatically without refreshing.

## Security model

- Spectators can read a room.
- The commissioner page creates a high-entropy room name automatically.
- The first commissioner publish claims the room.
- Later writes require the same PIN.
- The PIN itself is not stored in GitHub.
- The Durable Object stores a salted PBKDF2-derived verifier, not the plain PIN.
- The spectator URL does not contain the PIN.

## Current milestone

This deployment is the live-sync foundation. The current commissioner page is intentionally a test console.

Next milestone:

- replace the temporary control form with the full CourtVision wheel
- connect real bid / assign / pass actions
- sync player budgets
- sync team assignments and Barrel
- sync recap and current screen
- retain a local emergency backup on the commissioner laptop
- optimize the commissioner UI for a 1080p laptop
- keep the spectator UI extremely readable on laptops and phones
