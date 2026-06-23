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

export default function CalibrationStep({
  onContinue,
  onUpdateHeader,
  onUpdateBack,
}: {
  onContinue: () => void;
  onUpdateHeader: (header: { title: string, subtitle: string } | null) => void;
  onUpdateBack: (fn: (() => void) | null) => void;
}) {
  const [calibratedSensors, setCalibratedSensors] = useState<string[]>([]);
  const [activeSensorId, setActiveSensorId] = useState<string | null>(null);
  const [calibrationPhase, setCalibrationPhase] = useState<'empty' | 'active'>('empty');

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
    onUpdateBack(null);
  };


  // ==========================================
  // VIEW 2: INDIVIDUAL SENSOR CALIBRATION VIEW
  // ==========================================
  
  if (activeSensorId) {
    // ROUTE TO EYE TRACKER COMPONENT
    if (activeSensorId === 'eye') {
      return <EyeTrackerCalibrationFlow onFinish={handleFinishCalibration} onUpdateBack={onUpdateBack} />;
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
      return <EDACalibrationFlow onFinish={handleFinishCalibration} onUpdateBack={onUpdateBack} />;
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
          Start Sensor Calibration
        </button>
      </div>

    </div>
  );
}