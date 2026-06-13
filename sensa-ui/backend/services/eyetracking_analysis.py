"""
Eye Tracking Analysis Module
=============================
Implements fixation detection and AOI-based metrics for Tobii eye tracking data.

Algorithms:
    - I-VT (Velocity-Threshold Identification): Classifies gaze samples as fixations
      or saccades based on point-to-point angular velocity.
      Reference: Salvucci & Goldberg (2000), "Identifying fixations and saccades 
      in eye-tracking protocols"
      
    - I-DT (Dispersion-Threshold Identification): Groups consecutive gaze samples 
      into fixations when their spatial dispersion stays below a threshold for a 
      minimum duration.
      Reference: Salvucci & Goldberg (2000)

Metrics:
    - TFD  (Total Fixation Duration):   Sum of all fixation durations within an AOI
    - TTFF (Time to First Fixation):    Time from stimulus onset to first fixation in AOI
    - AFD  (Average Fixation Duration):  Mean fixation duration within an AOI
    - FC   (Fixation Count):            Number of fixations within an AOI

Author: Shahzeb (built on top of Andre's recording pipeline)
License: GPL-3.0
"""

import gzip
import json
import logging
import os

import numpy as np
import pandas as pd
from typing import Optional
from dataclasses import dataclass, field, asdict

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────────────────────
# DATA STRUCTURES
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class Fixation:
    """Represents a single detected fixation."""
    x: float              # Fixation x-coordinate in pixels
    y: float              # Fixation y-coordinate in pixels
    start_time: float     # Start timestamp in milliseconds
    end_time: float       # End timestamp in milliseconds
    duration: float       # Duration in milliseconds
    num_samples: int      # Number of raw gaze samples in this fixation


@dataclass
class AOI:
    """
    Defines a rectangular Area of Interest on the stimulus.
    Coordinates are in pixels, matching the screen resolution.
    """
    name: str
    x: float        # Top-left x
    y: float        # Top-left y
    width: float
    height: float

    def contains(self, px: float, py: float) -> bool:
        """Check if a point (px, py) falls inside this AOI."""
        return (self.x <= px <= self.x + self.width and
                self.y <= py <= self.y + self.height)


@dataclass
class AOIMetrics:
    """All computed metrics for a single AOI."""
    aoi_name: str
    total_fixation_duration_ms: float   # TFD
    time_to_first_fixation_ms: Optional[float]  # TTFF (None if AOI was never fixated)
    average_fixation_duration_ms: Optional[float]  # AFD (None if no fixations)
    fixation_count: int                 # FC


# ──────────────────────────────────────────────────────────────────────────────
# STEP 1: PARSE RAW TOBII DATA
# ──────────────────────────────────────────────────────────────────────────────

def parse_tobii_json(filepath: str) -> pd.DataFrame:
    """
    Load raw Tobii JSON data and extract usable gaze samples.
    
    What this does:
    1. Reads the JSON file that record_eyetracking.py produces
    2. Averages left and right eye gaze points (binocular average)
    3. Filters out invalid samples where the tracker lost the eyes
    4. Converts timestamps to milliseconds relative to recording start
    
    Args:
        filepath: Path to the Tobii JSON file
        
    Returns:
        DataFrame with columns: [timestamp_ms, x, y, stimulus_id]
    """
    df = pd.read_json(filepath)

    # ── Filter: keep only samples where BOTH eyes are valid ──
    # Validity == 1 means the eye tracker successfully detected that eye
    valid_mask = (
        (df["left_gaze_point_validity"] == 1) &
        (df["right_gaze_point_validity"] == 1)
    )
    df = df[valid_mask].copy()

    if df.empty:
        raise ValueError("No valid gaze samples found in the data file.")

    # ── Extract gaze coordinates ──
    # Tobii gives normalized coordinates (0.0 to 1.0) for each eye.
    # We average left + right eyes for a single gaze point.
    df["gaze_x_norm"] = df["left_gaze_point_on_display_area"].apply(lambda g: g[0]) * 0.5 + \
                         df["right_gaze_point_on_display_area"].apply(lambda g: g[0]) * 0.5
    df["gaze_y_norm"] = df["left_gaze_point_on_display_area"].apply(lambda g: g[1]) * 0.5 + \
                         df["right_gaze_point_on_display_area"].apply(lambda g: g[1]) * 0.5

    # ── Convert timestamps to milliseconds from recording start ──
    # device_time_stamp is in microseconds from the Tobii clock
    t0 = df["device_time_stamp"].iloc[0]
    df["timestamp_ms"] = (df["device_time_stamp"] - t0) / 1000.0

    # ── Build clean output DataFrame ──
    result = pd.DataFrame({
        "timestamp_ms": df["timestamp_ms"].values,
        "x_norm": df["gaze_x_norm"].values,
        "y_norm": df["gaze_y_norm"].values,
        "stimulus_id": df["stimulus_id"].values,
    })

    return result


