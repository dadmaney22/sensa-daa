# Eye-Tracking Calibration Validation (Thesis Subsection — Draft)

> Thesis-ready expansion of §3 of `CONTRIBUTION_AND_REFERENCES.md`. Drop into the
> Implementation / System Design chapter. Citations use author–year; reconcile
> with the bibliography in `CONTRIBUTION_AND_REFERENCES.md` §5 and your chosen
> style before submission. Figure and equation numbers are placeholders
> (`X`, `Y`) to be renumbered in the final document.

---

## X.X  Validation of Eye-Tracking Calibration Quality

### X.X.1  Rationale

A calibration routine maps a participant's raw eye images to on-screen gaze
coordinates, but the *act of calibrating does not guarantee that the resulting
gaze estimates are accurate*. Calibration quality varies with eye physiology,
ambient lighting, head position, and the calibration procedure itself (Nyström,
Andersson, Holmqvist & van de Weijer, 2013). A separate **validation** step is
therefore required: after calibration, the system presents targets at known
locations and measures how closely the recorded gaze corresponds to them. This
is standard practice in eye-tracking methodology and is the only way to obtain an
objective, reportable statement of data quality (Holmqvist, Nyström & Mulvey,
2012).

Sensa uses a consumer-grade Tobii 4C eye tracker. The 4C's gaze model is
constructed and stored by the manufacturer's own runtime; the system under study
deliberately does **not** attempt to reimplement gaze estimation. Instead, the
contribution of this work is a **transparent, hardware-grounded validation layer**
that quantifies the quality of whatever calibration the Tobii runtime has
produced, and reports it in the units conventional to the field. This separation
is important for the experimental design: because the gaze model is produced by
the identical Tobii runtime in both the unified (Sensa) and fragmented (native
tools) conditions, the validation layer functions as a *neutral scorer* rather
than as part of the apparatus being compared (see Methodology, "Why this design
is valid").

### X.X.2  Two distinct quality measures: accuracy and precision

Eye-tracking data quality is conventionally decomposed into two orthogonal
quantities (Holmqvist et al., 2011):

- **Accuracy** — the *systematic* offset between the true target location and the
  mean recorded gaze position. It captures bias: a consistently displaced gaze
  estimate.
- **Precision** — the *random* dispersion of successive gaze samples about their
  own mean. It captures noise: an unstable, jittery estimate, independent of
  whether the mean is correctly placed.

Both are reported in **degrees of visual angle** rather than in pixels or
millimetres. The visual angle normalises the measurement for both the physical
size of the display and the participant's distance from it, so that a quality
figure obtained on one apparatus is comparable to another — the reason it is the
field-standard unit (Holmqvist et al., 2011; Holmqvist, Nyström & Mulvey, 2012).

### X.X.3  Measurement procedure

The validation layer proceeds in three stages.

**(1) Live measurement of viewing distance.** Before scoring, the system reads
the tracker's eye-position stream, which reports the three-dimensional position
of each eye relative to the device in millimetres. The depth (z) coordinate of
each valid eye is averaged, and twenty such samples (≈1 s) are averaged again to
obtain a stable estimate of the participant's viewing distance, `d`. Samples
outside a plausibility window (300–1200 mm) are discarded; if no valid sample is
obtained, a nominal default of 600 mm is used. Measuring `d` per participant — as
opposed to assuming a fixed field of view — is what makes the subsequent angular
conversion valid across individuals who seat themselves at slightly different
distances.

**(2) Five-target collection.** Five targets are presented at fixed,
normalised display coordinates (the four corners, inset, plus the centre). For
each target the system collects approximately 1.5 s of gaze data. Each sample
that contains a valid estimate from both eyes is reduced to a single
**binocular mean** by averaging the left and right gaze points; the per-sample
binocular means are then averaged across the collection window to yield the
target's mean gaze position, `(ḡx, ḡy)`. Averaging the two eyes is appropriate
for a quality summary of normal binocular viewing and is consistent with how the
live gaze cursor is presented to the operator.

**(3) Angular conversion.** Let `(tx, ty)` be the target's normalised
coordinates and `(ḡx, ḡy)` the mean gaze. The normalised offset is converted to a
physical on-screen distance using the known display width `W` (520 mm), and then
to an angle subtended at the eye using the measured viewing distance `d`:

```
e_norm = sqrt( (ḡx − tx)² + (ḡy − ty)² )                         (Eq. X.1)
e_mm   = e_norm · W                                              (Eq. X.2)
θ_acc  = atan2( e_mm , d ) · (180 / π)                           (Eq. X.3)
```

Equation X.3 is the definition of visual angle: the inverse tangent of the
on-screen error over the viewing distance. Precision is computed analogously from
the root-mean-square dispersion of the individual binocular samples about their
own mean:

```
s_norm = sqrt( (1/N) · Σᵢ [ (gxᵢ − ḡx)² + (gyᵢ − ḡy)² ] )         (Eq. X.4)
θ_prec = atan2( s_norm · W , d ) · (180 / π)                     (Eq. X.5)
```

where `N` is the number of valid binocular samples for that target.

### X.X.4  Pass criteria and reported metrics

A target is considered to **pass** if it yielded valid gaze data and its accuracy
`θ_acc` is within a configurable threshold, defaulting to **3°**. The session as a
whole passes if a sufficient number of targets are valid and the mean accuracy
across valid targets is within the threshold. The 3° default is chosen to reflect
the realistic performance of consumer trackers in the Tobii EyeX/4C family, which
typically achieve accuracy on the order of a few degrees under ordinary seating
and lighting conditions (Gibaldi, Vanegas, Bex & Maiello, 2017; Feit et al.,
2017); it is deliberately exposed as an adjustable control and reported alongside
the result, so that the pass criterion is explicit rather than hidden.

In addition to mean accuracy and precision, the layer reports:

- **Valid-data yield** — the proportion of collected samples that contained a
  valid gaze estimate, an established component of data-quality reporting
  (Holmqvist, Nyström & Mulvey, 2012);
- **Per-target accuracy** — the individual `θ_acc` for each of the five targets;
- **First-pass success** — whether validation passed without any re-calibration;
- **Re-calibration count** — the number of re-calibration attempts.

The last two are operationally meaningful as dependent variables for the
usability comparison: they capture how readily a correctly calibrated state is
reached, independent of the eventual numeric accuracy.

### X.X.5  Visualisation

Validation results are presented as a two-dimensional scatter plot that overlays,
in normalised display space, the five target locations and the corresponding mean
gaze positions. **Figure X.1** describes this visualisation.

> **Figure X.1.** *Validation result visualisation.* The plot represents the
> display area in normalised coordinates. Each of the five validation **targets**
> is drawn as a numbered ring at its known location. Each measured **mean gaze
> position** is drawn as a filled dot. A dashed **offset line** connects every
> target to its corresponding gaze dot; the length of this line is the visual
> representation of the accuracy error `e_mm` (Eq. X.2), and the angle it
> subtends at the eye is the reported accuracy `θ_acc` (Eq. X.3). Elements are
> colour-coded by the pass criterion: a target whose accuracy is within the
> threshold is shown in green, and one exceeding it in red, allowing the operator
> to identify at a glance both the magnitude and the spatial pattern of any
> systematic offset (for example, a consistent downward displacement across all
> targets, which would indicate a vertical calibration bias). During the
> collection itself, a live gaze cursor with a short fading trail is overlaid on
> the active target, providing immediate feedback that the participant is
> fixating and that valid data are being captured.

This visualisation communicates the two quality dimensions directly: the
*length* and *direction* of the offset lines express accuracy and any systematic
bias, while the *scatter* of repeated samples (shown during collection and
summarised by `θ_prec`) expresses precision. Presenting system status and
measurement outcome visibly and immediately follows established usability
guidance on visibility of system status and recognition over recall (Nielsen,
1994; Norman, 2013).

### X.X.6  Distinction from synthetic data

It is emphasised that no stage of the validation pipeline fabricates or
approximates the reported figures. The viewing distance, the gaze samples, and
hence the derived accuracy and precision are all obtained from the physical eye
tracker; where the hardware is absent the system reports an explicit
no-hardware state rather than substituting placeholder values. An earlier
iteration of the system had relied on a mock fallback and on a fixed
field-of-view constant to convert screen-space error to degrees; both were
removed in favour of the measured-distance angular computation described in
§X.X.3, which is the basis on which the reported quality figures can be defended.
