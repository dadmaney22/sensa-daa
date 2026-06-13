import os
import io
import time
import uuid
from pathlib import Path
from typing import Optional
from contextlib import redirect_stdout

import cv2
from fastapi import APIRouter, HTTPException, UploadFile, File, Request, Form

from models.schemas import AnalysisRequest, AnalysisResponse, VisualizeRequest, AnalyzeTasksRequest
from services.eyetracking_analysis import (
    analyze_recording as run_analysis,
    analyze_by_tasks,
    parse_task_events,
    AOI,
)
from services.eyetracking_visualizations import generate_all_visualizations
from services import validate_tfd_ttff

router = APIRouter(prefix="/api")

BASE_DIR = Path(__file__).resolve().parent.parent
UPLOADS_DIR = BASE_DIR / "uploads"
UPLOADS_DIR.mkdir(exist_ok=True)
OUTPUTS_DIR = BASE_DIR / "outputs"
OUTPUTS_DIR.mkdir(exist_ok=True)
(UPLOADS_DIR / "stimuli").mkdir(exist_ok=True)
(UPLOADS_DIR / "glasses3").mkdir(exist_ok=True)
(UPLOADS_DIR / "events").mkdir(exist_ok=True)


def _resolve_upload_path(relative_or_abs: str) -> Path:
    p = Path(relative_or_abs)
    if not p.is_absolute():
        p = UPLOADS_DIR / p
    return p


def _schema_to_aoi(aoi_schema) -> AOI:
    """Convert a Pydantic AOISchema to the analysis module's AOI dataclass."""
    return AOI(
        name=aoi_schema.name,
        x=aoi_schema.x,
        y=aoi_schema.y,
        width=aoi_schema.width,
        height=aoi_schema.height,
    )


@router.post("/analyze", response_model=AnalysisResponse)
async def analyze_recording_endpoint(req: AnalysisRequest):
    filepath = Path(req.filepath)

    if not filepath.is_absolute():
        filepath = UPLOADS_DIR / filepath

    if not filepath.exists():
        raise HTTPException(
            status_code=400,
            detail=f"File {filepath.name} does not exist in uploads directory",
        )

    try:
        result = run_analysis(
            filepath=str(filepath),
            aois=[_schema_to_aoi(a) for a in req.aois],
            stimulus_id=req.stimulus_id,
            algorithm=req.algorithm,
            device_type=req.device_type,
            screen_w=req.screen_w,
            screen_h=req.screen_h,
        )
        return result
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Analysis failed: {exc}",
        )


@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    try:
        dest = UPLOADS_DIR / file.filename
        contents = await file.read()
        dest.write_bytes(contents)
        return {"filepath": str(dest), "filename": file.filename, "size": len(contents)}
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Upload failed: {exc}",
        )


@router.get("/recordings")
async def list_recordings():
    """List available recordings: JSON files (4C) and Glasses 3 recording dirs."""
    try:
        json_files = sorted(
            [f.name for f in UPLOADS_DIR.iterdir() if f.suffix == ".json"],
            key=lambda n: os.path.getmtime(UPLOADS_DIR / n),
            reverse=True,
        )

        glasses3_recordings = []
        g3_dir = UPLOADS_DIR / "glasses3"
        if g3_dir.exists():
            for d in sorted(g3_dir.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
                if d.is_dir() and any(f.name.endswith(".gz") for f in d.iterdir()):
                    glasses3_recordings.append({
                        "name": d.name,
                        "path": f"glasses3/{d.name}",
                        "device_type": "glasses3",
                    })

        return {
            "recordings": json_files,
            "glasses3_recordings": glasses3_recordings,
        }
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to list recordings: {exc}",
        )


