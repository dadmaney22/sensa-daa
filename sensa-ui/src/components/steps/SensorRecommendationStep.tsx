import { Eye, Activity, Heart, Brain, Lightbulb } from 'lucide-react';

export default function SensorRecommendationStep({ 
  onAccept, 
  onCustomize 
}: { 
  onAccept: () => void; 
  onCustomize: () => void; 
}) {
  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      
      <div className="mb-6">
        <h3 className="text-xl font-bold text-gray-900">Sensor Recommendation</h3>
        <p className="mt-2 text-sm text-gray-600">
          Based on your study goal (User Effort & Workload) and available equipment, we recommend the following setup:
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm md:p-8">
        
        {/* RECOMMENDED SENSORS GRID */}
        <div className="mb-8">
          <h4 className="mb-4 text-sm font-medium text-gray-700">Recommended Sensors</h4>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            
            {/* Eye Tracker */}
            <div className="flex items-center gap-4 rounded-xl border border-green-200 bg-green-50/50 p-4">
              <Eye className="h-5 w-5 text-gray-700 shrink-0" />
              <div>
                <h5 className="font-semibold text-sm text-gray-900">Eye Tracker (ET)</h5>
                <p className="text-xs text-gray-600 mt-0.5">Track gaze patterns and visual attention</p>
              </div>
            </div>

            {/* GSR Sensor */}
            <div className="flex items-center gap-4 rounded-xl border border-green-200 bg-green-50/50 p-4">
              <Activity className="h-5 w-5 text-gray-700 shrink-0" />
              <div>
                <h5 className="font-semibold text-sm text-gray-900">GSR Sensor (EDA)</h5>
                <p className="text-xs text-gray-600 mt-0.5">Measure emotional arousal and stress</p>
              </div>
            </div>

            {/* ECG Sensor */}
            <div className="flex items-center gap-4 rounded-xl border border-green-200 bg-green-50/50 p-4">
              <Heart className="h-5 w-5 text-gray-700 shrink-0" />
              <div>
                <h5 className="font-semibold text-sm text-gray-900">Heart Rate Sensor (ECG)</h5>
                <p className="text-xs text-gray-600 mt-0.5">Monitor heart activity and cognitive load</p>
              </div>
            </div>

            {/* EEG Sensor */}
            <div className="flex items-center gap-4 rounded-xl border border-green-200 bg-green-50/50 p-4">
              <Brain className="h-5 w-5 text-gray-700 shrink-0" />
              <div>
                <h5 className="font-semibold text-sm text-gray-900">Brain Waves Sensor (EEG)</h5>
                <p className="text-xs text-gray-600 mt-0.5">Capture neural activity and cognitive states</p>
              </div>
            </div>

          </div>
        </div>

        {/* METRICS TO TRACK */}
        <div className="mb-8">
          <h4 className="mb-4 text-sm font-medium text-gray-700">Metrics to Track</h4>
          <div className="flex flex-wrap gap-3">
            {/* ET Metrics */}
            <div className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 shadow-sm">
              <Eye className="h-3.5 w-3.5 text-gray-500" /> Fixation Duration (ET)
            </div>
            <div className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 shadow-sm">
              <Eye className="h-3.5 w-3.5 text-gray-500" /> Gaze Path (ET)
            </div>
            <div className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 shadow-sm">
              <Eye className="h-3.5 w-3.5 text-gray-500" /> Pupil Size (ET)
            </div>

            {/* EDA Metrics */}
            <div className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 shadow-sm">
              <Activity className="h-3.5 w-3.5 text-gray-500" /> Skin Conductance Response (EDA)
            </div>
            <div className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 shadow-sm">
              <Activity className="h-3.5 w-3.5 text-gray-500" /> Arousal Level (EDA)
            </div>

            {/* ECG Metrics */}
            <div className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 shadow-sm">
              <Heart className="h-3.5 w-3.5 text-gray-500" /> Heart Rate (ECG)
            </div>
            <div className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 shadow-sm">
              <Heart className="h-3.5 w-3.5 text-gray-500" /> Heart Rate Variability (ECG)
            </div>

            {/* EEG Metrics */}
            <div className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 shadow-sm">
              <Brain className="h-3.5 w-3.5 text-gray-500" /> Cognitive Load (EEG)
            </div>
            <div className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 shadow-sm">
              <Brain className="h-3.5 w-3.5 text-gray-500" /> Brain Activity (EEG)
            </div>
            <div className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 shadow-sm">
              <Brain className="h-3.5 w-3.5 text-gray-500" /> Attention Level (EEG)
            </div>
          </div>
        </div>

        {/* WHY THESE RECOMMENDATIONS */}
        <div className="mb-8 rounded-xl border border-blue-200 bg-blue-50 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-blue-600" />
            <h4 className="text-sm font-bold text-gray-900">Why these recommendations? (Based on User Effort & Workload)</h4>
          </div>
          <ul className="list-disc space-y-3 pl-7 text-sm text-gray-800">
            <li>
              <span className="font-semibold">Eye Tracker:</span> People's eyes move differently when something is hard to process.
              <span className="block mt-0.5 text-xs italic text-gray-600">Watch for: longer fixations, larger pupil size, more eye movements during effortful moments</span>
            </li>
            <li>
              <span className="font-semibold">EDA:</span> The body's stress response shows up in skin sweat.
              <span className="block mt-0.5 text-xs italic text-gray-600">Watch for: skin conductance spikes during difficult moments.</span>
            </li>
            <li>
              <span className="font-semibold">ECG:</span> Heart activity changes with mental effort.
              <span className="block mt-0.5 text-xs italic text-gray-600">Watch for: heart rate increases and heart rate variability (RMSSD) decreases during demanding moments.</span>
            </li>
            <li>
              <span className="font-semibold">EEG:</span> Brain activity changes when users think hard.
              <span className="block mt-0.5 text-xs italic text-gray-600">Watch for: alpha power decreases during mentally demanding moments.</span>
            </li>
          </ul>
        </div>

        {/* ACTIONS */}
        <div className="flex flex-col-reverse justify-between gap-4 border-t border-gray-100 pt-6 sm:flex-row sm:items-center">
          <button 
            onClick={onCustomize}
            className="rounded-lg bg-violet-50 px-6 py-3 text-sm font-semibold text-violet-700 transition-colors hover:bg-violet-100 w-full sm:w-auto text-center"
          >
            Customize Sensor Selection
          </button>
          
          <button 
            onClick={onAccept}
            className="rounded-lg bg-black px-8 py-3 text-sm font-medium text-white transition-colors hover:bg-gray-800 w-full sm:w-auto text-center"
          >
            Accept Recommendation
          </button>
        </div>

      </div>
    </div>
  );
}