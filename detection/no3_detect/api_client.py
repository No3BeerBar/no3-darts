"""HTTP client for No3 Darts camera API."""

from __future__ import annotations

from typing import Any, Optional
from urllib.parse import urlparse, urlunparse

import requests

from .board_geometry import SegmentHit


def normalize_api_base(url: str) -> str:
    """
    Normalize no3_api_url from config.

    Common mistakes that cause HTTP 405:
      - http://…  (Railway redirects to https and some clients turn POST→GET → 405)
      - trailing slash
      - accidental /api, /tv, /play suffix
    """
    u = (url or "").strip().strip('"').strip("'")
    if not u:
        return "http://localhost:3000"

    # Force https for railway / production hosts (avoids POST→GET on redirect)
    if u.startswith("http://") and "localhost" not in u and "127.0.0.1" not in u:
        u = "https://" + u[len("http://") :]

    parsed = urlparse(u)
    path = (parsed.path or "").rstrip("/")

    # Strip UI or API suffixes people paste from the browser bar
    for suffix in (
        "/api/camera/dart",
        "/api/camera",
        "/api",
        "/tv",
        "/play",
        "/admin",
        "/leaderboard",
        "/history",
        "/players",
    ):
        if path.lower().endswith(suffix):
            path = path[: -len(suffix)]
            break

    path = path.rstrip("/")
    cleaned = urlunparse((parsed.scheme, parsed.netloc, path, "", "", ""))
    return cleaned.rstrip("/")


class No3Client:
    def __init__(
        self,
        base_url: str,
        api_key: str = "",
        room_id: str = "Board 1",
        timeout: float = 5.0,
    ):
        self.base_url = normalize_api_base(base_url)
        self.api_key = api_key
        self.room_id = room_id
        self.timeout = timeout
        self.dart_url = f"{self.base_url}/api/camera/dart"

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
            "number": hit.number
            if hit.kind not in ("outer_bull", "bull", "miss")
            else (
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

        if hit.kind in ("single", "double", "triple"):
            payload["number"] = hit.number
        elif hit.kind == "outer_bull":
            payload["number"] = 25
        elif hit.kind == "bull":
            payload["number"] = 50
        else:
            payload["number"] = 0

        r = self._post_json(self.dart_url, payload)
        try:
            data = r.json()
        except Exception:
            data = {"raw": r.text[:300]}

        if r.status_code >= 400:
            err = data.get("error") if isinstance(data, dict) else data
            if r.status_code == 404 or "No active match" in str(err):
                raise RuntimeError(
                    f"API {r.status_code}: {err} — "
                    f"Start a game on the iPad for room '{self.room_id}' and leave it open. "
                    f"URL={self.dart_url}"
                )
            if r.status_code == 405:
                raise RuntimeError(
                    f"API 405 Method Not Allowed for {self.dart_url}\n"
                    f"  Fix config.yaml no3_api_url to the site ROOT with https, e.g.\n"
                    f'  no3_api_url: "https://no3-darts-production.up.railway.app"\n'
                    f"  (no /tv, no /api, no trailing path; use https not http)\n"
                    f"  response={data}"
                )
            raise RuntimeError(f"API {r.status_code} URL={self.dart_url}: {data}")
        return data

    def _post_json(self, url: str, payload: dict[str, Any]) -> requests.Response:
        """
        POST JSON without following redirects that can rewrite POST→GET (405).
        On 301/302/307/308, re-POST to the Location with https if needed.
        """
        headers = self._headers()
        r = requests.post(
            url,
            json=payload,
            headers=headers,
            timeout=self.timeout,
            allow_redirects=False,
        )
        hops = 0
        while r.status_code in (301, 302, 303, 307, 308) and hops < 4:
            loc = r.headers.get("Location") or r.headers.get("location")
            if not loc:
                break
            if loc.startswith("/"):
                # Relative redirect
                p = urlparse(url)
                loc = f"{p.scheme}://{p.netloc}{loc}"
            if loc.startswith("http://") and "localhost" not in loc:
                loc = "https://" + loc[len("http://") :]
            # Always re-POST (even on 301/302) — dart endpoint only accepts POST
            r = requests.post(
                loc,
                json=payload,
                headers=headers,
                timeout=self.timeout,
                allow_redirects=False,
            )
            hops += 1
            url = loc
        return r

    def health(self) -> dict[str, Any]:
        r = requests.get(
            f"{self.base_url}/api/health",
            timeout=self.timeout,
            allow_redirects=True,
        )
        r.raise_for_status()
        return r.json()

    def active_match(self) -> Optional[dict[str, Any]]:
        r = requests.get(
            f"{self.base_url}/api/matches/active",
            params={"room": self.room_id},
            headers=self._headers(),
            timeout=self.timeout,
            allow_redirects=True,
        )
        r.raise_for_status()
        data = r.json()
        return data.get("match")

    def end_turn(
        self,
        *,
        match_id: Optional[str] = None,
        dry_run: bool = False,
    ) -> dict[str, Any]:
        """Signal takeout complete / next player (POST /api/camera/end-turn)."""
        payload: dict[str, Any] = {"roomId": self.room_id}
        if match_id:
            payload["matchId"] = match_id
        if dry_run:
            return {"ok": True, "dry_run": True, "payload": payload}
        url = f"{self.base_url}/api/camera/end-turn"
        r = self._post_json(url, payload)
        try:
            data = r.json()
        except Exception:
            data = {"raw": r.text[:300]}
        if r.status_code >= 400:
            raise RuntimeError(f"end-turn API {r.status_code} URL={url}: {data}")
        return data
