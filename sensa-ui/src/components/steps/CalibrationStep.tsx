import { useState, useEffect } from 'react';
import { Eye, Activity, Heart, Brain, AlertCircle, CheckCircle2 } from 'lucide-react';
import EEGCalibrationFlow from './EEGCalibrationFlow';
import ECGCalibrationFlow from './ECGCalibrationFlow';
import EDACalibrationFlow from './EDACalibrationFlow';
import EyeTrackerCalibrationFlow from './EyeTrackerCalibrationFlow';

const SENSORS = [
  { id: 'eye', name: 'Eye Tracker', device: 'Tobii Eye Tracker 4C', icon: Eye },
  { id: 'gsr', name: 'GSR Sensor (EDA)', device: 'Biosignalplux', icon: Activity },
  { id: 'ecg', name: 'Heart Rate Sensor (ECG)', device: 'Biosignalplux', icon: Heart },
  { id: 'eeg', name: 'Brain Wave Sensor (EEG)', device: 'Biosignalplux', icon: Brain },
];

// ---------------------------------------------------------------------------
// Confetti
// ---------------------------------------------------------------------------
function ConfettiPiece({ style }: { style: React.CSSProperties }) {
  return <div className="absolute top-0 rounded-sm opacity-90" style={style} />;
}

function Confetti() {
  const pieces = Array.from({ length: 80 }, (_, i) => {
    const colours = ['#7C3AED','#10B981','#F59E0B','#EF4444','#3B82F6','#EC4899','#14B8A6'];
    const size = 6 + Math.random() * 8;
    return {
      id: i,
      style: {
        left: `${Math.random() * 100}%`,
        width: size,
        height: size,
        backgroundColor: colours[i % colours.length],
        transform: `rotate(${Math.random() * 360}deg)`,
        animation: `confetti-fall ${1.5 + Math.random() * 2}s ease-in ${Math.random() * 0.8}s forwards`,
      } as React.CSSProperties,
    };
  });

  return (
    <>
      <style>{`
        @keyframes confetti-fall {
          0%   { transform: translateY(-20px) rotate(0deg); opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
      `}</style>
      <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
        {pieces.map(p => <ConfettiPiece key={p.id} style={p.style} />)}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Thank-you screen
// ---------------------------------------------------------------------------
function ThankYouScreen() {
  const [showConfetti, setShowConfetti] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setShowConfetti(false), 4000);
    return () => clearTimeout(t);
  }, []);

  return (
    <>
      {showConfetti && <Confetti />}
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-8 animate-in fade-in zoom-in-95 duration-500 text-center px-4">
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-green-100 text-5xl">
          🎉
        </div>
        <div className="space-y-3">
          <h2 className="text-3xl font-bold text-gray-900">Testing Complete!</h2>
          <p className="text-lg text-gray-600 max-w-md">
            You've successfully completed the testing session. Thank you for your participation!
          </p>
        </div>
        <div className="rounded-xl border border-green-200 bg-green-50 p-6 max-w-sm w-full text-left space-y-2">
          <p className="text-sm font-semibold text-green-800">What happens next</p>
          <ul className="space-y-1 text-sm text-green-700">
            <li>✓ Your session data has been saved</li>
            <li>✓ Sensor recordings are ready for export</li>
            <li>✓ The experimenter will now debrief you</li>
          </ul>
        </div>
        <p className="text-sm text-gray-400">Please remain seated until the experimenter returns.</p>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function CalibrationStep({
  onContinue,
  onUpdateHeader,
}: {
  onContinue: () => void;
  onUpdateHeader: (header: { title: string, subtitle: string } | null) => void;
}) {
  const [calibratedSensors, setCalibratedSensors] = useState<string[]>(['eye', 'gsr', 'ecg', 'eeg']); // TEMP: preview-only seed, revert before commit
  const [activeSensorId, setActiveSensorId] = useState<string | null>(null);
  const [calibrationPhase, setCalibrationPhase] = useState<'empty' | 'active'>('empty');
  const [showThankYou] = useState(false);

  useEffect(() => {
    if (activeSensorId) {
      const sensor = SENSORS.find(s => s.id === activeSensorId);
      // Hides the global subtitle if in the EEG flow, EEG component brings own header
      if (activeSensorId === 'eeg') {
        onUpdateHeader({ title: "EEG Calibration", subtitle: "Follow the onscreen instructions to properly calibrate the Biosignalsplux EEG Sensor" });
      } else {
        onUpdateHeader({ title: `${sensor?.name} calibration`, subtitle: `Follow the onscreen instructions to properly calibrate the ${sensor?.device}` });
      }
    } else {
      onUpdateHeader(null); 
    }
    return () => onUpdateHeader(null);
  }, [activeSensorId, onUpdateHeader]);

  const handleStartCalibration = (id: string) => {
    setActiveSensorId(id);
    setCalibrationPhase('empty'); 
  };

  const handleFinishCalibration = () => {
    if (activeSensorId && !calibratedSensors.includes(activeSensorId)) {
      setCalibratedSensors(prev => [...prev, activeSensorId]);
    }
    setActiveSensorId(null);
  };


  // ==========================================
  // VIEW 2: INDIVIDUAL SENSOR CALIBRATION VIEW
  // ==========================================
  
  if (activeSensorId) {
    // ROUTE TO EYE TRACKER COMPONENT
    if (activeSensorId === 'eye') {
      return <EyeTrackerCalibrationFlow onFinish={handleFinishCalibration} />;
    }

    // ROUTE TO EEG COMPONENT
    if (activeSensorId === 'eeg') {
      return <EEGCalibrationFlow onFinish={handleFinishCalibration} />;
    }

    // ROUTE TO ECG COMPONENT
    if (activeSensorId === 'ecg') {
      return <ECGCalibrationFlow onFinish={handleFinishCalibration} />;
    }

    // ROUTE TO GSR/EDA COMPONENT
    if (activeSensorId === 'gsr') {
      return <EDACalibrationFlow onFinish={handleFinishCalibration} />;
    }

    // FALLBACK FOR THE OTHER SENSORS 
    return (
      <div className="animate-in fade-in slide-in-from-right-4 duration-300">
        <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-8 text-center text-sm text-gray-700">
          {calibrationPhase === 'empty' ? (
            <div className="flex flex-col items-center gap-4">
              <p>Empty state [please make sure the tracker is plugged in]</p>
              <button 
                onClick={() => setCalibrationPhase('active')}
                className="mt-4 rounded-lg bg-violet-100 px-4 py-2 font-medium text-violet-700 hover:bg-violet-200 transition-colors"
              >
                Simulate Tracker Connection
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <p>Screen with generic tracking calibration. Follow instructions.</p>
              <button 
                onClick={handleFinishCalibration}
                className="mt-4 rounded-lg bg-black px-6 py-2 font-medium text-white hover:bg-gray-800 transition-colors"
              >
                Complete Calibration
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ==========================================
  // THANK YOU SCREEN
  // ==========================================
  if (showThankYou) return <ThankYouScreen />;

  // ==========================================
  // VIEW 1: CALIBRATION OVERVIEW LIST
  // ==========================================
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      
      <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 text-sm text-gray-700">
        The calibration process will guide you step-by-step with visual instructions. Each sensor will be calibrated and validated individually before proceeding.
      </div>

      <div className="space-y-4">
        {SENSORS.map((sensor) => {
          const isCalibrated = calibratedSensors.includes(sensor.id);
          const Icon = sensor.icon;

          return (
            <div 
              key={sensor.id} 
              className={`flex items-center justify-between rounded-xl border p-4 transition-colors ${
                isCalibrated ? 'border-green-300 bg-green-50/30' : 'border-gray-200 bg-white'
              }`}
            >
              <div className="flex items-center gap-4">
                <Icon className={`h-6 w-6 ${isCalibrated ? 'text-green-600' : 'text-gray-500'}`} />
                <div>
                  <h4 className="text-sm font-semibold text-gray-900">{sensor.name}</h4>
                  <p className="mt-0.5 text-xs text-gray-500">{sensor.device}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button 
                  onClick={() => handleStartCalibration(sensor.id)}
                  className="rounded-lg bg-black px-4 py-2 text-xs font-medium text-white hover:bg-gray-800 transition-colors"
                >
                  {isCalibrated ? 'Re-calibrate' : 'Calibrate'}
                </button>
                {isCalibrated ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-gray-400" />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-end pt-4">
        <button
          onClick={onContinue}
          className="rounded-lg bg-black px-6 py-2.5 text-sm font-medium text-white hover:bg-gray-800 transition-colors"
        >
          Proceed to Recording Data
        </button>
      </div>

    </div>
  );
}