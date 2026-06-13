import asyncio
import logging
import math
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException
from pydantic import BaseModel

from services.tobii_stream import (
    find_tracker,
    launch_tobii_calibration,
    position_stream,
    gaze_stream,
    _bridge_available,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/calibration")

# Optimal head distance window (mm from tracker) for the 4C.
OPTIMAL_MIN_MM = 550.0
OPTIMAL_MAX_MM = 700.0

# Physical screen width (mm), used to convert normalized gaze error to degrees
# of visual angle during validation. Adjust to match the study monitor.
SCREEN_WIDTH_MM = 520.0

# Default pass threshold for validation (degrees of visual angle). The 4C is a
# consumer device that typically achieves 2-3° in real conditions, so 2.5° is a
# reasonable default. The frontend may override this per validation pass.
ACCURACY_PASS_DEG = 2.5
MIN_VALID_POINTS = 5


class PointRequest(BaseModel):
    x: float  # Normalized 0.0 to 1.0
    y: float  # Normalized 0.0 to 1.0


# Holds per-point validation results across the /validate/* calls.
_validation_points: list[dict] = []


def _avg_distance_mm(sample: dict) -> Optional[float]:
    """Average the valid eyes' Z (distance). Returns None if no valid eye."""
    zs = []
    if sample.get("left_valid") and "left_xyz" in sample:
        zs.append(abs(sample["left_xyz"][2]))
    if sample.get("right_valid") and "right_xyz" in sample:
        zs.append(abs(sample["right_xyz"][2]))
    if not zs:
        return None
    return sum(zs) / len(zs)


@router.get("/status")
async def calibration_status():
    """Report whether the Stream Engine bridge and a Tobii device are present."""
    bridge = _bridge_available()
    info = find_tracker() if bridge else None
    return {
        "bridge_available": bridge,
        "device_connected": info is not None,
        "model": info.model if info else None,
        "serial": info.serial_number if info else None,
    }


@router.websocket("/ws/position")
async def position_stream_ws(websocket: WebSocket):
    """Stream live eye distance/presence to the frontend via the Stream Engine."""
    await websocket.accept()

    if not _bridge_available():
        try:
            while True:
                await websocket.send_json({"distance_mm": -1.0, "status": "no_hardware"})
                await asyncio.sleep(0.5)
        except WebSocketDisconnect:
            return

    try:
        position_stream.start()
    except Exception as e:
        logger.warning("Failed to start position stream: %s", e)
        try:
            while True:
                await websocket.send_json({"distance_mm": -1.0, "status": "no_hardware"})
                await asyncio.sleep(0.5)
        except WebSocketDisconnect:
            return

    try:
        while True:
            sample = position_stream.latest()
            if sample is None:
                await websocket.send_json({"distance_mm": -1.0, "status": "adjust"})
            elif sample.get("normalized"):
                # Normalized [0,1] track-box depth: ~0.5 is centered/ideal.
                z = _avg_distance_mm(sample)
                status = "optimal" if (z is not None and 0.35 <= z <= 0.65) else "adjust"
                await websocket.send_json({
                    "distance_mm": -1.0, "normalized_z": z, "status": status,
                })
            else:
                dist = _avg_distance_mm(sample)
                if dist is None:
                    await websocket.send_json({"distance_mm": -1.0, "status": "adjust"})
                else:
                    status = "optimal" if OPTIMAL_MIN_MM <= dist <= OPTIMAL_MAX_MM else "adjust"
                    await websocket.send_json({"distance_mm": dist, "status": status})
            await asyncio.sleep(0.05)
    except WebSocketDisconnect:
        position_stream.stop()


@router.post("/launch-tobii")
async def launch_tobii():
    """Launch Tobii's own calibration app (the 4C calibrates through Tobii's
    software, not the Pro SDK)."""
    launched = launch_tobii_calibration()
    return {
        "launched": launched,
        "message": (
            "Tobii menu opened — click the Tobii tray icon and choose "
            "'Create New Profile' (or Recalibrate), complete the calibration, "
            "then return here."
            if launched else
            "Could not open Tobii's app automatically. Click the Tobii icon in "
            "your Windows tray (bottom-right, under the ^), choose 'Create New "
            "Profile', calibrate, then return here."
        ),
    }


@router.websocket("/ws/gaze")
async def gaze_ws(websocket: WebSocket):
    """Stream the live gaze point (normalized [0,1] on the display) to the
    frontend so the user can see where they're looking. Reads the shared gaze
    buffer that the validation flow also uses."""
    await websocket.accept()
    try:
        while True:
            sample = gaze_stream.latest() if gaze_stream.is_running else None
            if sample is None:
                await websocket.send_json({"valid": False})
            else:
                xs, ys = [], []
                if sample.get("left_gaze_point_validity"):
                    gp = sample.get("left_gaze_point_on_display_area")
                    if gp:
                        xs.append(gp[0]); ys.append(gp[1])
                if sample.get("right_gaze_point_validity"):
                    gp = sample.get("right_gaze_point_on_display_area")
                    if gp:
                        xs.append(gp[0]); ys.append(gp[1])
                if xs:
                    await websocket.send_json({
                        "valid": True,
                        "x": sum(xs) / len(xs),
                        "y": sum(ys) / len(ys),
                    })
                else:
                    await websocket.send_json({"valid": False})
            await asyncio.sleep(0.03)
    except WebSocketDisconnect:
        return


@router.post("/validate/start")
async def validate_start():
    """Begin a validation pass by starting the live gaze stream."""
    global _validation_points
    _validation_points = []

    if not _bridge_available():
        raise HTTPException(status_code=400, detail="Eye tracker not available.")
    try:
        gaze_stream.start()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to start gaze stream: {e}")
    return {"status": "validation_started"}


@router.post("/validate/point")
async def validate_point(point: PointRequest):
    """Collect ~1.5s of gaze while the user looks at (x, y); compute per-point
    accuracy in degrees of visual angle."""
    if not gaze_stream.is_running:
        raise HTTPException(status_code=400, detail="Validation not started.")

    # collect() blocks ~1.5s, so run it off the event loop.
    samples = await asyncio.to_thread(gaze_stream.collect, 1.5)

    gxs, gys = [], []
    for s in samples:
        if s.get("left_gaze_point_validity"):
            gp = s.get("left_gaze_point_on_display_area")
            if gp:
                gxs.append(gp[0]); gys.append(gp[1])

    valid_samples = len(gxs)
    if valid_samples == 0:
        result = {"x": point.x, "y": point.y, "valid": False, "valid_samples": 0,
                  "accuracy_degrees": None}
        _validation_points.append(result)
        return result

    mean_x = sum(gxs) / valid_samples
    mean_y = sum(gys) / valid_samples

    # Accuracy: normalized error -> mm on screen -> degrees at ~600mm.
    err_norm = math.hypot(mean_x - point.x, mean_y - point.y)
    err_mm = err_norm * SCREEN_WIDTH_MM
    acc_deg = math.degrees(math.atan2(err_mm, 600.0))

    # Precision: spread of samples around their own mean (RMS), -> degrees.
    spread_norm = math.sqrt(
        sum((sx - mean_x) ** 2 + (sy - mean_y) ** 2 for sx, sy in zip(gxs, gys)) / valid_samples
    )
    prec_deg = math.degrees(math.atan2(spread_norm * SCREEN_WIDTH_MM, 600.0))

    result = {
        "x": point.x, "y": point.y, "valid": True, "valid_samples": valid_samples,
        "accuracy_degrees": acc_deg, "precision_degrees": prec_deg,
    }
    _validation_points.append(result)
    return result


@router.post("/validate/finish")
async def validate_finish(accuracy_pass_deg: float = ACCURACY_PASS_DEG):
    """Stop the gaze stream and aggregate the validation pass into a real
    accuracy/precision report. The pass threshold (degrees) may be overridden
    via the `accuracy_pass_deg` query param; defaults to ACCURACY_PASS_DEG."""
    gaze_stream.stop()

    threshold = accuracy_pass_deg if accuracy_pass_deg > 0 else ACCURACY_PASS_DEG

    valid = [p for p in _validation_points if p.get("valid")]
    valid_count = len(valid)

    if valid_count == 0:
        return {
            "status": "success", "overall_quality": "Fail",
            "accuracy_degrees": 0.0, "precision_degrees": 0.0,
            "valid_count": 0, "threshold_degrees": threshold,
            "points": _validation_points,
        }

    avg_acc = sum(p["accuracy_degrees"] for p in valid) / valid_count
    avg_prec = sum(p["precision_degrees"] for p in valid) / valid_count

    overall = "Pass" if (valid_count >= MIN_VALID_POINTS and avg_acc <= threshold) else "Fail"

    return {
        "status": "success",
        "overall_quality": overall,
        "accuracy_degrees": avg_acc,
        "precision_degrees": avg_prec,
        "valid_count": valid_count,
        "threshold_degrees": threshold,
        "points": _validation_points,
    }