@router.post("/visualize")
async def visualize(request: Request, body: VisualizeRequest):
    """
    Generate all visualization images (heatmap, scanpath, fixation sequence, charts)
    and return URLs to access them.
    """
    recording_path = Path(body.recording_filepath)
    if not recording_path.is_absolute():
        recording_path = UPLOADS_DIR / recording_path
    if not recording_path.exists():
        raise HTTPException(
            status_code=400,
            detail=f"Recording file {body.recording_filepath} does not exist",
        )

    stimulus_path = None
    if body.stimulus_image_path:
        stimulus_path = Path(body.stimulus_image_path)
        if not stimulus_path.is_absolute():
            stimulus_path = UPLOADS_DIR / stimulus_path
        if not stimulus_path.exists():
            raise HTTPException(
                status_code=400,
                detail=f"Stimulus image {body.stimulus_image_path} does not exist",
            )
        stimulus_path = str(stimulus_path)

    timestamp = f"{int(time.time() * 1000)}-{uuid.uuid4().hex[:8]}"
    output_dir = OUTPUTS_DIR / timestamp
    output_dir.mkdir(parents=True, exist_ok=True)

    aois = [_schema_to_aoi(a) for a in body.aois]

    event_paths_resolved: Optional[list[str]] = None
    if body.task_name and body.event_file_paths:
        event_paths_resolved = [
            str(_resolve_upload_path(ep)) for ep in body.event_file_paths
        ]

    try:
        result = generate_all_visualizations(
            recording_filepath=str(recording_path),
            stimulus_id=body.stimulus_id,
            aois=aois,
            output_dir=str(output_dir),
            stimulus_image_path=stimulus_path,
            algorithm=body.algorithm,
            device_type=body.device_type,
            task_name=body.task_name,
            event_file_paths=event_paths_resolved,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Visualization failed: {exc}",
        )

    base_url = str(request.base_url).rstrip("/")
    image_paths = result.get("image_paths", {})
    image_urls = {
        key: f"{base_url}/api/outputs/{timestamp}/{Path(path).name}"
        for key, path in image_paths.items()
    }

    return {
        "image_urls": image_urls,
        "aoi_metrics": result.get("aoi_metrics", []),
        "fixation_count": result.get("fixation_count", 0),
        "avg_fixation_duration_ms": result.get("avg_fixation_duration_ms"),
        "algorithm": result.get("algorithm", body.algorithm),
    }


