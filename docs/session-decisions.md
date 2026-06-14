# Sensa — Session Decisions & Discussion Log

_Last updated: 2026-06-14_

---

## 1. Eye Tracker Hardware

- **Device in use**: Tobii Eye Tracker 4C (consumer, serial prefix `IS404*`)
- **SDK used**: Tobii Stream Engine (32-bit DLL via PowerShell bridge) — NOT Tobii Pro SDK
- **Why not Pro SDK**: `tobii_research` has no wheel for Python 3.11+; also requires an analytical-use license which was not available
- **Decision taken**: Stream Engine bridge is the primary and current path. Pro SDK backend scaffolded as an optional addon (`services/pro_sdk_tracker.py` + `services/tracker.py`) — activates automatically if a Pro device is detected and `tobii_research` is installed. Existing 4C behaviour is unchanged.

---

## 2. Calibration Architecture (current implementation)

| Step | What happens | Notes |
|------|-------------|-------|
| Step 1 — Positioning | Live head distance via Stream Engine gaze origin subscription | Distance in mm; optimal range 550–700mm |
| Step 2 — Calibration | Launches Tobii consumer tray app (`Tobii.EyeX.Tray.exe`) | Sensa cannot calibrate 4C natively without analytical license |
| Step 3 — Validation | In-app 5-point accuracy check using live gaze stream | Accuracy/precision in degrees of visual angle |

**Parked**: If a Tobii Pro Spark is obtained, Step 2 should be replaced with native `tobii_research.ScreenBasedCalibration` inside Sensa — same algorithm as Pro Lab, removes the calibration algorithm confound.

---

## 3. Validation — Metrics

| Metric | Status | Notes |
|--------|--------|-------|
| Mean gaze accuracy (°) | ✅ Implemented | Per-point + average |
| Mean gaze precision RMS (°) | ✅ Implemented | Per-point + average |
| Valid data yield (%) | ❌ Not yet added | `valid_samples / total_samples` — data already available |
| First-pass calibration success (0/1) | ❌ Not logged | Critical DV for thesis H5 |
| Recalibration attempt count | ❌ Not logged | Critical DV for thesis H5 |

**Decision**: Logging of first-pass success and recalibration count is parked until study device/design is confirmed. These become highest-priority Sensa features once confirmed.

---

## 4. Pass Threshold

- **Default**: 3.0° (Tobii 4C consumer device typically achieves 2–3° in real conditions; 1.5° is research-grade and too strict)
- **Configurable**: Slider + number input in Step 2 UI, range 0.5°–5°
- **Sent to backend**: Via `accuracy_pass_deg` query param at `/validate/finish`
- **Decision**: Threshold is informational only — researcher can accept regardless of result ("Accept Anyway" button added). Matches conventional research practice where the researcher decides, not the software.

---

## 5. Gaze Cursor (validation overlay)

- Large translucent outer ring (120px) with glow
- No center dot (removed — outer ring is the visual anchor)
- Trail shows last 12 gaze positions with fading opacity
- Sized to match Tobii's own gaze indicator

---

## 6. Validation Scatter Plot (Step 3 results)

- Target rings numbered 1–5 at known screen positions
- Measured gaze dot at actual `mean_x`/`mean_y` returned by backend
- Dashed line connecting target to measured position
- Per-point colour: green if accuracy ≤ threshold, red if over threshold
- Accuracy in degrees shown below each ring
- **Decision**: A dot only turns green if within the configured threshold — not just "eyes were detected"

---

## 7. Overall Pass/Fail

- **Previous behaviour**: Hard gate — failed = blocked from continuing
- **Decision changed**: Now informational only
  - Pass → "Accept and Continue"
  - Fail → "Recalibrate Eye Tracker" (primary) + "Accept Anyway" (secondary, red-outlined)
- Matches conventional research practice: quality is shown, researcher decides

---

## 8. Validation Dot Positions

- 5 points: top-left, top-right, centre, bottom-left, bottom-right
- Positions: `x ∈ {0.1, 0.5, 0.9}`, `y ∈ {0.1, 0.5, 0.9}`
- **Decision**: Kept at original 10%/90% edge positions (a change to 15%/85% was made and then reverted)

---

## 9. Degree Computation — Known Limitations

Sensa computes degrees using two hardcoded constants:

```python
SCREEN_WIDTH_MM = 520.0   # may not match the study monitor
VIEWING_DISTANCE = 600.0  # hardcoded; Step 1 already measures live distance
```

If either is wrong, all degree values are proportionally wrong.

