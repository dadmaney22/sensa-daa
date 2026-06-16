"""
biosignalsplux endpoints: the live signal WebSocket and baseline-recording
controls that the EDA / ECG / EEG calibration flows call.

The hub is a single shared acquisition session (see services/plux_stream.py),
so one WebSocket stream feeds all three flows — each reads its own
`{eda,ecg,eeg}_raw` field from the same frame.
"""

import asyncio
import logging
from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException

from services.plux_stream import plux_manager

logger = logging.getLogger(__name__)
router = APIRouter()

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


@router.get("/api/plux/status")
async def plux_status():
    """Report whether the PLUX API loaded, which device was found, and the
    detected channel map. Useful for debugging hardware setup."""
    return plux_manager.status()


@router.websocket("/ws/stream")
async def stream_ws(websocket: WebSocket):
    """Stream live hub frames as JSON (~25 Hz to the UI). Frames contain
    whichever of `eda_raw` / `ecg_raw` / `eeg_raw` are present."""
    await websocket.accept()

    # Let the client know we're alive before the (potentially slow) Bluetooth
    # scan/connect runs, so the UI never sits blank with no feedback.
    try:
        await websocket.send_json({"status": "connecting"})
    except Exception:
        return

    try:
        await asyncio.to_thread(plux_manager.start)
    except Exception as exc:
        logger.warning("Could not start PLUX acquisition: %s", exc)
        try:
            await websocket.send_json({"status": "error", "error": str(exc)})
            await asyncio.sleep(0.2)  # give the client a moment to read it
        except Exception:
            pass
        await websocket.close()
        return

    try:
        await websocket.send_json({"status": "streaming"})
        while True:
            sample = plux_manager.latest()
            if sample is not None:
                await websocket.send_json(sample)
            await asyncio.sleep(0.04)
    except WebSocketDisconnect:
        # Keep the hub running if a recording is in progress; otherwise free it.
        if not plux_manager.is_recording:
            await asyncio.to_thread(plux_manager.stop)


@router.post("/api/record/start")
async def record_start():
    try:
        await asyncio.to_thread(plux_manager.start)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    plux_manager.start_recording()
    return {"status": "recording"}


@router.post("/api/record/stop")
async def record_stop():
    count = plux_manager.stop_recording()
    return {"status": "stopped", "sample_count": count}


@router.post("/api/record/save")
async def record_save():
    info = plux_manager.save(DATA_DIR)
    return {"status": "saved", **info}
