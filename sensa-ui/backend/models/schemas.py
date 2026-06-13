from typing import Optional
from pydantic import BaseModel


class AOISchema(BaseModel):
    name: str
    x: float
    y: float
    width: float
    height: float


class AnalysisRequest(BaseModel):
    filepath: str
    aois: list[AOISchema]
    stimulus_id: int
    algorithm: str = "idt"
    device_type: str = "glasses3"
    screen_w: int = 1920
    screen_h: int = 1080


class FixationSchema(BaseModel):
    x: float
    y: float
    start_time: float
    end_time: float
    duration: float
    num_samples: int


class AOIMetricsSchema(BaseModel):
    aoi_name: str
    total_fixation_duration_ms: float
    time_to_first_fixation_ms: Optional[float] = None
    average_fixation_duration_ms: Optional[float] = None
    fixation_count: int


class AnalysisResponse(BaseModel):
    fixations: list[FixationSchema]
    aoi_metrics: list[AOIMetricsSchema]
    summary: dict


class VisualizeRequest(BaseModel):
    recording_filepath: str
    stimulus_id: int
    aois: list[AOISchema]
    stimulus_image_path: Optional[str] = None
    algorithm: str = "idt"
    device_type: str = "glasses3"
    task_name: Optional[str] = None
    event_file_paths: Optional[list[str]] = None


class AnalyzeTasksRequest(BaseModel):
    gazedata_path: str
    event_file_paths: list[str]
    aois: list[AOISchema]
    algorithm: str = "idt"
    screen_w: int = 1920
    screen_h: int = 1080
