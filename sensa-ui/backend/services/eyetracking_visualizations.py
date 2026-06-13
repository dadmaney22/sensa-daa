"""
Eye Tracking Visualization Service
====================================
Generates visualization images for the webapp's Analysis Results page.

Produces four types of output:
1. Gaze Heatmap     — Gaussian-blurred heatmap overlaid on stimulus with AOI boxes
2. Scan Path        — Fixation circles (sized by duration) connected by saccade lines
3. Fixation Sequence — Numbered fixation circles showing temporal order within AOIs
4. AOI Charts       — Bar charts for TFD, TTFF, and AOI comparison

Based on Andre's original OpenCV rendering, extended for web delivery.

Author: Shahzeb (extended from Andre's analyze_eyetracking_data.py)
License: GPL-3.0
"""

import cv2
import numpy as np
import matplotlib
matplotlib.use("Agg")  # Non-interactive backend for server use
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from pathlib import Path
from typing import Optional
from dataclasses import dataclass

from .eyetracking_analysis import (
    Fixation, AOI, AOIMetrics,
    parse_tobii_json, parse_glasses3_gz, to_pixel_coordinates,
    detect_fixations_idt, detect_fixations_ivt,
    compute_aoi_metrics,
    parse_task_events, filter_glasses3_by_recording_window,
)


# ──────────────────────────────────────────────────────────────────────────────
# COLOR PALETTE — matches your Sensa UI design system
# ──────────────────────────────────────────────────────────────────────────────

# AOI box colors (cycling through these for multiple AOIs)
AOI_COLORS = [
    (102, 102, 255),   # Purple-blue  (AOI #1 in your Figma)
    (255, 165, 0),     # Orange       (AOI #3 in your Figma)
    (255, 0, 128),     # Pink         (AOI #2 in your Figma)
    (0, 200, 150),     # Teal
    (255, 80, 80),     # Red
    (100, 200, 255),   # Light blue
]

# Chart colors matching your Figma
CHART_PRIMARY = "#7C6BFF"     # Purple from your bar charts
CHART_SECONDARY = "#C4B5FD"   # Light purple for secondary series
CHART_BG = "#FFFFFF"
CHART_TEXT = "#1F2937"
CHART_GRID = "#F3F4F6"

# TTFF color coding from your Figma design
TTFF_GREEN = "#16A34A"   # < 2000ms (good — noticed quickly)
TTFF_RED = "#DC2626"     # > 5000ms (bad — noticed late)
TTFF_GRAY = "#6B7280"    # Default


# ──────────────────────────────────────────────────────────────────────────────
# 1. GAZE HEATMAP
# ──────────────────────────────────────────────────────────────────────────────