@router.post("/upload-stimulus")
async def upload_stimulus(file: UploadFile = File(...)):
    """Upload a stimulus image; saved to uploads/stimuli/."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")
    allowed = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
    if Path(file.filename).suffix.lower() not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Allowed image types: {', '.join(sorted(allowed))}",
        )
    stimuli_dir = UPLOADS_DIR / "stimuli"
    try:
        dest = stimuli_dir / file.filename
        contents = await file.read()
        dest.write_bytes(contents)
        return {
            "filepath": f"stimuli/{file.filename}",
            "filename": file.filename,
            "size": len(contents),
        }
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Upload failed: {exc}",
        )


@router.post("/analyze-tasks")
async def analyze_tasks_endpoint(req: AnalyzeTasksRequest):
    """Run fixation + AOI analysis separately for each task from Controller event files."""
    gazedata = _resolve_upload_path(req.gazedata_path)
    if not gazedata.exists():
        raise HTTPException(
            status_code=400,
            detail=f"gazedata file not found: {req.gazedata_path}",
        )
    event_paths = [str(_resolve_upload_path(p)) for p in req.event_file_paths]
    for ep in event_paths:
        if not Path(ep).exists():
            raise HTTPException(status_code=400, detail=f"Event file not found: {ep}")

    try:
        return analyze_by_tasks(
            gazedata_path=str(gazedata),
            event_file_paths=event_paths,
            aois=[_schema_to_aoi(a) for a in req.aois],
            algorithm=req.algorithm,
            screen_w=req.screen_w,
            screen_h=req.screen_h,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Task analysis failed: {exc}")


@router.post("/upload-events")
async def upload_events(
    recording_name: str = Form(...),
    files: list[UploadFile] = File(...),
):
    """
    Upload Tobii Controller user-event JSON files to uploads/events/{recording_name}/.
    Returns parsed paired tasks for preview in the frontend.
    """
    safe_rec = Path(recording_name).name
    if not safe_rec or safe_rec in (".", ".."):
        raise HTTPException(status_code=400, detail="recording_name is required")
    dest_dir = UPLOADS_DIR / "events" / safe_rec
    dest_dir.mkdir(parents=True, exist_ok=True)

    saved_paths: list[str] = []
    for uf in files:
        if not uf.filename:
            continue
        safe_name = Path(uf.filename).name
        out = dest_dir / safe_name
        out.write_bytes(await uf.read())
        saved_paths.append(str(out))

    if not saved_paths:
        raise HTTPException(status_code=400, detail="No valid files uploaded")

    tasks = parse_task_events(saved_paths)
    return {
        "recording_name": safe_rec,
        "directory": f"events/{safe_rec}",
        "saved_files": [Path(p).name for p in saved_paths],
        "tasks": tasks,
    }


@router.post("/upload-glasses3")
async def upload_glasses3(
    request: Request,
    recording_name: str = Form(...),
    gazedata: UploadFile = File(...),
    recording_meta: Optional[UploadFile] = File(None),
    scenevideo: Optional[UploadFile] = File(None),
):
    """
    Upload Tobii Pro Glasses 3 recording files.
    Saves to uploads/glasses3/{recording_name}/.
    Expects at minimum the gazedata.gz file.
    """
    rec_dir = UPLOADS_DIR / "glasses3" / recording_name
    rec_dir.mkdir(parents=True, exist_ok=True)

    saved = {}

    gaze_dest = rec_dir / (gazedata.filename or "gazedata.gz")
    gaze_dest.write_bytes(await gazedata.read())
    saved["gazedata"] = str(gaze_dest)

    if recording_meta and recording_meta.filename:
        meta_dest = rec_dir / recording_meta.filename
        meta_dest.write_bytes(await recording_meta.read())
        saved["recording_meta"] = str(meta_dest)

    if scenevideo and scenevideo.filename:
        video_dest = rec_dir / scenevideo.filename
        video_dest.write_bytes(await scenevideo.read())
        saved["scenevideo"] = str(video_dest)

    return {
        "recording_name": recording_name,
        "directory": f"glasses3/{recording_name}",
        "files": saved,
    }


@router.get("/glasses3/frame")
async def extract_glasses3_frame(
    request: Request,
    recording_path: str,
    timestamp: float = 0.0,
):
    """
    Extract a single frame from a Glasses 3 scene video at a given timestamp.

    Args (query params):
        recording_path: Relative path to the recording dir (e.g. "glasses3/rec1")
                        or absolute path to the scenevideo.mp4
        timestamp: Time in seconds into the video
    """
    video_path = Path(recording_path)
    if not video_path.is_absolute():
        candidate = UPLOADS_DIR / video_path
        if candidate.is_dir():
            for ext in (".mp4", ".avi", ".mkv"):
                for f in candidate.iterdir():
                    if f.suffix.lower() == ext:
                        video_path = f
                        break
                if video_path != Path(recording_path):
                    break
            else:
                raise HTTPException(
                    status_code=400,
                    detail=f"No video file found in {candidate}",
                )
        elif candidate.is_file():
            video_path = candidate
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Recording path {recording_path} not found",
            )

    if not video_path.exists():
        raise HTTPException(status_code=400, detail=f"Video file not found: {video_path}")

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise HTTPException(status_code=500, detail="Could not open video file")

    try:
        cap.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000.0)
        ret, frame = cap.read()
        if not ret or frame is None:
            raise HTTPException(
                status_code=400,
                detail=f"Could not extract frame at timestamp {timestamp}s",
            )

        ts_label = str(int(time.time()))
        frame_dir = OUTPUTS_DIR / "frames"
        frame_dir.mkdir(parents=True, exist_ok=True)
        filename = f"frame_{ts_label}_{timestamp:.2f}s.png"
        frame_path = frame_dir / filename
        cv2.imwrite(str(frame_path), frame)

        base_url = str(request.base_url).rstrip("/")
        return {
            "frame_url": f"{base_url}/api/outputs/frames/{filename}",
            # Absolute filepath so the backend can reuse it as `stimulus_image_path` in /api/visualize.
            "frame_filepath": str(frame_path),
            "timestamp": timestamp,
            "width": int(frame.shape[1]),
            "height": int(frame.shape[0]),
        }
    finally:
        cap.release()


@router.get("/test-visualize")
async def test_visualize(request: Request):
    """
    Test endpoint: use first JSON in uploads/, four quadrant AOIs,
    generate all visualizations, return image URLs.
    """
    json_files = [f for f in UPLOADS_DIR.iterdir() if f.suffix == ".json"]
    if not json_files:
        raise HTTPException(
            status_code=400,
            detail="No JSON files in uploads/. Upload a Tobii recording first.",
        )
    recording_path = str(json_files[0])
    test_aois = [
        AOI(name="Top-Left", x=0, y=0, width=960, height=540),
        AOI(name="Top-Right", x=960, y=0, width=960, height=540),
        AOI(name="Bottom-Left", x=0, y=540, width=960, height=540),
        AOI(name="Bottom-Right", x=960, y=540, width=960, height=540),
    ]
    timestamp = f"{int(time.time() * 1000)}-{uuid.uuid4().hex[:8]}"
    output_dir = OUTPUTS_DIR / timestamp
    output_dir.mkdir(parents=True, exist_ok=True)
    try:
        result = generate_all_visualizations(
            recording_filepath=recording_path,
            stimulus_id=1,
            aois=test_aois,
            output_dir=str(output_dir),
            stimulus_image_path=None,
            algorithm="idt",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Test visualization failed: {exc}",
        )
    base_url = str(request.base_url).rstrip("/")
    image_paths = result.get("image_paths", {})
    image_urls = {
        key: f"{base_url}/api/outputs/{timestamp}/{Path(path).name}"
        for key, path in image_paths.items()
    }
    return {
        "test_file": json_files[0].name,
        "image_urls": image_urls,
        "aoi_metrics": result.get("aoi_metrics", []),
        "fixation_count": result.get("fixation_count", 0),
        "algorithm": result.get("algorithm", "idt"),
    }


@router.get("/test-analysis")
async def test_analysis():
    """
    Quick test endpoint — picks the first JSON file in uploads/ and runs
    analysis with four-quadrant AOIs covering the full screen.
    """
    json_files = [f for f in UPLOADS_DIR.iterdir() if f.suffix == ".json"]

    if not json_files:
        raise HTTPException(
            status_code=400,
            detail="No JSON files found in uploads/. Upload a Tobii recording first.",
        )

    filepath = str(json_files[0])

    test_aois = [
        AOI(name="Top-Left",     x=0,   y=0,   width=960, height=540),
        AOI(name="Top-Right",    x=960, y=0,   width=960, height=540),
        AOI(name="Bottom-Left",  x=0,   y=540, width=960, height=540),
        AOI(name="Bottom-Right", x=960, y=540, width=960, height=540),
    ]

    try:
        result = run_analysis(
            filepath=filepath,
            aois=test_aois,
            stimulus_id=1,
            algorithm="idt",
        )
        return {
            "test_file": json_files[0].name,
            **result,
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Test analysis failed: {exc}",
        )


@router.get("/validate")
async def run_validation_report():
    """
    Run validate_tfd_ttff.main() and return its printed output.
    """
    buffer = io.StringIO()
    try:
        with redirect_stdout(buffer):
            validate_tfd_ttff.main()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Validation run failed: {exc}")

    return {"report": buffer.getvalue()}
