# Camera / detector integration

This document describes how throw-detection software talks to No3 Darts.

> **Recommended bar path:** [Autodarts Board Manager](https://autodarts.diy/) detects throws; a local bridge POSTs them into No3. Game modes (X01, Cricket, Killer, …) stay in No3. See [`tools/autodarts-companion/`](../tools/autodarts-companion/README.md).

An experimental DIY OpenCV stack still lives under [`detection/`](../detection/README.md) but is **not** the recommended production path for the bar.

## Overview

1. Start a match on the tablet UI (or `POST /api/matches`) — pick any No3 game mode.
2. The browser syncs match state to the server.
3. Your detector calls `POST /api/camera/dart` when a dart is recognized.
4. On takeout / visit end, call `POST /api/camera/end-turn` (Autodarts bridge does this automatically). While Autodarts is in takeout, the bridge pauses dart/correct posts.
5. On mid-visit correction (changed / removed throw), call `POST /api/camera/correct` with the full visit.
6. Optional: `POST /api/camera/health` so iPad/TV can toast FPS / restart / takeout notices (`takeout: true` / `level: "takeout"`).
7. Optional: patron ack `POST /api/camera/takeout-ready` → bridge `GET …?consume=1` to reset/resume after remove-darts.
8. Optional: `POST /api/camera/undo` steps the server match back one dart (same engine as `/play` Undo).
9. Optional: subscribe to `GET /api/camera/stream` for confirmations / multi-display.

Bar mini-PC wiring + one-script start: [`docs/BOARD-STATION.md`](./BOARD-STATION.md).

```
[Autodarts Board Manager :3180]
        │  poll /api/state
        ▼
[companion bridge on board PC]
        │  POST /api/camera/dart
        │  POST /api/camera/correct  (visit replace)
        │  POST /api/camera/end-turn (takeout)
        │  POST /api/camera/health   (FPS / restart)
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
  /** When set, server refuses (409) if currentPlayerIndex differs. */
  expectedPlayerIndex?: number;
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

## Takeout ready (patron ack)

```http
POST /api/camera/takeout-ready
Content-Type: application/json

{ "roomId": "Board 1" }
```

Open to the play kiosk (no camera API key). Bridge polls:

```http
GET /api/camera/takeout-ready?room=Board%201&consume=1
```

Used when Autodarts is stuck in remove-darts / takeout and the player confirms the board is clear (**Ready for next visit** on `/play`).

## Undo one dart

```http
POST /api/camera/undo
Content-Type: application/json

{ "roomId": "Board 1" }
```

Reverses the last applied dart on the server match (camera or manual). Call repeatedly to walk backward through the open visit, then prior visits. `/play` Undo uses the same engine locally and syncs match state; this endpoint is for bridge/tools that need an immediate server-side step.

## Correct visit (Autodarts-style)

When Board Manager **changes or removes** a prior throw in the current visit (not just appends), replace the open turn in one shot:

```http
POST /api/camera/correct
Content-Type: application/json

{
  "roomId": "Board 1",
  "darts": [
    { "kind": "triple", "number": 19 },
    { "kind": "single", "number": 5 }
  ],
  "reason": "autodarts_state_diff"
}
```

- `darts` is the **full** current visit (0–3 items). Empty array clears the open visit without advancing the thrower.
- Server rebuilds from `turnBaseline` via `correctCurrentTurn` — idempotent, no double-scoring.
- Prefer this over undo + re-post from the bridge.
- Server **rejects** a non-empty correct when the current thrower has no open visit (blocks prior-player AD lists from landing on the next seat after auto end-turn).
- Players can also fix on the iPad: tap the dart slot → pick the right segment.

## Camera health

```http
POST /api/camera/health
Content-Type: application/json

{
  "roomId": "Board 1",
  "ok": false,
  "level": "unhealthy",
  "message": "Detection restarting…",
  "restarting": true,
  "fps": [0, 12, 30],
  "minFps": 0
}
```

```http
GET /api/camera/health?room=Board%201
```

SSE event `camera_health` fans the same payload to `/play` and `/tv` for toasts.

## Sequence (recommended — Autodarts bridge)

```
UI:     createGame (any mode) → sync POST /api/matches { state }
AD:     Board Manager Start (Throw)
Bridge: poll GET http://127.0.0.1:3180/api/state
        → new dart → POST /api/camera/dart { kind, number, roomId }
        → corrected / shrunk visit → POST /api/camera/correct { darts[] }
        → takeout / throws cleared → POST /api/camera/end-turn
          (dart/correct paused until takeout clears)
        → FPS / cam failure → POST /api/camera/health (+ restart Board Manager)
        → takeout banner → POST /api/camera/health { takeout: true }
UI:     SSE / poll merges camera darts + health / takeout banners
        patron Ready → POST /api/camera/takeout-ready
```

Bar one-script start: [`docs/BOARD-STATION.md`](./BOARD-STATION.md)  
Bridge CLI: [`tools/autodarts-companion/README.md`](../tools/autodarts-companion/README.md).

```powershell
cd tools\board-station
.\start-board.bat
# or:
cd tools\autodarts-companion
python -m companion bridge --no3-url https://your-app.up.railway.app --room "Board 1"
```

## Example (curl)

```bash
curl -X POST https://your-app.up.railway.app/api/camera/dart \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CAMERA_API_KEY" \
  -d '{"kind":"triple","number":20,"roomId":"Board 1","confidence":0.95}'

curl -X POST https://your-app.up.railway.app/api/camera/correct \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CAMERA_API_KEY" \
  -d '{"roomId":"Board 1","darts":[{"kind":"triple","number":19},{"kind":"single","number":5}]}'

curl -X POST https://your-app.up.railway.app/api/camera/end-turn \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CAMERA_API_KEY" \
  -d '{"roomId":"Board 1"}'
```

## DIY OpenCV (experimental)

The `detection/` Python stack can also post the same JSON. Prefer Autodarts + bridge for bar reliability; keep DIY for experiments.
