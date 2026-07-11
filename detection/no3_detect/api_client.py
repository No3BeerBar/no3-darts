"""HTTP client for No3 Darts camera API."""

from __future__ import annotations

from typing import Any, Optional

import requests

from .board_geometry import SegmentHit


class No3Client:
    def __init__(
        self,
        base_url: str,
        api_key: str = "",
        room_id: str = "Board 1",
        timeout: float = 5.0,
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.room_id = room_id
        self.timeout = timeout

    def _headers(self) -> dict[str, str]:
        h = {"Content-Type": "application/json"}
        if self.api_key:
            h["Authorization"] = f"Bearer {self.api_key}"
        return h

    def post_dart(
        self,
        hit: SegmentHit,
        *,
        match_id: Optional[str] = None,
        dry_run: bool = False,
    ) -> dict[str, Any]:
        payload = {
            "kind": hit.kind,
            "number": hit.number if hit.kind not in ("outer_bull", "bull", "miss") else (
                25 if hit.kind == "outer_bull" else 50 if hit.kind == "bull" else 0
            ),
            "roomId": self.room_id,
            "angle": hit.angle_deg,
            "radius": hit.radius,
            "confidence": hit.confidence,
        }
        if match_id:
            payload["matchId"] = match_id

        if dry_run:
            return {"ok": True, "dry_run": True, "payload": payload}

        # Engine expects number 1–20 for S/D/T; createDart handles bulls via kind
        if hit.kind in ("single", "double", "triple"):
            payload["number"] = hit.number
        elif hit.kind == "outer_bull":
            payload["number"] = 25
        elif hit.kind == "bull":
            payload["number"] = 50
        else:
            payload["number"] = 0

        r = requests.post(
            f"{self.base_url}/api/camera/dart",
            json=payload,
            headers=self._headers(),
            timeout=self.timeout,
        )
        try:
            data = r.json()
        except Exception:
            data = {"raw": r.text}
        if r.status_code >= 400:
            err = data.get("error") if isinstance(data, dict) else data
            if r.status_code == 404 or "No active match" in str(err):
                raise RuntimeError(
                    f"API {r.status_code}: {err} — "
                    f"Start a game on the iPad for room '{self.room_id}' and leave it open."
                )
            raise RuntimeError(f"API {r.status_code}: {data}")
        return data

    def health(self) -> dict[str, Any]:
        r = requests.get(f"{self.base_url}/api/health", timeout=self.timeout)
        r.raise_for_status()
        return r.json()

    def active_match(self) -> Optional[dict[str, Any]]:
        r = requests.get(
            f"{self.base_url}/api/matches/active",
            params={"room": self.room_id},
            headers=self._headers(),
            timeout=self.timeout,
        )
        r.raise_for_status()
        data = r.json()
        return data.get("match")
