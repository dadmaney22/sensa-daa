"""
biosignalsplux acquisition service.

Owns a single connection to the biosignalsplux hub via PLUX's `plux` Python
API (a version-specific compiled extension, `plux.pyd` on Windows). One hub is
a single Bluetooth session that reads all active analog ports at once, so this
module runs ONE shared acquisition and multiplexes the channels (EDA / ECG /
EEG) to every calibration flow that connects.

Design mirrors `services/tobii_stream.py`: a background acquisition thread, a
thread-safe latest-sample + rolling buffer, and a recorder that can dump a CSV.

The `plux` module is NOT on PyPI and is NOT importable from OpenSignals — it is
a separate download whose build must match the backend's exact Python version /
architecture. Drop `plux.pyd` next to the backend (or point `SENSA_PLUX_PATH`
at its folder). If it can't be imported the server still runs; the EDA/ECG/EEG
flows just report that the bridge is unavailable.
"""

import logging
import os
import sys
import threading
import time
import json
from collections import deque
from datetime import datetime
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SAMPLING_RATE = 1000          # Hz
RESOLUTION_BITS = 16          # 8 or 16
ROLLING_BUFFER_SECONDS = 10

# Optional MAC override; otherwise the first PLUX device found is used.
CONFIGURED_MAC = os.environ.get("SENSA_PLUX_MAC", "").strip()

# Default analog ports per sensor, used when class-based auto-detection can't
# resolve a channel. Only EDA's channel is known today (channel 5); ECG/EEG
# defaults are placeholders and overridable via env.
DEFAULT_CHANNELS = {
    "eda": int(os.environ.get("SENSA_EDA_CHANNEL", "5")),
    "ecg": int(os.environ.get("SENSA_ECG_CHANNEL", "2")),
    "eeg": int(os.environ.get("SENSA_EEG_CHANNEL", "1")),
}

# Maps PLUX sensor class codes (sensor.clas) -> our sensor keys. These codes
# vary by sensor revision, so every discovered (port, clas) is logged and the
# map can be tuned. Anything unresolved falls back to DEFAULT_CHANNELS.
SENSOR_CLASS_MAP = {
    # clas_code: "eda" | "ecg" | "eeg"
}

# ---------------------------------------------------------------------------
# Signal-specific baseline-stability thresholds (16-bit ADC, 0–65535)
# Literature sources:
#   EDA — Benedek & Kaernbach (2010); Boucsein (2012)
#   ECG — Berntson et al. (1997), Psychophysiology guidelines
#   EEG — Picton et al. (2000), IFCN guidelines
# ---------------------------------------------------------------------------

# EDA: slow DC signal — CV is valid; drift and spike checks use absolute ADC units.
EDA_MAX_CV    = 0.05    # 5% CV — real SCL varies more than the old 1.5% limit
EDA_MAX_DRIFT = 1500    # ADC units drift first→last quarter (≈2.3% of 65535)
EDA_MAX_SPIKE = 3000    # ADC units max-min within any 1s window (movement artifact)

# ECG: AC cardiac signal — CV is meaningless (near-zero mean).
ECG_MIN_RANGE        = 500   # ADC units peak-to-peak over full recording (heartbeats visible)
ECG_CONSISTENCY_FRAC = 0.40  # each 1/4-window range must be ≥ 40% of median (no dropout)
ECG_CLIP_MAX         = 65000 # rail saturation ceiling
ECG_CLIP_MIN         = 100   # rail saturation floor

# EEG: AC brain signal — CV is meaningless (near-zero mean).
EEG_MIN_RMS     = 50   # ADC units — overall RMS must exceed noise floor
EEG_MAX_RMS_CV  = 3.0  # no per-5s-window RMS may be >3× the median (burst artifact)
EEG_FLATLINE_STD = 10  # ADC units — any 2s window below this = electrode disconnected

# ---------------------------------------------------------------------------
# plux.pyd location + import
# ---------------------------------------------------------------------------

_BACKEND_DIR = Path(__file__).resolve().parent.parent

_PLUX_SEARCH_DIRS = [
    os.environ.get("SENSA_PLUX_PATH", ""),
    str(_BACKEND_DIR),
    str(_BACKEND_DIR / "plux"),
    r"C:\Program Files\PLUX\PythonAPI",
    r"C:\Program Files (x86)\PLUX\PythonAPI",
    str(Path.home() / "Downloads"),
]

