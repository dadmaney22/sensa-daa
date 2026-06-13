"""
Tobii Pro SDK backend — research-grade trackers (Spark, Nano, Fusion, ...).

This is an OPTIONAL, additive backend. It is only used when the consumer
Stream Engine bridge (services/tobii_stream.py) is unavailable AND a Pro device
is detected via `tobii_research`. The 4C / Stream Engine path is unaffected.

It exposes the same surface the validation/positioning flow already expects from
`tobii_stream.LiveStream`:
  - start(), stop(), latest(), collect(window_s), is_running
and emits samples in the SAME dict shapes:
  - "stream"  (gaze):     left/right_gaze_point_validity + left/right_gaze_point_on_display_area
  - "position" (distance): left/right_valid + left/right_xyz (mm)

`tobii_research` is not installable on every Python version, so the import is
guarded; if it's missing, pro_sdk_available() returns False and nothing here is
used.
"""

import logging
import threading
import time
from typing import Optional

from services.tobii_stream import TrackerInfo

logger = logging.getLogger(__name__)

try:
    import tobii_research as tr  # type: ignore
    _TR_IMPORTED = True
except Exception:  # ImportError or any load failure
    tr = None  # type: ignore
    _TR_IMPORTED = False


def pro_sdk_available() -> bool:
    """True if the Tobii Pro SDK (`tobii_research`) is importable."""
    return _TR_IMPORTED


def find_pro_tracker() -> Optional[TrackerInfo]:
    """Discover the first Tobii Pro device via the Pro SDK. Returns None if the
    SDK isn't installed or no device is connected."""
    if not _TR_IMPORTED:
        return None
    try:
        found = tr.find_all_eyetrackers()
    except Exception as exc:
        logger.warning("Pro SDK find_all_eyetrackers failed: %s", exc)
        return None
    if not found:
        return None
    et = found[0]
    return TrackerInfo(
        url=getattr(et, "address", "") or "",
        serial_number=getattr(et, "serial_number", "") or "",
        model=getattr(et, "model", "") or "Tobii Eye Tracker",
        generation=getattr(et, "device_name", "") or "",
        firmware_version=getattr(et, "firmware_version", "") or "",
    )


class ProSdkStream:
    """Pro SDK equivalent of tobii_stream.LiveStream.

    Subscribes to the Pro SDK gaze-data callback (which carries BOTH gaze points
    and gaze origin) and reshapes each sample to match the Stream Engine bridge's
    JSON, so the rest of the app doesn't need to know which backend is active.
    """

    def __init__(self, mode: str, maxlen: int = 2000) -> None:
        self._mode = mode  # "position" or "stream"
        self._maxlen = maxlen
        self._lock = threading.Lock()
        self._samples: list[dict] = []
        self._total_appended = 0  # monotonic; survives buffer trimming
        self._running = False
        self._tracker = None  # tobii_research eyetracker handle

    @property
    def is_running(self) -> bool:
        return self._running

    def start(self) -> None:
        if self._running:
            return
        if not _TR_IMPORTED:
            raise RuntimeError("Tobii Pro SDK (tobii_research) is not installed")
        found = tr.find_all_eyetrackers()
        if not found:
            raise RuntimeError("No Tobii Pro device found")
        self._tracker = found[0]
        with self._lock:
            self._samples = []
            self._total_appended = 0
        self._tracker.subscribe_to(
            tr.EYETRACKER_GAZE_DATA, self._on_gaze_data, as_dictionary=True
        )
        self._running = True
        logger.info("ProSdkStream started (mode=%s)", self._mode)

    def stop(self) -> None:
        if not self._running:
            return
        try:
            self._tracker.unsubscribe_from(tr.EYETRACKER_GAZE_DATA, self._on_gaze_data)
        except Exception as exc:
            logger.warning("ProSdkStream unsubscribe failed: %s", exc)
        self._running = False
        logger.info("ProSdkStream stopped (mode=%s)", self._mode)

    def latest(self) -> Optional[dict]:
        with self._lock:
            return self._samples[-1] if self._samples else None

    def collect(self, window_s: float) -> list[dict]:
        """Block window_s, then return samples captured during that window.
        Mirrors LiveStream.collect() exactly (monotonic counter)."""
        with self._lock:
            start_count = self._total_appended
        time.sleep(window_s)
        with self._lock:
            n = self._total_appended - start_count
            if n <= 0:
                return []
            return list(self._samples[-n:]) if n <= len(self._samples) else list(self._samples)

    def _on_gaze_data(self, gaze_data: dict) -> None:
        """Pro SDK callback (runs on the SDK's own thread). Reshape into the
        Stream Engine bridge's sample dicts so downstream code is identical."""
        try:
            if self._mode == "position":
                lo = gaze_data.get("left_gaze_origin_in_user_coordinate_system")
                ro = gaze_data.get("right_gaze_origin_in_user_coordinate_system")
                sample = {
                    "left_valid": bool(gaze_data.get("left_gaze_origin_validity")),
                    "right_valid": bool(gaze_data.get("right_gaze_origin_validity")),
                    "left_xyz": list(lo) if lo is not None else [0.0, 0.0, 0.0],
                    "right_xyz": list(ro) if ro is not None else [0.0, 0.0, 0.0],
                }
            else:  # "stream" — gaze points on the display
                lp = gaze_data.get("left_gaze_point_on_display_area")
                rp = gaze_data.get("right_gaze_point_on_display_area")
                sample = {
                    "left_gaze_point_validity": bool(gaze_data.get("left_gaze_point_validity")),
                    "right_gaze_point_validity": bool(gaze_data.get("right_gaze_point_validity")),
                    "left_gaze_point_on_display_area": list(lp) if lp is not None else None,
                    "right_gaze_point_on_display_area": list(rp) if rp is not None else None,
                }
        except Exception:
            return
        with self._lock:
            self._samples.append(sample)
            self._total_appended += 1
            if len(self._samples) > self._maxlen:
                self._samples = self._samples[-self._maxlen:]
