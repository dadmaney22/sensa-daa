import asyncio
import logging
import math  # <-- Missing import added!
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/calibration")

# --- Try to load Tobii Pro SDK ---
try:
    import tobii_research as tr
    TOBII_PRO_AVAILABLE = True
    sdk_version = getattr(tr, "__version__", "1.11.0")
    print(f"Tobii Pro SDK imported successfully. Version: {sdk_version}")
except ImportError:
    TOBII_PRO_AVAILABLE = False
    print("Tobii Pro SDK is not installed or unavailable on this platform.")

# Global state for calibration
calibration_instance: Optional[object] = None
current_tracker: Optional[object] = None


class PointRequest(BaseModel):
    x: float  # Normalized 0.0 to 1.0
    y: float  # Normalized 0.0 to 1.0


@router.websocket("/ws/position")
async def position_stream(websocket: WebSocket):
    """
    Streams 3D eye position to the frontend.
    Falls back to mock data if the Tobii 4C is not found.
    """
    await websocket.accept()
    
    use_mock_data = False

    # Check for real hardware
    if TOBII_PRO_AVAILABLE:
        found_trackers = tr.find_all_eyetrackers()
        if not found_trackers:
            print("\n[WARNING] Tobii Pro SDK installed, but no tracker found. Falling back to Mock UI.")
            use_mock_data = True
        else:
            tracker = found_trackers[0]
    else:
        use_mock_data = True

    # --- MOCK / FALLBACK MODE ---
    if use_mock_data:
        try:
            while True:
                payload = {
                    "distance_mm": -1.0,
                    "status": "no_hardware",
                    "mock": True
                }
                await websocket.send_json(payload)
                await asyncio.sleep(0.5)
        except WebSocketDisconnect:
            return

    # --- REAL HARDWARE MODE (Adjusted for closer 550-700mm threshold) ---
    try:
        queue = asyncio.Queue()

        def gaze_data_callback(gaze_data):
            try:
                left_pos = gaze_data.left_eye.gaze_origin.position_in_user_coordinates
                right_pos = gaze_data.right_eye.gaze_origin.position_in_user_coordinates
                
                valid_z = []
                if isinstance(left_pos, (tuple, list)) and len(left_pos) == 3 and not math.isnan(left_pos[2]):
                    valid_z.append(left_pos[2])
                if isinstance(right_pos, (tuple, list)) and len(right_pos) == 3 and not math.isnan(right_pos[2]):
                    valid_z.append(right_pos[2])
                
                if valid_z:
                    avg_z = sum(valid_z) / len(valid_z)
                    queue.put_nowait({
                        "distance_mm": avg_z,
                        # NEW SWEEET SPOT: 550mm to 700mm
                        "status": "optimal" if 550 <= avg_z <= 700 else "adjust"
                    })
                else:
                    queue.put_nowait({
                        "distance_mm": -1.0, 
                        "status": "adjust"
                    })
            except Exception as e:
                print(f"Callback error: {e} | Available data: {dir(gaze_data)}")

        tracker.subscribe_to(tr.EYETRACKER_GAZE_DATA, gaze_data_callback)

        try:
            while True:
                payload = await queue.get()
                await websocket.send_json(payload)
        except WebSocketDisconnect:
            tracker.unsubscribe_from(tr.EYETRACKER_GAZE_DATA, gaze_data_callback)
            
    except Exception as e:
        print(f"WebSocket Error: {e}")
        try:
            await websocket.close()
        except:
            pass

@router.get("/status")
async def calibration_status():
    if not TOBII_PRO_AVAILABLE:
        return {"sdk_available": False, "tracker_found": False, "mock_mode": True}
    trackers = tr.find_all_eyetrackers()
    found = len(trackers) > 0
    return {"sdk_available": True, "tracker_found": found, "mock_mode": not found}