def render_heatmap(
    gaze_x: np.ndarray,
    gaze_y: np.ndarray,
    stimulus_image: Optional[np.ndarray] = None,
    screen_w: int = 1920,
    screen_h: int = 1080,
    aois: Optional[list[AOI]] = None,
    sigma: int = 40,
    opacity: float = 0.55,
    output_path: Optional[str] = None,
    aoi_metrics: Optional[list[dict]] = None,
) -> np.ndarray:
    """
    Generate a gaze heatmap overlaid on the stimulus image.
    
    This builds on Andre's heatmap code but adds:
    - Configurable Gaussian blur (sigma controls spread)
    - AOI rectangle overlays with labels
    - Better color mapping with transparency
    
    How it works:
    1. Create a blank grayscale image the size of the screen
    2. Draw a filled circle at each gaze point (accumulating intensity)
    3. Apply Gaussian blur to smooth the points into a heat distribution
    4. Normalize and apply a color map (blue→green→yellow→red)
    5. Blend with the stimulus image at the given opacity
    6. Draw AOI boxes on top
    
    Args:
        gaze_x: Array of gaze x-coordinates in pixels
        gaze_y: Array of gaze y-coordinates in pixels
        stimulus_image: The stimulus image (BGR). If None, uses white background.
        screen_w: Screen width
        screen_h: Screen height
        aois: Optional list of AOIs to draw as overlays
        sigma: Gaussian blur kernel size (higher = more spread)
        opacity: Heatmap opacity over the stimulus (0-1)
        output_path: If provided, saves the image to this path
        
    Returns:
        BGR image as numpy array
    """
    # ── Create base heatmap from gaze points ──
    heatmap = np.zeros((screen_h, screen_w), dtype=np.float32)

    for x, y in zip(gaze_x, gaze_y):
        xi, yi = int(round(x)), int(round(y))
        if 0 <= xi < screen_w and 0 <= yi < screen_h:
            # Draw filled circle — intensity accumulates where gaze clusters
            cv2.circle(heatmap, (xi, yi), 12, 1.0, thickness=-1)

    # ── Smooth with Gaussian blur ──
    # This turns discrete gaze points into a smooth heat distribution.
    # Kernel size must be odd, so we ensure that.
    ksize = sigma * 2 + 1
    heatmap = cv2.GaussianBlur(heatmap, (ksize, ksize), sigma)

    # ── Normalize to 0-255 range ──
    if heatmap.max() > 0:
        heatmap = (heatmap / heatmap.max() * 255).astype(np.uint8)
    else:
        heatmap = heatmap.astype(np.uint8)

    # ── Apply color map ──
    # COLORMAP_JET: blue (low) → green → yellow → red (high attention)
    heatmap_colored = cv2.applyColorMap(heatmap, cv2.COLORMAP_JET)

    # Make low-attention areas transparent by creating an alpha mask
    # This way the stimulus shows through where there's little gaze activity
    alpha_mask = (heatmap.astype(np.float32) / 255.0)
    alpha_mask = np.stack([alpha_mask] * 3, axis=-1)

    # ── Blend with stimulus image ──
    if stimulus_image is not None:
        base = stimulus_image.copy()
        # Resize stimulus if needed
        if base.shape[:2] != (screen_h, screen_w):
            base = cv2.resize(base, (screen_w, screen_h))
    else:
        base = np.ones((screen_h, screen_w, 3), dtype=np.uint8) * 245  # Light gray

    # Blend: show heatmap only where there IS gaze data, keep stimulus elsewhere
    result = base.copy().astype(np.float32)
    heatmap_float = heatmap_colored.astype(np.float32)
    result = result * (1 - alpha_mask * opacity) + heatmap_float * (alpha_mask * opacity)
    result = np.clip(result, 0, 255).astype(np.uint8)

    # ── Draw AOI boxes ──
    if aois:
        result = _draw_aoi_boxes(result, aois, aoi_metrics)

    if output_path:
        cv2.imwrite(output_path, result)

    return result


# ──────────────────────────────────────────────────────────────────────────────
# 2. GAZE PLOT (SCAN PATH)
# ──────────────────────────────────────────────────────────────────────────────

