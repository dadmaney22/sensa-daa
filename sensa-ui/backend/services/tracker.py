"""
Tracker facade — picks the right eye-tracker backend at runtime.

Two backends:
  - Stream Engine (services/tobii_stream.py) — consumer devices (Tobii 4C / 5).
  - Pro SDK       (services/pro_sdk_tracker.py) — research devices (Spark, ...).

Selection rule (deliberately conservative): the Stream Engine path is used
whenever its 32-bit bridge is available — i.e. the existing 4C setup behaves
EXACTLY as before. The Pro SDK backend only engages when the bridge is NOT
available and a Pro device is detected. So adding Spark support cannot change
how the 4C currently works.

This module re-exposes the same names calibration.py already imported from
tobii_stream (find_tracker, launch_tobii_calibration, position_stream,
gaze_stream, _bridge_available), so the router code is unchanged apart from the
import path.
"""

import logging
from typing import Optional

from services import tobii_stream as se
from services.tobii_stream import TrackerInfo, launch_tobii_calibration  # re-export

try:
    from services import pro_sdk_tracker as pro
    _PRO_MODULE = True
except Exception:  # module import should never hard-fail, but be safe
    pro = None  # type: ignore
    _PRO_MODULE = False

logger = logging.getLogger(__name__)


def _pro_device_present() -> bool:
    """True only if the Pro SDK is importable and a Pro device is connected."""
    if not _PRO_MODULE or not pro.pro_sdk_available():
        return False
    try:
        return pro.find_pro_tracker() is not None
    except Exception:
        return False


def _bridge_available() -> bool:
    """Any usable tracker backend? Stream Engine bridge takes priority (current
    4C behavior); otherwise a connected Pro device counts."""
    if se._bridge_available():
        return True
    return _pro_device_present()


def active_backend() -> str:
    """Which backend would be used right now: 'stream_engine', 'pro_sdk', or
    'none'. Stream Engine wins whenever its bridge is present."""
    if se._bridge_available():
        return "stream_engine"
    if _pro_device_present():
        return "pro_sdk"
    return "none"


def find_tracker() -> Optional[TrackerInfo]:
    """Discover a tracker. Stream Engine first (unchanged 4C path), then Pro SDK."""
    if se._bridge_available():
        info = se.find_tracker()
        if info is not None:
            return info
    if _PRO_MODULE and pro.pro_sdk_available():
        return pro.find_pro_tracker()
    return None


class _SelectingStream:
    """Delegates to the Stream Engine LiveStream when the bridge is available
    (current behavior), otherwise to a Pro SDK stream. The chosen backend is
    fixed at start() and reused for the session."""

    def __init__(self, mode: str) -> None:
        self._mode = mode
        # The existing Stream Engine singletons are reused as-is.
        self._se = se.position_stream if mode == "position" else se.gaze_stream
        self._pro = None
        self._active = None

    def start(self) -> None:
        if se._bridge_available():
            self._active = self._se
        elif _pro_device_present():
            if self._pro is None:
                self._pro = pro.ProSdkStream(self._mode)
            self._active = self._pro
        else:
            # No backend — fall through to the Stream Engine, which raises its
            # usual descriptive "bridge not available" error.
            self._active = self._se
        self._active.start()

    def stop(self) -> None:
        (self._active or self._se).stop()

    def latest(self):
        return (self._active or self._se).latest()

    def collect(self, window_s: float):
        return (self._active or self._se).collect(window_s)

    @property
    def is_running(self) -> bool:
        return (self._active or self._se).is_running


# Module-level singletons mirroring tobii_stream's, but backend-aware.
position_stream = _SelectingStream("position")
gaze_stream = _SelectingStream("stream")
