"""
TFD/TTFF validation module.

You can replace this file with your full validation script.
The /api/validate endpoint calls main() and returns its printed output.
"""


def main() -> None:
    print("TFD/TTFF validation module loaded.")
    print("Paste your validate_tfd_ttff.py implementation here.")
    print("Then open /api/validate to run and view the report.")

"""
Validation Script for TFD and TTFF Algorithms
===============================================
This script creates SYNTHETIC gaze data where we know the exact expected
TFD and TTFF values, then runs our analysis and checks if the output matches.

Why synthetic data?
- No publicly available benchmark dataset exists with ground truth TFD/TTFF
- With synthetic data, we DEFINE the fixations ourselves, so we know 
  exactly what the correct answer should be
- This is a standard validation approach in eye tracking research
  (see Frontiers paper: Andersson et al., 2017, "One algorithm to rule 
  them all? An evaluation and discussion of ten eye movement event-detection 
  algorithms")

How it works:
1. We create fake gaze data that simulates a person looking at known 
   locations for known durations
2. We define AOIs at those locations  
3. We run our I-DT algorithm on the synthetic data
4. We compare computed TFD/TTFF against expected values
5. If the error is within acceptable tolerance → algorithm is validated

Usage: python validate_tfd_ttff.py
"""

import numpy as np
import json
import gzip
import os
import sys
from dataclasses import dataclass

# Import our analysis module
sys.path.insert(0, os.path.dirname(__file__))
from eyetracking_analysis import (
    AOI, Fixation, 
    detect_fixations_idt, detect_fixations_ivt,
    compute_aoi_metrics,
)


# ──────────────────────────────────────────────────────────────────────────────
# STEP 1: Define synthetic fixation patterns with KNOWN ground truth
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class SyntheticFixation:
    """A fake fixation we plant in the data. We know exactly where and when."""
    center_x: float      # Pixel coordinate
    center_y: float
    start_ms: float      # When this fixation starts
    duration_ms: float   # How long this fixation lasts
    noise_px: float = 3.0  # Jitter added to simulate real eye tracker noise