@router.post("/start")
async def start_calibration():
    global calibration_instance, current_tracker
    
    if not TOBII_PRO_AVAILABLE:
        return {"status": "mock_calibration_started"}

    found_trackers = tr.find_all_eyetrackers()
    if not found_trackers:
        raise HTTPException(status_code=400, detail="No eye tracker connected.")
        
    current_tracker = found_trackers[0]
    calibration_instance = tr.ScreenBasedCalibration(current_tracker)
    calibration_instance.enter_calibration_mode()
    
    return {"status": "calibration_mode_active"}


@router.post("/collect")
async def collect_calibration_point(point: PointRequest):
    if not TOBII_PRO_AVAILABLE:
        await asyncio.sleep(0.5)
        return {"status": "mock_point_collected", "point": point.dict()}

    if not calibration_instance:
        raise HTTPException(status_code=400, detail="Calibration not started.")

    status = calibration_instance.collect_data(point.x, point.y)
    
    if status != tr.CALIBRATION_STATUS_SUCCESS:
        return {"status": "failed_to_collect", "reason": str(status)}
        
    return {"status": "success", "point": point.dict()}


@router.post("/compute")
async def compute_calibration():
    global calibration_instance
    
    # --- Mock Mode Fallback ---
    if not TOBII_PRO_AVAILABLE:
        return {
            "status": "success",
            "overall_quality": "Pass",
            "accuracy_degrees": 0.45,
            "precision_degrees": 0.12,
            "valid_count": 5,
            "points": []
        }

    if not calibration_instance:
        raise HTTPException(status_code=400, detail="Calibration not started.")

    # Tell the hardware to compute the profile
    result = calibration_instance.compute_and_apply()
    calibration_instance.leave_calibration_mode()
    calibration_instance = None

    if result.status != tr.CALIBRATION_STATUS_SUCCESS:
        return {"status": "failed", "overall_quality": "Fail"}

    points_data = []
    valid_points_count = 0
    total_accuracy_err = 0.0
    total_precision_err = 0.0

    # Extract dynamic precision and accuracy from the physical samples
    for point in result.calibration_points:
        px, py = point.position_on_display_area
        samples = point.calibration_samples
        
        is_valid = len(samples) > 0
        points_data.append({"x": px, "y": py, "valid": is_valid})
        
        if is_valid:
            valid_points_count += 1
            sample_xs = []
            sample_ys = []
            
            # Extract raw coordinate samples from both eyes
            for s in samples:
                if s.left_eye.validity == 1:
                    sample_xs.append(s.left_eye.position_on_display_area[0])
                    sample_ys.append(s.left_eye.position_on_display_area[1])
                if s.right_eye.validity == 1:
                    sample_xs.append(s.right_eye.position_on_display_area[0])
                    sample_ys.append(s.right_eye.position_on_display_area[1])
            
            if sample_xs and sample_ys:
                mean_x = sum(sample_xs) / len(sample_xs)
                mean_y = sum(sample_ys) / len(sample_ys)
                
                # Accuracy: Distance between intended target and average gaze
                dx = mean_x - px
                dy = mean_y - py
                dist = math.sqrt(dx*dx + dy*dy)
                total_accuracy_err += dist
                
                # Precision: Variance of the gaze samples around their own mean
                variance = sum(math.sqrt((sx - mean_x)**2 + (sy - mean_y)**2) for sx, sy in zip(sample_xs, sample_ys)) / len(sample_xs)
                total_precision_err += variance

    # ENFORCE STRICT REQUIREMENT: Must have 5 out of 5 valid points to pass
    overall_quality = "Pass" if valid_points_count == 5 else "Fail"
    
    # Map normalized screen space errors to approximate degrees of visual angle (assuming typical 35° monitor FOV)
    avg_acc = (total_accuracy_err / valid_points_count * 35.0) if valid_points_count > 0 else 0.0
    avg_prec = (total_precision_err / valid_points_count * 35.0) if valid_points_count > 0 else 0.0

    return {
        "status": "success",
        "overall_quality": overall_quality,
        "accuracy_degrees": avg_acc,
        "precision_degrees": avg_prec,
        "valid_count": valid_points_count,
        "points": points_data
    }