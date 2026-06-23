import { useState } from 'react';
import { Monitor, Smartphone, Wifi, FlaskConical, Eye, Activity, Heart, Brain, CheckSquare, ChevronDown } from 'lucide-react';
import type { StudyConfig } from '../../App';

const STUDY_GOALS = [
  {
    id: 'workload',
    title: 'User Effort & Workload',
    subtitle: 'Mental effort, attention, and task demand',
    sensors: 'Sensors: Eye Tracker + EEG + EDA + ECG',
    metrics: 'fixations ↑, alpha power ↓, EDA peaks ↑, HR ↑ / RMSSD ↓'
  },
  {
    id: 'emotion',
    title: 'Emotional Engagement / Arousal',
    subtitle: 'Arousal, stress, and emotional response',
    sensors: 'Sensors: EDA + ECG + Eye Tracker',
    metrics: 'EDA peaks ↑, HR ↑, pupil dilation ↑'
  },
  {
    id: 'decision',
    title: 'Decision-Making Behavior',
    subtitle: 'Choice patterns, hesitation, and decision points',
    sensors: 'Sensors: Eye Tracker + ECG',
    metrics: 'Time to First Fixation (TTFF), gaze transitions, HR variability changes'
  },
  {
    id: 'usability',
    title: 'Usability Friction / Interaction Difficulty',
    subtitle: 'Breakdowns, confusion, and interaction errors',
    sensors: 'Sensors: EDA + ECG + Eye Tracking',
    metrics: 'EDA spikes, HR ↑, repeated gaze shifts, longer fixations'
  }
];

const AVAILABLE_EQUIPMENT = [
  { id: 'eye', name: 'Eye Tracker', desc: 'Track gaze patterns and visual attention', icon: Eye },
  { id: 'gsr', name: 'GSR Sensor (EDA)', desc: 'Measure emotional arousal and stress', icon: Activity },
  { id: 'ecg', name: 'Heart Rate Sensor (ECG)', desc: 'Monitor heart activity and cognitive load', icon: Heart },
  { id: 'eeg', name: 'Brain Waves Sensor (EEG)', desc: 'Capture neural activity and cognitive states', icon: Brain }
];