plux = None              # the imported module, or None
plux_available = False
_plux_import_error = ""


def _load_plux() -> None:
    """Find a directory containing plux.pyd (or plux.so), add it to sys.path,
    and import it. Safe to call once at module import."""
    global plux, plux_available, _plux_import_error

    for d in _PLUX_SEARCH_DIRS:
        if not d:
            continue
        if not os.path.isdir(d):
            continue
        has_module = any(
            os.path.isfile(os.path.join(d, name))
            for name in ("plux.pyd", "plux.so")
        )
        if has_module and d not in sys.path:
            sys.path.insert(0, d)

    try:
        import plux as _plux  # type: ignore
        plux = _plux
        plux_available = True
        logger.info("PLUX API loaded (%s)", getattr(_plux, "__file__", "?"))
    except Exception as exc:  # ImportError, or a load error from arch mismatch
        plux_available = False
        _plux_import_error = str(exc)
        logger.warning(
            "PLUX API not available (%s). Place plux.pyd matching this Python "
            "version next to the backend or set SENSA_PLUX_PATH.", exc
        )


_load_plux()


# ---------------------------------------------------------------------------
# Device discovery
# ---------------------------------------------------------------------------

def scan_device() -> Optional[str]:
    """Return the address of a PLUX device to connect to.

    If SENSA_PLUX_MAC is set, prefer a matching device. Otherwise return the
    first PLUX device found by `plux.BaseDev.findDevices()`. Returns None if no
    device is found or the API is unavailable.
    """
    if not plux_available:
        return None
    try:
        found = plux.BaseDev.findDevices()  # tuple of (address, description)
    except Exception as exc:
        logger.warning("PLUX findDevices() failed: %s", exc)
        return None

    addrs = []
    for entry in found or []:
        addr = entry[0] if isinstance(entry, (tuple, list)) else str(entry)
        addrs.append(addr)

    if not addrs:
        logger.warning("No PLUX devices found in scan")
        return None

    if CONFIGURED_MAC:
        for addr in addrs:
            if CONFIGURED_MAC.lower() in addr.lower():
                return addr
        logger.warning(
            "Configured MAC %s not among found devices %s; using first",
            CONFIGURED_MAC, addrs,
        )
    logger.info("PLUX devices found: %s (using %s)", addrs, addrs[0])
    return addrs[0]


# ---------------------------------------------------------------------------
# Acquisition
# ---------------------------------------------------------------------------

def _build_acquisition_class():
    """Build the plux.SignalsDev subclass lazily (only valid once plux is
    importable, since it must subclass plux.SignalsDev)."""

    class PluxAcquisition(plux.SignalsDev):  # type: ignore[name-defined]
        """Receives raw frames from the hub via onRawFrame and hands them to
        the owning manager."""

        def __init__(self, address):
            # PLUX's Boost.Python binding requires calling the *base* MemoryDev
            # constructor with just the address (no self) — this is the exact
            # incantation from PLUX's own OneDeviceAcquisitionExample.
            plux.MemoryDev.__init__(address)
            self.manager: Optional["PluxManager"] = None

        def onRawFrame(self, nSeq, data):  # noqa: N802 (PLUX API name)
            mgr = self.manager
            if mgr is not None:
                mgr._on_frame(nSeq, data)
            # Returning True stops loop(); manager flips _should_stop to end it.
            return bool(mgr and mgr._should_stop)

    return PluxAcquisition


# ---------------------------------------------------------------------------
# Signal-specific baseline quality functions
# All return: {"stable": bool|None, "reason": str, ...diagnostic fields}
# ---------------------------------------------------------------------------

def _rms(vals: list[float]) -> float:
    import math
    if not vals:
        return 0.0
    return math.sqrt(sum(v * v for v in vals) / len(vals))


def _std(vals: list[float]) -> float:
    import math
    if len(vals) < 2:
        return 0.0
    mean = sum(vals) / len(vals)
    return math.sqrt(sum((v - mean) ** 2 for v in vals) / len(vals))


