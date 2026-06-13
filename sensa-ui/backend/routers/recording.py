from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.tobii_stream import recorder

router = APIRouter(prefix="/api")

UPLOADS_DIR = Path(__file__).resolve().parent.parent / "uploads"
UPLOADS_DIR.mkdir(exist_ok=True)


class StartRequest(BaseModel):
    stimulus_id: int = 1


class StartResponse(BaseModel):
    status: str
    stimulus_id: int


class StopResponse(BaseModel):
    status: str
    filepath: str
    filename: str
    sample_count: int


class StatusResponse(BaseModel):
    recording: bool
    sample_count: int


@router.post("/recording/start", response_model=StartResponse)
async def start_recording(req: StartRequest):
    try:
        recorder.start(stimulus_id=req.stimulus_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))

    return StartResponse(status="recording", stimulus_id=req.stimulus_id)


@router.post("/recording/stop", response_model=StopResponse)
async def stop_recording():
    try:
        filepath, count = recorder.stop(output_dir=UPLOADS_DIR)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))

    return StopResponse(
        status="stopped",
        filepath=str(filepath),
        filename=filepath.name,
        sample_count=count,
    )


@router.get("/recording/status", response_model=StatusResponse)
async def recording_status():
    return StatusResponse(
        recording=recorder.is_recording,
        sample_count=recorder.sample_count,
    )
