# SYNCWAVE — P2P video sync (NestJS + TanStack Start)

Host a video URL, share one link, and every viewer's playback follows the host
frame-for-frame. Sync commands travel over **WebRTC data channels** (direct
peer-to-peer); a **NestJS** server only brokers the signaling handshake over
WebSockets, then drops out of the loop.

> Rebuild of the original TanStack-Start-only SYNCWAVE with a split stack:
> **NestJS backend** for signaling, **TanStack Start client**, a shared types
> package, and a **pnpm monorepo**. Nothing is stored in a database — room state
> lives in server memory and evaporates on restart.

## Monorepo layout

```
syncwave/
├─ pnpm-workspace.yaml
├─ package.json                 # root scripts (dev runs server + web together)
├─ packages/
│  └─ shared/                   # @syncwave/shared — SignalMessage / SyncMessage / Role
│     └─ src/index.ts           # the wire contract, imported by BOTH apps
└─ apps/
   ├─ server/                   # @syncwave/server — NestJS signaling
   │  └─ src/
   │     ├─ main.ts             # bootstrap, CORS, listens on :4000
   │     ├─ app.module.ts
   │     └─ signaling/signaling.gateway.ts   # socket.io: register / signal / disconnect
   └─ web/                      # @syncwave/web — TanStack Start client
      └─ src/
         ├─ routes/             # index (landing) + room.$roomId (host|viewer)
         ├─ hooks/
         │  ├─ useSocket.ts     # socket.io transport (replaces the old HTTP poll)
         │  ├─ useHostPeers.ts  # one RTCPeerConnection per viewer; DOM events → broadcast
         │  └─ useViewerPeer.ts # answers offer; slaves <video> w/ drift correction
         ├─ components/         # VideoPlayer, RoomHost, RoomViewer, Brand
         └─ lib/rtc.ts          # ICE config, tolerances, randomId()
```

## How it works

1. **Landing** (`routes/index.tsx`) — paste an `.mp4`/`.m3u8` URL → generates a
   room id → navigates to the host view.
2. **Signaling** (`apps/server`) — the browser opens a socket.io connection and
   `register`s as a participant (`host` or a viewer id) in a room. Offer, answer
   and ICE candidates are relayed **only** to their addressed recipient. Messages
   for a peer that hasn't registered yet are buffered and flushed on register.
3. **P2P** — once the WebRTC data channel is up, the server is done. The host
   mirrors its `<video>` play / pause / seek / ratechange events (plus a 2 s
   heartbeat snapshot) to every viewer; each viewer slaves its player to that
   stream and hard-resyncs when drift exceeds `DRIFT_TOLERANCE` (0.75 s).
4. **Disconnect** — a dropped socket broadcasts a `bye`; the host tears down that
   peer, viewers learn the host is gone. Viewers auto re-`join` for a fresh offer.

**Signaling vs. sync:** the server sees only the short handshake. All actual
playback-sync traffic is browser↔browser and never touches the backend.

## Run locally

```bash
pnpm install
pnpm dev          # builds @syncwave/shared, then runs server (:4000) + web (:3000)
```

- Web → http://localhost:3000
- Signaling server → http://localhost:4000

Paste an `.mp4`/`.m3u8` URL, **Host Room**, copy the viewer link into a second
tab/device to join.

Run the two apps separately if you prefer:

```bash
pnpm dev:server   # NestJS, watch mode
pnpm dev:web      # TanStack Start (Vite)
```

Other scripts:

```bash
pnpm build        # build shared → server → web
pnpm typecheck    # strict tsc across all packages
```

The web client points at the signaling server via `VITE_SIGNAL_URL`
(default `http://localhost:4000`). Copy `apps/web/.env.example` → `apps/web/.env`
to override.

## Deploy: web on Vercel, server on a persistent host

The client is a normal TanStack Start app — **Vercel** detects it natively. The
signaling server is a **stateful** WebSocket process, so it needs an always-on
host (Railway, Fly.io, Render, a VPS) — not a serverless function.

**Server** (Railway / Fly / Render):
- Build: `pnpm --filter @syncwave/shared build && pnpm --filter @syncwave/server build`
- Start: `node apps/server/dist/main.js`
- Env: `PORT` (host-provided), `CORS_ORIGIN=https://your-web.vercel.app`

**Web** (Vercel):
- Root directory: `apps/web`
- Env: `VITE_SIGNAL_URL=https://your-server-host` (the deployed signaling URL)

Because room state is in-memory, run a **single** server instance (or add
sticky sessions + a shared adapter like `@socket.io/redis-adapter` if you scale
out — the gateway's message contract stays identical).

## NAT note

ICE uses public **STUN** only. Peers behind symmetric / carrier-grade NAT need a
**TURN** relay — add its `{ urls, username, credential }` to `RTC_CONFIG` in
`apps/web/src/lib/rtc.ts` (e.g. a free metered.ca key).
