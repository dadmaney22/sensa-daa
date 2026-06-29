# Contribution Statement & Academic References

> Personal contribution log and defence notes for the Sensa physiological data
> acquisition tool. Companion to `THESIS_METHODOLOGY.md`.

---

## 1. Role and how my contribution evolved

I joined the project as the **UI/UX designer** — responsible for the interaction
design, information architecture, visual design, and the end-to-end flow of the
guided setup wizard (study setup → sensor selection → project details →
readiness check → calibration). Over the course of the project my role expanded
from *designing* the interface to *implementing and refining the system itself*,
including the front-end behaviour, the front-end/back-end contract, and several
methodological decisions about how physiological data quality is measured and
reported.

This document separates **what I designed**, **what I implemented/changed**, and
**what I decided methodologically**, because each is defended differently in a
viva.

### Honest framing of tooling
Parts of the implementation were produced with AI-assisted pair-programming. The
defensible contribution is not "I hand-typed every line" — it is that I **set the
requirements, made the design and methodological decisions, directed the
implementation, and verified the outputs against real hardware and against the
psychophysiology literature.** This is the standard separation between
*authorship of decisions* and *mechanical production*, and it is how the
contribution should be presented. Where your institution requires disclosure of
AI assistance, disclose it; the intellectual contribution (the *why* and the
*is-this-correct*) is unaffected by it.

---

## 2. Contribution breakdown

### 2.1 UI / UX design (primary role)
- Designed the multi-step guided calibration wizard as the central UX concept:
  one linear, instrumented flow replacing fragmented, separate tools. This is the
  *independent variable* of the thesis (unified vs. fragmented tooling).
- Designed the per-sensor calibration flows (Placement → Connect → Signal Check →
  Baseline) as a consistent 4-step mental model across EDA/ECG/EEG, and the
  4-step eye-tracker flow (Instructions → Positioning → Calibration → Validation).
- Designed the readiness checklist, study-configuration summary, validation
  scatter-plot visualisation, live signal previews, and the completion/celebration
  state.
- **Defence basis:** usability/interaction-design principles (Nielsen heuristics;
  Norman's mental models; recognition-over-recall via the live status panels and
  inline validation). See §4.6.

### 2.2 Front-end implementation and behaviour (expanded role)
Concrete, attributable changes (traceable in git history):
- **Form validation & state lifting** — mandatory-field gating in Study Setup and
  Project Details, with lifted shared state so the configuration summary reflects
  real user input (`App.tsx`, `StudySetupStep.tsx`, `ProjectDetailsStep.tsx`).
- **Eye-tracker validation UI** — the 5-point grid, live gaze cursor + trail,
  configurable pass-threshold control, per-point green/red scoring, results
  scatter plot with target-to-gaze offset lines, and the metrics panel
  (accuracy°, precision°, valid-data yield, first-pass success, recalibration
  count) (`EyeTrackerCalibrationFlow.tsx`).
- **Calibration baseline UX** — live waveform during recording, export controls,
  step-gating logic, instructional copy, and physiologically-correct guidance
  (e.g. electrodes on the **non-dominant hand**; see §4.2).
- **Distance guidance** — corrected the on-screen viewing-distance target to the
  value actually used by the positioning logic.

### 2.3 Methodological / measurement decisions (expanded role)
These are the most thesis-relevant and the most defensible as original
contribution:
- **Real validation instead of mock/heuristic scoring.** Replaced a
  Tobii-Pro-SDK-or-mock layer (which returned hardcoded accuracy, or converted
  screen error to degrees via a fixed "≈35° FOV" fudge) with a hardware-grounded
  measurement: collect 1.5 s of binocular gaze per target and compute accuracy as
  a true **angle of visual angle** using the *measured* viewing distance. See §4.1.
- **Signal-specific baseline quality** instead of one generic threshold for all
  signals (EDA vs. ECG vs. EEG have different valid-signal definitions). See §4.3.
- **EDA reported in microsiemens (µS)** via the biosignalsplux transfer function,
  not raw ADC counts. See §4.2.