def _median(vals: list[float]) -> float:
    s = sorted(vals)
    n = len(s)
    return (s[n // 2] + s[(n - 1) // 2]) / 2 if n else 0.0


def _baseline_eda(vals: list[float]) -> dict:
    """EDA is a slow DC signal — CV, drift, and spike checks are all valid.
    Ref: Benedek & Kaernbach (2010); Boucsein (2012)."""
    import math
    if len(vals) < 50:
        return {"stable": None, "reason": "too few samples"}
    n = len(vals)
    mean = sum(vals) / n
    if mean == 0:
        return {"stable": None, "reason": "zero-mean signal"}

    std = _std(vals)
    cv = std / abs(mean)

    q = max(n // 4, 1)
    drift = abs(sum(vals[-q:]) / q - sum(vals[:q]) / q)

    # Spike check: any 1s window (SAMPLING_RATE samples) with large range
    spike = False
    win = SAMPLING_RATE
    for i in range(0, n - win, win):
        if max(vals[i:i + win]) - min(vals[i:i + win]) > EDA_MAX_SPIKE:
            spike = True
            break

    reasons = []
    if cv > EDA_MAX_CV:
        reasons.append("excessive noise")
    if drift > EDA_MAX_DRIFT:
        reasons.append("signal drift")
    if spike:
        reasons.append("movement artifact")

    return {
        "stable": len(reasons) == 0,
        "cv": round(cv, 5),
        "drift": round(drift, 1),
        "reason": ", ".join(reasons) if reasons else "stable",
    }


def _baseline_ecg(vals: list[float]) -> dict:
    """ECG is an AC cardiac signal — CV is meaningless (near-zero mean).
    Checks: overall range (heartbeats visible), per-quarter range consistency
    (no electrode dropout), and rail clipping.
    Ref: Berntson et al. (1997), Psychophysiology guidelines."""
    if len(vals) < 50:
        return {"stable": None, "reason": "too few samples"}
    n = len(vals)
    overall_range = max(vals) - min(vals)

    # Per-quarter ranges
    q = max(n // 4, 1)
    quarter_ranges = [
        max(vals[i * q:(i + 1) * q]) - min(vals[i * q:(i + 1) * q])
        for i in range(4)
    ]
    med_range = _median(quarter_ranges)
    consistent = all(r >= ECG_CONSISTENCY_FRAC * med_range for r in quarter_ranges)
    clipped = max(vals) >= ECG_CLIP_MAX or min(vals) <= ECG_CLIP_MIN

    reasons = []
    if overall_range < ECG_MIN_RANGE:
        reasons.append("signal too weak (check electrode contact)")
    if not consistent:
        reasons.append("intermittent signal loss")
    if clipped:
        reasons.append("signal clipping")

    return {
        "stable": len(reasons) == 0,
        "range": round(overall_range, 1),
        "reason": ", ".join(reasons) if reasons else "stable",
    }


def _baseline_eeg(vals: list[float]) -> dict:
    """EEG is an AC brain signal — CV is meaningless (near-zero mean).
    Checks: overall RMS above noise floor, per-5s-window RMS consistency
    (burst artifact), and flatline detection (electrode disconnected).
    Ref: Picton et al. (2000), IFCN guidelines."""
    if len(vals) < 50:
        return {"stable": None, "reason": "too few samples"}
    n = len(vals)
    overall_rms = _rms(vals)

    # Per-5s-window RMS
    win5 = SAMPLING_RATE * 5
    window_rmses = [
        _rms(vals[i:i + win5])
        for i in range(0, n - win5, win5)
    ] or [overall_rms]
    med_rms = _median(window_rmses)
    burst = any(r > EEG_MAX_RMS_CV * med_rms for r in window_rmses)

    # Flatline: any 2s window with std < threshold
    win2 = SAMPLING_RATE * 2
    flatline = any(
        _std(vals[i:i + win2]) < EEG_FLATLINE_STD
        for i in range(0, n - win2, win2)
    )

    reasons = []
    if overall_rms < EEG_MIN_RMS:
        reasons.append("signal too weak")
    if burst:
        reasons.append("burst artifact detected")
    if flatline:
        reasons.append("electrode appears disconnected (flatline)")

    return {
        "stable": len(reasons) == 0,
        "rms": round(overall_rms, 2),
        "reason": ", ".join(reasons) if reasons else "stable",
    }


class PluxManager:
    """Owns the single shared hub acquisition session."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._device = None
        self._thread: Optional[threading.Thread] = None
        self._running = False
        self._should_stop = False
        self._device_address: Optional[str] = None

        # channel_map: {"eda": port, ...}; port_order: ports passed to start(),
        # so a frame's data[i] corresponds to port_order[i].
        self._channel_map: dict[str, int] = {}
        self._port_order: list[int] = []
        # Per-port sensor info discovered via getSensors(): each entry is
        # {"port", "clas", "type", "detected"}. Drives the Step 2 live readout.
        self._sensors: list[dict] = []

        maxlen = SAMPLING_RATE * ROLLING_BUFFER_SECONDS
        self._buffer: deque = deque(maxlen=maxlen)
        self._latest: Optional[dict] = None

        self._recording = False
        self._recorded_rows: list[dict] = []
        self._last_save_path: Optional[str] = None

    # -- lifecycle ---------------------------------------------------------

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def is_recording(self) -> bool:
        return self._recording

    def start(self) -> None:
        """Scan, connect, detect channels and begin streaming. Idempotent."""
        with self._lock:
            if self._running:
                return
            if not plux_available:
                raise RuntimeError(
                    "PLUX API not available — place plux.pyd (matching this "
                    "Python version) next to the backend or set SENSA_PLUX_PATH."
                )

            address = scan_device()
            if not address:
                raise RuntimeError(
                    "No biosignalsplux device found. Ensure the hub is powered, "
                    "paired, and closed in OpenSignals (one app at a time)."
                )

            cls = _build_acquisition_class()
            device = cls(address)
            device.manager = self

            channel_map, port_order = self._detect_channels(device)
            if not port_order:
                device.close()
                raise RuntimeError("No active analog channels detected on the hub.")

            ports_bitmask = 0
            for p in port_order:
                ports_bitmask |= (1 << (p - 1))

            device.start(SAMPLING_RATE, ports_bitmask, RESOLUTION_BITS)

            self._device = device
            self._device_address = address
            self._channel_map = channel_map
            self._port_order = port_order
            self._buffer.clear()
            self._latest = None
            self._should_stop = False
            self._running = True

            self._thread = threading.Thread(target=self._loop, daemon=True)
            self._thread.start()
            logger.info(
                "PLUX acquisition started: addr=%s channel_map=%s ports=%s",
                address, channel_map, port_order,
            )

    def stop(self) -> None:
        with self._lock:
            if not self._running:
                return
            self._should_stop = True
            device = self._device

        # device.loop() will return once onRawFrame reports stop; then we
        # tear it down outside the lock.
        if self._thread:
            self._thread.join(timeout=3)
        try:
            if device is not None:
                device.stop()
                device.close()
        except Exception as exc:
            logger.warning("Error closing PLUX device: %s", exc)

        with self._lock:
            self._running = False
            self._device = None
            self._thread = None
        logger.info("PLUX acquisition stopped")

    def _loop(self) -> None:
        try:
            self._device.loop()  # blocks, calling onRawFrame per frame
        except Exception as exc:
            logger.warning("PLUX loop ended: %s", exc)

    # -- channel detection -------------------------------------------------

    def _detect_channels(self, device) -> tuple[dict[str, int], list[int]]:
        """Resolve which analog port carries each sensor.

        Uses getSensors() class codes where possible (logging every discovery
        so SENSOR_CLASS_MAP can be tuned), and falls back to DEFAULT_CHANNELS
        for any sensor type not resolved. Returns (channel_map, port_order).
        """
        channel_map: dict[str, int] = {}
        active_ports: set[int] = set()
        port_clas: dict[int, object] = {}  # port -> raw class code from getSensors()

        try:
            sensors = device.getSensors()  # {port: sensor}
        except Exception as exc:
            logger.warning("getSensors() failed (%s); using default channels", exc)
            sensors = {}

        for port, sensor in (sensors or {}).items():
            clas = getattr(sensor, "clas", None)
            logger.info("PLUX sensor on port %s: clas=%s", port, clas)
            active_ports.add(int(port))
            port_clas[int(port)] = clas
            key = SENSOR_CLASS_MAP.get(clas)
            if key and key not in channel_map:
                channel_map[key] = int(port)

        # Fallback: fill any unresolved sensor types from defaults.
        for key, default_port in DEFAULT_CHANNELS.items():
            if key not in channel_map:
                channel_map[key] = default_port
                active_ports.add(default_port)

        # Per-channel summary for the UI: which port each sensor is on, its raw
        # class code, and whether the hub actually reported a sensor there (vs a
        # configured fallback default).
        self._sensors = [
            {
                "type": key,
                "port": port,
                "clas": port_clas.get(port),
                "detected": port in port_clas,
            }
            for key, port in channel_map.items()
        ]

        port_order = sorted(active_ports)
        return channel_map, port_order

    # -- frame handling ----------------------------------------------------

    def _on_frame(self, nSeq, data) -> None:
        """Called from the acquisition thread for every raw frame."""
        frame = {"seq": int(nSeq), "timestamp": time.time()}
        for key, port in self._channel_map.items():
            try:
                idx = self._port_order.index(port)
                frame[f"{key}_raw"] = int(data[idx])
            except (ValueError, IndexError):
                frame[f"{key}_raw"] = None

        with self._lock:
            self._latest = frame
            self._buffer.append(frame)
            if self._recording:
                self._recorded_rows.append(frame)

    def latest(self) -> Optional[dict]:
        with self._lock:
            return dict(self._latest) if self._latest else None

    # -- recording ---------------------------------------------------------

    def start_recording(self) -> None:
        with self._lock:
            self._recorded_rows = []
            self._recording = True
        logger.info("PLUX recording started")

    def stop_recording(self) -> dict:
        """Stop recording and assess baseline stability over the captured rows.

        Returns {"sample_count", "quality": {<channel>: {...}}} so the UI can
        show whether the baseline is stable (and prompt a re-record if not).
        Each channel uses a signal-specific algorithm (see helpers below).
        """
        with self._lock:
            self._recording = False
            rows = list(self._recorded_rows)
            keys = list(self._channel_map.keys())

        _dispatch = {"eda": _baseline_eda, "ecg": _baseline_ecg, "eeg": _baseline_eeg}
        quality: dict[str, dict] = {}
        for key in keys:
            vals = [r.get(f"{key}_raw") for r in rows if r.get(f"{key}_raw") is not None]
            fn = _dispatch.get(key, _baseline_eda)
            quality[key] = fn(vals)

        logger.info("PLUX recording stopped (%d rows) quality=%s", len(rows), quality)
        return {"sample_count": len(rows), "quality": quality}

    def save(self, output_dir: Path) -> dict:
        """Write the recorded rows to an enriched CSV and return file info.

        Format:
          # metadata comment lines (device, sample rate, channel map, start time)
          seq,datetime_iso,elapsed_s,<SENSOR>_raw,...
          0,2026-06-16T12:01:00.123,0.000,32100,...
        """
        output_dir.mkdir(parents=True, exist_ok=True)
        ts = time.strftime("%Y%m%d_%H%M%S")
        filepath = output_dir / f"plux_recording_{ts}.csv"

        with self._lock:
            rows = list(self._recorded_rows)
            keys = list(self._channel_map.keys())
            device_address = self._device_address or "unknown"
            channel_map = dict(self._channel_map)

        t0 = rows[0]["timestamp"] if rows else 0.0
        recording_start_iso = datetime.fromtimestamp(t0).isoformat() if rows else ""

        # Metadata header lines (prefixed with # so pandas/Excel skips them easily)
        meta = [
            f"# device_address,{device_address}",
            f"# sample_rate_hz,{SAMPLING_RATE}",
            f"# channel_map,{json.dumps(channel_map)}",
            f"# recording_start,{recording_start_iso}",
        ]

        col_names = ["seq", "datetime_iso", "elapsed_s"] + [f"{k.upper()}_raw" for k in keys]
        data_lines = [",".join(col_names)]
        for r in rows:
            t = r.get("timestamp", t0)
            cells = [
                str(r.get("seq", "")),
                datetime.fromtimestamp(t).isoformat(),
                f"{t - t0:.4f}",
            ]
            for k in keys:
                v = r.get(f"{k}_raw")
                cells.append("" if v is None else str(v))
            data_lines.append(",".join(cells))

        filepath.write_text("\n".join(meta + data_lines), encoding="utf-8")
        logger.info("PLUX recording saved: %s (%d rows)", filepath, len(rows))
        self._last_save_path = str(filepath)
        return {"filename": filepath.name, "filepath": str(filepath), "rows": len(rows)}

    # -- last save ---------------------------------------------------------

    @property
    def last_save_path(self) -> Optional[str]:
        return self._last_save_path

    # -- status ------------------------------------------------------------

    def status(self) -> dict:
        with self._lock:
            return {
                "plux_available": plux_available,
                "import_error": _plux_import_error or None,
                "device_address": self._device_address,
                "channel_map": dict(self._channel_map),
                "sensors": [dict(s) for s in self._sensors],
                "running": self._running,
                "recording": self._recording,
            }


# Module-level singleton
plux_manager = PluxManager()