**Decision parked**: Make `SCREEN_WIDTH_MM` a configurable UI setting; use live Step 1 distance in the degree formula. Priority depends on whether Sensa's in-app numbers are cited as primary or supplementary data.

---

---

## 10. Thesis Study Design — H5 Analysis

### Hypothesis (exact wording)

> H5: Participants using a unified onboarding and calibration workflow will achieve calibration and data quality outcomes that are **equal or better** than those of participants using fragmented workflows, across the dimensions of (a) eye-tracking gaze accuracy and valid data yield, (b) biosignal integrity, and (c) first-pass calibration success.

### Study groups

| Group | Calibration method | Verification |
|-------|--------------------|-------------|
| A (baseline) | Tobii consumer tray app + OpenSignals (manual/fragmented) | Same instrument as Group B |
| B (Sensa) | Sensa guided calibration flow | Same instrument as Group B |

### Critical issue identified — calibration algorithm confound

If Group A uses Pro Lab calibration and Group B uses the consumer tray app, any quality difference could reflect the algorithm, not the workflow. **H5 is only cleanly testable if both groups use the same calibration algorithm.**

- With a Spark: Sensa uses Pro SDK (`ScreenBasedCalibration`) = same as Pro Lab → confound gone
- Without a Spark or analytical upgrade: both groups use consumer tray app → confound also gone, but gaze DVs lose their measurement instrument (consumer app gives no numbers)

### Statistical note (flagged — not actioned)

H5 uses "equal or better" (non-inferiority) framing but the analysis plan specifies two-tailed t-tests, which test for difference not equivalence. A non-significant result ≠ equivalence. **Recommend flagging to supervisor.** In the write-up, say "no significant difference was found" rather than "groups are equal."

---

## 11. Hardware Scenario Map

| Hardware available | Calibration algorithm | Verification instrument | H5(a) gaze DVs | Study viable? |
|--------------------|-----------------------|------------------------|----------------|---------------|
| Tobii Pro Spark (borrowed) | Pro SDK — same as Pro Lab | Pro Lab on Spark | Full (accuracy, precision, yield) | ✅ Cleanest |
| 4C + analytical upgrade (~€500–800) | Pro SDK via `tobii_research` | Pro Lab on 4C | Full | ✅ |
| 4C only, no upgrade, no Pro Lab | Consumer tray app (both groups) | No numerical instrument | ❌ Must drop | ✅ Narrower |

### If no Spark and no analytical upgrade

- H5(a) gaze accuracy/precision/yield: **dropped** — consumer tray app gives no numbers
- H5(a) reframed as: first-pass calibration success rate (eye tracker) only
- H5(b) biosignals: ✅ fully intact (OpenSignals + MNE-Python/neurokit2)
- H5(c) first-pass success: ✅ fully intact (observable from workflow behaviour)
- Note: this is a **cleaner comparison** in one respect — both groups use the same calibration algorithm, so the only variable is the workflow interface

### Consumer tray app has no validation numbers

Confirmed: the Tobii consumer tray app shows a visual gaze test (dot following eyes across points) but exports **no numbers** — no degrees, no yield, nothing. So without a research-grade SDK, H5(a) gaze quality DVs have no measurement instrument regardless of which groups use it.

---

## 12. Decisions Parked — Pending Monday Confirmation

| Decision | Waiting on | Impact |
|----------|-----------|--------|
| Native Pro SDK calibration in Step 2 | Spark availability | Removes calibration algorithm confound |
| H5(a) gaze DVs kept or dropped | Spark/Pro Lab availability | Determines study scope |
| 9-point validation grid in Sensa | Whether Sensa is the measurement instrument | Low priority if Pro Lab measures both groups |
| Session event logging (first-pass, recalibration count) | Study design confirmed | High priority regardless of scenario |
| `SCREEN_WIDTH_MM` configurable + live distance in formula | Study design confirmed | Priority if Sensa numbers cited as data |

---

## 13. Sensa Features Needed (by scenario)

### Both scenarios (always needed)
- Session event logging: first-pass calibration success (0/1) + recalibration attempt count, per sensor, exportable per participant
- "Accept Anyway" logged as first-pass failure + 0 additional recalibration attempts (not a success override)

### If Spark obtained
- Native `tobii_research.ScreenBasedCalibration` in Step 2 (replaces "Open Tobii Menu" button)
- Valid data yield (%) added to validation metrics
- Screen width configurable; live distance used in degree formula

### If no Spark
- No additional eye-tracker features needed beyond logging
- Biosensor calibration logging becomes the primary remaining feature