- **Choice of OpenSignals as the neutral measurement instrument** and the
  within-subjects A/B design rationale (already documented in
  `THESIS_METHODOLOGY.md`). See §4.4–4.5.

---

## 3. The eye-tracker validation layer — what to claim and how it works

**Claim:** I converted the eye-tracking quality check from a cosmetic/mocked
display into a real, defensible measurement of gaze accuracy and precision.

**How it works (one paragraph for the viva):**
The Tobii 4C builds its gaze model in its own runtime; Sensa does not replace
that. After calibration, Sensa runs a 5-point validation grid. For each target
it collects ~1.5 s of gaze samples, averages the two eyes per sample (binocular
mean), and takes the mean gaze position. It measures the participant's actual
viewing distance live from the tracker's eye-position stream. Accuracy is the
**angular offset** between the mean gaze and the target:

```
err_mm  = ||mean_gaze − target||  (normalised) × screen_width_mm
acc_deg = degrees( atan2(err_mm, viewing_distance_mm) )
```

Precision is the RMS spread of samples about their own mean, expressed in the
same angular units. A point passes if its accuracy is within a configurable
threshold (default 3°, realistic for a consumer 4C); the session passes if enough
points are valid and the mean accuracy is within threshold.

**Why this is correct (and defensible):** *Accuracy* (systematic offset from the
target) and *precision* (sample-to-sample dispersion) are the two standard,
distinct data-quality measures in eye-tracking, and reporting them in **degrees
of visual angle** is the field standard because it normalises for screen size and
seating distance (Holmqvist et al., 2011; Holmqvist, Nyström & Mulvey, 2012). The
angular conversion `θ = atan(offset / distance)` is the definition of visual
angle. Using the *measured* distance — rather than a fixed assumption — is what
makes the degree value valid across participants who sit at slightly different
distances. Consumer trackers in the Tobii EyeX/4C family realistically achieve a
few degrees under typical conditions, so a ~2–3° threshold is appropriate and
honest (Gibaldi et al., 2017; Feit et al., 2017).

---

## 4. Academic references mapped to each decision

> Full citations in §5. Each item below says *which decision it backs* so you can
> cite precisely in the viva and the write-up.

### 4.1 Eye-tracking accuracy/precision, degrees of visual angle, consumer-tracker thresholds
- **Holmqvist et al. (2011)** — definitive textbook definitions of *accuracy* and
  *precision*, and the use of degrees of visual angle. Backs the whole metric.
- **Holmqvist, Nyström & Mulvey (2012)** — "eye tracker data quality: what it is
  and how to measure it"; backs *valid-data yield* and the accuracy/precision
  split as quality measures.
- **Nyström et al. (2013)** — calibration method and eye physiology affect data
  quality; backs *why a post-calibration validation step is necessary at all*.
- **Gibaldi et al. (2017)** — evaluation of the **Tobii EyeX** (same consumer
  family as the 4C) for research; backs the realistic accuracy range and the
  decision to treat it as a usable-but-consumer-grade device.
- **Feit et al. (2017)** — accuracy/precision of eye tracking for everyday/
  interaction use and design implications; backs the *practical threshold* choice
  and the design framing.

### 4.2 EDA in microsiemens, electrode placement on the non-dominant hand
- **Boucsein (2012)** — the standard monograph on electrodermal activity; backs
  units (µS / skin conductance level), site selection, and signal interpretation.
- **Boucsein et al. (2012), *Psychophysiology* publication recommendations** —
  consensus standards: report skin conductance in µS, electrode siting on the
  **medial phalanges of the non-dominant hand**, recommended hardware/handling.
  Directly backs the "non-dominant hand" instruction and the µS reporting.
- **Braithwaite et al. (2013)** — practical guide to analysing EDA/SCRs and
  artifacts; backs the baseline-quality artifact checks (drift, movement spikes).

### 4.3 Signal-specific baseline quality (EDA vs. ECG vs. EEG)
- **EDA:** Boucsein (2012); Benedek & Kaernbach (2010) — phasic/tonic structure,
  why a slow DC signal is assessed by drift/CV, not by AC criteria.
