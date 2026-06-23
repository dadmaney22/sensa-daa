import { useState } from 'react';
import { Check, CheckCircle2, HelpCircle } from 'lucide-react';

const CHECKLIST_ITEMS = [
  {
    id: 'seated',
    title: 'Participant seated correctly',
    description: 'Participant is comfortably seated at the workstation with proper posture and correct viewing distance (approx. 90cm).',
    tooltip: [
      "Ensure the participant sits upright with their back supported and eyes level with the screen.",
      "Their face should be approximately 90 cm from the monitor (roughly an arm's length).",
      "Sitting too close or too far reduces eye-tracking accuracy and may cause calibration to fail."
    ]
  },
  {
    id: 'lighting',
    title: 'Proper Lighting',
    description: 'Room lighting is consistent, diffused, and free from direct sunlight or strong directional light sources.',
    tooltip: [
      "Use consistent indoor lighting at normal office levels. Avoid direct sunlight or bright lamps positioned behind or beside the participant. If sunlight enters the room, close the blinds.",
      "Very dim lighting should also be avoided as it causes excessive pupil dilation and reduces tracking quality."
    ]
  },
  {
    id: 'visibility',
    title: 'Sensor Visibility',
    description: 'All sensors are within reach, powered on, and accessible for placement and calibration.',
    tooltip: [
      "Confirm that all sensors to be used in this session are visible and reachable.",
      "The biosignalsplux hub should be powered on and within Bluetooth range of the recording device.",
      "Electrode cables should be untangled and ready for placement."
    ]
  },
  {
    id: 'cleaning',
    title: 'Ensure electrodes are attached to each biosensor',
    description: 'Confirm that all electrodes are securely connected to their respective biosensors before proceeding.',
    tooltip: [
      "Check that each electrode cable is firmly plugged into the biosignalsplux hub.",
      "Loose or disconnected electrodes will result in missing or noisy signal channels during calibration.",
      "Ensure the electrode snap connectors are fully seated on the sensor contacts."
    ]
  }
];

export default function EnvironmentReadinessStep({ onContinue }: { onContinue: () => void }) {
  const [participantName, setParticipantName] = useState('Ali Khan');
  const [participantId, setParticipantId] = useState('SENS-PRJ001-PRT001');
  const [completedChecks, setCompletedChecks] = useState<string[]>([]);

  const toggleCheck = (id: string) => {
    setCompletedChecks(prev => 
      prev.includes(id) 
        ? prev.filter(checkId => checkId !== id) 
        : [...prev, id]
    );
  };

  const isAllComplete = completedChecks.length === CHECKLIST_ITEMS.length;

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      
      {/* Participant Info Inputs */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <label className="mb-2 block text-xs font-medium text-gray-700">
            Participant Name <span className="text-red-500">*</span>
          </label>
          <input 
            type="text" 
            value={participantName}
            onChange={(e) => setParticipantName(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 focus:border-violet-600 focus:outline-none focus:ring-1 focus:ring-violet-600"
          />
        </div>
        <div>
          <label className="mb-2 block text-xs font-medium text-gray-700">
            Participant ID <span className="text-red-500">*</span>
          </label>
          <input 
            type="text" 
            value={participantId}
            onChange={(e) => setParticipantId(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 bg-gray-50 focus:border-violet-600 focus:outline-none focus:ring-1 focus:ring-violet-600"
          />
        </div>
      </div>

      {/* Interactive Checklist */}
      <div className="space-y-4">
        {CHECKLIST_ITEMS.map((item) => {
          const isChecked = completedChecks.includes(item.id);
          
          return (
            <div 
              key={item.id}
              onClick={() => toggleCheck(item.id)}
              className={`group/card flex cursor-pointer items-start justify-between gap-4 rounded-xl border p-5 transition-all duration-200 ${
                isChecked 
                  ? 'border-violet-600 bg-violet-50/30' 
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className="flex items-start gap-4">
                {/* Custom Checkbox */}
                <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
                  isChecked 
                    ? 'border-violet-600 bg-white text-violet-600' 
                    : 'border-gray-300 bg-white'
                }`}>
                  {isChecked && <Check className="h-3.5 w-3.5" />}
                </div>
                
                {/* Text Content */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-900">{item.title}</h4>
                  <p className="mt-0.5 text-xs text-gray-500 pr-4">{item.description}</p>
                </div>
              </div>

              {/* Tooltip Wrapper */}
              <div 
                className="group/tooltip relative mt-0.5 p-1"
                onClick={(e) => e.stopPropagation()} // Prevents the card from toggling if they accidentally click the icon
              >
                <HelpCircle className="h-4 w-4 text-gray-400 transition-colors group-hover/tooltip:text-gray-600" />
                
                {/* Dark Hover Tooltip */}
                <div className="pointer-events-none absolute bottom-full right-0 z-10 mb-2 hidden w-80 flex-col gap-3 rounded-xl bg-gray-900 p-4 text-xs font-normal text-gray-200 opacity-0 shadow-xl transition-opacity group-hover/tooltip:pointer-events-auto group-hover/tooltip:flex group-hover/tooltip:opacity-100">
                  <h5 className="font-semibold text-white">{item.title}</h5>
                  <div className="space-y-2">
                    {item.tooltip.map((paragraph, index) => (
                      <p key={index} className="leading-relaxed">{paragraph}</p>
                    ))}
                  </div>
                </div>
              </div>

            </div>
          );
        })}
      </div>

      {/* Success Banner */}
      {isAllComplete && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-4 text-sm font-medium text-green-800 animate-in zoom-in-95 duration-300">
          <CheckCircle2 className="h-5 w-5 text-green-600" />
          All environment checks complete
        </div>
      )}

      {/* Action Button */}
      <div className="flex justify-end pt-4">
        <button 
          onClick={onContinue}
          disabled={!isAllComplete}
          className={`rounded-lg px-6 py-2.5 text-sm font-medium transition-all ${
            isAllComplete 
              ? 'bg-black text-white hover:bg-gray-800' 
              : 'bg-violet-100 text-white cursor-not-allowed opacity-80'
          }`}
        >
          Start Sensor Calibration
        </button>
      </div>

    </div>
  );
}