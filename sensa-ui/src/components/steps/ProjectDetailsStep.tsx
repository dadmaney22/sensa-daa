import { ClipboardList } from 'lucide-react';

export default function ProjectDetailsStep({ 
  onContinue, 
  onEdit 
}: { 
  onContinue: () => void;
  onEdit: () => void;
}) {
  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      
      {/* Summary Card */}
      <div className="relative rounded-xl border border-blue-200 bg-blue-50/30 p-6">
        <div className="mb-4 flex items-center gap-2 font-semibold text-gray-900">
          <ClipboardList className="h-5 w-5 text-gray-600" />
          Study Configuration
        </div>
        
        <div className="space-y-2 text-sm text-gray-600">
          <p><strong className="font-medium text-gray-900">Study Name:</strong> Pilot Testing ABC</p>
          <p><strong className="font-medium text-gray-900">Study Type:</strong> Usability Testing</p>
          <p><strong className="font-medium text-gray-900">Interface:</strong> Web Application</p>
          <p><strong className="font-medium text-gray-900">Environment:</strong> Lab Setup</p>
          <p><strong className="font-medium text-gray-900">Sensors:</strong> Eye Tracking, GSR Sensor (EDA), Heart Rate Sensor (ECG), Brain Waves Sensor (EEG)</p>
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
            placeholder="e.g Q1 2025 UX Research Initiative"
            className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 focus:border-violet-600 focus:outline-none focus:ring-1 focus:ring-violet-600"
          />
          <p className="mt-1.5 text-xs text-gray-500">A unique identifier for this research project</p>
        </div>

        {/* Number of Participants */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Number of participants <span className="text-red-500">*</span>
          </label>
          <select className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 bg-white focus:border-violet-600 focus:outline-none focus:ring-1 focus:ring-violet-600 appearance-none sm:w-64">
            <option value="20">20</option>
            <option value="50">50</option>
            <option value="100">100+</option>
          </select>
          <p className="mt-1.5 text-xs text-gray-500">Number of people taking part in this project</p>
        </div>

        {/* Project Objectives */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Project Objectives <span className="text-red-500">*</span>
          </label>
          <input 
            type="text" 
            placeholder="e.g This project aims to evaluate the new checkout flow for xyz platform"
            className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 focus:border-violet-600 focus:outline-none focus:ring-1 focus:ring-violet-600"
          />
          <p className="mt-1.5 text-xs text-gray-500">Brief overview of the project objectives</p>
        </div>

        {/* Project Description */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Project Description <span className="text-red-500">*</span>
          </label>
          <textarea 
            rows={4}
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
          onClick={onContinue}
          className="rounded-lg bg-black px-6 py-2.5 text-sm font-medium text-white hover:bg-gray-800 transition-colors"
        >
          Start Readiness Check
        </button>
      </div>

    </div>
  );
}