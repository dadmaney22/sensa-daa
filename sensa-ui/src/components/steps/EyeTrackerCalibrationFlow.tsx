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

  const [calibrationPhase, setCalibrationPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [activeDot, setActiveDot] = useState(-1);
  const [validationStatus, setValidationStatus] = useState<'passed' | 'failed'>('passed');
  const [accuracy, setAccuracy] = useState<string>('--');
  const [precision, setPrecision] = useState<string>('--');
  const [validPoints, setValidPoints] = useState<number>(0);

  // 1. Live Distance Positioning WebSocket Pipeline (Step 1b)
  useEffect(() => {
    if (step === 1 && positioningPhase === 'tracking') {
      const ws = new WebSocket('ws://localhost:8000/api/calibration/ws/position');

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setLiveDistance(Math.round(data.distance_mm));
          setPositionReady(data.status === 'optimal');
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

  // 2. Hardware Calibration Sequence & Point Collection (Step 2)
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;

    const runSequence = async () => {
      if (calibrationPhase === 'running') {
        try {
          // Tell hardware to enter calibration mode
          await fetch('http://localhost:8000/api/calibration/start', { method: 'POST' });
          
          let currentDot = 0;
          setActiveDot(0);
          
          // Helper function to send target look point to Tobii hardware
          const collectPoint = async (dotIdx: number) => {
            const coords = DOT_COORDINATES[dotIdx];
            try {
              await fetch('http://localhost:8000/api/calibration/collect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(coords),
              });
            } catch (err) {
              console.error(`Error collecting dot ${dotIdx}:`, err);
            }
          };

          // Collect the very first dot after 2 seconds (giving eye time to fixate)
          setTimeout(() => collectPoint(0), 2000);

          interval = setInterval(() => {
            currentDot++;
            if (currentDot > 4) {
              clearInterval(interval);
              finishCalibration();
            } else {
              setActiveDot(currentDot);
              // Collect coordinate midway through the 4-second dot window
              const targetDot = currentDot;
              setTimeout(() => collectPoint(targetDot), 2000);
            }
          }, 4000);

        } catch (err) {
          console.error("Failed to initiate hardware calibration setup:", err);
          setCalibrationPhase('idle');
        }
      }
    };

   const finishCalibration = async () => {
  try {
    const response = await fetch('http://localhost:8000/api/calibration/compute', { method: 'POST' });
    const results = await response.json();

    if (results.status === 'success') {
      setValidationStatus(results.overall_quality.toLowerCase() === 'pass' ? 'passed' : 'failed');
      
      // Map the calculated math to the UI
      setAccuracy(results.accuracy_degrees ? `${results.accuracy_degrees.toFixed(2)}°` : '--');
      setPrecision(results.precision_degrees ? `${results.precision_degrees.toFixed(2)}°` : '--');
      setValidPoints(results.valid_count || 0); // <--- Capture valid points
    } else {
      setValidationStatus('failed');
    }
  } catch (err) {
    console.error("Error computing final calibration data:", err);
    setValidationStatus('failed');
  }
  setCalibrationPhase('done');
  setStep(3);
};

    runSequence();

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [calibrationPhase]);

  return (
    <>
      {/* ==================== FULL SCREEN CALIBRATION OVERLAY ==================== */}
      {calibrationPhase === 'running' && (
        <div className="fixed inset-0 z-[100] bg-black text-white cursor-none animate-in fade-in duration-700">
          <div className="absolute top-16 w-full text-center text-sm font-medium text-gray-400">
            Follow and focus on the dot with your eyes as it moves around.
            <button 
              onClick={() => { setCalibrationPhase('done'); setStep(3); }} 
              className="block mx-auto mt-2 text-[10px] text-gray-800 hover:text-gray-500 cursor-pointer"
            >
              [Dev: Skip 20s Timer]
            </button>
          </div>

          {/* Full Screen Calibration Targets */}
          <div className="absolute left-16 top-16 h-8 w-8 rounded-full border-2 transition-all duration-1000 ease-in-out" style={{ backgroundColor: activeDot === 0 ? '#7C3AED' : 'transparent', borderColor: activeDot === 0 ? '#7C3AED' : '#374151', transform: activeDot === 0 ? 'scale(1.2)' : 'scale(1)' }}></div>
          <div className="absolute right-16 top-16 h-8 w-8 rounded-full border-2 transition-all duration-1000 ease-in-out" style={{ backgroundColor: activeDot === 1 ? '#7C3AED' : 'transparent', borderColor: activeDot === 1 ? '#7C3AED' : '#374151', transform: activeDot === 1 ? 'scale(1.2)' : 'scale(1)' }}></div>
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-8 w-8 rounded-full border-2 transition-all duration-1000 ease-in-out" style={{ backgroundColor: activeDot === 2 ? '#7C3AED' : 'transparent', borderColor: activeDot === 2 ? '#7C3AED' : '#374151', transform: activeDot === 2 ? 'scale(1.2)' : 'scale(1)' }}></div>
          <div className="absolute bottom-16 left-16 h-8 w-8 rounded-full border-2 transition-all duration-1000 ease-in-out" style={{ backgroundColor: activeDot === 3 ? '#7C3AED' : 'transparent', borderColor: activeDot === 3 ? '#7C3AED' : '#374151', transform: activeDot === 3 ? 'scale(1.2)' : 'scale(1)' }}></div>
          <div className="absolute bottom-16 right-16 h-8 w-8 rounded-full border-2 transition-all duration-1000 ease-in-out" style={{ backgroundColor: activeDot === 4 ? '#7C3AED' : 'transparent', borderColor: activeDot === 4 ? '#7C3AED' : '#374151', transform: activeDot === 4 ? 'scale(1.2)' : 'scale(1)' }}></div>
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
               <div className="flex justify-end">
                 <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded">
                  Live Tracker Metric: {liveDistance !== null ? (liveDistance === -1 ? 'Looking for eyes...' : `${liveDistance} mm`) : 'Connecting to hardware...'}
                 </span>
               </div>

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

                  <div className={`z-10 mb-8 text-lg font-medium transition-colors ${positionReady ? 'text-[#10B981]' : 'text-[#F59E0B]'}`}>
                    {positionReady ? 'Position looks good (Optimal range)' : liveDistance ? `Target Distance: 900mm | Current: ${liveDistance}mm` : 'Waiting for sensor input...'}
                  </div>

                  <button 
                    disabled={!positionReady}
                    onClick={() => setStep(2)}
                    className="z-10 w-full max-w-xs rounded-lg bg-violet-600 py-3.5 text-sm font-bold text-white transition-all hover:bg-violet-700 disabled:bg-violet-400 disabled:opacity-50"
                  >
                    Go to Calibration
                  </button>
                </div>
            </div>
          )}

          {/* STEP 2: RUN CALIBRATION */}
          {step === 2 && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
                A series of dots will appear on screen. Follow each dot with your eyes without moving your head. Keep still until each dot disappears. The process takes about 20 seconds.
              </div>

              <div className="flex h-64 w-full flex-col items-center justify-center rounded-xl bg-gray-100 border border-gray-200 shadow-inner">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border-4 border-violet-200">
                  <div className="h-6 w-6 rounded-full bg-violet-600 animate-pulse"></div>
                </div>
                <span className="text-sm font-medium text-gray-600">5 calibration targets will appear in sequence</span>
                <span className="text-xs text-gray-500 mt-1">Make sure your browser is maximized</span>
              </div>

              <div className="flex justify-center pt-4">
                <button 
                  onClick={() => setCalibrationPhase('running')}
                  className="rounded-lg bg-violet-600 px-10 py-3.5 text-base font-bold text-white transition-all hover:bg-violet-700 shadow-md"
                >
                  Start Calibration Sequence
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
                      {validPoints} of 5   {/* <--- Change this to read dynamic validPoints */}
                    </span>
                  </div>
                  <div className="flex justify-between pt-1">
                    <span className="text-gray-600 flex items-center gap-2"><div className={`h-1.5 w-1.5 rounded-full ${validationStatus === 'passed' ? 'bg-green-500' : 'bg-red-500'}`}></div> Overall result</span>
                    <span className={`font-bold uppercase ${validationStatus === 'passed' ? 'text-green-600' : 'text-red-600'}`}>\n                      {validationStatus === 'passed' ? 'Passed' : 'Failed'}\n                    </span>
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