# Camera / CV Integration Guide

This document describes how computer-vision software talks to No3 Darts.

> **We do not use Autodarts.** Detection is our own stack under [`detection/`](../detection/README.md) (Python + OpenCV), or any client that posts the same JSON payload.

## Overview

1. Start a match on the tablet UI (or `POST /api/matches`).
2. The browser syncs match state to the server.
3. Your detector calls `POST /api/camera/dart` when a dart is recognized.
4. Optional: subscribe to `GET /api/camera/stream` for confirmations / multi-display.

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

## Auth

Set `CAMERA_API_KEY` on Railway. Send either:

- `Authorization: Bearer <key>`
- `x-api-key: <key>`

If unset, endpoints are open (convenient for LAN-only installs).

## Sequence (recommended)

```
UI: createGame → sync POST /api/matches { state }
CV: loop → detect → POST /api/camera/dart { kind, number, roomId }
UI: poll GET /api/matches/active?room=…  OR  SSE stream
    → apply returned state (optional second display)
```

The play screen subscribes to **SSE** (`useCameraSync`) and merges server-side camera darts into the live match when `updatedAt` is newer.

For the full DIY detector (calibrate cameras, run OpenCV loop, simulate hits), see:

- [`detection/README.md`](../detection/README.md)

## Example (curl)

```bash
curl -X POST https://your-app.up.railway.app/api/camera/dart \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CAMERA_API_KEY" \
  -d '{"kind":"triple","number":20,"roomId":"Board 1","confidence":0.95}'
```
