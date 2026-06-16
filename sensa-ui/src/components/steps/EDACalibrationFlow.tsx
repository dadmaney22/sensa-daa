import { useState, useEffect, useMemo } from 'react';
import { CheckCircle2, Check, AlertCircle } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer } from 'recharts';
import { computeSignalMetrics, toneClasses } from '../../lib/signalMetrics';

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

  // Live-stream diagnostics
  const [wsState, setWsState] = useState<'idle' | 'connecting' | 'streaming' | 'error' | 'closed'>('idle');
  const [wsError, setWsError] = useState<string | null>(null);
  const [msgCount, setMsgCount] = useState(0);
  const [lastRaw, setLastRaw] = useState<number | null>(null);
  // Bumping this re-runs the WebSocket effect (used by "Run Signal Check").
  const [wsAttempt, setWsAttempt] = useState(0);
  const [pluxStatus, setPluxStatus] = useState<
    {
      plux_available: boolean;
      device_address: string | null;
      channel_map: Record<string, number>;
      sensors?: { type: string | null; port: number; clas: number | null; detected: boolean }[];
      running?: boolean;
      import_error?: string | null;
      error?: string | null;
    } | null
  >(null);

  // Step 4 State
  const toggleCheck = (id: string, _current: string[], setter: React.Dispatch<React.SetStateAction<string[]>>) => {
    setter(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const [recordingState, setRecordingState] = useState<'idle' | 'recording' | 'done'>('idle');
  const [countdown, setCountdown] = useState<number | null>(null);
  const [saveData, setSaveData] = useState<{ filename: string; rows: number } | null>(null);
  // Baseline stability verdict from the backend (computed over the full recording).
  const [baseline, setBaseline] = useState<{ stable: boolean | null; reason?: string } | null>(null);

  // Rolling buffer of the last ~120 live samples for the chart
  const [chartData, setChartData] = useState<{ uv: number }[]>([]);

  // Live signal-quality metrics derived from the rolling buffer.
  const metrics = useMemo(() => computeSignalMetrics(chartData.map(d => d.uv)), [chartData]);
  const ampTone = toneClasses(metrics?.amplitudeQuality.tone ?? 'idle');
  const noiseTone = toneClasses(metrics?.noiseQuality.tone ?? 'idle');

  // Live hub readout for Step 2 (which channel EDA is on, sensor detected, etc.)
  const hubConnected = !!pluxStatus?.running && !!pluxStatus?.device_address;
  const edaPort = pluxStatus?.channel_map?.eda;
  const edaSensor = pluxStatus?.sensors?.find(s => s.type === 'eda');

  // ==========================================
  // 1. LIVE WEBSOCKET CONNECTION (reconnectable)
  // ==========================================
  useEffect(() => {
    if (step < 3) return;

    setWsState('connecting');
    setWsError(null);
    const ws = new WebSocket('ws://localhost:8000/ws/stream');

    ws.onmessage = (event) => {
      let data: any;
      try { data = JSON.parse(event.data); } catch { return; }

      // Status / error frames from the backend.
      if (data.error || data.status === 'error') {
        setWsError(data.error || 'Stream error');
        setWsState('error');
        return;
      }
      if (data.status === 'streaming') { setWsState('streaming'); return; }
      if (data.status) return; // e.g. "connecting"

      // Data frame — ignore until a real EDA value is present.
      if (data.eda_raw === undefined || data.eda_raw === null) return;
      setWsState('streaming');
      setLastRaw(data.eda_raw);
      setMsgCount(c => c + 1);
      setChartData(prev => {
        const next = [...prev, { uv: data.eda_raw }];
        if (next.length > 120) next.shift();
        return next;
      });
      setSignalStatus(prev => (prev === 'checking' ? 'good' : prev));
    };

    ws.onerror = () => setWsState('error');
    ws.onclose = () => setWsState(s => (s === 'error' ? s : 'closed'));

    return () => ws.close();
  }, [step, wsAttempt]);

  // Fetch hardware status (device + channel map) for the debug readout.
  useEffect(() => {
    if (step < 3) return;
    fetch('http://localhost:8000/api/plux/status')
      .then(r => r.json())
      .then(setPluxStatus)
      .catch(() => setPluxStatus(null));
  }, [step, wsAttempt]);

  // Step 2: poll the hub so the setup screen shows, live, which channel the
  // EDA sensor is on and whether the hub actually reports a sensor there.
  // /api/plux/detect connects (idempotent) and returns the channel/sensor map.
  // Polled sequentially (chained timeout) so a slow Bluetooth scan can't stack.
  useEffect(() => {
    if (step !== 2) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const res = await fetch('http://localhost:8000/api/plux/detect');
        const data = await res.json();
        if (!cancelled) setPluxStatus(data);
      } catch {
        if (!cancelled) setPluxStatus(null);
      }
      if (!cancelled) timer = setTimeout(poll, 3000);
    };
    poll();

    return () => { cancelled = true; clearTimeout(timer); };
  }, [step]);

  // Countdown timer effect — ticks every second while recording.
  useEffect(() => {
    if (countdown === null || countdown <= 0) return;
    const t = setTimeout(() => setCountdown(c => (c !== null ? c - 1 : null)), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  // ==========================================
  // 2. REAL HARDWARE RECORDING LOGIC
  // ==========================================
  const startRealRecording = async () => {
    setRecordingState('recording');
    setCountdown(30);
    setSaveData(null);
    setBaseline(null);
    try {
      await fetch('http://localhost:8000/api/record/start', { method: 'POST' });
      setTimeout(async () => {
        const stopRes = await fetch('http://localhost:8000/api/record/stop', { method: 'POST' });
        const stopInfo = await stopRes.json();
        // Backend assesses stability over the full recording; read the EDA verdict.
        const q = stopInfo?.quality?.eda;
        setBaseline(q ? { stable: q.stable, reason: q.reason } : { stable: null });
        const res = await fetch('http://localhost:8000/api/record/save', { method: 'POST' });
        const info = await res.json();
        setSaveData({ filename: info.filename, rows: info.rows });
        setCountdown(null);
        setRecordingState('done');
      }, 30000);
    } catch (error) {
      console.error('Failed to trigger backend recording:', error);
      setRecordingState('idle');
    }
  };

  const handleExport = async () => {
    // Re-save (idempotent) then stream the file to the browser.
    await fetch('http://localhost:8000/api/record/save', { method: 'POST' });
    const res = await fetch('http://localhost:8000/api/record/download');
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = saveData?.filename ?? 'plux_recording.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300">
      
      {/* SUCCESS BANNER (only when the baseline is actually stable) */}
      {step === 4 && recordingState === 'done' && baseline?.stable !== false && (
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

               {/* Live hub status — updates as the user plugs in the sensor */}
               <div className="rounded-lg border border-gray-200 bg-white">
                 <h4 className="border-b border-gray-200 bg-gray-100 px-4 py-2 text-xs font-bold uppercase text-gray-700 flex items-center gap-2">
                   <div className={`h-1.5 w-1.5 rounded-full ${hubConnected ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></div>
                   Live Hub Status
                 </h4>
                 <div className="space-y-2 p-4 text-sm">
                   <div className="flex justify-between gap-4">
                     <span className="text-gray-600">Device</span>
                     <span className="font-medium text-gray-900 text-right break-all">
                       {pluxStatus?.device_address
                         || (pluxStatus?.plux_available === false ? 'plux.pyd not loaded' : 'Scanning…')}
                     </span>
                   </div>
                   <div className="flex justify-between">
                     <span className="text-gray-600">EDA channel</span>
                     <span className="font-medium text-gray-900">{edaPort !== undefined ? edaPort : '—'}</span>
                   </div>
                   <div className="flex justify-between">
                     <span className="text-gray-600">Sensor on channel</span>
                     <span className={`font-medium ${edaSensor?.detected ? 'text-green-600' : 'text-gray-500'}`}>
                       {edaSensor?.detected
                         ? `Detected${edaSensor.clas != null ? ` (class ${edaSensor.clas})` : ''}`
                         : hubConnected ? 'Using default' : '—'}
                     </span>
                   </div>
                   {pluxStatus?.error && <div className="text-[11px] text-red-500">{pluxStatus.error}</div>}
                 </div>
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
                    <span className={`ml-auto rounded px-2 py-0.5 text-[11px] font-medium ${hubConnected && edaPort !== undefined ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {hubConnected && edaPort !== undefined ? `Channel ${edaPort}` : 'Detecting…'}
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-3 text-sm text-gray-700 hover:text-gray-900">
                    <input type="checkbox" checked={step2Checks.includes('en3')} onChange={() => toggleCheck('en3', step2Checks, setStep2Checks)} className="h-4 w-4 rounded border-gray-300 text-violet-600 focus:ring-violet-600" />
                    Set channel type to EDA
                    <span className={`ml-auto rounded px-2 py-0.5 text-[11px] font-medium ${
                      edaSensor?.detected ? 'bg-green-100 text-green-700'
                      : hubConnected ? 'bg-yellow-100 text-yellow-700'
                      : 'bg-gray-100 text-gray-500'}`}>
                      {edaSensor?.detected
                        ? `EDA sensor${edaSensor.clas != null ? ` (class ${edaSensor.clas})` : ''}`
                        : hubConnected ? `Default ch ${edaPort ?? '?'}`
                        : 'Detecting…'}
                    </span>
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
                    <LineChart data={chartData} margin={{ top: 4, right: 8, left: 4, bottom: 20 }}>
                      <XAxis
                        tickFormatter={(i: number) => `${((i / 120) * 5).toFixed(0)}s`}
                        tick={{ fontSize: 10, fill: '#9ca3af' }}
                        label={{ value: 'Time (last 5 s)', position: 'insideBottom', offset: -8, fontSize: 10, fill: '#9ca3af' }}
                      />
                      <YAxis
                        domain={['auto', 'auto']}
                        tick={{ fontSize: 10, fill: '#9ca3af' }}
                        width={48}
                        label={{ value: 'EDA (raw)', angle: -90, position: 'insideLeft', offset: 10, fontSize: 10, fill: '#9ca3af' }}
                      />
                      <Line type="monotone" dataKey="uv" stroke="#7C3AED" strokeWidth={2} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <span className="text-xs text-gray-400">Awaiting sensor data...</span>
                  </div>
                )}
              </div>

              {/* Live-stream debug readout */}
              <div className="mt-2 space-y-0.5 text-center text-[11px] text-gray-400">
                <div>
                  stream: <span className={wsState === 'streaming' ? 'text-green-500' : wsState === 'error' ? 'text-red-500' : 'text-gray-500'}>{wsState}</span>
                  {' · '}msgs: {msgCount}
                  {lastRaw !== null && <> · last EDA: {lastRaw}</>}
                </div>
                {pluxStatus && (
                  <div>
                    device: {pluxStatus.device_address || (pluxStatus.plux_available ? 'not found' : 'plux.pyd not loaded')}
                    {pluxStatus.channel_map?.eda !== undefined && <> · EDA ch {pluxStatus.channel_map.eda}</>}
                  </div>
                )}
                {wsError && <div className="text-red-500">{wsError}</div>}
                {pluxStatus?.import_error && <div className="text-red-500">plux import: {pluxStatus.import_error}</div>}
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
                      <div className={`h-1.5 w-1.5 rounded-full ${ampTone.dot}`}></div> Signal amplitude
                    </span>
                    <span className={`font-medium ${ampTone.text}`}>
                      {metrics ? metrics.amplitudeQuality.label : 'Checking...'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 flex items-center gap-2">
                      <div className={`h-1.5 w-1.5 rounded-full ${noiseTone.dot}`}></div> Noise level
                    </span>
                    <span className={`font-medium ${noiseTone.text}`}>
                      {metrics ? metrics.noiseQuality.label : 'Checking...'}
                    </span>
                  </div>
                </div>
                <div className="border-t border-gray-100 p-3 text-center">
                  <button 
                    onClick={() => {
                      setChartData([]);
                      setMsgCount(0);
                      setLastRaw(null);
                      setWsError(null);
                      setSignalStatus('checking');
                      setWsAttempt(a => a + 1);
                    }}
                    className="text-sm font-medium text-violet-600 hover:text-violet-800"
                  >
                    Rerun Signal Check
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
                disabled={wsState !== 'streaming'}
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
            <div className="flex flex-col items-center text-center">
              <p className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
                To confirm signal quality, a short resting baseline will be recorded. Ensure the participant is seated and relaxed.
              </p>

              {/* Live waveform during recording */}
              <div className="mb-4 h-24 w-full overflow-hidden rounded-lg border border-gray-100 bg-gray-50/50">
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 2, right: 4, left: 4, bottom: 2 }}>
                      <YAxis
                        domain={['auto', 'auto']}
                        tick={{ fontSize: 9, fill: '#9ca3af' }}
                        width={42}
                        label={{ value: 'EDA', angle: -90, position: 'insideLeft', offset: 10, fontSize: 9, fill: '#9ca3af' }}
                      />
                      <Line type="monotone" dataKey="uv" stroke="#7C3AED" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <span className="text-xs text-gray-400">Awaiting signal...</span>
                  </div>
                )}
              </div>

              <p className="mb-4 text-sm font-medium text-gray-900 px-4">
                Press record, then focus on the circle and remain still for 30 seconds.
              </p>

              <div className={`mb-6 h-40 w-40 rounded-full border-4 border-dashed transition-colors duration-500 flex items-center justify-center ${
                recordingState === 'recording' ? 'border-violet-600 bg-violet-100 animate-pulse' : 'border-slate-800 bg-slate-600'
              }`}>
                {recordingState === 'recording' && countdown !== null && (
                  <span className="text-3xl font-bold text-violet-700 tabular-nums">{countdown}</span>
                )}
              </div>

              <button
                onClick={startRealRecording}
                disabled={recordingState === 'recording'}
                className="rounded-lg bg-violet-600 px-8 py-2.5 text-sm font-medium text-white transition-all hover:bg-violet-700 disabled:opacity-50"
              >
                {recordingState === 'idle' ? 'Start Recording' : recordingState === 'recording' ? '• Recording...' : 'Record Again'}
              </button>

              {recordingState === 'recording' && (
                <button onClick={() => setRecordingState('done')} className="mt-4 text-xs text-gray-400 underline">
                  [Dev: Skip 30s Timer]
                </button>
              )}
              {saveData && (
                <p className="mt-3 text-xs text-gray-400">{saveData.filename} · {saveData.rows} samples</p>
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
                    <span className="text-gray-600 flex items-center gap-2"><div className={`h-1.5 w-1.5 rounded-full ${ampTone.dot}`}></div> Signal amplitude</span>
                    <span className={`font-medium ${ampTone.text}`}>{metrics ? metrics.amplitudeQuality.label : 'Checking...'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 flex items-center gap-2"><div className={`h-1.5 w-1.5 rounded-full ${noiseTone.dot}`}></div> Noise level</span>
                    <span className={`font-medium ${noiseTone.text}`}>{metrics ? metrics.noiseQuality.label : 'Checking...'}</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-gray-100 mt-2">
                    <span className="text-gray-600 flex items-center gap-2">
                      <div className={`h-1.5 w-1.5 rounded-full ${
                        recordingState !== 'done' ? 'bg-gray-400'
                        : baseline?.stable === true ? 'bg-green-500'
                        : baseline?.stable === false ? 'bg-red-500'
                        : 'bg-gray-400'}`}></div> Baseline
                    </span>
                    <span className={`text-xs font-medium ${
                      recordingState !== 'done' ? 'text-gray-500'
                      : baseline?.stable === true ? 'text-green-600'
                      : baseline?.stable === false ? 'text-red-600'
                      : 'text-gray-500'}`}>
                      {recordingState === 'idle' ? 'unknown'
                        : recordingState === 'recording' ? 'recording...'
                        : baseline?.stable === true ? 'Stable'
                        : baseline?.stable === false ? 'Unstable'
                        : 'Recorded'}
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

              {recordingState === 'done' && baseline?.stable === false && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 animate-in fade-in duration-300">
                  <AlertCircle className="h-5 w-5 shrink-0 text-red-600" />
                  <span>
                    Baseline looks unstable{baseline.reason ? ` (${baseline.reason})` : ''}. Keep the hand still
                    and press <span className="font-medium">Record Again</span> for a cleaner baseline.
                  </span>
                </div>
              )}

              {recordingState === 'done' && (
                <div className="flex gap-3 justify-end pt-4 animate-in fade-in zoom-in-95 duration-300">
                  <button
                    onClick={handleExport}
                    className="rounded-lg border border-gray-300 px-6 py-3 text-sm font-medium text-gray-700 transition-all hover:bg-gray-50"
                  >
                    Export Baseline Recording
                  </button>
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