export default function StudySetupStep({
  initialConfig,
  onContinue,
}: {
  initialConfig: StudyConfig;
  onContinue: (config: StudyConfig) => void;
}) {
  const [studyName, setStudyName] = useState(initialConfig.studyName);
  const [studyType, setStudyType] = useState(initialConfig.studyType);
  const [selectedGoal, setSelectedGoal] = useState<string>(initialConfig.selectedGoal);
  const [selectedEquipment, setSelectedEquipment] = useState<string[]>(initialConfig.selectedEquipment);
  const [interfaceType, setInterfaceType] = useState<string>(initialConfig.interfaceType);
  const [environmentType, setEnvironmentType] = useState<string>(initialConfig.environmentType);
  const [submitted, setSubmitted] = useState(false);

  const toggleEquipment = (id: string) => {
    setSelectedEquipment(prev => prev.includes(id) ? prev.filter(e => e !== id) : [...prev, id]);
  };

  const errors = {
    studyName: !studyName.trim(),
    studyType: !studyType,
    selectedGoal: !selectedGoal,
    selectedEquipment: selectedEquipment.length === 0,
    interfaceType: !interfaceType,
    environmentType: !environmentType,
  };

  const handleContinue = () => {
    setSubmitted(true);
    if (Object.values(errors).some(Boolean)) return;
    onContinue({ studyName: studyName.trim(), studyType, selectedGoal, selectedEquipment, interfaceType, environmentType });
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300">

      {/* Top Row: Name & Type */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">Study Name <span className="text-red-500">*</span></label>
          <input
            type="text"
            placeholder="Lorem Ipsum"
            value={studyName}
            onChange={(e) => setStudyName(e.target.value)}
            className={`w-full rounded-lg border px-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-1 ${
              submitted && errors.studyName
                ? 'border-red-400 focus:border-red-400 focus:ring-red-400'
                : 'border-gray-300 focus:border-violet-600 focus:ring-violet-600'
            }`}
          />
          {submitted && errors.studyName && (
            <p className="mt-1 text-xs text-red-500">Study name is required.</p>
          )}
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">Study Type <span className="text-red-500">*</span></label>
          <div className="relative">
            <select
              value={studyType}
              onChange={(e) => setStudyType(e.target.value)}
              className={`w-full rounded-lg border px-4 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-1 appearance-none pr-10 ${
                submitted && errors.studyType
                  ? 'border-red-400 focus:border-red-400 focus:ring-red-400'
                  : 'border-gray-300 focus:border-violet-600 focus:ring-violet-600'
              }`}
            >
              <option value="" disabled>Select study type</option>
              <option value="screen">Screen Based Usability Testing</option>
              <option value="mobile">Mobile App Usability Testing</option>
            </select>
            <ChevronDown className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500 pointer-events-none" />
          </div>
          {submitted && errors.studyType && (
            <p className="mt-1 text-xs text-red-500">Please select a study type.</p>
          )}
        </div>
      </div>

      {/* Study Goal */}
      <div className={`rounded-lg border bg-white ${submitted && errors.selectedGoal ? 'border-red-400' : 'border-gray-200'}`}>
        <div className="px-5 pt-5 pb-3">
          <label className="mb-1 block text-sm font-medium text-gray-900">Study Goal <span className="text-red-500">*</span></label>
          <p className="text-sm text-gray-500">The main purpose of this study is to measure:</p>
        </div>

        <div className="flex flex-col">
          {STUDY_GOALS.map((goal, index) => (
            <label
              key={goal.id}
              className={`flex cursor-pointer items-start justify-between gap-4 px-5 py-4 hover:bg-gray-50 transition-colors ${
                index !== STUDY_GOALS.length - 1 ? 'border-b border-gray-100' : ''
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="radio"
                  name="studyGoal"
                  checked={selectedGoal === goal.id}
                  onChange={() => setSelectedGoal(goal.id)}
                  className="mt-1 h-4 w-4 border-gray-300 text-violet-600 focus:ring-violet-600"
                />
                <div>
                  <span className="block text-sm font-medium text-gray-900">{goal.title}</span>
                  <span className="block text-xs text-gray-500 mt-0.5">{goal.subtitle}</span>
                </div>
              </div>
              <div className="hidden text-right text-xs sm:block">
                <span className="block text-gray-600">{goal.sensors}</span>
                <span className="block text-gray-400 mt-0.5">{goal.metrics}</span>
              </div>
            </label>
          ))}
        </div>
        {submitted && errors.selectedGoal && (
          <p className="px-5 pb-3 text-xs text-red-500">Please select a study goal.</p>
        )}
      </div>

      {/* Available Equipment Selection */}
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">Available Equipment <span className="text-red-500">*</span></label>
        <p className="mb-4 text-sm text-gray-500">What hardware do you have available?</p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {AVAILABLE_EQUIPMENT.map((item) => {
            const Icon = item.icon;
            const isSelected = selectedEquipment.includes(item.id);

            return (
              <div
                key={item.id}
                onClick={() => toggleEquipment(item.id)}
                className={`flex cursor-pointer items-center justify-between rounded-xl border p-4 transition-all ${
                  isSelected
                    ? 'border-violet-600 bg-violet-50/50'
                    : submitted && errors.selectedEquipment
                    ? 'border-red-300 bg-white hover:border-red-400'
                    : 'border-gray-200 bg-white hover:border-violet-300'
                }`}
              >
                <div className="flex items-center gap-4">
                  <Icon className={`h-5 w-5 ${isSelected ? 'text-violet-600' : 'text-gray-500'}`} />
                  <div>
                    <h4 className={`font-semibold text-sm ${isSelected ? 'text-violet-900' : 'text-gray-900'}`}>
                      {item.name}
                    </h4>
                    <p className={`text-xs mt-0.5 ${isSelected ? 'text-violet-700' : 'text-gray-500'}`}>
                      {item.desc}
                    </p>
                  </div>
                </div>
                <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                  isSelected ? 'border-violet-600 bg-white' : 'border-gray-300 bg-white'
                }`}>
                  {isSelected && <CheckSquare className="h-3.5 w-3.5 text-violet-600 rounded-sm" />}
                </div>
              </div>
            );
          })}
        </div>
        {submitted && errors.selectedEquipment && (
          <p className="mt-2 text-xs text-red-500">Please select at least one piece of equipment.</p>
        )}
      </div>

      {/* Interface Type Selection */}
      <div>
        <label className="mb-3 block text-sm font-medium text-gray-700">Interface Type <span className="text-red-500">*</span></label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <button
            onClick={() => setInterfaceType('web')}
            className={`flex flex-col items-center justify-center gap-2 rounded-lg p-6 transition-colors ${
              interfaceType === 'web'
                ? 'border-2 border-violet-600 bg-violet-50/30 text-violet-700'
                : submitted && errors.interfaceType
                ? 'border border-red-300 bg-white text-gray-500 hover:border-red-400'
                : 'border border-gray-200 bg-white text-gray-500 hover:border-gray-300'
            }`}
          >
            <Monitor className="h-8 w-8" />
            <span className="font-medium">Web Application</span>
          </button>
          <button
            onClick={() => setInterfaceType('mobile')}
            className={`flex flex-col items-center justify-center gap-2 rounded-lg p-6 transition-colors ${
              interfaceType === 'mobile'
                ? 'border-2 border-violet-600 bg-violet-50/30 text-violet-700'
                : submitted && errors.interfaceType
                ? 'border border-red-300 bg-white text-gray-500 hover:border-red-400'
                : 'border border-gray-200 bg-white text-gray-500 hover:border-gray-300'
            }`}
          >
            <Smartphone className="h-8 w-8" />
            <span className="font-medium">Mobile Application</span>
          </button>
        </div>
        {submitted && errors.interfaceType && (
          <p className="mt-2 text-xs text-red-500">Please select an interface type.</p>
        )}
      </div>

      {/* Environment Type Selection */}
      <div>
        <label className="mb-3 block text-sm font-medium text-gray-700">Test Environment <span className="text-red-500">*</span></label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <button
            onClick={() => setEnvironmentType('remote')}
            className={`flex flex-col items-center justify-center gap-2 rounded-lg p-6 transition-colors ${
              environmentType === 'remote'
                ? 'border-2 border-violet-600 bg-violet-50/30 text-violet-700'
                : submitted && errors.environmentType
                ? 'border border-red-300 bg-white text-gray-500 hover:border-red-400'
                : 'border border-gray-200 bg-white text-gray-500 hover:border-gray-300'
            }`}
          >
            <Wifi className="h-8 w-8" />
            <span className="font-medium">Remote Environment</span>
          </button>
          <button
            onClick={() => setEnvironmentType('lab')}
            className={`flex flex-col items-center justify-center gap-2 rounded-lg p-6 transition-colors ${
              environmentType === 'lab'
                ? 'border-2 border-violet-600 bg-violet-50/30 text-violet-700'
                : submitted && errors.environmentType
                ? 'border border-red-300 bg-white text-gray-500 hover:border-red-400'
                : 'border border-gray-200 bg-white text-gray-500 hover:border-gray-300'
            }`}
          >
            <FlaskConical className="h-8 w-8" />
            <span className="font-medium">Lab Environment</span>
          </button>
        </div>
        {submitted && errors.environmentType && (
          <p className="mt-2 text-xs text-red-500">Please select a test environment.</p>
        )}
      </div>

      {/* Action Button */}
      <div className="flex justify-end pt-4 border-t border-gray-100">
        <button
          onClick={handleContinue}
          className="rounded-lg bg-black px-8 py-3 text-sm font-medium text-white hover:bg-gray-800 transition-colors"
        >
          Continue to Sensor Selection
        </button>
      </div>

    </div>
  );
}
