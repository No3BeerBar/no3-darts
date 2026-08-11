# Camera / detector integration

This document describes how throw-detection software talks to No3 Darts.

> **Recommended bar path:** [Autodarts Board Manager](https://autodarts.diy/) detects throws; a local bridge POSTs them into No3. Game modes (X01, Cricket, Killer, …) stay in No3. See [`tools/autodarts-companion/`](../tools/autodarts-companion/README.md).

An experimental DIY OpenCV stack still lives under [`detection/`](../detection/README.md) but is **not** the recommended production path for the bar.

## Overview

1. Start a match on the tablet UI (or `POST /api/matches`) — pick any No3 game mode.
2. The browser syncs match state to the server.
3. Your detector calls `POST /api/camera/dart` when a dart is recognized.
4. On takeout / visit end, call `POST /api/camera/end-turn` (Autodarts bridge does this automatically).
5. Optional: subscribe to `GET /api/camera/stream` for confirmations / multi-display.

```
[Autodarts Board Manager :3180]
        │  poll /api/state
        ▼
[companion bridge on board PC]
        │  POST /api/camera/dart (+ end-turn on takeout)
        ▼
[No3 server] ──SSE──► tablet / TV scoring UI
```

## Payload

```ts
type DartDetectedEvent = {
  kind: "single" | "double" | "triple" | "outer_bull" | "bull" | "miss";
  number: number;      // 1–20 for segments; 0 for miss; 25/50 optional
  matchId?: string;
  roomId?: string;     // e.g. "Board 1"
  angle?: number;      // degrees, for heatmaps
  radius?: number;     // 0–1 from center
  confidence?: number; // 0–1
  timestamp?: number;
};
```

## Mapping detector output → kind/number

| Board region | kind | number |
|--------------|------|--------|
| Single 20 | `single` | `20` |
| Double 16 | `double` | `16` |
| Triple 19 | `triple` | `19` |
| Outer bull | `outer_bull` | `25` |
| Bullseye | `bull` | `50` |
| Miss / bounce-out | `miss` | `0` |

Autodarts labels (`T20`, `S5`, `Bull`, `Miss`, …) are mapped by the companion bridge.

## Auth

Set `CAMERA_API_KEY` on Railway. Send either:

- `Authorization: Bearer <key>`
- `x-api-key: <key>`

If unset, endpoints are open (convenient for LAN-only installs).

## End turn / takeout

```http
POST /api/camera/end-turn
Content-Type: application/json

{ "roomId": "Board 1" }
```

Call this when the player pulls darts early (1–2 darts) or when the detector signals takeout. After a full 3-dart visit No3 usually auto-ends the turn; a redundant end-turn is safe (returns `READY`).

## Sequence (recommended — Autodarts bridge)

```
UI:     createGame (any mode) → sync POST /api/matches { state }
AD:     Board Manager Start (Throw)
Bridge: poll GET http://127.0.0.1:3180/api/state
        → new dart → POST /api/camera/dart { kind, number, roomId }
        → takeout / throws cleared → POST /api/camera/end-turn
UI:     SSE / poll merges camera darts into the live match
```

Bar one-liner and CLI: [`tools/autodarts-companion/README.md`](../tools/autodarts-companion/README.md).

```powershell
cd tools\autodarts-companion
python -m companion bridge --no3-url https://your-app.up.railway.app --room "Board 1"
```

## Example (curl)

```bash
curl -X POST https://your-app.up.railway.app/api/camera/dart \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CAMERA_API_KEY" \
  -d '{"kind":"triple","number":20,"roomId":"Board 1","confidence":0.95}'

curl -X POST https://your-app.up.railway.app/api/camera/end-turn \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CAMERA_API_KEY" \
  -d '{"roomId":"Board 1"}'
```

## DIY OpenCV (experimental)

The `detection/` Python stack can also post the same JSON. Prefer Autodarts + bridge for bar reliability; keep DIY for experiments.