def generate_synthetic_gaze(
    fixation_sequence: list[SyntheticFixation],
    sample_rate_hz: float = 50.0,
    saccade_duration_ms: float = 40.0,
    total_duration_ms: float = None,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Generate synthetic raw gaze data from a sequence of planted fixations.
    
    Between fixations, we generate saccade samples (fast movement).
    During fixations, we generate stable gaze with small noise.
    
    Args:
        fixation_sequence: List of planned fixations in chronological order
        sample_rate_hz: Simulated sampling rate
        saccade_duration_ms: Time for saccade between fixations
        total_duration_ms: Total duration (None = auto from last fixation)
        
    Returns:
        (timestamps_ms, x_px, y_px) arrays
    """
    dt = 1000.0 / sample_rate_hz  # Time between samples in ms

    if total_duration_ms is None:
        last = fixation_sequence[-1]
        total_duration_ms = last.start_ms + last.duration_ms + 200  # Buffer

    timestamps = np.arange(0, total_duration_ms, dt)
    x_coords = np.zeros(len(timestamps))
    y_coords = np.zeros(len(timestamps))

    # Default: random saccade-like movement (high velocity)
    np.random.seed(42)
    x_coords[:] = np.random.uniform(100, 1800, len(timestamps))
    y_coords[:] = np.random.uniform(100, 980, len(timestamps))

    # Overwrite with stable fixation data at the planned times
    for fix in fixation_sequence:
        mask = (timestamps >= fix.start_ms) & (timestamps < fix.start_ms + fix.duration_ms)
        n_samples = np.sum(mask)
        
        # Fixation = stable position + small Gaussian noise
        x_coords[mask] = fix.center_x + np.random.normal(0, fix.noise_px, n_samples)
        y_coords[mask] = fix.center_y + np.random.normal(0, fix.noise_px, n_samples)

    return timestamps, x_coords, y_coords


# ──────────────────────────────────────────────────────────────────────────────
# STEP 2: Define test scenarios
# ──────────────────────────────────────────────────────────────────────────────

def create_test_scenarios():
    """
    Each scenario has:
    - A list of synthetic fixations (what the "person" looked at)
    - AOI definitions
    - Expected ground truth TFD and TTFF for each AOI
    """
    scenarios = []

    # ── SCENARIO 1: Simple case — one fixation per AOI ──
    scenarios.append({
        "name": "Simple: One fixation per AOI",
        "fixations": [
            SyntheticFixation(center_x=200, center_y=200, start_ms=500,  duration_ms=300),
            SyntheticFixation(center_x=800, center_y=200, start_ms=1000, duration_ms=500),
            SyntheticFixation(center_x=200, center_y=600, start_ms=1700, duration_ms=200),
        ],
        "aois": [
            AOI(name="Top-Left",     x=100, y=100, width=300, height=300),
            AOI(name="Top-Right",    x=650, y=100, width=300, height=300),
            AOI(name="Bottom-Left",  x=100, y=500, width=300, height=300),
            AOI(name="Bottom-Right", x=650, y=500, width=300, height=300),
        ],
        "expected": {
            "Top-Left":     {"tfd": 300, "ttff": 500,  "fc": 1},
            "Top-Right":    {"tfd": 500, "ttff": 1000, "fc": 1},
            "Bottom-Left":  {"tfd": 200, "ttff": 1700, "fc": 1},
            "Bottom-Right": {"tfd": 0,   "ttff": None, "fc": 0},  # Never looked here
        },
    })

    # ── SCENARIO 2: Multiple fixations in same AOI (tests TFD accumulation) ──
    scenarios.append({
        "name": "Accumulation: Multiple fixations in same AOI",
        "fixations": [
            SyntheticFixation(center_x=200, center_y=200, start_ms=200,  duration_ms=400),
            SyntheticFixation(center_x=800, center_y=200, start_ms=800,  duration_ms=300),
            SyntheticFixation(center_x=250, center_y=250, start_ms=1300, duration_ms=350),
            SyntheticFixation(center_x=800, center_y=250, start_ms=1850, duration_ms=250),
            SyntheticFixation(center_x=180, center_y=180, start_ms=2300, duration_ms=500),
        ],
        "aois": [
            AOI(name="Left-Box",  x=100, y=100, width=300, height=300),
            AOI(name="Right-Box", x=650, y=100, width=300, height=300),
        ],
        "expected": {
            "Left-Box":  {"tfd": 1250, "ttff": 200, "fc": 3},  # 400 + 350 + 500
            "Right-Box": {"tfd": 550,  "ttff": 800, "fc": 2},  # 300 + 250
        },
    })

    # ── SCENARIO 3: Quick glances (short fixations near minimum threshold) ──
    scenarios.append({
        "name": "Edge case: Short fixations near minimum duration",
        "fixations": [
            SyntheticFixation(center_x=500, center_y=500, start_ms=100,  duration_ms=110),
            SyntheticFixation(center_x=500, center_y=500, start_ms=400,  duration_ms=150),
            SyntheticFixation(center_x=500, center_y=500, start_ms=800,  duration_ms=500),
        ],
        "aois": [
            AOI(name="Center", x=400, y=400, width=200, height=200),
        ],
        "expected": {
            "Center": {"tfd": 760, "ttff": 100, "fc": 3},  # 110 + 150 + 500
        },
    })

    # ── SCENARIO 4: TTFF precision — first fixation is brief ──
    scenarios.append({
        "name": "TTFF precision: First fixation is very short",
        "fixations": [
            SyntheticFixation(center_x=900, center_y=500, start_ms=0,    duration_ms=200),
            SyntheticFixation(center_x=200, center_y=200, start_ms=3000, duration_ms=120),
            SyntheticFixation(center_x=200, center_y=200, start_ms=5000, duration_ms=800),
        ],
        "aois": [
            AOI(name="Late-Discovery", x=100, y=100, width=300, height=300),
            AOI(name="Immediate",      x=800, y=400, width=200, height=200),
        ],
        "expected": {
            "Late-Discovery": {"tfd": 920,  "ttff": 3000, "fc": 2},
            "Immediate":      {"tfd": 200,  "ttff": 0,    "fc": 1},
        },
    })

    # ── SCENARIO 5: Glasses 3 format at 50Hz ──
    scenarios.append({
        "name": "Glasses 3 simulation: 50Hz sampling rate",
        "sample_rate": 50,
        "fixations": [
            SyntheticFixation(center_x=960, center_y=540, start_ms=500,  duration_ms=400),
            SyntheticFixation(center_x=300, center_y=300, start_ms=1200, duration_ms=600),
            SyntheticFixation(center_x=960, center_y=540, start_ms=2100, duration_ms=350),
        ],
        "aois": [
            AOI(name="Center-Screen", x=760, y=340, width=400, height=400),
            AOI(name="Corner",        x=200, y=200, width=200, height=200),
        ],
        "expected": {
            "Center-Screen": {"tfd": 750, "ttff": 500,  "fc": 2},  # 400 + 350
            "Corner":        {"tfd": 600, "ttff": 1200, "fc": 1},
        },
    })

    return scenarios


# ──────────────────────────────────────────────────────────────────────────────
# STEP 3: Run validation
# ──────────────────────────────────────────────────────────────────────────────

def validate_scenario(scenario: dict, algorithm: str = "idt", tolerance_ms: float = 80.0) -> dict:
    """
    Run one test scenario and compare results against expected values.
    
    Tolerance accounts for:
    - Discrete sampling (at 50Hz each sample is 20ms apart)
    - Fixation boundary detection uncertainty
    - I-DT window initialization
    
    A tolerance of 80ms means we accept results within ~4 samples of expected.
    """
    sample_rate = scenario.get("sample_rate", 50)
    
    timestamps, x_coords, y_coords = generate_synthetic_gaze(
        scenario["fixations"],
        sample_rate_hz=sample_rate,
    )

    # Detect fixations
    if algorithm == "idt":
        fixations = detect_fixations_idt(
            timestamps, x_coords, y_coords,
            dispersion_threshold=25.0,
            min_fixation_duration_ms=100.0,
        )
    else:
        fixations = detect_fixations_ivt(
            timestamps, x_coords, y_coords,
            velocity_threshold=300.0,
            min_fixation_duration_ms=60.0,
        )

    # Compute metrics for each AOI
    results = {}
    all_pass = True
    details = []

    for aoi in scenario["aois"]:
        metrics = compute_aoi_metrics(fixations, aoi, stimulus_onset_time_ms=0.0)
        expected = scenario["expected"][aoi.name]

        # ── Check TFD ──
        tfd_error = abs(metrics.total_fixation_duration_ms - expected["tfd"])
        tfd_pass = tfd_error <= tolerance_ms

        # ── Check TTFF ──
        if expected["ttff"] is None:
            ttff_pass = metrics.time_to_first_fixation_ms is None
            ttff_error = 0 if ttff_pass else float('inf')
        else:
            if metrics.time_to_first_fixation_ms is None:
                ttff_pass = False
                ttff_error = float('inf')
            else:
                ttff_error = abs(metrics.time_to_first_fixation_ms - expected["ttff"])
                ttff_pass = ttff_error <= tolerance_ms

        # ── Check Fixation Count ──
        fc_pass = metrics.fixation_count == expected["fc"]

        aoi_pass = tfd_pass and ttff_pass and fc_pass
        if not aoi_pass:
            all_pass = False

        details.append({
            "aoi": aoi.name,
            "pass": aoi_pass,
            "tfd": {
                "expected": expected["tfd"],
                "computed": metrics.total_fixation_duration_ms,
                "error": round(tfd_error, 1),
                "pass": tfd_pass,
            },
            "ttff": {
                "expected": expected["ttff"],
                "computed": metrics.time_to_first_fixation_ms,
                "error": round(ttff_error, 1) if ttff_error != float('inf') else "N/A",
                "pass": ttff_pass,
            },
            "fc": {
                "expected": expected["fc"],
                "computed": metrics.fixation_count,
                "pass": fc_pass,
            },
        })

    return {
        "scenario": scenario["name"],
        "algorithm": algorithm,
        "all_pass": all_pass,
        "fixations_detected": len(fixations),
        "details": details,
    }


# ──────────────────────────────────────────────────────────────────────────────
# STEP 4: Run all tests and print report
# ──────────────────────────────────────────────────────────────────────────────

def main():
    scenarios = create_test_scenarios()
    
    print("=" * 80)
    print("TFD & TTFF ALGORITHM VALIDATION REPORT")
    print("=" * 80)
    
    for algorithm in ["idt", "ivt"]:
        print(f"\n{'─' * 80}")
        print(f"ALGORITHM: {algorithm.upper()}")
        print(f"{'─' * 80}")
        
        total_pass = 0
        total_fail = 0
        
        for scenario in scenarios:
            result = validate_scenario(scenario, algorithm=algorithm)
            
            status = "✅ PASS" if result["all_pass"] else "❌ FAIL"
            print(f"\n  {status}  {result['scenario']}")
            print(f"         Fixations detected: {result['fixations_detected']}")
            
            for d in result["details"]:
                aoi_status = "✓" if d["pass"] else "✗"
                print(f"         {aoi_status} {d['aoi']}:")
                
                tfd = d["tfd"]
                tfd_mark = "✓" if tfd["pass"] else "✗"
                print(f"           TFD:  expected={tfd['expected']}ms, "
                      f"computed={tfd['computed']}ms, error={tfd['error']}ms {tfd_mark}")
                
                ttff = d["ttff"]
                ttff_mark = "✓" if ttff["pass"] else "✗"
                exp_str = f"{ttff['expected']}ms" if ttff['expected'] is not None else "None"
                comp_str = f"{ttff['computed']}ms" if ttff['computed'] is not None else "None"
                print(f"           TTFF: expected={exp_str}, "
                      f"computed={comp_str}, error={ttff['error']}ms {ttff_mark}")
                
                fc = d["fc"]
                fc_mark = "✓" if fc["pass"] else "✗"
                print(f"           FC:   expected={fc['expected']}, "
                      f"computed={fc['computed']} {fc_mark}")
            
            if result["all_pass"]:
                total_pass += 1
            else:
                total_fail += 1
        
        print(f"\n  {'─' * 40}")
        print(f"  {algorithm.upper()} Summary: {total_pass} passed, {total_fail} failed "
              f"out of {total_pass + total_fail} scenarios")

    print(f"\n{'=' * 80}")
    print("VALIDATION COMPLETE")
    print("=" * 80)
    print("\nInterpretation:")
    print("  - Errors under 80ms are acceptable (within 4 samples at 50Hz)")
    print("  - Fixation count mismatches indicate algorithm tuning needed")
    print("  - If I-DT passes but I-VT fails, that's expected for noisy data")
    print("  - Use these results to calibrate dispersion_threshold and")
    print("    min_fixation_duration_ms for your specific setup")


if __name__ == "__main__":
    main()
