"""
Tobii Stream Engine — 32-bit bridge for consumer eye trackers (4C / 5).

The Tobii 4C ships only a 32-bit tobii_stream_engine.dll but the Python
backend runs as a 64-bit process.  This module launches a lightweight
32-bit PowerShell subprocess that loads the DLL via P/Invoke and streams
gaze data back over stdout as JSON lines.

No extra pip dependencies are required.
"""

import json
import logging
import os
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

_PS32 = r"C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
_BRIDGE_SCRIPT = Path(__file__).with_name("tobii_bridge.ps1")

_DLL_SEARCH_PATHS = [
    r"C:\Program Files (x86)\Tobii\Tobii EyeX\tobii_stream_engine.dll",
    r"C:\Program Files (x86)\Tobii\Tobii EyeX Config\tobii_stream_engine.dll",
    r"C:\Program Files\Tobii\Tobii EyeX\tobii_stream_engine.dll",
    r"C:\Program Files (x86)\Tobii\Troubleshooter\tobii_stream_engine.dll",
]


def _find_dll() -> Optional[str]:
    for p in _DLL_SEARCH_PATHS:
        if os.path.isfile(p):
            return p
    return None


def _bridge_available() -> bool:
    return os.path.isfile(_PS32) and _BRIDGE_SCRIPT.is_file() and _find_dll() is not None


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass
class TrackerInfo:
    url: str
    serial_number: str
    model: str
    generation: str
    firmware_version: str


# ---------------------------------------------------------------------------
# Device detection
# ---------------------------------------------------------------------------

def find_tracker() -> Optional[TrackerInfo]:
    """Discover the first connected Tobii consumer eye tracker via the
    32-bit bridge subprocess."""
    if not _bridge_available():
        logger.warning("Tobii bridge not available (missing 32-bit PS, script, or DLL)")
        return None

    dll = _find_dll()
    try:
        result = subprocess.run(
            [
                _PS32,
                "-NoProfile",
                "-ExecutionPolicy", "Bypass",
                "-File", str(_BRIDGE_SCRIPT),
                "-Mode", "detect",
                "-DllPath", dll,
            ],
            capture_output=True,
            text=True,
            timeout=15,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError) as exc:
        logger.warning("Bridge detect failed: %s", exc)
        return None

    stdout = result.stdout.strip()
    if not stdout:
        logger.warning("Bridge detect returned no output (stderr: %s)", result.stderr.strip())
        return None

    try:
        data = json.loads(stdout)
    except json.JSONDecodeError:
        logger.warning("Bridge detect returned invalid JSON: %s", stdout[:200])
        return None

    if not data.get("connected"):
        return None

    return TrackerInfo(
        url=data.get("url", ""),
        serial_number=data.get("serial_number", ""),
        model=data.get("model", "Tobii Eye Tracker"),
        generation=data.get("generation", ""),
        firmware_version=data.get("firmware_version", ""),
    )


# ---------------------------------------------------------------------------
# Recording manager
# ---------------------------------------------------------------------------

class GazeRecorder:
    """
    Manages a live gaze-data recording session.

    start() launches the 32-bit bridge in stream mode.
    stop()  terminates it and saves collected samples to a JSON file.
    """

    def __init__(self) -> None:
        self._proc: Optional[subprocess.Popen] = None
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()
        self._samples: list[dict] = []
        self._recording = False
        self._stimulus_id: int = 0

    @property
    def is_recording(self) -> bool:
        return self._recording

    @property
    def sample_count(self) -> int:
        return len(self._samples)

    def start(self, stimulus_id: int = 1) -> None:
        if self._recording:
            raise RuntimeError("A recording is already in progress")

        if not _bridge_available():
            raise RuntimeError(
                "Tobii bridge not available — check that 32-bit PowerShell, "
                "the bridge script, and the Stream Engine DLL are present"
            )

        dll = _find_dll()
        self._samples = []
        self._stimulus_id = stimulus_id

        self._proc = subprocess.Popen(
            [
                _PS32,
                "-NoProfile",
                "-ExecutionPolicy", "Bypass",
                "-File", str(_BRIDGE_SCRIPT),
                "-Mode", "stream",
                "-DllPath", dll,
                "-StimulusId", str(stimulus_id),
            ],
            stdout=subprocess.PIPE,
            stdin=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )

        # Wait for the readiness signal
        first_line = self._proc.stdout.readline().strip()
        if not first_line:
            stderr_out = self._proc.stderr.read()
            self._proc.kill()
            raise RuntimeError(f"Bridge failed to start: {stderr_out}")

        try:
            status = json.loads(first_line)
            if status.get("status") != "streaming":
                raise RuntimeError(f"Unexpected bridge status: {first_line}")
        except json.JSONDecodeError:
            raise RuntimeError(f"Bridge returned invalid JSON: {first_line}")

        self._recording = True
        self._thread = threading.Thread(target=self._reader, daemon=True)
        self._thread.start()
        logger.info("Recording started (stimulus_id=%d)", stimulus_id)

    def stop(self, output_dir: Path) -> tuple[Path, int]:
        if not self._recording:
            raise RuntimeError("No recording in progress")

        # Kill the bridge process (it runs an infinite loop)
        try:
            self._proc.kill()
        except OSError:
            pass

        try:
            self._proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass

        if self._thread:
            self._thread.join(timeout=3)

        self._recording = False

        output_dir.mkdir(parents=True, exist_ok=True)
        ts = time.strftime("%Y%m%d-%H%M%S")
        filepath = output_dir / f"recording_{ts}.json"
        count = len(self._samples)
        filepath.write_text(json.dumps(self._samples, indent=2), encoding="utf-8")

        logger.info("Recording stopped — %d samples saved to %s", count, filepath)
        self._samples = []
        return filepath, count

    def _reader(self) -> None:
        """Background thread that reads gaze samples from the bridge stdout."""
        try:
            for line in self._proc.stdout:
                line = line.strip()
                if not line:
                    continue
                try:
                    sample = json.loads(line)
                    if "device_time_stamp" in sample:
                        self._samples.append(sample)
                except json.JSONDecodeError:
                    continue
        except (ValueError, OSError):
            pass


# Module-level singleton
recorder = GazeRecorder()
