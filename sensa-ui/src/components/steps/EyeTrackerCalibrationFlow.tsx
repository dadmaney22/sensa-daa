import { useState, useEffect } from 'react';
import { CheckCircle2, Check, XCircle, AlertCircle, CircleDot } from 'lucide-react';
import calibrationDiagram from '../../assets/eyetrackpos.png';

const DOT_COORDINATES = [
  { x: 0.1, y: 0.1 }, // Dot 0: Top-Left
  { x: 0.9, y: 0.1 }, // Dot 1: Top-Right
  { x: 0.5, y: 0.5 }, // Dot 2: Center
  { x: 0.1, y: 0.9 }, // Dot 3: Bottom-Left
  { x: 0.9, y: 0.9 }, // Dot 4: Bottom-Right
];

export default function EyeTrackerCalibrationFlow({ onFinish }: { onFinish: () => void }) {
  const [step, setStep] = useState(1);
  
  const [positioningPhase, setPositioningPhase] = useState<'instructions' | 'tracking'>('instructions');
  const [positionReady, setPositionReady] = useState(false);
  const [liveDistance, setLiveDistance] = useState<number | null>(null);

  const [deviceInfo, setDeviceInfo] = useState<{ bridge_available: boolean; device_connected: boolean; model: string | null; serial: string | null } | null>(null);
  const [wsMessageCount, setWsMessageCount] = useState(0);
  const [rawWsStatus, setRawWsStatus] = useState<string>('--');

  const [tobiiLaunchMsg, setTobiiLaunchMsg] = useState<string>('');

  const [calibrationPhase, setCalibrationPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [activeDot, setActiveDot] = useState(-1);
  const [gaze, setGaze] = useState<{ x: number; y: number; valid: boolean } | null>(null);
  const [gazeTrail, setGazeTrail] = useState<Array<{ x: number; y: number; id: number }>>([]);
  const [pointStatuses, setPointStatuses] = useState<Array<'pending' | 'collecting' | 'success' | 'fail'>>(['pending', 'pending', 'pending', 'pending', 'pending']);
  const [validationStatus, setValidationStatus] = useState<'passed' | 'failed'>('passed');
  const [accuracy, setAccuracy] = useState<string>('--');
  const [precision, setPrecision] = useState<string>('--');
  const [validPoints, setValidPoints] = useState<number>(0);
  // Accuracy pass threshold (degrees of visual angle). Default 2.5° suits the
  // consumer-grade 4C; researchers can tighten/loosen it per study.
  const [passThreshold, setPassThreshold] = useState<number>(2.5);

  // Fetch hardware status once on mount
  useEffect(() => {
    fetch('http://localhost:8000/api/calibration/status')
      .then(r => r.json())
      .then(d => setDeviceInfo(d))
      .catch(() => setDeviceInfo(null));
  }, []);

  // 1. Live Distance Positioning WebSocket Pipeline (Step 1b)
  useEffect(() => {
    if (step === 1 && positioningPhase === 'tracking') {
      const ws = new WebSocket('ws://localhost:8000/api/calibration/ws/position');

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setLiveDistance(Math.round(data.distance_mm));
          setPositionReady(data.status === 'optimal');
          setRawWsStatus(data.status);
          setWsMessageCount(c => c + 1);
        } catch (err) {
          console.error("Failed to parse positioning data:", err);
        }
      };

      ws.onerror = (error) => console.error("Positioning WebSocket Error:", error);
      
      return () => {
        ws.close();
      };
    }
  }, [step, positioningPhase]);

  // 2. Validation sequence — reads the live gaze stream and measures accuracy
  //    against each known target. (The 4C's gaze-model calibration itself is
  //    performed by Tobii's own software in Step 2.)
  useEffect(() => {
    if (calibrationPhase !== 'running') return;
    let cancelled = false;

    const sleep = (ms: number) => new Promise<void>(res => setTimeout(res, ms));

    const runValidation = async () => {
      try {
        await fetch('http://localhost:8000/api/calibration/validate/start', { method: 'POST' });
        setPointStatuses(['pending', 'pending', 'pending', 'pending', 'pending']);

        for (let i = 0; i < DOT_COORDINATES.length; i++) {
          if (cancelled) return;
          setActiveDot(i);
          setPointStatuses(s => { const n = [...s]; n[i] = 'collecting'; return n; });
          // Give the eye ~0.8s to settle, then collect (backend blocks ~1.5s).
          await sleep(800);
          if (cancelled) return;
          try {
            const res = await fetch('http://localhost:8000/api/calibration/validate/point', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(DOT_COORDINATES[i]),
            });
            const data = await res.json();
            const ok = data.valid && data.valid_samples > 0;
            setPointStatuses(s => { const n = [...s]; n[i] = ok ? 'success' : 'fail'; return n; });
          } catch (err) {
            console.error(`Error validating dot ${i}:`, err);
            setPointStatuses(s => { const n = [...s]; n[i] = 'fail'; return n; });
          }
          await sleep(400);
        }

        if (cancelled) return;
        const response = await fetch(`http://localhost:8000/api/calibration/validate/finish?accuracy_pass_deg=${passThreshold}`, { method: 'POST' });
        const results = await response.json();

        if (results.status === 'success') {
          setValidationStatus(results.overall_quality.toLowerCase() === 'pass' ? 'passed' : 'failed');
          setAccuracy(results.accuracy_degrees ? `${results.accuracy_degrees.toFixed(2)}°` : '--');
          setPrecision(results.precision_degrees ? `${results.precision_degrees.toFixed(2)}°` : '--');
          setValidPoints(results.valid_count || 0);
        } else {
          setValidationStatus('failed');
        }
      } catch (err) {
        console.error("Validation failed:", err);
        setValidationStatus('failed');
      }
      if (!cancelled) {
        setCalibrationPhase('done');
        setStep(3);
      }
    };

    runValidation();
    return () => { cancelled = true; };
  }, [calibrationPhase]);

  // Live gaze cursor — only while the fullscreen validation overlay is up.
  useEffect(() => {
    if (calibrationPhase !== 'running') {
      setGaze(null);
      setGazeTrail([]);
      return;
    }
    let nextId = 0;
    const ws = new WebSocket('ws://localhost:8000/api/calibration/ws/gaze');
    ws.onmessage = (event) => {
      try {
        const d = JSON.parse(event.data);
        if (d.valid) {
          setGaze({ x: d.x, y: d.y, valid: true });
          setGazeTrail(t => [...t.slice(-12), { x: d.x, y: d.y, id: nextId++ }]);
        } else {
          setGaze(g => (g ? { ...g, valid: false } : null));
        }
      } catch { /* ignore */ }
    };
    ws.onerror = () => { /* stream may not be up yet */ };
    return () => ws.close();
  }, [calibrationPhase]);

  return (
    <>
      {/* ==================== FULL SCREEN CALIBRATION OVERLAY ==================== */}
      {calibrationPhase === 'running' && (
        <div className="fixed inset-0 z-[100] bg-black text-white cursor-none animate-in fade-in duration-700">
          <div className="absolute top-16 w-full text-center text-sm font-medium text-gray-400">
            Validating tracking — focus on each dot as it lights up.
            <button
              onClick={() => { setCalibrationPhase('done'); setStep(3); }}
              className="block mx-auto mt-2 text-[10px] text-gray-800 hover:text-gray-500 cursor-pointer"
            >
              [Dev: Skip]
            </button>
          </div>

          {/* Full Screen Calibration Targets */}
          {[
            'absolute left-16 top-16',
            'absolute right-16 top-16',
            'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
            'absolute bottom-16 left-16',
            'absolute bottom-16 right-16',
          ].map((cls, i) => {
            const st = pointStatuses[i];
            const isActive = activeDot === i;
            const bg = isActive ? '#7C3AED' : st === 'success' ? '#10B981' : st === 'fail' ? '#EF4444' : 'transparent';
            const border = isActive ? '#7C3AED' : st === 'success' ? '#10B981' : st === 'fail' ? '#EF4444' : '#374151';
            return (
              <div key={i} className={`${cls} h-8 w-8 rounded-full border-2 transition-all duration-700 ease-in-out`}
                style={{ backgroundColor: bg, borderColor: border, transform: isActive ? 'scale(1.2)' : 'scale(1)' }}
              />
            );
          })}

          {/* Live gaze trail */}
          {gazeTrail.map((p, idx) => (
            <div
              key={p.id}
              className="pointer-events-none absolute rounded-full bg-cyan-400"
              style={{
                left: `${p.x * 100}%`,
                top: `${p.y * 100}%`,
                width: 10,
                height: 10,
                transform: 'translate(-50%, -50%)',
                opacity: ((idx + 1) / gazeTrail.length) * 0.4,
              }}
            />
          ))}

          {/* Live gaze cursor — sized to match Tobii's own gaze bubble:
              a large translucent ring with a solid inner dot. */}
          {gaze && (
            <div
              className="pointer-events-none absolute transition-all duration-75"
              style={{
                left: `${gaze.x * 100}%`,
                top: `${gaze.y * 100}%`,
                width: 120,
                height: 120,
                transform: 'translate(-50%, -50%)',
                opacity: gaze.valid ? 1 : 0.3,
              }}
            >
              {/* Outer bubble */}
              <div
                className="absolute inset-0 rounded-full"
                style={{
                  border: '3px solid #22D3EE',
                  backgroundColor: gaze.valid ? 'rgba(34,211,238,0.15)' : 'transparent',
                  boxShadow: '0 0 24px rgba(34,211,238,0.6)',
                }}
              />
              {/* Inner dot */}
              <div
                className="absolute rounded-full"
                style={{
                  left: '50%',
                  top: '50%',
                  width: 28,
                  height: 28,
                  transform: 'translate(-50%, -50%)',
                  backgroundColor: '#22D3EE',
                  boxShadow: '0 0 12px rgba(34,211,238,0.9)',
                }}
              />
            </div>
          )}

          {/* Gaze legend */}
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 text-center text-xs text-gray-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-cyan-400" /> live gaze
            </span>
            {gaze && !gaze.valid && <span className="ml-3 text-yellow-500">eyes not detected</span>}
          </div>
        </div>
      )}

      {/* ==================== NORMAL COMPONENT FLOW ==================== */}
      <div className="animate-in fade-in slide-in-from-right-4 duration-300">
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm md:p-8">
          
          {/* HEADER & STEPPER */}
          <div className="mb-8 flex flex-col justify-between gap-6 border-b border-gray-100 pb-6 md:flex-row md:items-end">
            <div>
              <h3 className="text-lg font-bold text-gray-900">
                Step {step}: <br/>
                {step === 1 && 'Position the participant'}
                {step === 2 && 'Run Calibration'}
                {step === 3 && 'Validate Calibration Results'}
              </h3>
            </div>

            {/* Stepper Graphic */}
            <div className="flex items-center">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center">
                  <div className="flex flex-col items-center gap-2">
                    <div className={`flex h-6 w-6 items-center justify-center rounded-full border-2 ${
                      step > i ? 'border-violet-600 bg-violet-600 text-white' : 
                      step === i ? 'border-violet-600 bg-white text-violet-600' : 
                      'border-gray-300 bg-white'
                    }`}>
                      {step > i ? <Check className="h-3 w-3" /> : <div className={`h-2 w-2 rounded-full ${step === i ? 'bg-violet-600' : 'bg-transparent'}`} />}
                    </div>
                    <span className="text-[10px] font-medium text-gray-500 uppercase">
                      {i === 1 && 'Positioning'}
                      {i === 2 && 'Calibration'}
                      {i === 3 && 'Validation'}
                    </span>
                  </div>
                  {i < 3 && (
                    <div className={`h-[2px] w-16 mb-6 ${step > i ? 'bg-violet-600' : 'bg-gray-200'}`} />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* STEP 1a: POSITIONING INSTRUCTIONS */}
          {step === 1 && positioningPhase === 'instructions' && (
            <div className="space-y-8 animate-in fade-in duration-300">
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
                The eye tracker needs to detect both eyes clearly. Your position before calibration directly affects accuracy.
              </div>

              <div className="flex w-full items-center justify-center rounded-xl bg-white py-4">
                <img 
                  src={calibrationDiagram} 
                  alt="Eye Tracker Positioning Diagram" 
                  className="max-h-80 w-auto object-contain" 
                />
              </div>

              <div className="rounded-lg border border-gray-200 bg-gray-100/50 p-6">
                 <h4 className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-700">
                   <div className="flex h-4 w-4 items-center justify-center rounded bg-gray-300 text-[10px] font-bold text-gray-600">-</div>
                   Instructions
                 </h4>
                 <ul className="space-y-5 text-sm text-gray-700">
                   <li className="flex items-start gap-3">
                     <CircleDot className="mt-0.5 h-5 w-5 shrink-0 text-violet-600" />
                     <div>
                       <span className="block font-semibold text-gray-900">Sit directly in front of the screen</span>
                       <span className="text-sm text-gray-500">Position yourself so the screen is at eye level</span>
                     </div>
                   </li>
                   <li className="flex items-start gap-3">
                     <CircleDot className="mt-0.5 h-5 w-5 shrink-0 text-violet-600" />
                     <div>
                       <span className="block font-semibold text-gray-900">Maintain approximately 90 cm distance</span>
                       <span className="text-sm text-gray-500">Roughly an arm's length from the monitor</span>
                     </div>
                   </li>
                   <li className="flex items-start gap-3">
                     <CircleDot className="mt-0.5 h-5 w-5 shrink-0 text-violet-600" />
                     <div>
                       <span className="block font-semibold text-gray-900">Look straight ahead</span>
                       <span className="text-sm text-gray-500">Keep your head still and face the screen directly</span>
                     </div>
                   </li>
                   <li className="flex items-start gap-3">
                     <CircleDot className="mt-0.5 h-5 w-5 shrink-0 text-violet-600" />
                     <div>
                       <span className="block font-semibold text-gray-900">Click Continue to Positioning</span>
                       <span className="text-sm text-gray-500">The next screen will confirm your position</span>
                     </div>
                   </li>
                 </ul>
              </div>

              <div className="flex justify-center pt-2">
                <button 
                  onClick={() => setPositioningPhase('tracking')}
                  className="rounded-lg bg-violet-600 px-8 py-3 text-sm font-medium text-white transition-all hover:bg-violet-700"
                >
                  Continue to Positioning
                </button>
              </div>
            </div>
          )}

          {/* STEP 1b: SELF CALIBRATION TRACKING */}
          {step === 1 && positioningPhase === 'tracking' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">

               <div className="relative flex w-full flex-col items-center justify-center overflow-hidden rounded-2xl bg-[#3B3E46] py-16 text-center shadow-inner">
                  <div className="absolute top-1/2 w-full border-t border-dashed border-gray-500/30"></div>
                  <span className="absolute right-6 top-1/2 -translate-y-1/2 text-xs text-gray-500">optimal range (~90cm)</span>
                  
                  <div className="z-10 mb-12 flex gap-12">
                    <div className="flex flex-col items-center gap-4">
                      <div className={`h-32 w-20 rounded-full transition-all duration-500 ${positionReady ? 'bg-[#10B981] shadow-[0_0_30px_rgba(16,185,129,0.5)]' : 'bg-[#EF4444]'}`}></div>
                      <span className="text-sm font-medium text-gray-300">Left Eye</span>
                    </div>
                    <div className="flex flex-col items-center gap-4">
                      <div className={`h-32 w-20 rounded-full transition-all duration-500 ${positionReady ? 'bg-[#10B981] shadow-[0_0_30px_rgba(16,185,129,0.5)]' : 'bg-[#EF4444]'}`}></div>
                      <span className="text-sm font-medium text-gray-300">Right Eye</span>
                    </div>
                  </div>

                  <div className={`z-10 mb-8 text-lg font-medium transition-colors ${positionReady ? 'text-[#10B981]' : rawWsStatus === 'no_hardware' ? 'text-[#EF4444]' : 'text-[#F59E0B]'}`}>
                    {positionReady
                      ? 'Position looks good (Optimal range)'
                      : rawWsStatus === 'no_hardware'
                        ? 'No eye tracker detected — check USB connection'
                        : liveDistance && liveDistance > 0
                          ? `Target Distance: 600mm | Current: ${liveDistance}mm`
                          : 'Looking for eyes...'}
                  </div>

                  <button
                    disabled={!positionReady}
                    onClick={() => setStep(2)}
                    className="z-10 w-full max-w-xs rounded-lg bg-violet-600 py-3.5 text-sm font-bold text-white transition-all hover:bg-violet-700 disabled:bg-violet-400 disabled:opacity-50"
                  >
                    Go to Calibration
                  </button>
                </div>

              {/* Debug panel */}
              <div className="rounded-lg border border-gray-600 p-3 font-mono text-xs text-gray-300" style={{ backgroundColor: '#0f172a' }}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="font-bold text-gray-400">EYE TRACKER DEBUG</span>
                  {deviceInfo === null && <span className="rounded bg-gray-700 px-1.5 py-0.5 text-gray-400">checking...</span>}
                  {deviceInfo && deviceInfo.device_connected && <span className="rounded bg-green-700 px-1.5 py-0.5 text-white">DEVICE CONNECTED</span>}
                  {deviceInfo && !deviceInfo.device_connected && deviceInfo.bridge_available && <span className="rounded bg-orange-600 px-1.5 py-0.5 text-white">BRIDGE OK — no device found</span>}
                  {deviceInfo && !deviceInfo.bridge_available && <span className="rounded bg-red-700 px-1.5 py-0.5 text-white">NO BRIDGE — Stream Engine DLL missing</span>}
                </div>
                <div className="space-y-1 text-gray-400">
                  <div>model: <span className="text-white">{deviceInfo?.model ?? '--'}</span></div>
                  <div>serial: <span className="text-white">{deviceInfo?.serial ?? '--'}</span></div>
                  <div>distance_mm: <span className="text-white">{liveDistance !== null ? (liveDistance === -1 ? 'no eyes detected' : `${liveDistance}`) : 'waiting...'}</span></div>
                  <div>status: <span className={rawWsStatus === 'optimal' ? 'text-green-400' : 'text-yellow-400'}>{rawWsStatus}</span></div>
                  <div>ws messages received: <span className="text-white">{wsMessageCount}</span></div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: RUN CALIBRATION (handled by Tobii's own software) */}
          {step === 2 && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
                The Tobii 4C calibrates through Tobii's own software. Click below to open the Tobii menu, choose <strong>Create New Profile</strong> (or Recalibrate) and follow Tobii's guided calibration, then return here to validate the result.
              </div>

              <div className="space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-6">
                <div className="flex items-start gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-600 text-xs font-bold text-white">1</div>
                  <div className="text-sm text-gray-700">
                    <span className="block font-semibold text-gray-900">Open the Tobii menu, then "Create New Profile"</span>
                    <span className="text-gray-500">Opens the Tobii tray menu. Click the Tobii icon → <strong>Create New Profile</strong> to start a fresh calibration. (Tobii doesn't allow jumping straight into calibration, so this one click is needed.)</span>
                  </div>
                </div>
                <div className="pl-10">
                  <button
                    onClick={async () => {
                      try {
                        const res = await fetch('http://localhost:8000/api/calibration/launch-tobii', { method: 'POST' });
                        const data = await res.json();
                        setTobiiLaunchMsg(data.message || '');
                      } catch {
                        setTobiiLaunchMsg('Could not reach the backend. Open Tobii calibration from the tray icon manually.');
                      }
                    }}
                    className="rounded-lg bg-violet-600 px-6 py-2.5 text-sm font-medium text-white transition-all hover:bg-violet-700"
                  >
                    Open Tobii Menu
                  </button>
                  {tobiiLaunchMsg && <p className="mt-2 text-xs text-gray-600">{tobiiLaunchMsg}</p>}
                </div>

                <div className="flex items-start gap-3 border-t border-gray-200 pt-4">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-600 text-xs font-bold text-white">2</div>
                  <div className="text-sm text-gray-700">
                    <span className="block font-semibold text-gray-900">Validate the result</span>
                    <span className="text-gray-500">5 dots will appear; look at each so we can measure real accuracy. Make sure your browser is maximized.</span>
                  </div>
                </div>

                {/* Pass threshold configuration */}
                <div className="flex items-start gap-3 border-t border-gray-200 pt-4">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-400 text-xs font-bold text-white">3</div>
                  <div className="w-full text-sm text-gray-700">
                    <span className="block font-semibold text-gray-900">Pass threshold</span>
                    <span className="text-gray-500">Maximum average error (degrees of visual angle) to count as a pass. The Tobii 4C is a consumer device that typically reaches 2–3°, so the default is 2.5°.</span>
                    <div className="mt-3 flex items-center gap-4">
                      <input
                        type="range"
                        min={0.5}
                        max={5}
                        step={0.1}
                        value={passThreshold}
                        onChange={(e) => setPassThreshold(parseFloat(e.target.value))}
                        className="h-2 w-full max-w-xs cursor-pointer accent-violet-600"
                      />
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0.5}
                          max={5}
                          step={0.1}
                          value={passThreshold}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            if (!Number.isNaN(v)) setPassThreshold(Math.min(5, Math.max(0.5, v)));
                          }}
                          className="w-16 rounded border border-gray-300 px-2 py-1 text-sm text-gray-800 focus:border-violet-500 focus:outline-none"
                        />
                        <span className="text-sm font-medium text-gray-500">°</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-center pt-2">
                <button
                  onClick={() => setCalibrationPhase('running')}
                  className="rounded-lg bg-violet-600 px-10 py-3.5 text-base font-bold text-white transition-all hover:bg-violet-700 shadow-md"
                >
                  I've Calibrated — Run Validation
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: VALIDATION */}
          {step === 3 && (
            <div className="space-y-6 animate-in fade-in duration-300">
              
              <div className={`flex items-center justify-between rounded-lg border p-4 text-sm font-medium ${
                validationStatus === 'passed' ? 'border-green-300 bg-green-50 text-green-800' : 'border-red-300 bg-red-50 text-red-800'
              }`}>
                <div className="flex items-center gap-3">
                  {validationStatus === 'passed' ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <XCircle className="h-5 w-5 text-red-600" />}
                  <div>
                    <span className="block font-bold">{validationStatus === 'passed' ? 'Eye tracker successfully calibrated.' : 'Calibration quality too low. Please recalibrate.'}</span>
                    {validationStatus === 'failed' && <span className="text-xs font-normal opacity-80 mt-0.5">Low calibration quality may lead to inaccurate results and harm the integrity of the gathered data.</span>}
                  </div>
                </div>
                <AlertCircle className={`h-5 w-5 ${validationStatus === 'passed' ? 'text-green-400' : 'text-red-400'}`} />
              </div>

              <div className="flex flex-col-reverse gap-4 sm:flex-row sm:items-center sm:justify-between">
                {validationStatus === 'passed' ? (
                  <button onClick={onFinish} className="rounded-lg bg-violet-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-violet-700">Accept and Continue</button>
                ) : (
                  <button onClick={() => {
                    setStep(1);
                    setPositioningPhase('instructions');
                    setCalibrationPhase('idle');
                  }} className="flex w-full sm:w-auto items-center justify-center gap-2 rounded-lg bg-violet-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-violet-700">
                    <AlertCircle className="h-4 w-4" /> Recalibrate Eye Tracker
                  </button>
                )}
                <button className="w-full sm:w-auto rounded-lg border border-gray-300 bg-white px-6 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">Run Validation Check</button>
              </div>

              <div className="relative flex h-80 w-full items-center justify-center rounded-xl bg-gray-200 overflow-hidden shadow-inner">
                 <div className="absolute left-1/2 top-1/2 -translate-x-1/2 translate-y-12 text-sm font-medium" style={{ color: validationStatus === 'passed' ? '#10B981' : '#EF4444' }}>
                   Calibration point accuracy: {accuracy}
                 </div>

                 {[
                   { top: '15%', left: '15%' }, { top: '15%', right: '15%' },
                   { top: '50%', left: '50%', center: true },
                   { bottom: '15%', left: '15%' }, { bottom: '15%', right: '15%' }
                 ].map((pos, i) => (
                   <div key={i} className="absolute flex items-center justify-center" style={{ ...pos, transform: pos.center ? 'translate(-50%, -50%)' : 'none' }}>
                     <div className="absolute h-8 w-8 rounded-full border-2 border-gray-400"></div>
                     <div className={`absolute h-3 w-3 rounded-full bg-gray-400 opacity-60 translate-x-3 -translate-y-2`}></div>
                     <div className={`absolute h-3 w-3 rounded-full bg-gray-400 opacity-60 -translate-x-2 translate-y-3`}></div>
                     <div className={`absolute h-3 w-3 rounded-full bg-gray-400 opacity-60 -translate-x-3 -translate-y-3`}></div>
                     <div className={`absolute h-6 w-6 rounded-full border border-gray-800 transition-all duration-300 ${validationStatus === 'passed' ? 'bg-[#10B981]' : 'bg-[#EF4444]'} ${validationStatus === 'failed' ? 'translate-x-2 translate-y-1 scale-110' : ''}`}></div>
                   </div>
                 ))}
              </div>

              <div className="rounded-lg border border-gray-200 bg-white">
                <h4 className="border-b border-gray-200 bg-gray-100 px-4 py-2 text-xs font-bold uppercase text-gray-700 flex items-center gap-2">
                  <div className="flex h-4 w-4 items-center justify-center rounded bg-gray-300 text-[10px] font-bold text-gray-600">-</div>
                  Sensor Status
                </h4>
                <div className="space-y-3 p-4 text-sm">
                  <div className="flex justify-between border-b border-gray-50 pb-2">
                    <span className="text-gray-600 flex items-center gap-2"><div className={`h-1.5 w-1.5 rounded-full ${validationStatus === 'passed' ? 'bg-green-500' : 'bg-red-500'}`}></div> Accuracy</span>
                    <span className={`font-semibold ${validationStatus === 'passed' ? 'text-green-600' : 'text-red-600'}`}>
                      {accuracy} {validationStatus === 'passed' ? 'Good' : 'Poor'}
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-gray-50 pb-2">
                    <span className="text-gray-600 flex items-center gap-2"><div className={`h-1.5 w-1.5 rounded-full ${validationStatus === 'passed' ? 'bg-green-500' : 'bg-red-500'}`}></div> Precision</span>
                    <span className={`font-semibold ${validationStatus === 'passed' ? 'text-green-600' : 'text-red-600'}`}>
                       {precision} {validationStatus === 'passed' ? 'Good' : 'Poor'}
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-gray-50 pb-2">
                    <span className="text-gray-600 flex items-center gap-2"><div className={`h-1.5 w-1.5 rounded-full ${validationStatus === 'passed' ? 'bg-green-500' : 'bg-red-500'}`}></div> Point Passed</span>
                    <span className="font-semibold text-gray-700">
                      {validPoints} of 5
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-gray-50 pb-2">
                    <span className="text-gray-600 flex items-center gap-2"><div className="h-1.5 w-1.5 rounded-full bg-gray-400"></div> Pass threshold</span>
                    <span className="font-semibold text-gray-700">≤ {passThreshold.toFixed(1)}°</span>
                  </div>
                  <div className="flex justify-between pt-1">
                    <span className="text-gray-600 flex items-center gap-2"><div className={`h-1.5 w-1.5 rounded-full ${validationStatus === 'passed' ? 'bg-green-500' : 'bg-red-500'}`}></div> Overall result</span>
                    <span className={`font-bold uppercase ${validationStatus === 'passed' ? 'text-green-600' : 'text-red-600'}`}>{validationStatus === 'passed' ? 'Passed' : 'Failed'}</span>
                  </div>
                </div>
                <div className="border-t border-gray-100 p-3">
                   <button 
                    onClick={() => {
                      setStep(1);
                      setPositioningPhase('instructions');
                      setCalibrationPhase('idle');
                    }} 
                    className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900"
                   >
                     <AlertCircle className="h-4 w-4" /> Recalibrate Eye Tracker
                   </button>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </>
  );
}