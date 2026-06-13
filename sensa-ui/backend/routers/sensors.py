from fastapi import APIRouter

router = APIRouter(prefix="/api")

# --- Tobii Pro SDK (research-grade trackers) --------------------------------
try:
    import tobii_research as tr
    TOBII_PRO_AVAILABLE = True
except ImportError:
    TOBII_PRO_AVAILABLE = False

# --- Tobii Stream Engine (consumer trackers: 4C, 5, etc.) -------------------
try:
    from services.tobii_stream import find_tracker as se_find_tracker
    STREAM_ENGINE_AVAILABLE = True
except Exception:
    STREAM_ENGINE_AVAILABLE = False


@router.get("/sensors/status")
async def sensor_status():
    eye_tracker = {
        "id": "eye-tracker",
        "name": "Eye Tracker",
        "connected": False,
        "model": None,
        "serial": None,
        "address": None,
    }

    # 1) Try Stream Engine first (supports consumer 4C / 5)
    if STREAM_ENGINE_AVAILABLE:
        try:
            info = se_find_tracker()
            if info is not None:
                eye_tracker.update({
                    "connected": True,
                    "model": info.model or "Tobii Eye Tracker",
                    "serial": info.serial_number or None,
                    "address": info.url or None,
                })
        except Exception:
            pass

    # 2) Fall back to Tobii Pro SDK (research-grade)
    if not eye_tracker["connected"] and TOBII_PRO_AVAILABLE:
        try:
            found = tr.find_all_eyetrackers()
            if found:
                et = found[0]
                eye_tracker.update({
                    "connected": True,
                    "model": et.model or "Tobii Eye Tracker",
                    "serial": et.serial_number or None,
                    "address": et.address or None,
                })
        except Exception:
            pass

    return {
        "sensors": [
            eye_tracker,
            {
                "id": "gsr",
                "name": "GSR Sensor",
                "connected": False,
                "model": None,
            },
            {
                "id": "heart-rate",
                "name": "Heart Rate Sensor",
                "connected": False,
                "model": None,
            },
        ],
        "tobii_sdk_installed": TOBII_PRO_AVAILABLE or STREAM_ENGINE_AVAILABLE,
    }