- **ECG / HRV:** Task Force (1996); Berntson et al. (1997) — standards for cardiac
  signal measurement; backs range/consistency/clipping checks rather than CV
  (ECG is a zero-mean AC signal, so CV is meaningless).
- **EEG:** Picton et al. (2000) — guidelines for human electrophysiology; backs
  RMS/flatline/burst checks and "electrode disconnected" detection.
- **General defence point:** the contribution here is recognising that a *single*
  generic stability metric is invalid across modalities with different signal
  physics, and replacing it with per-modality criteria grounded in each field's
  measurement standards.

### 4.4 Physiological computing / multimodal setup as a research problem
- **Fairclough (2009)** — fundamentals of physiological computing; frames the
  whole product domain.
- **Cacioppo, Tassinary & Berntson (2017), *Handbook of Psychophysiology*** —
  authoritative reference for multimodal psychophysiological measurement.

### 4.5 Study design and statistics (already in THESIS_METHODOLOGY.md)
- **Within-subjects rationale & counterbalancing:** Field (2018).
- **Equivalence testing (TOST) for the "equal data quality" hypothesis:**
  Lakens (2017).
- **Workload measure (NASA-TLX):** Hart & Staveland (1988); Hart (2006).
- **Usability measure (SUS):** Brooke (1996); Bangor, Kortum & Miller (2008).

### 4.6 UI/UX design principles (your primary role)
- **Nielsen (1994)** — usability heuristics: *visibility of system status* (live
  signal/position panels), *error prevention* (mandatory-field gating),
  *recognition over recall* (configuration summary, inline labels).
- **Norman (2013)** — mental models, mapping, and feedback; backs the consistent
  step structure across sensors and the immediate validation feedback.
- **Cooper et al. (2014), *About Face*** — goal-directed interaction design; backs
  the guided-wizard structure.

---

## 5. Full citations

> Verify each against your institution's citation style and the original source
> before submission. Page numbers/editions noted where commonly cited.

**Eye tracking**
- Holmqvist, K., Nyström, M., Andersson, R., Dewhurst, R., Jarodzka, H., & Van de
  Weijer, J. (2011). *Eye Tracking: A Comprehensive Guide to Methods and
  Measures*. Oxford University Press.
