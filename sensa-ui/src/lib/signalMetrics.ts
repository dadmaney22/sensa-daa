// Derives live "signal amplitude" and "noise level" indicators from the rolling
// buffer of raw samples shown in the calibration waveform charts. Used by the
// EDA / ECG / EEG calibration flows so those status rows reflect the actual
// incoming signal instead of a fixed label.

export type SignalTone = 'good' | 'warn' | 'bad' | 'idle';

export interface SignalQuality {
  label: string;
  tone: SignalTone;
}

export interface SignalMetrics {
  amplitude: number; // peak-to-peak swing in raw units
  noise: number; // median sample-to-sample |Δ| (robust to legitimate sharp peaks)
  noiseRatio: number; // noise relative to amplitude
  amplitudeQuality: SignalQuality;
  noiseQuality: SignalQuality;
}

// Raw values from the PLUX hub are 16-bit (0–65535). A near-flat trace means
// weak contact / no signal; a trace pinned near full scale means saturation.
const AMPLITUDE_FLAT = 20;
const AMPLITUDE_RAIL = 45000;

// Median |Δ| as a fraction of the peak-to-peak swing: low = smooth, high = jittery.
const NOISE_LOW = 0.12;
const NOISE_MED = 0.35;

export function computeSignalMetrics(values: number[]): SignalMetrics | null {
  // Need a handful of samples before the numbers are meaningful.
  if (values.length < 8) return null;

  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const amplitude = max - min;

  // Median of consecutive absolute differences. Median (not mean) so a few
  // legitimate sharp transitions — e.g. ECG R-peaks — don't read as "noise".
  const diffs: number[] = [];
  for (let i = 1; i < values.length; i++) diffs.push(Math.abs(values[i] - values[i - 1]));
  diffs.sort((a, b) => a - b);
  const noise = diffs[Math.floor(diffs.length / 2)] ?? 0;
  const noiseRatio = amplitude > 0 ? noise / amplitude : 0;

  let amplitudeQuality: SignalQuality;
  if (amplitude < AMPLITUDE_FLAT) amplitudeQuality = { label: 'Low', tone: 'warn' };
  else if (amplitude > AMPLITUDE_RAIL) amplitudeQuality = { label: 'High', tone: 'warn' };
  else amplitudeQuality = { label: 'Normal', tone: 'good' };

  let noiseQuality: SignalQuality;
  if (noiseRatio < NOISE_LOW) noiseQuality = { label: 'Low', tone: 'good' };
  else if (noiseRatio < NOISE_MED) noiseQuality = { label: 'Medium', tone: 'warn' };
  else noiseQuality = { label: 'High', tone: 'bad' };

  return { amplitude, noise, noiseRatio, amplitudeQuality, noiseQuality };
}

export function toneClasses(tone: SignalTone): { dot: string; text: string } {
  switch (tone) {
    case 'good':
      return { dot: 'bg-green-500', text: 'text-green-600' };
    case 'warn':
      return { dot: 'bg-yellow-500', text: 'text-yellow-600' };
    case 'bad':
      return { dot: 'bg-red-500', text: 'text-red-600' };
    default:
      return { dot: 'bg-gray-400', text: 'text-gray-500' };
  }
}