def render_scanpath(
    fixations: list[Fixation],
    stimulus_image: Optional[np.ndarray] = None,
    screen_w: int = 1920,
    screen_h: int = 1080,
    aois: Optional[list[AOI]] = None,
    min_circle_radius: int = 15,
    max_circle_radius: int = 60,
    show_numbers: bool = True,
    output_path: Optional[str] = None,
    aoi_metrics: Optional[list[dict]] = None,
) -> np.ndarray:
    """
    Render a scan path visualization showing fixation locations and saccades.
    
    This is the "Gaze Plot (Scan Path)" tab in your Figma design.
    
    What it shows:
    - Circles at each fixation location, sized proportional to fixation duration
      (bigger circle = longer fixation = more processing time at that spot)
    - Lines connecting consecutive fixations showing the scan path order
    - Optional numbers inside circles showing temporal sequence
    
    Args:
        fixations: List of Fixation objects from the detection algorithm
        stimulus_image: Background image (BGR). None = white background.
        screen_w: Screen width
        screen_h: Screen height
        aois: Optional AOIs to draw
        min_circle_radius: Smallest fixation circle (shortest fixation)
        max_circle_radius: Largest fixation circle (longest fixation)
        show_numbers: Whether to show fixation sequence numbers
        output_path: If provided, saves to this path
        
    Returns:
        BGR image as numpy array
    """
    if stimulus_image is not None:
        img = stimulus_image.copy()
        if img.shape[:2] != (screen_h, screen_w):
            img = cv2.resize(img, (screen_w, screen_h))
    else:
        img = np.ones((screen_h, screen_w, 3), dtype=np.uint8) * 245

    if not fixations:
        # Draw placeholder text
        cv2.putText(img, "No fixations detected", (screen_w // 2 - 200, screen_h // 2),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.2, (150, 150, 150), 2)
        if output_path:
            cv2.imwrite(output_path, img)
        return img

    # ── Calculate circle sizes proportional to duration ──
    durations = [f.duration for f in fixations]
    min_dur = min(durations) if durations else 1
    max_dur = max(durations) if durations else 1
    dur_range = max_dur - min_dur if max_dur > min_dur else 1

    def duration_to_radius(dur):
        normalized = (dur - min_dur) / dur_range
        return int(min_circle_radius + normalized * (max_circle_radius - min_circle_radius))

    # ── Draw saccade lines (connections between fixations) ──
    for i in range(1, len(fixations)):
        p1 = (int(fixations[i - 1].x), int(fixations[i - 1].y))
        p2 = (int(fixations[i].x), int(fixations[i].y))
        cv2.line(img, p1, p2, (160, 100, 160), 2, cv2.LINE_AA)

        # Draw arrow tip for direction
        length = np.sqrt((p2[0] - p1[0]) ** 2 + (p2[1] - p1[1]) ** 2)
        if length > 30:
            cv2.arrowedLine(img, p1, p2, (160, 100, 160),
                            thickness=2, tipLength=min(12 / length, 0.3),
                            line_type=cv2.LINE_AA)

    # ── Draw fixation circles ──
    for i, fix in enumerate(fixations):
        x, y = int(fix.x), int(fix.y)
        r = duration_to_radius(fix.duration)

        # Semi-transparent filled circle
        overlay = img.copy()
        cv2.circle(overlay, (x, y), r, (180, 130, 255), -1)  # Purple fill
        cv2.addWeighted(overlay, 0.4, img, 0.6, 0, img)

        # Solid border
        cv2.circle(img, (x, y), r, (128, 80, 200), 2, cv2.LINE_AA)

        # ── Fixation number ──
        if show_numbers:
            label = str(i + 1)
            font = cv2.FONT_HERSHEY_SIMPLEX
            font_scale = max(0.4, r / 40)
            thickness = max(1, int(r / 25))
            text_size = cv2.getTextSize(label, font, font_scale, thickness)[0]
            tx = x - text_size[0] // 2
            ty = y + text_size[1] // 2
            cv2.putText(img, label, (tx, ty), font, font_scale, (60, 20, 100), thickness, cv2.LINE_AA)

    # ── Highlight first fixation ──
    if fixations:
        fx, fy = int(fixations[0].x), int(fixations[0].y)
        r0 = duration_to_radius(fixations[0].duration)
        cv2.circle(img, (fx, fy), r0 + 4, (0, 255, 255), 3, cv2.LINE_AA)  # Yellow ring

    # ── Draw AOI boxes ──
    if aois:
        img = _draw_aoi_boxes(img, aois, aoi_metrics)

    if output_path:
        cv2.imwrite(output_path, img)

    return img


# ──────────────────────────────────────────────────────────────────────────────
# 3. FIXATION SEQUENCE (within AOIs)
# ──────────────────────────────────────────────────────────────────────────────

def render_fixation_sequence(
    fixations: list[Fixation],
    aois: list[AOI],
    stimulus_image: Optional[np.ndarray] = None,
    screen_w: int = 1920,
    screen_h: int = 1080,
    output_path: Optional[str] = None,
    aoi_metrics: Optional[list[dict]] = None,
) -> np.ndarray:
    """
    Render fixation sequence showing which AOIs were visited and in what order.
    
    This is the "Fixation Sequence" tab in your Figma design. It's similar to
    the scan path but emphasizes the AOI-level visit pattern.
    
    Each fixation is colored by which AOI it falls in, and a connecting path
    shows the order of AOI visits. Fixations outside all AOIs are shown in gray.
    
    Args:
        fixations: List of Fixation objects
        aois: List of AOI definitions
        stimulus_image: Background image
        screen_w: Screen width
        screen_h: Screen height
        output_path: If provided, saves to this path
        
    Returns:
        BGR image as numpy array
    """
    if stimulus_image is not None:
        img = stimulus_image.copy()
        if img.shape[:2] != (screen_h, screen_w):
            img = cv2.resize(img, (screen_w, screen_h))
    else:
        img = np.ones((screen_h, screen_w, 3), dtype=np.uint8) * 245

    if not fixations or not aois:
        if output_path:
            cv2.imwrite(output_path, img)
        return img

    # ── Draw AOI boxes first (background layer) ──
    img = _draw_aoi_boxes(img, aois, aoi_metrics)

    # ── Assign each fixation to an AOI (or None) ──
    def get_aoi_index(fix: Fixation) -> int:
        """Returns AOI index or -1 if outside all AOIs."""
        for idx, aoi in enumerate(aois):
            if aoi.contains(fix.x, fix.y):
                return idx
        return -1

    # ── Draw connecting lines ──
    for i in range(1, len(fixations)):
        p1 = (int(fixations[i - 1].x), int(fixations[i - 1].y))
        p2 = (int(fixations[i].x), int(fixations[i].y))
        cv2.line(img, p1, p2, (200, 180, 200), 1, cv2.LINE_AA)

    # ── Draw fixation dots colored by AOI ──
    for i, fix in enumerate(fixations):
        x, y = int(fix.x), int(fix.y)
        aoi_idx = get_aoi_index(fix)

        if aoi_idx >= 0:
            color = AOI_COLORS[aoi_idx % len(AOI_COLORS)]
        else:
            color = (180, 180, 180)  # Gray for outside AOIs

        # Circle sized by duration
        radius = max(6, min(25, int(fix.duration / 20)))
        cv2.circle(img, (x, y), radius, color, -1, cv2.LINE_AA)
        cv2.circle(img, (x, y), radius, (255, 255, 255), 1, cv2.LINE_AA)

        # Sequence number
        label = str(i + 1)
        font_scale = max(0.3, radius / 30)
        text_size = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, font_scale, 1)[0]
        tx = x - text_size[0] // 2
        ty = y + text_size[1] // 2
        cv2.putText(img, label, (tx, ty), cv2.FONT_HERSHEY_SIMPLEX,
                    font_scale, (255, 255, 255), 1, cv2.LINE_AA)

    if output_path:
        cv2.imwrite(output_path, img)

    return img


# ──────────────────────────────────────────────────────────────────────────────
# 4. AOI METRIC CHARTS (Matplotlib)
# ──────────────────────────────────────────────────────────────────────────────

def render_tfd_chart(
    aoi_metrics: list[dict],
    output_path: str,
    width: int = 700,
    height: int = 400,
) -> str:
    """
    Render "Total Fixation Duration per AOI" bar chart.
    Matches the left chart in Image 2 of your Figma design.
    """
    fig, ax = _create_chart_figure(width, height)

    names = [m["aoi_name"] for m in aoi_metrics]
    values = [m["total_fixation_duration_ms"] for m in aoi_metrics]

    bars = ax.bar(names, values, color=CHART_PRIMARY, width=0.5, zorder=3)
    ax.set_ylabel("Duration (ms)", fontsize=11, color=CHART_TEXT)
    ax.set_title("Total Fixation Duration per AOI", fontsize=13, fontweight="bold",
                 color=CHART_TEXT, pad=15)

    _style_chart(ax)
    fig.tight_layout()
    fig.savefig(output_path, dpi=150, bbox_inches="tight", facecolor=CHART_BG)
    plt.close(fig)
    return output_path


def render_ttff_chart(
    aoi_metrics: list[dict],
    output_path: str,
    width: int = 700,
    height: int = 400,
) -> str:
    """
    Render "Time to First Fixation per AOI" bar chart.
    Matches the right chart in Image 2 of your Figma design.
    Bars colored by severity: green (<2s), red (>5s).
    """
    fig, ax = _create_chart_figure(width, height)

    names = [m["aoi_name"] for m in aoi_metrics]
    values = [m["time_to_first_fixation_ms"] if m["time_to_first_fixation_ms"] is not None else 0
              for m in aoi_metrics]

    # Color bars by TTFF severity (matching your Figma color coding)
    colors = []
    for v, m in zip(values, aoi_metrics):
        if m["time_to_first_fixation_ms"] is None:
            colors.append("#D1D5DB")  # Gray — never fixated
        elif v < 2000:
            colors.append(TTFF_GREEN)
        elif v > 5000:
            colors.append(TTFF_RED)
        else:
            colors.append(CHART_PRIMARY)

    bars = ax.bar(names, values, color=colors, width=0.5, zorder=3)
    ax.set_ylabel("Time (ms)", fontsize=11, color=CHART_TEXT)
    ax.set_title("Time to First Fixation per AOI", fontsize=13, fontweight="bold",
                 color=CHART_TEXT, pad=15)

    _style_chart(ax)
    fig.tight_layout()
    fig.savefig(output_path, dpi=150, bbox_inches="tight", facecolor=CHART_BG)
    plt.close(fig)
    return output_path


def render_aoi_comparison_chart(
    aoi_metrics: list[dict],
    output_path: str,
    width: int = 700,
    height: int = 400,
) -> str:
    """
    Render combined AOI comparison chart with Total Time + Visit Count.
    Matches the chart in Image 4 of your Figma design.
    Two bars per AOI: TFD (purple) and Fixation Count (light purple).
    """
    fig, ax1 = _create_chart_figure(width, height)

    names = [m["aoi_name"] for m in aoi_metrics]
    tfd_values = [m["total_fixation_duration_ms"] for m in aoi_metrics]
    count_values = [m["fixation_count"] for m in aoi_metrics]

    x = np.arange(len(names))
    bar_width = 0.35

    bars1 = ax1.bar(x - bar_width / 2, tfd_values, bar_width,
                    label="Total Time", color=CHART_PRIMARY, zorder=3)

    # Secondary y-axis for fixation count (different scale)
    ax2 = ax1.twinx()
    bars2 = ax2.bar(x + bar_width / 2, count_values, bar_width,
                    label="Visit Count", color=CHART_SECONDARY, zorder=3)

    ax1.set_ylabel("Duration (ms)", fontsize=11, color=CHART_TEXT)
    ax2.set_ylabel("Fixation Count", fontsize=11, color=CHART_TEXT)
    ax1.set_title("Areas of Interest (AOI) Analysis", fontsize=13, fontweight="bold",
                  color=CHART_TEXT, pad=15)
    ax1.set_xticks(x)
    ax1.set_xticklabels(names, fontsize=10)

    # Combined legend
    lines1, labels1 = ax1.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax1.legend(lines1 + lines2, labels1 + labels2, loc="upper center",
               bbox_to_anchor=(0.5, -0.12), ncol=2, frameon=False, fontsize=10)

    _style_chart(ax1)
    ax2.spines["top"].set_visible(False)
    ax2.tick_params(colors=CHART_TEXT)

    fig.tight_layout()
    fig.savefig(output_path, dpi=150, bbox_inches="tight", facecolor=CHART_BG)
    plt.close(fig)
    return output_path


# ──────────────────────────────────────────────────────────────────────────────
# 5. HIGH-LEVEL FUNCTION — Generate all visualizations at once
# ──────────────────────────────────────────────────────────────────────────────

def generate_all_visualizations(
    recording_filepath: str,
    stimulus_id: int,
    aois: list[AOI],
    output_dir: str,
    stimulus_image_path: Optional[str] = None,
    screen_w: int = 1920,
    screen_h: int = 1080,
    algorithm: str = "idt",
    device_type: str = "glasses3",
    dispersion_threshold: float = 25.0,
    velocity_threshold: float = 100.0,
    min_fixation_duration_ms: float = 100.0,
    task_name: Optional[str] = None,
    event_file_paths: Optional[list[str]] = None,
) -> dict:
    """
    Generate ALL visualization images for the results page.
    
    This is the main function your FastAPI endpoint should call.
    It produces every image needed for all four tabs in your Figma design.
    
    Args:
        recording_filepath: Path to the recording file (.gz for Glasses 3, JSON for 4C)
        stimulus_id: Which stimulus to analyze (use 0 for Glasses 3)
        aois: List of AOI definitions from the frontend
        output_dir: Directory to save all generated images
        stimulus_image_path: Path to the stimulus image (for overlay)
        screen_w: Screen width
        screen_h: Screen height
        algorithm: "ivt" or "idt"
        device_type: "glasses3" or "4c"
        dispersion_threshold: For I-DT
        velocity_threshold: For I-VT
        min_fixation_duration_ms: Minimum fixation duration
        task_name: If set with ``event_file_paths``, only visualize gaze within that task window (Glasses 3).
        event_file_paths: Paths to Controller user-event JSON files (required when ``task_name`` is set).

    Returns:
        Dictionary with paths to all generated images
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    if task_name and not (event_file_paths and len(event_file_paths) > 0):
        raise ValueError("event_file_paths is required when task_name is set.")

    # ── Load and prepare data ──
    if device_type == "glasses3":
        df = parse_glasses3_gz(recording_filepath)
    else:
        df = parse_tobii_json(recording_filepath)
    df = to_pixel_coordinates(df, screen_w, screen_h)

    stim_data = df[df["stimulus_id"] == stimulus_id].copy()
    if stim_data.empty:
        raise ValueError(f"No data found for stimulus_id={stimulus_id}")
    if "recording_start_ms" in getattr(df, "attrs", {}):
        stim_data.attrs["recording_start_ms"] = df.attrs["recording_start_ms"]

    if task_name:
        if device_type != "glasses3":
            raise ValueError("task_name filtering is only supported for device_type='glasses3'.")
        tasks = parse_task_events(event_file_paths or [])
        match = next((t for t in tasks if t["name"] == task_name), None)
        if not match:
            raise ValueError(f"No paired task named {task_name!r} found in event files.")
        stim_data = filter_glasses3_by_recording_window(
            stim_data,
            match["start_s"],
            match["end_s"],
            reset_time_to_task_onset=True,
        )
        if stim_data.empty:
            raise ValueError(f"No gaze samples in task {task_name!r} time window.")
    else:
        # Reset timestamps to stimulus onset (first sample in segment)
        t0 = stim_data["timestamp_ms"].iloc[0]
        stim_data["timestamp_ms"] = stim_data["timestamp_ms"] - t0

    timestamps = stim_data["timestamp_ms"].values
    gaze_x = stim_data["x_px"].values
    gaze_y = stim_data["y_px"].values

    # ── Load stimulus image if provided ──
    stimulus_img = None
    if stimulus_image_path:
        stimulus_img = cv2.imread(stimulus_image_path)

    # ── Detect fixations ──
    if algorithm.lower() == "idt":
        fixations = detect_fixations_idt(
            timestamps, gaze_x, gaze_y,
            dispersion_threshold=dispersion_threshold,
            min_fixation_duration_ms=min_fixation_duration_ms,
        )
    else:
        fixations = detect_fixations_ivt(
            timestamps, gaze_x, gaze_y,
            velocity_threshold=velocity_threshold,
            min_fixation_duration_ms=min_fixation_duration_ms,
        )

    # ── Compute AOI metrics ──
    aoi_metrics = []
    for aoi in aois:
        metrics = compute_aoi_metrics(fixations, aoi, stimulus_onset_time_ms=0.0)
        aoi_metrics.append({
            "aoi_name": metrics.aoi_name,
            "total_fixation_duration_ms": metrics.total_fixation_duration_ms,
            "time_to_first_fixation_ms": metrics.time_to_first_fixation_ms,
            "average_fixation_duration_ms": metrics.average_fixation_duration_ms,
            "fixation_count": metrics.fixation_count,
        })

    # ── Generate all visualizations ──
    paths = {}

    # 1. Heatmap
    heatmap_path = str(output_dir / "heatmap.png")
    render_heatmap(gaze_x, gaze_y, stimulus_img, screen_w, screen_h, aois,
                   aoi_metrics=aoi_metrics, output_path=heatmap_path)
    paths["heatmap"] = heatmap_path

    # 2. Scan Path
    scanpath_path = str(output_dir / "scanpath.png")
    render_scanpath(fixations, stimulus_img, screen_w, screen_h, aois,
                    aoi_metrics=aoi_metrics, output_path=scanpath_path)
    paths["scanpath"] = scanpath_path

    # 3. Fixation Sequence
    fixseq_path = str(output_dir / "fixation_sequence.png")
    render_fixation_sequence(fixations, aois, stimulus_img, screen_w, screen_h,
                            aoi_metrics=aoi_metrics, output_path=fixseq_path)
    paths["fixation_sequence"] = fixseq_path

    # 4. Charts
    tfd_path = str(output_dir / "tfd_chart.png")
    render_tfd_chart(aoi_metrics, tfd_path)
    paths["tfd_chart"] = tfd_path

    ttff_path = str(output_dir / "ttff_chart.png")
    render_ttff_chart(aoi_metrics, ttff_path)
    paths["ttff_chart"] = ttff_path

    comparison_path = str(output_dir / "aoi_comparison_chart.png")
    render_aoi_comparison_chart(aoi_metrics, comparison_path)
    paths["aoi_comparison_chart"] = comparison_path

    total_fixation_count = len(fixations)
    avg_fixation_duration_ms = None
    if total_fixation_count > 0:
        avg_fixation_duration_ms = round(
            sum(f.duration for f in fixations) / total_fixation_count, 1
        )

    return {
        "image_paths": paths,
        "aoi_metrics": aoi_metrics,
        "fixation_count": total_fixation_count,
        "avg_fixation_duration_ms": avg_fixation_duration_ms,
        "algorithm": algorithm,
    }


# ──────────────────────────────────────────────────────────────────────────────
# HELPER FUNCTIONS
# ──────────────────────────────────────────────────────────────────────────────

def _draw_aoi_boxes(
    img: np.ndarray,
    aois: list[AOI],
    aoi_metrics: Optional[list[dict]] = None,
) -> np.ndarray:
    """Draw labeled AOI rectangles on an image, optionally with TFD/TTFF badges."""
    result = img.copy()

    for i, aoi in enumerate(aois):
        color = AOI_COLORS[i % len(AOI_COLORS)]
        x1, y1 = int(aoi.x), int(aoi.y)
        x2, y2 = int(aoi.x + aoi.width), int(aoi.y + aoi.height)

        # Semi-transparent fill
        overlay = result.copy()
        cv2.rectangle(overlay, (x1, y1), (x2, y2), color, -1)
        cv2.addWeighted(overlay, 0.08, result, 0.92, 0, result)

        # Solid border
        cv2.rectangle(result, (x1, y1), (x2, y2), color, 2, cv2.LINE_AA)

        # Label badge (bottom-left of box)
        label = f"AOI #{i + 1}"
        font = cv2.FONT_HERSHEY_SIMPLEX
        font_scale = 0.6
        text_size = cv2.getTextSize(label, font, font_scale, 2)[0]
        badge_x1 = x1
        badge_y1 = y2 - text_size[1] - 12
        badge_x2 = x1 + text_size[0] + 12
        badge_y2 = y2

        cv2.rectangle(result, (badge_x1, badge_y1), (badge_x2, badge_y2), color, -1)
        cv2.putText(result, label, (badge_x1 + 6, badge_y2 - 6),
                    font, font_scale, (255, 255, 255), 2, cv2.LINE_AA)

        # TFD / TTFF metrics badge (top-left inside box)
        if aoi_metrics and i < len(aoi_metrics):
            m = aoi_metrics[i]
            tfd = m.get("total_fixation_duration_ms", 0)
            ttff = m.get("time_to_first_fixation_ms")
            fc = m.get("fixation_count", 0)

            lines = [
                f"TFD: {int(round(tfd))} ms",
                f"TTFF: {int(round(ttff))} ms" if ttff is not None else "TTFF: --",
                f"Fixations: {fc}",
            ]
            metric_font_scale = 0.5
            line_h = 22
            pad = 8
            max_tw = max(
                cv2.getTextSize(ln, font, metric_font_scale, 1)[0][0] for ln in lines
            )
            box_w = max_tw + pad * 2
            box_h = line_h * len(lines) + pad * 2

            mx1 = x1 + 6
            my1 = y1 + 6
            mx2 = mx1 + box_w
            my2 = my1 + box_h

            overlay2 = result.copy()
            cv2.rectangle(overlay2, (mx1, my1), (mx2, my2), (0, 0, 0), -1)
            cv2.addWeighted(overlay2, 0.6, result, 0.4, 0, result)

            for li, ln in enumerate(lines):
                ty = my1 + pad + 14 + li * line_h
                cv2.putText(result, ln, (mx1 + pad, ty), font,
                            metric_font_scale, (255, 255, 255), 1, cv2.LINE_AA)

    return result


def _create_chart_figure(width: int = 700, height: int = 400):
    """Create a styled matplotlib figure matching the Sensa UI."""
    fig, ax = plt.subplots(figsize=(width / 100, height / 100))
    fig.patch.set_facecolor(CHART_BG)
    ax.set_facecolor(CHART_BG)
    return fig, ax


def _style_chart(ax):
    """Apply consistent styling to chart axes."""
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_color("#E5E7EB")
    ax.spines["bottom"].set_color("#E5E7EB")
    ax.tick_params(colors=CHART_TEXT, labelsize=10)
    ax.yaxis.grid(True, color=CHART_GRID, linestyle="-", linewidth=0.8, zorder=0)
    ax.set_axisbelow(True)


# ──────────────────────────────────────────────────────────────────────────────
# TEST
# ──────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    """Test visualization generation with sample data."""

    test_file = "subject_1_2022_03_15_11_34_30_tobii_eyetracking_data.json"
    test_aois = [
        AOI(name="Top-Left",     x=0,   y=0,   width=960, height=540),
        AOI(name="Top-Right",    x=960, y=0,   width=960, height=540),
        AOI(name="Bottom-Left",  x=0,   y=540, width=960, height=540),
        AOI(name="Bottom-Right", x=960, y=540, width=960, height=540),
    ]

    print("Generating all visualizations...")
    results = generate_all_visualizations(
        recording_filepath=test_file,
        stimulus_id=1,
        aois=test_aois,
        output_dir="./test_output",
        algorithm="idt",
    )

    print(f"\nGenerated {len(results['image_paths'])} images:")
    for name, path in results["image_paths"].items():
        print(f"  {name}: {path}")
    print(f"\nFixations detected: {results['fixation_count']}")
    print("\nAOI Metrics:")
    for m in results["aoi_metrics"]:
        print(f"  {m['aoi_name']}: TFD={m['total_fixation_duration_ms']}ms, "
              f"TTFF={m['time_to_first_fixation_ms']}ms, "
              f"FC={m['fixation_count']}")
