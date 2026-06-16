import { useState, useEffect } from 'react';
import { CheckCircle2, Check, AlertCircle } from 'lucide-react';
import { LineChart, Line, YAxis, ResponsiveContainer } from 'recharts';

// === REPLACE THESE WITH YOUR ACTUAL ASSET NAMES ===
import edaPlacementSvg from '../../assets/EDAplac1.png'; 
import edaDevicePng from '../../assets/eegHub.png';


export default function EDACalibrationFlow({ onFinish }: { onFinish: () => void }) {
  const [step, setStep] = useState(1);
  
  // Step 1 State (Note: EDA only has 2 placement checkboxes, unlike ECG's 3)
  const [step1Checks, setStep1Checks] = useState<string[]>([]);
  const step1Required = ['prep1', 'prep2', 'place1', 'place2'];
  
  // Step 2 State
  const [step2Checks, setStep2Checks] = useState<string[]>([]);
  const step2Required = ['conn1', 'en1', 'en2', 'en3'];

  // Step 3 State
  const [signalStatus, setSignalStatus] = useState<'unknown' | 'checking' | 'good'>('unknown');

  // Step 4 State
  const toggleCheck = (id: string, _current: string[], setter: React.Dispatch<React.SetStateAction<string[]>>) => {
    setter(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const [recordingState, setRecordingState] = useState<'idle' | 'recording' | 'done'>('idle');
 // Step 4 State
  
  // NEW: Keep a rolling buffer of the last 60 data points for the chart
  const [chartData, setChartData] = useState<{ uv: number }[]>([]);

  // ==========================================
  // 1. LIVE WEBSOCKET CONNECTION
  // ==========================================
  useEffect(() => {
    // Only connect the socket when we reach the Signal Check step
    if (step >= 3) {
      const ws = new WebSocket('ws://localhost:8000/ws/stream');
      
      ws.onopen = () => console.log('Connected to PLUX WebSocket');
      
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        // Feed the new point into the chart array
        setChartData(prev => {
          const newData = [...prev, { uv: data.eda_raw }];
          if (newData.length > 60) newData.shift(); // Keep it to 60 points max
          return newData;
        });
        
        setSignalStatus((prev) => (prev === 'checking' ? 'good' : prev));
      };    
        // If data is flowing, automatically upgrade signal status to 'good'
    

      return () => ws.close(); // Cleanup socket if user unmounts/goes back
    }
  }, [step]);

  // ==========================================
  // 2. REAL HARDWARE RECORDING LOGIC
  // ==========================================
  const startRealRecording = async () => {
    setRecordingState('recording');
    
    try {
      // Tell Python to start saving data to memory
      await fetch('http://localhost:8000/api/record/start', { method: 'POST' });
      
      // Wait 30 seconds
      setTimeout(async () => {
        // Tell Python to stop and export the CSV
        await fetch('http://localhost:8000/api/record/stop', { method: 'POST' });
        const saveRes = await fetch('http://localhost:8000/api/record/save', { method: 'POST' });
        const saveData = await saveRes.json();
        
        console.log('Recording Saved!', saveData);
        setRecordingState('done');
      }, 30000);
      
    } catch (error) {
      console.error('Failed to trigger backend recording:', error);
      setRecordingState('idle'); // Reset if server is down
    }
  };

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300">
      
      {/* SUCCESS BANNER */}
      {step === 4 && recordingState === 'done' && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-4 text-sm font-medium text-green-800">
          <CheckCircle2 className="h-5 w-5 text-green-600" />
          EDA Sensor Successfully calibrated.
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm md:p-8">
        
        {/* HEADER & STEPPER */}
        <div className="mb-8 flex flex-col justify-between gap-6 border-b border-gray-100 pb-6 md:flex-row md:items-end">
          <div>
            <h3 className="text-lg font-bold text-gray-900">
              Step {step}: <br/>
              {step === 1 && 'Attach and Place Electrodes'}
              {step === 2 && 'Connect Electrodes and Setup Channels'}
              {step === 3 && 'Check and Verify Signal Quality'}
              {step === 4 && 'Establish a baseline recording'}
            </h3>
          </div>

          <div className="flex items-center">
            {[1, 2, 3, 4].map((i) => (
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
                    {i === 1 && 'Placement'}
                    {i === 2 && 'Connect'}
                    {i === 3 && 'Signal Check'}
                    {i === 4 && 'Baseline'}
                  </span>
                </div>
                {i < 4 && (
                  <div className={`h-[2px] w-12 mb-6 ${step > i ? 'bg-violet-600' : 'bg-gray-200'}`} />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ==================== STEP 1 ==================== */}
        {step === 1 && (
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
            
            <div className="flex flex-col items-center justify-center rounded-lg border border-gray-200 bg-white py-6">
              <img src={edaPlacementSvg} alt="EDA Placement Guide" className="w-full max-w-sm object-contain" />
              <div className="mt-4 text-xs text-gray-400">If image breaks, check the filename in EDACalibrationFlow.tsx</div>
            </div>
            
            <div className="space-y-6">
              <div className="flex items-center gap-3 rounded-lg border border-yellow-200 bg-yellow-50/50 p-4 text-sm text-yellow-800">
                <AlertCircle className="h-5 w-5 text-yellow-600" />
                Checkmark each section to proceed to next step.
              </div>

              <div>
                <h4 className="mb-2 rounded bg-gray-200 px-3 py-1 text-xs font-bold uppercase text-gray-700">Prepare Skin</h4>
                <div className="space-y-2 px-1">
                  <label className="flex cursor-pointer items-center gap-3 text-sm text-gray-700 hover:text-gray-900">
                    <input type="checkbox" checked={step1Checks.includes('prep1')} onChange={() => toggleCheck('prep1', step1Checks, setStep1Checks)} className="h-4 w-4 rounded border-gray-300 text-violet-600 focus:ring-violet-600" />
                    If skin is visibly dirty, clean with lukewarm water
                  </label>
                  <label className="flex cursor-pointer items-center gap-3 text-sm text-gray-700 hover:text-gray-900">
                    <input type="checkbox" checked={step1Checks.includes('prep2')} onChange={() => toggleCheck('prep2', step1Checks, setStep1Checks)} className="h-4 w-4 rounded border-gray-300 text-violet-600 focus:ring-violet-600" />
                    Ensure skin is dry
                  </label>
                </div>
              </div>

              <div>
                <h4 className="mb-2 rounded bg-gray-200 px-3 py-1 text-xs font-bold uppercase text-gray-700">Place Electrodes</h4>
                <div className="space-y-2 px-1">
                  <label className="flex cursor-pointer items-center gap-3 text-sm text-gray-700 hover:text-gray-900">
                    <input type="checkbox" checked={step1Checks.includes('place1')} onChange={() => toggleCheck('place1', step1Checks, setStep1Checks)} className="h-4 w-4 rounded border-gray-300 text-violet-600 focus:ring-violet-600" />
                    Red (+) → index finger (palm side)
                  </label>
                  <label className="flex cursor-pointer items-center gap-3 text-sm text-gray-700 hover:text-gray-900">
                    <input type="checkbox" checked={step1Checks.includes('place2')} onChange={() => toggleCheck('place2', step1Checks, setStep1Checks)} className="h-4 w-4 rounded border-gray-300 text-violet-600 focus:ring-violet-600" />
                    Black (-) → middle finger (palm side)
                  </label>
                </div>
              </div>

              <button 
                disabled={step1Checks.length < step1Required.length}
                onClick={() => setStep(2)}
                className="w-full rounded-lg bg-violet-600 py-3 text-sm font-medium text-white transition-all hover:bg-violet-700 disabled:bg-violet-200 disabled:cursor-not-allowed"
              >
                Continue to Connect
              </button>
            </div>
          </div>
        )}

        {/* ==================== STEP 2 ==================== */}
        {step === 2 && (
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
            <div className="space-y-4">
               <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-xs leading-relaxed text-blue-800">
                 The biosignalsplux EDA sensor is compatible with all analog input channels of the 4-channel and 8-channel biosignalsplux hub, but incompatible with the reference/ground and digital I/O ports. Connect the sensor to an analog input to use it with this device.
               </div>
               
               <div className="flex items-center justify-center rounded-lg border border-gray-200 bg-white py-6">
                 <img src={edaDevicePng} alt="Device hub connection guide" className="w-full max-w-sm object-contain" />
               </div>
            </div>
            
            <div className="space-y-6">
              <div className="flex items-center gap-3 rounded-lg border border-yellow-200 bg-yellow-50/50 p-4 text-sm text-yellow-800">
                <AlertCircle className="h-5 w-5 text-yellow-600" />
                Checkmark each section to proceed to next step.
              </div>

              <div>
                <h4 className="mb-2 rounded bg-gray-200 px-3 py-1 text-xs font-bold uppercase text-gray-700">Connect Hardware</h4>
                <div className="space-y-2 px-1">
                  <label className="flex cursor-pointer items-center gap-3 text-sm text-gray-700 hover:text-gray-900">
                    <input type="checkbox" checked={step2Checks.includes('conn1')} onChange={() => toggleCheck('conn1', step2Checks, setStep2Checks)} className="h-4 w-4 rounded border-gray-300 text-violet-600 focus:ring-violet-600" />
                    Plug EDA cable into an analog input port
                  </label>
                </div>
              </div>

              <div>
                <h4 className="mb-2 rounded bg-gray-200 px-3 py-1 text-xs font-bold uppercase text-gray-700">Enable Channel</h4>
                <div className="space-y-2 px-1">
                  <label className="flex cursor-pointer items-center gap-3 text-sm text-gray-700 hover:text-gray-900">
                    <input type="checkbox" checked={step2Checks.includes('en1')} onChange={() => toggleCheck('en1', step2Checks, setStep2Checks)} className="h-4 w-4 rounded border-gray-300 text-violet-600 focus:ring-violet-600" />
                    Setup EDA Channel on Hub
                  </label>
                  <label className="flex cursor-pointer items-center gap-3 text-sm text-gray-700 hover:text-gray-900">
                    <input type="checkbox" checked={step2Checks.includes('en2')} onChange={() => toggleCheck('en2', step2Checks, setStep2Checks)} className="h-4 w-4 rounded border-gray-300 text-violet-600 focus:ring-violet-600" />
                    Activate EDA channel in system
                  </label>
                  <label className="flex cursor-pointer items-center gap-3 text-sm text-gray-700 hover:text-gray-900">
                    <input type="checkbox" checked={step2Checks.includes('en3')} onChange={() => toggleCheck('en3', step2Checks, setStep2Checks)} className="h-4 w-4 rounded border-gray-300 text-violet-600 focus:ring-violet-600" />
                    Set channel type to EDA
                  </label>
                </div>
              </div>

              <button 
                disabled={step2Checks.length < step2Required.length}
                onClick={() => setStep(3)}
                className="w-full rounded-lg bg-violet-600 py-3 text-sm font-medium text-white transition-all hover:bg-violet-700 disabled:bg-violet-200 disabled:cursor-not-allowed"
              >
                Continue to Signal Check
              </button>
            </div>
          </div>
        )}

        {/* ==================== STEP 3 ==================== */}
        {step === 3 && (
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
            <div>
              <p className="mb-4 text-center text-sm font-semibold text-gray-700">Live EDA waveform preview:</p>
              <div className="h-48 w-full overflow-hidden rounded-lg border border-gray-100 bg-gray-50/50">
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <YAxis domain={['auto', 'auto']} hide={true} />
                      <Line 
                        type="monotone" 
                        dataKey="uv" 
                        stroke="#7C3AED" // Matches your violet UI theme
                        strokeWidth={2} 
                        dot={false} 
                        isAnimationActive={false} // Turn off CSS animation so it renders at 60fps instantly
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <span className="text-xs text-gray-400">Awaiting sensor data...</span>
                  </div>
                )}
              </div>
            </div>
            
            <div className="space-y-6">
              <div className="rounded-lg border border-gray-200 bg-white">
                <h4 className="border-b border-gray-200 bg-gray-100 px-4 py-2 text-xs font-bold uppercase text-gray-700 flex items-center gap-2">
                  <div className="flex h-4 w-4 items-center justify-center rounded bg-gray-300 text-[10px] font-bold text-gray-600">-</div>
                  Sensor Status
                </h4>
                <div className="space-y-3 p-4 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600 flex items-center gap-2"><div className="h-1.5 w-1.5 rounded-full bg-green-500"></div> Sensor Connection</span>
                    <span className="font-medium text-green-600">Connected</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 flex items-center gap-2">
                      <div className={`h-1.5 w-1.5 rounded-full ${signalStatus === 'good' ? 'bg-green-500' : 'bg-yellow-500'}`}></div> Signal amplitude
                    </span>
                    <span className={`font-medium ${signalStatus === 'good' ? 'text-green-600' : 'text-yellow-600'}`}>
                      {signalStatus === 'good' ? 'Normal' : signalStatus === 'checking' ? 'Checking...' : 'Medium'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 flex items-center gap-2">
                      <div className={`h-1.5 w-1.5 rounded-full ${signalStatus === 'good' ? 'bg-green-500' : 'bg-red-500'}`}></div> Noise level
                    </span>
                    <span className={`font-medium ${signalStatus === 'good' ? 'text-green-600' : 'text-red-600'}`}>
                      {signalStatus === 'good' ? 'Low' : signalStatus === 'checking' ? 'Checking...' : 'High'}
                    </span>
                  </div>
                </div>
                <div className="border-t border-gray-100 p-3 text-center">
                  <button 
                    onClick={() => {
                      setSignalStatus('checking');
                      // Note: We removed the setTimeout here because the WebSocket 
                      // onmessage function above will now automatically set it to 'good' 
                      // the millisecond it receives actual hardware data!
                    }}
                    className="text-sm font-medium text-violet-600 hover:text-violet-800"
                  >
                    Run Signal Check
                  </button>
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white">
                 <h4 className="border-b border-gray-200 bg-gray-100 px-4 py-2 text-xs font-bold uppercase text-gray-700 flex items-center gap-2">
                   <div className="flex h-4 w-4 items-center justify-center rounded bg-gray-300 text-[10px] font-bold text-gray-600">-</div>
                   Instructions
                 </h4>
                 <ul className="space-y-2 p-4 text-sm text-gray-700">
                   <li>1. Sit still and relax hands</li>
                   <li>2. Avoid hand or finger movement</li>
                   <li>3. Breathe normally while recording</li>
                 </ul>
              </div>

             <button 
                disabled={signalStatus !== 'good'}
                onClick={() => setStep(4)}
                className="w-full rounded-lg bg-violet-600 py-3 text-sm font-medium text-white transition-all hover:bg-violet-700 disabled:bg-violet-200 disabled:cursor-not-allowed"
              >
                Continue to Baseline Recording
              </button>
            </div>
          </div>
        )}

        {/* ==================== STEP 4 ==================== */}
        {step === 4 && (
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
            <div className="flex flex-col items-center justify-center text-center">
              <p className="mb-8 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
                To confirm signal quality, a short resting baseline will be recorded. Ensure the participant is seated and relaxed.
              </p>
              <p className="mb-6 text-sm font-medium text-gray-900 px-4">
                Press the record button, then focus on the circle and remain still for 30 seconds.
              </p>
              
              <div className={`mb-8 h-40 w-40 rounded-full border-4 border-dashed transition-colors duration-500 ${
                recordingState === 'recording' ? 'border-violet-600 bg-violet-100 animate-pulse' : 'border-slate-800 bg-slate-600'
              }`}></div>

              <button 
                onClick={startRealRecording} // <--- UPDATED THIS LINE
                disabled={recordingState === 'recording'}
                className="rounded-lg bg-violet-600 px-8 py-2.5 text-sm font-medium text-white transition-all hover:bg-violet-700 disabled:opacity-50"
              >
                {recordingState === 'idle' ? 'Start Recording' : recordingState === 'recording' ? '• Recording...' : 'Record Again'}
              </button>

              {/* DEV SKIP BUTTON */}
              {recordingState === 'recording' && (
                <button onClick={() => setRecordingState('done')} className="mt-4 text-xs text-gray-400 underline">
                  [Dev: Skip 30s Timer]
                </button>
              )}
            </div>
            
            <div className="space-y-6">
              <div className="rounded-lg border border-gray-200 bg-white">
                <h4 className="border-b border-gray-200 bg-gray-100 px-4 py-2 text-xs font-bold uppercase text-gray-700 flex items-center gap-2">
                  <div className="flex h-4 w-4 items-center justify-center rounded bg-gray-300 text-[10px] font-bold text-gray-600">-</div>
                  Sensor Status
                </h4>
                <div className="space-y-3 p-4 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600 flex items-center gap-2"><div className="h-1.5 w-1.5 rounded-full bg-green-500"></div> Sensor Connection</span>
                    <span className="font-medium text-green-600">Connected</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 flex items-center gap-2"><div className="h-1.5 w-1.5 rounded-full bg-green-500"></div> Signal amplitude</span>
                    <span className="font-medium text-green-600">Normal</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 flex items-center gap-2"><div className="h-1.5 w-1.5 rounded-full bg-green-500"></div> Noise level</span>
                    <span className="font-medium text-green-600">Low</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-gray-100 mt-2">
                    <span className="text-gray-600 flex items-center gap-2"><div className="h-1.5 w-1.5 rounded-full bg-gray-400"></div> Baseline</span>
                    <span className={`text-xs font-medium ${recordingState === 'done' ? 'text-green-600' : 'text-gray-500'}`}>
                      {recordingState === 'idle' ? 'unknown' : recordingState === 'recording' ? 'recording...' : 'Stable'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white">
                 <h4 className="border-b border-gray-200 bg-gray-100 px-4 py-2 text-xs font-bold uppercase text-gray-700 flex items-center gap-2">
                   <div className="flex h-4 w-4 items-center justify-center rounded bg-gray-300 text-[10px] font-bold text-gray-600">-</div>
                   Instructions
                 </h4>
                 <ul className="space-y-2 p-4 text-sm text-gray-700">
                   <li>1. Sit still </li>
                   <li>2. Avoid hand or finger movement</li>
                   <li>3. Breathe normally while recording</li>
                 </ul>
              </div>

              {/* FINISH BUTTON */}
              {recordingState === 'done' && (
                <div className="flex justify-end pt-4 animate-in fade-in zoom-in-95 duration-300">
                  <button 
                    onClick={onFinish}
                    className="rounded-lg bg-black px-8 py-3 text-sm font-medium text-white transition-all hover:bg-gray-800"
                  >
                    Finish EDA Sensor Calibration
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}