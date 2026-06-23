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
from fastapi.responses import FileResponse

from services import plux_stream
from services.plux_stream import plux_manager

logger = logging.getLogger(__name__)
router = APIRouter()

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


@router.get("/api/plux/status")
async def plux_status():
    """Report whether the PLUX API loaded, which device was found, and the
    detected channel map. Useful for debugging hardware setup."""
    return plux_manager.status()


@router.get("/api/plux/detect")
async def plux_detect():
    """Ensure the hub is connected (idempotent) and report the live channel /
    sensor map. Used by the Step 2 setup screen to show which channel each
    sensor is on as the user plugs things in. Errors are returned in-band so
    the UI can show "not detected yet" instead of failing the request."""
    try:
        await asyncio.to_thread(plux_manager.start)
    except Exception as exc:  # noqa: BLE001
        return {**plux_manager.status(), "error": str(exc)}
    return plux_manager.status()


@router.get("/api/plux/scan")
async def plux_scan():
    """Run a Bluetooth scan and report every PLUX device found, without
    connecting. Lets you confirm the hub is visible (and its address) in
    isolation from streaming. Ensure OpenSignals is closed first."""
    if not plux_stream.plux_available:
        return {"plux_available": False, "devices": [], "error": plux_stream._plux_import_error}

    def _scan():
        try:
            found = plux_stream.plux.BaseDev.findDevices()
            return [
                (entry[0] if isinstance(entry, (tuple, list)) else str(entry))
                for entry in (found or [])
            ], None
        except Exception as exc:  # noqa: BLE001
            return [], str(exc)

    devices, error = await asyncio.to_thread(_scan)
    return {"plux_available": True, "devices": devices, "error": error}


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
    result = plux_manager.stop_recording()
    return {"status": "stopped", **result}


@router.post("/api/record/save")
async def record_save():
    info = plux_manager.save(DATA_DIR)
    return {"status": "saved", **info}


@router.get("/api/record/download")
async def record_download():
    """Return the most recently saved recording HDF5 as a file download."""
    path = plux_manager.last_save_path
    if not path or not Path(path).exists():
        raise HTTPException(status_code=404, detail="No recording saved yet — call /api/record/save first.")
    return FileResponse(
        path,
        media_type="application/x-hdf5",
        headers={"Content-Disposition": f"attachment; filename={Path(path).name}"},
    )


@router.get("/api/record/download/opensignals")
async def record_download_opensignals():
    """Return the OpenSignals-format copy of the most recent recording."""
    path = plux_manager.last_opensignals_path
    if not path or not Path(path).exists():
        raise HTTPException(status_code=404, detail="No OpenSignals-format recording available — call /api/record/save first.")
    return FileResponse(
        path,
        media_type="application/x-hdf5",
        headers={"Content-Disposition": f"attachment; filename={Path(path).name}"},
    )
