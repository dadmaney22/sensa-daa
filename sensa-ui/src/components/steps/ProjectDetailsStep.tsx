import { useState } from 'react';
import { ClipboardList } from 'lucide-react';
import type { StudyConfig } from '../../App';

const STUDY_TYPE_LABELS: Record<string, string> = {
  screen: 'Screen Based Usability Testing',
  mobile: 'Mobile App Usability Testing',
};

const INTERFACE_LABELS: Record<string, string> = {
  web: 'Web Application',
  mobile: 'Mobile Application',
};

const ENVIRONMENT_LABELS: Record<string, string> = {
  remote: 'Remote Environment',
  lab: 'Lab Environment',
};

const EQUIPMENT_NAMES: Record<string, string> = {
  eye: 'Eye Tracking',
  gsr: 'GSR Sensor (EDA)',
  ecg: 'Heart Rate Sensor (ECG)',
  eeg: 'Brain Waves Sensor (EEG)',
};

export default function ProjectDetailsStep({
  studyConfig,
  onContinue,
  onEdit,
}: {
  studyConfig: StudyConfig;
  onContinue: () => void;
  onEdit: () => void;
}) {
  const [projectName, setProjectName] = useState('');
  const [participants, setParticipants] = useState('');
  const [objectives, setObjectives] = useState('');
  const [description, setDescription] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const errors = {
    projectName: !projectName.trim(),
    participants: !participants || Number(participants) < 1,
    objectives: !objectives.trim(),
  };

  const handleContinue = () => {
    setSubmitted(true);
    if (Object.values(errors).some(Boolean)) return;
    onContinue();
  };

  const equipmentDisplay = studyConfig.selectedEquipment
    .map(id => EQUIPMENT_NAMES[id] ?? id)
    .join(', ') || '—';

  return (
    <div className="space-y-8 animate-in fade-in duration-300">

      {/* Summary Card */}
      <div className="relative rounded-xl border border-blue-200 bg-blue-50/30 p-6">
        <div className="mb-4 flex items-center gap-2 font-semibold text-gray-900">
          <ClipboardList className="h-5 w-5 text-gray-600" />
          Study Configuration
        </div>

        <div className="space-y-2 text-sm text-gray-600">
          <p><strong className="font-medium text-gray-900">Study Name:</strong> {studyConfig.studyName || '—'}</p>
          <p><strong className="font-medium text-gray-900">Study Type:</strong> {(STUDY_TYPE_LABELS[studyConfig.studyType] ?? studyConfig.studyType) || '—'}</p>
          <p><strong className="font-medium text-gray-900">Interface:</strong> {(INTERFACE_LABELS[studyConfig.interfaceType] ?? studyConfig.interfaceType) || '—'}</p>
          <p><strong className="font-medium text-gray-900">Environment:</strong> {(ENVIRONMENT_LABELS[studyConfig.environmentType] ?? studyConfig.environmentType) || '—'}</p>
          <p><strong className="font-medium text-gray-900">Sensors:</strong> {equipmentDisplay}</p>
        </div>

        <button
          onClick={onEdit}
          className="absolute right-6 top-6 rounded-md bg-black px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-800 transition-colors"
        >
          Edit
        </button>
      </div>

      {/* Form Fields */}
      <div className="space-y-6">

        {/* Project Name */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Project Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="e.g Q1 2025 UX Research Initiative"
            className={`w-full rounded-lg border px-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-1 ${
              submitted && errors.projectName
                ? 'border-red-400 focus:border-red-400 focus:ring-red-400'
                : 'border-gray-300 focus:border-violet-600 focus:ring-violet-600'
            }`}
          />
          {submitted && errors.projectName ? (
            <p className="mt-1.5 text-xs text-red-500">Project name is required.</p>
          ) : (
            <p className="mt-1.5 text-xs text-gray-500">A unique identifier for this research project</p>
          )}
        </div>

        {/* Number of Participants */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Number of participants <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            min={1}
            value={participants}
            onChange={(e) => setParticipants(e.target.value)}
            placeholder="e.g. 20"
            className={`w-full rounded-lg border px-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-1 sm:w-64 ${
              submitted && errors.participants
                ? 'border-red-400 focus:border-red-400 focus:ring-red-400'
                : 'border-gray-300 focus:border-violet-600 focus:ring-violet-600'
            }`}
          />
          {submitted && errors.participants ? (
            <p className="mt-1.5 text-xs text-red-500">Please enter the number of participants.</p>
          ) : (
            <p className="mt-1.5 text-xs text-gray-500">Number of people taking part in this project</p>
          )}
        </div>

        {/* Project Objectives */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Project Objectives <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={objectives}
            onChange={(e) => setObjectives(e.target.value)}
            placeholder="e.g This project aims to evaluate the new checkout flow for xyz platform"
            className={`w-full rounded-lg border px-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-1 ${
              submitted && errors.objectives
                ? 'border-red-400 focus:border-red-400 focus:ring-red-400'
                : 'border-gray-300 focus:border-violet-600 focus:ring-violet-600'
            }`}
          />
          {submitted && errors.objectives ? (
            <p className="mt-1.5 text-xs text-red-500">Project objectives are required.</p>
          ) : (
            <p className="mt-1.5 text-xs text-gray-500">Brief overview of the project objectives</p>
          )}
        </div>

        {/* Project Description */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Project Description
          </label>
          <textarea
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g We will conduct usability tests with 20 participants to identify pain points and measure user engagement throughout the checkout process for xyz platform. Key focus areas include form completion, payment method selection and order confirmation."
            className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm text-gray-900 focus:border-violet-600 focus:outline-none focus:ring-1 focus:ring-violet-600 resize-none"
          ></textarea>
          <p className="mt-1.5 text-xs text-gray-500">Detailed description of project methodologies, participants, and expected outcomes</p>
        </div>

      </div>

      {/* Information Callout */}
      <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 text-sm text-gray-700">
        After proceeding, you'll move to the readiness check and then the calibration phase where the selected sensors will be set up and tested.
      </div>

      {/* Action Button */}
      <div className="flex justify-end pt-2">
        <button
          onClick={handleContinue}
          className="rounded-lg bg-black px-6 py-2.5 text-sm font-medium text-white hover:bg-gray-800 transition-colors"
        >
          Start Readiness Check
        </button>
      </div>

    </div>
  );
}
