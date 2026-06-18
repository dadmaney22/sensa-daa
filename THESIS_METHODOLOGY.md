# Thesis Methodology — Revised Plan

## Research Question
Comparing **fragmented tooling** (Group A) vs **unified tooling / Sensa** (Group B) for physiological data acquisition setup in research contexts.

## Key Constraints (Hardware Reality)
- Eye tracker: **Tobii 4C** (consumer device) — incompatible with Tobii Pro Lab
- Biosignal hardware: **biosignalsplux hub** — no impedance readout
- Eye calibration tool available: **Tobii Experience / Tobii Core** (native 4C app)
- Biosignal recording tool available: **OpenSignals** (free, same machine)

---

## The Two Conditions

| | Group A — Fragmented | Group B — Unified |
|---|---|---|
| Eye calibration | Tobii Experience/Core | Sensa guided workflow |
| Biosignal setup | OpenSignals | Sensa guided workflow |
| Guided? | Task sheet only | Sensa's step-by-step UI |

---

## Step-by-Step Session Protocol

### 0. Pre-session (experimenter only)
- Same room, monitor (520 mm width), seating distance, biosignalsplux + Tobii 4C rig for all participants
- Counterbalanced group assignment ready
- Fresh Tobii profile slot available
- OpenSignals installed and idle

### 1. Consent + Intake
- Consent form
- Demographics questionnaire
- Short tech-familiarity questionnaire

### 2. Setup Phase ← **THE MANIPULATION**
This is where the two groups diverge.

**Group A (fragmented):**
1. Participant follows printed task sheet
2. Opens **Tobii Experience** → creates/calibrates a new eye-tracking profile
3. Opens **OpenSignals** → attaches EDA/ECG/EEG sensors, runs signal check
4. Experimenter logs: setup time, errors, help requests

**Group B (unified):**
1. Participant follows **Sensa's guided workflow** end-to-end:
   - Positioning step (head distance feedback)
   - Eye calibration launch (Tobii Experience opened *from* Sensa)
   - 5-point gaze validation
   - Biosignal sensor attachment + signal check + 30s baseline
2. Experimenter logs: setup time, errors, help requests

**DVs captured here:**
- Setup time (stopwatch)
- Error count / help requests
- NASA-TLX (post-setup workload)
- SUS (post-setup usability, Group B only)

### 3. Verification Phase ← **IDENTICAL FOR BOTH GROUPS**
Experimenter operates both instruments. Participant sits still.

**Eye-tracking accuracy** (neutral instrument: Sensa 5-point grid):
- Run Sensa's validation grid once
- Record: accuracy°, precision°, valid-data yield per point
- Why neutral: Tobii's runtime built the gaze model in both arms — Sensa only displays the grid and scores the result

**Biosignal quality** (neutral instrument: OpenSignals):
- Record a fixed-duration baseline window in OpenSignals for both groups
- Export CSV, compute quality metrics offline:
  - EDA: CV ≤ 5%, drift ≤ 1500 ADC, no spike > 3000 ADC/s
  - ECG: range ≥ 500 ADC, per-window consistency ≥ 40% median, no clipping
  - EEG: RMS > 50 ADC, no burst > 3× median RMS, no flatline (std < 10 ADC)

### 4. Debrief
- Short preference interview
- Open-ended feedback

---

## Why This Design Is Valid

**No circularity:** Sensa is the *tool under study*, not the measurement instrument that produces the ground-truth quality numbers.
- Gaze model → built by Tobii's runtime (identical in both groups)
- Biosignal quality → measured by OpenSignals (held constant across both groups)
- Sensa's 5-point grid scores gaze *accuracy*, which Tobii's runtime determines — Sensa is a neutral scorer here

**H5 argument:** Sensa measures gaze accuracy using the same Tobii runtime that Group A uses natively. The measurement instrument is not Sensa — it is Tobii. Sensa is a transparent window onto Tobii's output.

---

## Thesis Sections That Need Revision

### 6.4.3 Apparatus
- Replace "Tobii Pro Lab" → **Tobii Experience / Tobii Core**
- Add note: Tobii 4C is a consumer device; Pro Lab is Pro-SDK-only and incompatible
- Keep OpenSignals, biosignalsplux hub as written

### 6.4.4 Procedure (Group A)
- Replace Pro Lab steps with **Tobii Experience** calibration flow
- Replace separate impedance check with **OpenSignals signal check** (same tool they use for recording)

### 6.4.4.1 Validation / Ground Truth
- Replace 9-point Pro Lab validation with **Sensa's 5-point validation grid**
- Note: Group B participants encountered this grid during setup — this is ecological realism (they practiced with the unified tool), not a confound, because the grid is experimenter-scored and both groups face it identically in the verification phase

### 6.4.5 Dependent Variables
- Remove "impedance check" DV — biosignalsplux does not expose electrode impedance
- Replace with biosignal quality metrics derived from the OpenSignals CSV export (see signal-specific thresholds above)

---

## Hypotheses Reference

| Hypothesis | What it tests | Measurement |
|---|---|---|
| H1 | Setup time shorter (Sensa) | Stopwatch, setup phase |
| H2 | Fewer errors (Sensa) | Error count, setup phase |
| H3 | Lower workload (Sensa) | NASA-TLX, post-setup |
| H4 | Higher usability (Sensa) | SUS, post-setup (Group B only) |
| H5 | Equivalent data quality (both groups) | Eye accuracy° via 5-pt grid + biosignal quality via OpenSignals, verification phase |
