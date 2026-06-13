import { useState } from 'react';
import { Eye, Activity, Heart, Brain, CheckSquare } from 'lucide-react';

// Centralized data for the sensors and their specific metrics
const SENSOR_DATA = [
  {
    id: 'eye',
    name: 'Eye Tracker',
    description: 'Track gaze patterns and visual attention',
    icon: Eye,
    metrics: ['Eye Tracking', 'Fixation Duration', 'Gaze Path', 'Areas of Interest (AOI)', 'Saccade Velocity']
  },
  {
    id: 'gsr',
    name: 'GSR Sensor (EDA)',
    description: 'Measure emotional arousal and stress',
    icon: Activity,
    metrics: ['GSR Sensor (EDA)', 'Skin Conductance Response', 'Arousal Level', 'Stress Index']
  },
  {
    id: 'ecg',
    name: 'Heart Rate Sensor (ECG)',
    description: 'Monitor heart activity and cognitive load',
    icon: Heart,
    metrics: ['Heart Rate Sensor (ECG)', 'Heart Rate', 'Heart Rate Variability', 'Cognitive Load', 'Stress Level']
  },
  {
    id: 'eeg',
    name: 'Brain Waves Sensor (EEG)',
    description: 'Capture neural activity and cognitive states',
    icon: Brain,
    metrics: ['Brain Waves Sensor (EEG)', 'Brain Activity', 'Cognitive State', 'Attention Level', 'Mental Workload']
  }
];

export default function ManualSensorSelectionStep({ onContinue }: { onContinue: () => void }) {
  // State to track selections
  const [selectedSensors, setSelectedSensors] = useState<string[]>([]);
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>([]);

  // Toggle a sensor on or off
  const handleToggleSensor = (sensorId: string) => {
    setSelectedSensors(prev => {
      const isSelected = prev.includes(sensorId);
      const sensor = SENSOR_DATA.find(s => s.id === sensorId);
      
      if (isSelected) {
        // If unchecking the sensor, also remove all its associated metrics
        setSelectedMetrics(currentMetrics => 
          currentMetrics.filter(m => !sensor?.metrics.includes(m))
        );
        return prev.filter(id => id !== sensorId);
      } else {
        // If checking the sensor, auto-select all its metrics for convenience
        if (sensor) {
          setSelectedMetrics(currentMetrics => 
            [...new Set([...currentMetrics, ...sensor.metrics])]
          );
        }
        return [...prev, sensorId];
      }
    });
  };

  // Toggle individual metrics on or off
  const handleToggleMetric = (metricName: string) => {
    setSelectedMetrics(prev => 
      prev.includes(metricName) 
        ? prev.filter(m => m !== metricName) 
        : [...prev, metricName]
    );
  };

  return (
    <div className="flex flex-col animate-in fade-in duration-300">
      
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:gap-12">
        {/* LEFT COLUMN: Select Sensors */}
        <div>
          <h3 className="mb-4 text-sm font-medium text-gray-700">Select Sensors</h3>
          <div className="space-y-3">
            {SENSOR_DATA.map((sensor) => {
              const Icon = sensor.icon;
              const isSelected = selectedSensors.includes(sensor.id);
              
              return (
                <div 
                  key={sensor.id}
                  onClick={() => handleToggleSensor(sensor.id)}
                  className={`flex cursor-pointer items-center justify-between rounded-xl border p-4 transition-all ${
                    isSelected 
                      ? 'border-violet-600 bg-violet-50/50' 
                      : 'border-gray-200 bg-white hover:border-violet-300'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className={`rounded-full p-2 ${isSelected ? 'bg-white text-violet-600' : 'bg-gray-50 text-gray-500'}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <h4 className={`font-semibold text-sm ${isSelected ? 'text-violet-900' : 'text-gray-900'}`}>
                        {sensor.name}
                      </h4>
                      <p className={`text-xs mt-0.5 ${isSelected ? 'text-violet-700' : 'text-gray-500'}`}>
                        {sensor.description}
                      </p>
                    </div>
                  </div>
                  <div className={`flex h-5 w-5 items-center justify-center rounded border ${
                    isSelected ? 'border-violet-600 bg-violet-600' : 'border-gray-300'
                  }`}>
                    {isSelected && <CheckSquare className="h-3.5 w-3.5 text-white" />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT COLUMN: Select Metrics */}
        <div>
          <h3 className="mb-4 text-sm font-medium text-gray-700">Select Metrics to Track</h3>
          
          {selectedSensors.length === 0 ? (
            // Empty State
            <div className="flex h-[300px] items-center justify-center rounded-xl border border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500">
              Select at least one sensor to see available metrics
            </div>
          ) : (
            // Populated State
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {selectedSensors.map(sensorId => {
                const sensor = SENSOR_DATA.find(s => s.id === sensorId);
                if (!sensor) return null;
                const Icon = sensor.icon;

                return (
                  <div key={`metrics-${sensor.id}`} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm animate-in zoom-in-95 duration-200">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
                      <Icon className="h-4 w-4 text-gray-500" />
                      {sensor.name}
                    </div>
                    <div className="space-y-2">
                      {sensor.metrics.map(metric => (
                        <label key={metric} className="flex cursor-pointer items-center gap-2">
                          <input 
                            type="checkbox" 
                            checked={selectedMetrics.includes(metric)}
                            onChange={() => handleToggleMetric(metric)}
                            className="h-4 w-4 rounded border-gray-300 text-violet-600 focus:ring-violet-600"
                          />
                          <span className="text-xs text-gray-700">{metric}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* BOTTOM SUMMARY BAR */}
      <div className="mt-8 rounded-lg border border-blue-200 bg-blue-50/50 p-4 text-sm text-gray-700 flex items-center">
        Selected: <span className="font-semibold ml-1">{selectedSensors.length} sensors</span> 
        <span className="mx-2">-</span> 
        <span className="font-semibold">{selectedMetrics.length} metrics</span>
      </div>

      {/* ACTION BUTTON */}
      <div className="mt-6 flex justify-end">
        <button 
          onClick={onContinue}
          disabled={selectedSensors.length === 0}
          className="rounded-lg bg-black px-8 py-2.5 text-sm font-medium text-white hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Continue
        </button>
      </div>

    </div>
  );
}