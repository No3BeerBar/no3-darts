"""Keep-alive: start a stopped board; never reset; Board1 id only."""

from __future__ import annotations

from typing import Any, Optional

from companion.keepalive import (
    START_PATHS,
    KeepAliveConfig,
    KeepAliveTracker,
    collect_board_ids,
    extract_board_id,
    is_board_stopped,
    maybe_keep_alive,
    should_start_this_board,
    start_board_detection,
)


class FakeClient:
    def __init__(
        self,
        *,
        config: Any = None,
        boards: Any = None,
        start_code: int = 200,
        fail_paths: Optional[set[str]] = None,
    ) -> None:
        self.puts: list[str] = []
        self.posts: list[str] = []
        self.gets: list[str] = []
        self.config = config
        self.boards = boards
        self.start_code = start_code
        self.fail_paths = fail_paths or set()

    def get(self, path: str) -> tuple[int, Any]:
        self.gets.append(path)
        if path == "/api/config":
            if self.config is None:
                return 404, "missing"
            return 200, self.config
        if path in ("/api/boards", "/api/board"):
            if self.boards is None:
                return 404, "missing"
            return 200, self.boards
        return 404, ""

    def put(self, path: str, body: Optional[dict] = None) -> tuple[int, Any]:
        self.puts.append(path)
        if path in self.fail_paths:
            return 404, "no"
        if "start" in path:
            return self.start_code, {"ok": True}
        return 404, ""

    def post(self, path: str, body: Optional[dict] = None) -> tuple[int, Any]:
        self.posts.append(path)
        if path in self.fail_paths:
            return 404, "no"
        if "start" in path:
            return self.start_code, {"ok": True}
        return 404, ""


def test_stopped_status_is_detected() -> None:
    assert is_board_stopped({"status": "Stopped"}) is True
    assert is_board_stopped({"event": "Stopped"}) is True
    assert is_board_stopped({"boardStatus": "Stopped"}) is True
    assert is_board_stopped({"status": "Board: Stopped"}) is True
    assert is_board_stopped({"running": False, "status": "Throw"}) is True


def test_running_states_are_not_stopped() -> None:
    for status in (
        "Throw",
        "Throw detected",
        "Takeout",
        "Takeout started",
        "Takeout finished",
        "Started",
        "Wait",
        "Removing darts",
        "Calibration finished",
    ):
        assert is_board_stopped({"status": status}) is False
    assert is_board_stopped({"status": "Stopped", "running": True}) is False
    assert is_board_stopped({"status": "Throw", "throws": [{"segment": {"name": "T20"}}]}) is False


def test_empty_or_unknown_status_is_not_stopped() -> None:
    assert is_board_stopped(None) is False
    assert is_board_stopped({}) is False
    assert is_board_stopped({"status": ""}) is False
    assert is_board_stopped({"status": "Mystery"}) is False


def test_board_id_extract_and_collect() -> None:
    assert extract_board_id({"boardId": "abc-1"}) == "abc-1"
    assert extract_board_id({"auth": {"boardId": "abc-1"}}) == "abc-1"
    assert extract_board_id({"board": {"id": "abc-1"}}) == "abc-1"
    ids = collect_board_ids(
        {"status": "Stopped", "boardId": "board-1"},
        {"boards": [{"id": "board-1"}, {"id": "board-2"}]},
    )
    assert ids == ["board-1", "board-2"]


def test_should_start_this_board_fail_closed_on_other_boards() -> None:
    other = {"boards": [{"id": "other"}, {"id": "also-other"}]}
    assert should_start_this_board("board-1", other) is False
    assert should_start_this_board("", other) is False
    assert should_start_this_board("board-1", {"boardId": "board-1"}) is True
    assert should_start_this_board("board-1", {"boards": [{"id": "board-1"}]}) is True
    # Typical Board1: no id configured, local BM has zero or one board
    assert should_start_this_board("", {"status": "Stopped"}) is True
    assert should_start_this_board("", {"boardId": "only-one"}) is True


def test_start_uses_detection_start_not_reset() -> None:
    client = FakeClient()
    result = start_board_detection(client, board_id="board-1")
    assert result["ok"] is True
    assert result["method"] == "PUT"
    assert "/start" in result["path"]
    assert not any("reset" in p or "calibrat" in p for p in client.puts + client.posts)
    assert "/api/boards/board-1/start" in client.puts or "/api/detection/start" in client.puts


def test_start_paths_are_start_only() -> None:
    joined = " ".join(START_PATHS)
    assert "reset" not in joined
    assert "calibrat" not in joined
    assert "/api/detection/start" in START_PATHS


def test_maybe_keep_alive_starts_stopped_board() -> None:
    client = FakeClient(config={"boardId": "board-1"})
    tracker = KeepAliveTracker(
        KeepAliveConfig(enabled=True, interval_s=10.0, board_id="board-1")
    )
    result = maybe_keep_alive(
        client, tracker, {"status": "Stopped"}, now=100.0
    )
    assert result["action"] == "start"
    assert result["ok"] is True
    assert client.puts
    assert tracker.last_start_at == 100.0


def test_maybe_keep_alive_skips_running_and_respects_interval() -> None:
    client = FakeClient()
    tracker = KeepAliveTracker(KeepAliveConfig(interval_s=10.0))
    skip = maybe_keep_alive(
        client, tracker, {"status": "Throw"}, now=50.0
    )
    assert skip["reason"] == "already_running"
    assert client.puts == []
    again = maybe_keep_alive(
        client, tracker, {"status": "Stopped"}, now=55.0
    )
    assert again["reason"] == "not_due"
    assert client.puts == []


def test_maybe_keep_alive_refuses_other_board_id() -> None:
    client = FakeClient(config={"boardId": "other-board"})
    tracker = KeepAliveTracker(
        KeepAliveConfig(enabled=True, interval_s=10.0, board_id="board-1")
    )
    result = maybe_keep_alive(
        client, tracker, {"status": "Stopped", "boardId": "other-board"}, now=1.0
    )
    assert result["action"] == "skip"
    assert result["reason"] == "board_id_mismatch"
    assert client.puts == []


def test_maybe_keep_alive_disabled() -> None:
    client = FakeClient()
    tracker = KeepAliveTracker(KeepAliveConfig(enabled=False))
    result = maybe_keep_alive(client, tracker, {"status": "Stopped"}, now=1.0)
    assert result["reason"] == "not_due"
    assert client.puts == []


def test_tracker_first_tick_is_due() -> None:
    t = KeepAliveTracker(KeepAliveConfig(interval_s=10.0))
    assert t.due(1.0) is True
    t.mark_check(1.0)
    assert t.due(5.0) is False
    assert t.due(11.0) is True