- Holmqvist, K., Nyström, M., & Mulvey, F. (2012). Eye tracker data quality: What
  it is and how to measure it. In *Proceedings of the Symposium on Eye Tracking
  Research and Applications (ETRA '12)* (pp. 45–52). ACM.
- Nyström, M., Andersson, R., Holmqvist, K., & van de Weijer, J. (2013). The
  influence of calibration method and eye physiology on eyetracking data quality.
  *Behavior Research Methods, 45*(1), 272–288.
- Gibaldi, A., Vanegas, M., Bex, P. J., & Maiello, G. (2017). Evaluation of the
  Tobii EyeX eye tracking controller and Matlab toolkit for research. *Behavior
  Research Methods, 49*(3), 923–946.
- Feit, A. M., Williams, S., Toledo, A., Paradiso, A., Kulkarni, H., Kane, S., &
  Morris, M. R. (2017). Toward everyday gaze input: Accuracy and precision of eye
  tracking and implications for design. In *Proceedings of the 2017 CHI Conference
  on Human Factors in Computing Systems* (pp. 1118–1130). ACM.

**Electrodermal activity (EDA)**
- Boucsein, W. (2012). *Electrodermal Activity* (2nd ed.). Springer.
- Boucsein, W., Fowles, D. C., Grimnes, S., Ben-Shakhar, G., Roth, W. T., Dawson,
  M. E., & Filion, D. L. (2012). Publication recommendations for electrodermal
  measurements. *Psychophysiology, 49*(8), 1017–1034.
- Benedek, M., & Kaernbach, C. (2010). A continuous measure of phasic
  electrodermal activity. *Journal of Neuroscience Methods, 190*(1), 80–91.
- Braithwaite, J. J., Watson, D. G., Jones, R., & Rowe, M. (2013). A guide for
  analysing electrodermal activity (EDA) and skin conductance responses (SCRs)
  for psychological experiments. *Psychophysiology* (technical report).

**ECG / heart-rate variability**
- Task Force of the European Society of Cardiology and the North American Society
  of Pacing and Electrophysiology. (1996). Heart rate variability: Standards of
  measurement, physiological interpretation, and clinical use. *Circulation,
  93*(5), 1043–1065.
- Berntson, G. G., Bigger, J. T., Eckberg, D. L., et al. (1997). Heart rate
  variability: Origins, methods, and interpretive caveats. *Psychophysiology,
  34*(6), 623–648.

**EEG**
- Picton, T. W., Bentin, S., Berg, P., et al. (2000). Guidelines for using human
  event-related potentials to study cognition: Recording standards and
  publication criteria. *Psychophysiology, 37*(2), 127–152.

**Physiological computing / psychophysiology**
- Fairclough, S. H. (2009). Fundamentals of physiological computing. *Interacting
  with Computers, 21*(1–2), 133–145.
- Cacioppo, J. T., Tassinary, L. G., & Berntson, G. G. (Eds.). (2017). *Handbook
  of Psychophysiology* (4th ed.). Cambridge University Press.

**Study design and statistics**
- Field, A. (2018). *Discovering Statistics Using IBM SPSS Statistics* (5th ed.).
  SAGE.
- Lakens, D. (2017). Equivalence tests: A practical primer for t tests,
  correlations, and meta-analyses. *Social Psychological and Personality Science,
  8*(4), 355–362.
- Hart, S. G., & Staveland, L. E. (1988). Development of NASA-TLX (Task Load
  Index): Results of empirical and theoretical research. In *Advances in
  Psychology* (Vol. 52, pp. 139–183). North-Holland.
- Hart, S. G. (2006). NASA-Task Load Index (NASA-TLX); 20 years later. In
  *Proceedings of the Human Factors and Ergonomics Society Annual Meeting, 50*(9),
  904–908.
- Brooke, J. (1996). SUS: A "quick and dirty" usability scale. In P. W. Jordan,
  B. Thomas, B. A. Weerdmeester, & I. L. McClelland (Eds.), *Usability Evaluation
  in Industry* (pp. 189–194). Taylor & Francis.
- Bangor, A., Kortum, P. T., & Miller, J. T. (2008). An empirical evaluation of
  the System Usability Scale. *International Journal of Human–Computer
  Interaction, 24*(6), 574–594.

**UI/UX / interaction design**
- Nielsen, J. (1994). *Usability Engineering*. Morgan Kaufmann. (10 usability
  heuristics.)
- Norman, D. A. (2013). *The Design of Everyday Things* (revised & expanded ed.).
  Basic Books.
- Cooper, A., Reimann, R., Cronin, D., & Noessel, C. (2014). *About Face: The
  Essentials of Interaction Design* (4th ed.). Wiley.

---

## 6. Likely viva questions and short answers

- **"Isn't Sensa measuring its own performance — isn't that circular?"**
  No. The gaze model is built by Tobii's runtime (identical in both conditions);
  EDA quality is verified in OpenSignals (held constant). Sensa is a neutral
  scorer/recorder, not the measurement instrument. (See `THESIS_METHODOLOGY.md`
  §"Why This Design Is Valid".)
- **"Why degrees, not pixels?"** Degrees of visual angle normalise for screen
  size and viewing distance, which is the field-standard data-quality unit
  (Holmqvist et al., 2011).
- **"Why a 3° threshold?"** It reflects realistic consumer-tracker performance
  (Gibaldi et al., 2017; Feit et al., 2017); it is also configurable and reported,
  so the criterion is transparent.
- **"Why different baseline checks per signal?"** Because EDA (slow DC) and
  ECG/EEG (zero-mean AC) have different valid-signal definitions; one generic
  metric (e.g. coefficient of variation) is meaningless for AC signals.
- **"What exactly did you contribute vs. tooling?"** Design decisions,
  requirements, measurement methodology, and verification against hardware and
  literature — see §1 framing.
