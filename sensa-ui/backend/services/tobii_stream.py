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

# Known Tobii calibration / configuration executables, searched in order.
# The 4C's gaze-model calibration is owned by Tobii's own software; we just
# launch whichever one is installed.
_CALIBRATION_EXE_PATHS = [
    # Tobii EyeX / Core (the 4C stack) — note the dotted filename.
    r"C:\Program Files (x86)\Tobii\Tobii EyeX Config\Tobii.EyeX.Configuration.exe",
    r"C:\Program Files (x86)\Tobii\Tobii EyeX Config\Tobii EyeX Configuration.exe",
    r"C:\Program Files (x86)\Tobii\Tobii EyeX Interaction\Tobii.EyeX.Interaction.exe",
    r"C:\Program Files\Tobii\Tobii Eye Tracking\TobiiExperience.exe",
    r"C:\Program Files (x86)\Tobii\Tobii Eye Tracking\TobiiExperience.exe",
]

# Root folders to scan recursively when the exact paths above miss. Covers the
# various Tobii stacks (EyeX/Core for the 4C, Tobii Experience, TobiiGaming).
_TOBII_SCAN_ROOTS = [
    r"C:\Program Files\Tobii",
    r"C:\Program Files (x86)\Tobii",
    r"C:\Program Files\TobiiGaming",
    r"C:\Program Files (x86)\TobiiGaming",
]

# Executable name fragments that launch a calibration / config UI, most
# preferred first.
_CALIBRATION_EXE_NAME_HINTS = [
    "configuration",
    "tobiiexperience",
    "eyex interaction",
    "guestcalibration",
    "calibrat",
    "settings",
    "eye tracking",
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


# ---------------------------------------------------------------------------
# Live stream (positioning + validation)
# ---------------------------------------------------------------------------

class LiveStream:
    """
    Runs the 32-bit bridge in a given mode ("position" or "stream") and keeps a
    thread-safe rolling buffer of the most recent parsed samples. Used by the
    positioning WebSocket (distance) and the validation flow (accuracy).
    """

    def __init__(self, mode: str, maxlen: int = 600) -> None:
        self._mode = mode
        self._maxlen = maxlen
        self._proc: Optional[subprocess.Popen] = None
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()
        self._samples: list[dict] = []
        self._running = False

    @property
    def is_running(self) -> bool:
        return self._running

    def start(self) -> None:
        if self._running:
            return
        if not _bridge_available():
            raise RuntimeError(
                "Tobii bridge not available — check 32-bit PowerShell, the "
                "bridge script, and the Stream Engine DLL"
            )

        dll = _find_dll()
        with self._lock:
            self._samples = []

        self._proc = subprocess.Popen(
            [
                _PS32,
                "-NoProfile",
                "-ExecutionPolicy", "Bypass",
                "-File", str(_BRIDGE_SCRIPT),
                "-Mode", self._mode,
                "-DllPath", dll,
            ],
            stdout=subprocess.PIPE,
            stdin=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )

        # Wait for readiness signal
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

        self._running = True
        self._thread = threading.Thread(target=self._reader, daemon=True)
        self._thread.start()
        logger.info("LiveStream started (mode=%s)", self._mode)

    def stop(self) -> None:
        if not self._running:
            return
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
        self._running = False
        logger.info("LiveStream stopped (mode=%s)", self._mode)

    def latest(self) -> Optional[dict]:
        with self._lock:
            return self._samples[-1] if self._samples else None

    def collect(self, window_s: float) -> list[dict]:
        """Block for window_s, then return samples captured during that window."""
        with self._lock:
            start_idx = len(self._samples)
        time.sleep(window_s)
        with self._lock:
            return list(self._samples[start_idx:])

    def _reader(self) -> None:
        try:
            for line in self._proc.stdout:
                line = line.strip()
                if not line:
                    continue
                try:
                    sample = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if "status" in sample:
                    continue
                with self._lock:
                    self._samples.append(sample)
                    if len(self._samples) > self._maxlen:
                        self._samples = self._samples[-self._maxlen:]
        except (ValueError, OSError):
            pass


def _find_calibration_exe() -> Optional[str]:
    """Locate Tobii's calibration/config executable.

    Order: TOBII_CALIBRATION_EXE env override -> known exact paths ->
    recursive scan of the Tobii install roots, ranked by name hint.
    """
    override = os.environ.get("TOBII_CALIBRATION_EXE")
    if override and os.path.isfile(override):
        return override

    for exe in _CALIBRATION_EXE_PATHS:
        if os.path.isfile(exe):
            return exe

    # Recursive scan, ranked by how well the filename matches a hint.
    best: Optional[str] = None
    best_rank = len(_CALIBRATION_EXE_NAME_HINTS)
    for root in _TOBII_SCAN_ROOTS:
        if not os.path.isdir(root):
            continue
        for dirpath, _dirs, files in os.walk(root):
            for fname in files:
                if not fname.lower().endswith(".exe"):
                    continue
                lower = fname.lower()
                for rank, hint in enumerate(_CALIBRATION_EXE_NAME_HINTS):
                    if hint in lower and rank < best_rank:
                        best = os.path.join(dirpath, fname)
                        best_rank = rank
                        break
    return best


def launch_tobii_calibration() -> bool:
    """Launch Tobii's own calibration/config app. Returns True if one was found
    and launched, False otherwise (caller should then guide the user to the
    Tobii tray icon)."""
    exe = _find_calibration_exe()
    if exe:
        try:
            subprocess.Popen([exe])
            logger.info("Launched Tobii calibration: %s", exe)
            return True
        except OSError as exc:
            logger.warning("Failed to launch %s: %s", exe, exc)
    logger.warning("No Tobii calibration executable found")
    return False


# Module-level singletons
recorder = GazeRecorder()
position_stream = LiveStream("position")
gaze_stream = LiveStream("stream")