def parse_glasses3_gz(filepath: str) -> pd.DataFrame:
    """
    Parse Tobii Pro Glasses 3 gaze data from .gz JSONL files.

    Expected line format:
      {"type":"gaze","timestamp":0.019013,"data":{"gaze2d":[x,y],...}}

    Returns:
      DataFrame with columns [timestamp_ms, x_norm, y_norm, stimulus_id, pupil_diameter]
    """
    rows = []

    with gzip.open(filepath, "rt", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue

            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue

            if obj.get("type") != "gaze":
                continue

            data = obj.get("data") or {}
            gaze2d = data.get("gaze2d")
            if not gaze2d or len(gaze2d) < 2:
                continue

            x_norm, y_norm = gaze2d[0], gaze2d[1]
            if not (0 <= x_norm <= 1 and 0 <= y_norm <= 1):
                continue

            ts_s = float(obj.get("timestamp", 0.0))
            timestamp_ms = ts_s * 1000.0

            left_pupil = (data.get("eyeleft") or {}).get("pupildiameter")
            right_pupil = (data.get("eyeright") or {}).get("pupildiameter")
            pupil_vals = [v for v in [left_pupil, right_pupil] if isinstance(v, (int, float)) and v > 0]
            pupil_diameter = sum(pupil_vals) / len(pupil_vals) if pupil_vals else None

            rows.append({
                "timestamp_ms": timestamp_ms,
                "x_norm": x_norm,
                "y_norm": y_norm,
                "stimulus_id": 0,
                "pupil_diameter": pupil_diameter,
            })

    if not rows:
        raise ValueError("No valid gaze2d samples found in Glasses 3 gazedata.gz.")

    df = pd.DataFrame(rows)
    recording_start_ms = float(df["timestamp_ms"].iloc[0])
    df["timestamp_ms"] = df["timestamp_ms"] - recording_start_ms
    df.attrs["recording_start_ms"] = recording_start_ms
    return df


def filter_glasses3_by_recording_window(
    df: pd.DataFrame,
    start_s: float,
    end_s: float,
    *,
    reset_time_to_task_onset: bool = True,
) -> pd.DataFrame:
    """
    Filter Glasses 3 gaze rows to [start_s, end_s] in recording time (seconds from
    recording start, matching raw gazedata.gz timestamps). When reset_time_to_task_onset
    is True, timestamps become milliseconds relative to task start (task onset = 0).
    """
    rs = float(df.attrs.get("recording_start_ms", 0.0))
    abs_ms = df["timestamp_ms"] + rs
    start_ms = start_s * 1000.0
    end_ms = end_s * 1000.0
    mask = (abs_ms >= start_ms) & (abs_ms <= end_ms)
    seg = df.loc[mask].copy()
    if seg.empty:
        return seg
    if reset_time_to_task_onset:
        seg["timestamp_ms"] = abs_ms.loc[seg.index] - start_ms
    return seg


def parse_task_events(event_files: list[str]) -> list[dict]:
    """
    Read Tobii Glasses 3 Controller user-event JSON files; pair Start/End by task name.

    Each file is JSON with keys including ``timestamp`` (seconds from recording start)
    and ``label`` (e.g. ``"T1A Start"``, ``"T1A End"``).

    Returns tasks sorted by start time: [{"name": "T1A", "start_s": 26.5, "end_s": 32.81}, ...]
    """
    events: list[tuple[float, str, str]] = []  # (timestamp_s, kind, task_name)

    for path in event_files:
        if not path:
            continue
        if not os.path.isfile(path):
            logger.warning("Skipping missing event file: %s", path)
            continue
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            logger.warning("Could not read event file %s: %s", path, e)
            continue

        label = (data.get("label") or "").strip()
        ts = float(data.get("timestamp", 0.0))

        if label.endswith(" Start"):
            name = label[: -len(" Start")].strip()
            kind = "start"
        elif label.endswith(" End"):
            name = label[: -len(" End")].strip()
            kind = "end"
        else:
            logger.warning(
                "Skipping event with unsupported label %r in %s (expected '* Start' or '* End')",
                label,
                path,
            )
            continue

        if not name:
            logger.warning("Empty task name in label %r (%s)", label, path)
            continue

        events.append((ts, kind, name))

    # Sort: time order; for equal timestamps, process starts before ends
    events.sort(key=lambda x: (x[0], 0 if x[1] == "start" else 1))

    stack: list[tuple[str, float]] = []
    pairs: list[dict] = []

    for ts, kind, name in events:
        if kind == "start":
            stack.append((name, ts))
        else:
            matched = False
            for k in range(len(stack) - 1, -1, -1):
                if stack[k][0] == name:
                    start_ts = stack[k][1]
                    del stack[k]
                    matched = True
                    if ts >= start_ts:
                        pairs.append({"name": name, "start_s": start_ts, "end_s": ts})
                    else:
                        logger.warning(
                            "End before start for task %r: start=%s end=%s — skipped",
                            name,
                            start_ts,
                            ts,
                        )
                    break
            if not matched:
                logger.warning(
                    "End without matching start for task %r at %s s — skipped",
                    name,
                    ts,
                )

    for name, ts in stack:
        logger.warning("Start without end for task %r at %s s — skipped", name, ts)

    pairs.sort(key=lambda p: p["start_s"])
    return pairs


def analyze_gaze_dataframe_segment(
    stimulus_data: pd.DataFrame,
    aois: list[AOI],
    algorithm: str = "idt",
    velocity_threshold: float = 100.0,
    dispersion_threshold: float = 25.0,
    min_fixation_duration_ms: float = 100.0,
) -> dict:
    """
    Fixation detection + AOI metrics on a gaze segment whose ``timestamp_ms`` is
    already relative to segment onset (e.g. task start at 0 ms).
    """
    if stimulus_data.empty:
        aoi_metrics = [asdict(compute_aoi_metrics([], aoi, 0.0)) for aoi in aois]
        return {
            "fixations": [],
            "aoi_metrics": aoi_metrics,
            "summary": {
                "total_fixations": 0,
                "total_recording_duration_ms": 0.0,
                "algorithm_used": algorithm.lower(),
                "parameters": {
                    "velocity_threshold": velocity_threshold if algorithm.lower() == "ivt" else None,
                    "dispersion_threshold": dispersion_threshold if algorithm.lower() == "idt" else None,
                    "min_fixation_duration_ms": min_fixation_duration_ms,
                },
            },
        }

    timestamps = stimulus_data["timestamp_ms"].values
    x_coords = stimulus_data["x_px"].values
    y_coords = stimulus_data["y_px"].values

    if algorithm.lower() == "ivt":
        fixations = detect_fixations_ivt(
            timestamps,
            x_coords,
            y_coords,
            velocity_threshold=velocity_threshold,
            min_fixation_duration_ms=min_fixation_duration_ms,
        )
    elif algorithm.lower() == "idt":
        fixations = detect_fixations_idt(
            timestamps,
            x_coords,
            y_coords,
            dispersion_threshold=dispersion_threshold,
            min_fixation_duration_ms=min_fixation_duration_ms,
        )
    else:
        raise ValueError(f"Unknown algorithm: '{algorithm}'. Use 'ivt' or 'idt'.")

    aoi_metrics = []
    for aoi in aois:
        metrics = compute_aoi_metrics(fixations, aoi, stimulus_onset_time_ms=0.0)
        aoi_metrics.append(asdict(metrics))

    recording_duration = float(timestamps[-1] - timestamps[0]) if len(timestamps) > 0 else 0.0

    return {
        "fixations": [asdict(f) for f in fixations],
        "aoi_metrics": aoi_metrics,
        "summary": {
            "total_fixations": len(fixations),
            "total_recording_duration_ms": round(recording_duration, 2),
            "algorithm_used": algorithm.lower(),
            "parameters": {
                "velocity_threshold": velocity_threshold if algorithm.lower() == "ivt" else None,
                "dispersion_threshold": dispersion_threshold if algorithm.lower() == "idt" else None,
                "min_fixation_duration_ms": min_fixation_duration_ms,
            },
        },
    }


def analyze_by_tasks(
    gazedata_path: str,
    event_file_paths: list[str],
    aois: list[AOI],
    algorithm: str = "idt",
    screen_w: int = 1920,
    screen_h: int = 1080,
    velocity_threshold: float = 100.0,
    dispersion_threshold: float = 25.0,
    min_fixation_duration_ms: float = 100.0,
) -> dict:
    """
    Segment gaze by Controller user events; run fixation + AOI analysis per task.
    Timestamps are reset to task onset so TTFF is measured from task start.
    """
    tasks_def = parse_task_events(event_file_paths)
    df = parse_glasses3_gz(gazedata_path)
    df = to_pixel_coordinates(df, screen_w, screen_h)

    out_tasks: list[dict] = []
    for task in tasks_def:
        name = task["name"]
        start_s = task["start_s"]
        end_s = task["end_s"]
        seg = filter_glasses3_by_recording_window(
            df, start_s, end_s, reset_time_to_task_onset=True
        )
        stim = seg[seg["stimulus_id"] == 0].copy()
        block = analyze_gaze_dataframe_segment(
            stim,
            aois,
            algorithm=algorithm,
            velocity_threshold=velocity_threshold,
            dispersion_threshold=dispersion_threshold,
            min_fixation_duration_ms=min_fixation_duration_ms,
        )
        duration_s = round(end_s - start_s, 4)
        out_tasks.append({
            "name": name,
            "start_s": start_s,
            "end_s": end_s,
            "duration_s": duration_s,
            "fixations": block["fixations"],
            "aoi_metrics": block["aoi_metrics"],
            "summary": block["summary"],
        })

    return {"tasks": out_tasks}


def to_pixel_coordinates(df: pd.DataFrame, screen_w: int = 1920, screen_h: int = 1080) -> pd.DataFrame:
    """
    Convert normalized gaze coordinates (0-1) to pixel coordinates.
    
    Args:
        df: DataFrame from parse_tobii_json()
        screen_w: Screen width in pixels
        screen_h: Screen height in pixels
        
    Returns:
        Same DataFrame with added columns: [x_px, y_px]
    """
    df = df.copy()
    df["x_px"] = df["x_norm"] * screen_w
    df["y_px"] = df["y_norm"] * screen_h
    return df


# ──────────────────────────────────────────────────────────────────────────────
# STEP 2: FIXATION DETECTION ALGORITHMS
# ──────────────────────────────────────────────────────────────────────────────

def detect_fixations_ivt(
    timestamps_ms: np.ndarray,
    x_px: np.ndarray,
    y_px: np.ndarray,
    velocity_threshold: float = 100.0,
    min_fixation_duration_ms: float = 60.0,
    smoothing_window: int = 5,
    merge_max_gap_ms: float = 75.0,
    merge_max_distance_px: float = 50.0,
) -> list[Fixation]:
    """
    I-VT (Velocity-Threshold Identification) fixation detection.
    
    Implements the improved I-VT algorithm based on the Tobii I-VT fixation
    filter whitepaper (Olsen, 2012) with two key enhancements for handling
    low-frequency (50Hz) and noisy data:
    
    Enhancement 1 — Velocity Smoothing:
        Raw point-to-point velocity is very noisy at low sampling rates
        because even small gaze jitter (2-3px) produces large velocity spikes
        when divided by the short inter-sample interval. A moving average
        window smooths out these spikes before thresholding.
        Reference: Olsen (2012), "The Tobii I-VT fixation filter"
    
    Enhancement 2 — Fixation Merging:
        After initial classification, noise can split one real fixation into
        multiple short fragments separated by 1-2 "saccade" samples. The
        merging step rejoins fragments that are close in both time and space.
        Reference: Salvucci & Goldberg (2000), gap fill-in procedure
    
    The algorithm:
    1. Smooth x,y coordinates with a moving average window
    2. Calculate velocity from the smoothed signal
    3. Threshold: below = fixation, above = saccade
    4. Group consecutive fixation samples
    5. Merge nearby groups that were split by noise
    6. Discard groups shorter than minimum duration
    
    Args:
        timestamps_ms: Array of timestamps in milliseconds
        x_px: Array of x-coordinates in pixels
        y_px: Array of y-coordinates in pixels
        velocity_threshold: Max velocity (pixels/second) to count as fixation.
            Default 100 px/s works well after smoothing is applied. This is
            lower than the unsmoothed threshold because smoothing removes the
            noise spikes that previously inflated velocities.
        min_fixation_duration_ms: Minimum duration to count as a real fixation.
            Default 60ms follows Tobii's recommendation.
        smoothing_window: Number of samples for the moving average filter.
            Default 5 samples ≈ 100ms at 50Hz. Must be odd. Larger values
            smooth more aggressively but may blur saccade boundaries.
        merge_max_gap_ms: Maximum time gap between fixation fragments to merge.
            Default 75ms ≈ 3-4 samples at 50Hz. Bridges small noise gaps.
        merge_max_distance_px: Maximum spatial distance between fragment
            centroids to allow merging. Default 50px prevents merging
            fixations at genuinely different locations.
    
    Returns:
        List of detected Fixation objects
    """
    if len(timestamps_ms) < 2:
        return []

    # ── Enhancement 1: Smooth coordinates with moving median filter ──
    # Median filter is better than moving average for eye tracking because
    # it preserves the sharp transitions at fixation/saccade boundaries
    # while still removing noise spikes within fixations.
    if smoothing_window > 1:
        if smoothing_window % 2 == 0:
            smoothing_window += 1
        try:
            from scipy.ndimage import median_filter
        except ImportError as e:
            raise ImportError(
                "I-VT smoothing requires scipy. From your backend venv run: pip install 'scipy>=1.13.0'"
            ) from e
        x_smooth = median_filter(x_px, size=smoothing_window).astype(float)
        y_smooth = median_filter(y_px, size=smoothing_window).astype(float)
    else:
        x_smooth = x_px
        y_smooth = y_px

    # ── Calculate velocity from smoothed signal ──
    dt = np.diff(timestamps_ms)
    dx = np.diff(x_smooth)
    dy = np.diff(y_smooth)

    dt[dt == 0] = 0.001
    distance = np.sqrt(dx**2 + dy**2)
    velocity = distance / (dt / 1000.0)

    # ── Classify each sample ──
    is_fixation = np.zeros(len(timestamps_ms), dtype=bool)
    is_fixation[1:] = velocity < velocity_threshold
    is_fixation[0] = is_fixation[1] if len(is_fixation) > 1 else False

    # ── Group consecutive fixation samples into initial fragments ──
    fragments = []
    i = 0
    n = len(timestamps_ms)

    while i < n:
        if not is_fixation[i]:
            i += 1
            continue

        group_start = i
        while i < n and is_fixation[i]:
            i += 1
        group_end = i

        # Use ORIGINAL coordinates for fixation position (not smoothed),
        # because smoothing is only for velocity calculation
        fragments.append({
            "start_idx": group_start,
            "end_idx": group_end,
            "x": float(np.mean(x_px[group_start:group_end])),
            "y": float(np.mean(y_px[group_start:group_end])),
            "start_time": float(timestamps_ms[group_start]),
            "end_time": float(timestamps_ms[group_end - 1]),
        })

    # ── Enhancement 2: Merge nearby fragments ──
    # Noise can create 1-2 false "saccade" samples in the middle of a
    # fixation, splitting it into fragments. We merge fragments that are
    # close in both time and space.
    if len(fragments) > 1:
        merged = [fragments[0]]
        for frag in fragments[1:]:
            prev = merged[-1]
            time_gap = frag["start_time"] - prev["end_time"]
            spatial_dist = np.sqrt(
                (frag["x"] - prev["x"])**2 + (frag["y"] - prev["y"])**2
            )

            if time_gap <= merge_max_gap_ms and spatial_dist <= merge_max_distance_px:
                # Merge: extend the previous fragment to include this one
                prev["end_idx"] = frag["end_idx"]
                prev["end_time"] = frag["end_time"]
                # Recalculate centroid from all samples in merged range
                all_x = x_px[prev["start_idx"]:prev["end_idx"]]
                all_y = y_px[prev["start_idx"]:prev["end_idx"]]
                prev["x"] = float(np.mean(all_x))
                prev["y"] = float(np.mean(all_y))
            else:
                merged.append(frag)
        fragments = merged

    # ── Build final fixation list, filtering by minimum duration ──
    fixations = []
    for frag in fragments:
        duration = frag["end_time"] - frag["start_time"]
        if duration >= min_fixation_duration_ms:
            fixations.append(Fixation(
                x=frag["x"],
                y=frag["y"],
                start_time=frag["start_time"],
                end_time=frag["end_time"],
                duration=float(duration),
                num_samples=frag["end_idx"] - frag["start_idx"],
            ))

    return fixations


def detect_fixations_idt(
    timestamps_ms: np.ndarray,
    x_px: np.ndarray,
    y_px: np.ndarray,
    dispersion_threshold: float = 25.0,
    min_fixation_duration_ms: float = 100.0,
) -> list[Fixation]:
    """
    I-DT (Dispersion-Threshold Identification) fixation detection.
    
    How it works:
    1. Start with a sliding window of gaze samples covering the minimum duration.
    2. Calculate the "dispersion" of points in that window:
       dispersion = (max_x - min_x) + (max_y - min_y)
    3. If dispersion is BELOW the threshold → all those points are part of a fixation.
       Expand the window by one sample and check again.
    4. If dispersion is ABOVE the threshold → the current window is NOT a fixation.
       Remove the first sample and try again.
    5. When a fixation window stops growing, record it and move past it.
    
    This algorithm is more robust to noisy data because it looks at the spatial
    spread of a GROUP of samples rather than individual velocities. It's the most
    commonly used algorithm in usability research.
    
    Args:
        timestamps_ms: Array of timestamps in milliseconds
        x_px: Array of x-coordinates in pixels
        y_px: Array of y-coordinates in pixels  
        dispersion_threshold: Maximum allowed dispersion in pixels.
            Default 25px ≈ 0.5° visual angle at 60cm on a 24" 1080p display.
        min_fixation_duration_ms: Minimum window duration.
            Default 100ms is the standard minimum for usability studies.
    
    Returns:
        List of detected Fixation objects
    """
    if len(timestamps_ms) < 2:
        return []

    fixations = []
    n = len(timestamps_ms)
    i = 0  # Start of current window

    while i < n:
        # ── Initialize window to cover minimum duration ──
        j = i + 1
        while j < n and (timestamps_ms[j] - timestamps_ms[i]) < min_fixation_duration_ms:
            j += 1

        if j >= n:
            break  # Not enough data left for a fixation

        # ── Check dispersion of current window ──
        window_x = x_px[i:j + 1]
        window_y = y_px[i:j + 1]
        dispersion = (window_x.max() - window_x.min()) + (window_y.max() - window_y.min())

        if dispersion <= dispersion_threshold:
            # This IS a fixation — try to expand it
            while j < n - 1:
                j += 1
                window_x = x_px[i:j + 1]
                window_y = y_px[i:j + 1]
                new_dispersion = (window_x.max() - window_x.min()) + (window_y.max() - window_y.min())

                if new_dispersion > dispersion_threshold:
                    j -= 1  # Step back — this sample broke the fixation
                    break

            # ── Record the fixation ──
            fixation_x = x_px[i:j + 1]
            fixation_y = y_px[i:j + 1]

            fixations.append(Fixation(
                x=float(np.mean(fixation_x)),
                y=float(np.mean(fixation_y)),
                start_time=float(timestamps_ms[i]),
                end_time=float(timestamps_ms[j]),
                duration=float(timestamps_ms[j] - timestamps_ms[i]),
                num_samples=j - i + 1,
            ))

            i = j + 1  # Move past this fixation
        else:
            # Not a fixation — slide window forward by one sample
            i += 1

    return fixations


# ──────────────────────────────────────────────────────────────────────────────
# STEP 3: AOI METRIC CALCULATIONS
# ──────────────────────────────────────────────────────────────────────────────

def compute_aoi_metrics(
    fixations: list[Fixation],
    aoi: AOI,
    stimulus_onset_time_ms: float = 0.0,
) -> AOIMetrics:
    """
    Compute all eye tracking metrics for a single AOI.
    
    This is the core analysis function. Given a list of fixations and an AOI,
    it calculates all four metrics used in usability evaluation.
    
    What each metric tells you about usability:
    
    - TFD (Total Fixation Duration): High TFD can mean the element is interesting
      OR confusing. Context matters — high TFD on a navigation menu = bad (users
      are struggling), high TFD on key content = good (users are engaged).
      
    - TTFF (Time to First Fixation): How quickly users notice an element.
      High TTFF on a CTA button = poor visual hierarchy. 
      Low TTFF on important content = good design.
      
    - AFD (Average Fixation Duration): Longer fixations suggest deeper processing
      or difficulty understanding. Short fixations suggest scanning behavior.
      
    - FC (Fixation Count): More fixations in an AOI can indicate importance
      or difficulty. Combined with AFD, it reveals the viewing pattern.
    
    Args:
        fixations: List of Fixation objects (from either I-VT or I-DT)
        aoi: The Area of Interest to analyze
        stimulus_onset_time_ms: When the stimulus first appeared (ms).
            TTFF is measured relative to this time.
            
    Returns:
        AOIMetrics with all computed values
    """
    # ── Find all fixations that land inside this AOI ──
    aoi_fixations = [f for f in fixations if aoi.contains(f.x, f.y)]

    fixation_count = len(aoi_fixations)

    if fixation_count == 0:
        return AOIMetrics(
            aoi_name=aoi.name,
            total_fixation_duration_ms=0.0,
            time_to_first_fixation_ms=None,  # Never looked at this AOI
            average_fixation_duration_ms=None,
            fixation_count=0,
        )

    # ── TFD: Sum of all fixation durations in this AOI ──
    total_fixation_duration = sum(f.duration for f in aoi_fixations)

    # ── TTFF: Time from stimulus onset to the START of the first fixation ──
    first_fixation = min(aoi_fixations, key=lambda f: f.start_time)
    time_to_first_fixation = first_fixation.start_time - stimulus_onset_time_ms

    # ── AFD: Average duration of fixations in this AOI ──
    average_fixation_duration = total_fixation_duration / fixation_count

    return AOIMetrics(
        aoi_name=aoi.name,
        total_fixation_duration_ms=round(total_fixation_duration, 2),
        time_to_first_fixation_ms=round(time_to_first_fixation, 2),
        average_fixation_duration_ms=round(average_fixation_duration, 2),
        fixation_count=fixation_count,
    )


# ──────────────────────────────────────────────────────────────────────────────
# STEP 4: HIGH-LEVEL ANALYSIS FUNCTION (What your FastAPI backend calls)
# ──────────────────────────────────────────────────────────────────────────────

def analyze_recording(
    filepath: str,
    aois: list[AOI],
    stimulus_id: int,
    screen_w: int = 1920,
    screen_h: int = 1080,
    algorithm: str = "idt",
    device_type: str = "glasses3",
    velocity_threshold: float = 100.0,
    dispersion_threshold: float = 25.0,
    min_fixation_duration_ms: float = 100.0,
) -> dict:
    """
    Full analysis pipeline: JSON file → fixations → AOI metrics.
    
    This is the main entry point your FastAPI backend should call.
    It chains together all the steps: parse → pixel conversion → fixation 
    detection → AOI metric computation.
    
    Args:
        filepath: Path to the Tobii JSON recording file
        aois: List of AOI definitions (from your webapp's AOI editor)
        stimulus_id: Which stimulus to analyze (matches stimulus_id in the JSON)
        screen_w: Screen width in pixels
        screen_h: Screen height in pixels
        algorithm: "ivt" or "idt" — which fixation detection to use
        velocity_threshold: For I-VT only (pixels/second)
        dispersion_threshold: For I-DT only (pixels)
        min_fixation_duration_ms: Minimum fixation duration for either algorithm
        
    Returns:
        Dictionary with:
        {
            "fixations": [...],          # All detected fixations
            "aoi_metrics": [...],        # Metrics for each AOI
            "summary": {                 # Overall statistics
                "total_fixations": int,
                "total_recording_duration_ms": float,
                "algorithm_used": str,
            }
        }
    """
    # ── Step 1: Parse and prepare data ──
    if device_type == "glasses3":
        df = parse_glasses3_gz(filepath)
        stimulus_id = 0
    else:
        df = parse_tobii_json(filepath)
    df = to_pixel_coordinates(df, screen_w, screen_h)

    # Filter to the requested stimulus
    stimulus_data = df[df["stimulus_id"] == stimulus_id].copy()
    
    if stimulus_data.empty:
        raise ValueError(f"No data found for stimulus_id={stimulus_id}")

    # Reset timestamps relative to this stimulus onset
    stimulus_onset = stimulus_data["timestamp_ms"].iloc[0]
    stimulus_data["timestamp_ms"] = stimulus_data["timestamp_ms"] - stimulus_onset

    timestamps = stimulus_data["timestamp_ms"].values
    x_coords = stimulus_data["x_px"].values
    y_coords = stimulus_data["y_px"].values

    # ── Step 2: Detect fixations ──
    if algorithm.lower() == "ivt":
        fixations = detect_fixations_ivt(
            timestamps, x_coords, y_coords,
            velocity_threshold=velocity_threshold,
            min_fixation_duration_ms=min_fixation_duration_ms,
        )
    elif algorithm.lower() == "idt":
        fixations = detect_fixations_idt(
            timestamps, x_coords, y_coords,
            dispersion_threshold=dispersion_threshold,
            min_fixation_duration_ms=min_fixation_duration_ms,
        )
    else:
        raise ValueError(f"Unknown algorithm: '{algorithm}'. Use 'ivt' or 'idt'.")

    # ── Step 3: Compute metrics for each AOI ──
    aoi_metrics = []
    for aoi in aois:
        metrics = compute_aoi_metrics(fixations, aoi, stimulus_onset_time_ms=0.0)
        aoi_metrics.append(asdict(metrics))

    # ── Step 4: Build response ──
    recording_duration = timestamps[-1] - timestamps[0] if len(timestamps) > 0 else 0.0

    return {
        "fixations": [asdict(f) for f in fixations],
        "aoi_metrics": aoi_metrics,
        "summary": {
            "total_fixations": len(fixations),
            "total_recording_duration_ms": round(recording_duration, 2),
            "algorithm_used": algorithm.lower(),
            "parameters": {
                "velocity_threshold": velocity_threshold if algorithm.lower() == "ivt" else None,
                "dispersion_threshold": dispersion_threshold if algorithm.lower() == "idt" else None,
                "min_fixation_duration_ms": min_fixation_duration_ms,
            },
        },
    }


# ──────────────────────────────────────────────────────────────────────────────
# EXAMPLE / TEST USAGE
# ──────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    """
    Quick test with the sample data. Run this file directly to verify 
    everything works before integrating with your FastAPI backend.
    
    Usage: python eyetracking_analysis.py
    """
    import json
    import sys

    # ── Test with sample data ──
    test_file = "subject_1_2022_03_15_11_34_30_tobii_eyetracking_data.json"

    # Define some example AOIs (you'd get these from your webapp's AOI editor)
    test_aois = [
        AOI(name="Top-Left Area",    x=0,   y=0,   width=960, height=540),
        AOI(name="Top-Right Area",   x=960, y=0,   width=960, height=540),
        AOI(name="Bottom-Left Area", x=0,   y=540, width=960, height=540),
        AOI(name="Bottom-Right Area",x=960, y=540, width=960, height=540),
        AOI(name="Center Area",      x=660, y=340, width=600, height=400),
    ]

    print("=" * 70)
    print("EYE TRACKING ANALYSIS MODULE — TEST RUN")
    print("=" * 70)

    for algo in ["ivt", "idt"]:
        print(f"\n{'─' * 70}")
        print(f"Algorithm: {algo.upper()}")
        print(f"{'─' * 70}")

        try:
            results = analyze_recording(
                filepath=test_file,
                aois=test_aois,
                stimulus_id=1,  # Analyze stimulus 1 (first real image)
                algorithm=algo,
            )

            summary = results["summary"]
            print(f"\nTotal fixations detected: {summary['total_fixations']}")
            print(f"Recording duration: {summary['total_recording_duration_ms']:.0f} ms")
            print(f"\nAOI Metrics:")
            print(f"{'AOI Name':<20} {'TFD (ms)':>10} {'TTFF (ms)':>10} {'AFD (ms)':>10} {'Count':>6}")
            print(f"{'-'*20} {'-'*10} {'-'*10} {'-'*10} {'-'*6}")

            for m in results["aoi_metrics"]:
                ttff = f"{m['time_to_first_fixation_ms']:>10.0f}" if m["time_to_first_fixation_ms"] is not None else "     Never"
                afd = f"{m['average_fixation_duration_ms']:>10.0f}" if m["average_fixation_duration_ms"] is not None else "       N/A"
                print(f"{m['aoi_name']:<20} {m['total_fixation_duration_ms']:>10.0f} {ttff} {afd} {m['fixation_count']:>6}")

        except FileNotFoundError:
            print(f"Test file not found: {test_file}")
            print("Place the sample JSON in the same directory to test.")
        except Exception as e:
            print(f"Error: {e}")

    print(f"\n{'=' * 70}")
    print("Test complete. This module is ready for FastAPI integration.")
    print("=" * 70)
