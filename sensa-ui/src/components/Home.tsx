import { useState } from 'react';
import { Activity, Folder, History, ArrowLeft, Database, Upload, ChevronRight } from 'lucide-react';

export default function Home({ onStartWizard }: { onStartWizard: () => void }) {
  // State to toggle between the initial list and the "New Study" options
  const [view, setView] = useState<'main' | 'new-study'>('main');

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6 font-sans text-gray-900">
      
      {/* ==========================================
          VIEW 1: MAIN MENU
          ========================================== */}
      {view === 'main' && (
        <div className="w-full max-w-2xl animate-in fade-in zoom-in-95 duration-300">
          
          {/* Header/Logo Area */}
          <div className="mb-12 flex flex-col items-center text-center">
            <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-violet-600 shadow-md">
              <Activity className="h-8 w-8 text-white" />
            </div>
            <h1 className="mb-2 text-3xl font-bold tracking-tight text-gray-900">SENSA</h1>
            <p className="text-gray-500">Multi-sensor research platform for usability labs</p>
          </div>

          {/* Action List */}
          <div className="space-y-4">
            {/* Action 1 */}
            <button 
              onClick={() => setView('new-study')}
              className="group flex w-full items-center justify-between rounded-xl border border-gray-200 bg-white p-5 text-left shadow-sm transition-all hover:border-violet-300 hover:shadow-md"
            >
              <div className="flex items-center gap-5">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white transition-transform group-hover:scale-105">
                  <Activity className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">Start New Study</h3>
                  <p className="text-sm text-gray-500">Begin a new research study with sensor setup and calibration</p>
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-gray-400 transition-transform group-hover:translate-x-1 group-hover:text-violet-600" />
            </button>

            {/* Action 2 */}
            <button className="group flex w-full items-center justify-between rounded-xl border border-gray-200 bg-white p-5 text-left shadow-sm transition-all hover:border-gray-300 hover:shadow-md">
              <div className="flex items-center gap-5">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-slate-700 text-white transition-transform group-hover:scale-105">
                  <Folder className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">Open Existing Study</h3>
                  <p className="text-sm text-gray-500">Continue working on a previously created study</p>
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-gray-400 transition-transform group-hover:translate-x-1" />
            </button>

            {/* Action 3 */}
            <button className="group flex w-full items-center justify-between rounded-xl border border-gray-200 bg-white p-5 text-left shadow-sm transition-all hover:border-gray-300 hover:shadow-md">
              <div className="flex items-center gap-5">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-slate-700 text-white transition-transform group-hover:scale-105">
                  <History className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">View Past Studies</h3>
                  <p className="text-sm text-gray-500">Browse and analyze completed research studies</p>
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-gray-400 transition-transform group-hover:translate-x-1" />
            </button>
          </div>

        </div>
      )}


      {/* ==========================================
          VIEW 2: START NEW STUDY SUB-MENU
          ========================================== */}
      {view === 'new-study' && (
        <div className="w-full max-w-3xl animate-in fade-in slide-in-from-bottom-4 duration-300">
          
          <button 
            onClick={() => setView('main')}
            className="mb-6 flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Home
          </button>

          <div className="rounded-2xl border border-gray-200 bg-white p-8 md:p-10 shadow-sm">
            <h2 className="mb-2 text-2xl font-bold text-gray-900">Start New Study</h2>
            <p className="mb-8 text-gray-500">Choose how you want to collect your research data.</p>

            <div className="space-y-4">
              
              {/* Option 1: Record New Data */}
              <button 
                onClick={onStartWizard} // LAUNCHES SETUP WIZARD
                className="group relative flex w-full items-center justify-between rounded-xl border border-gray-200 bg-white p-5 text-left transition-all hover:border-violet-600 hover:bg-violet-50/30"
              >
                <div className="flex items-center gap-5">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white">
                    <Database className="h-6 w-6" />
                  </div>
                  <div className="pr-20"> {/* Padding to prevent text from hitting the badge */}
                    <h3 className="font-semibold text-gray-900">Record New Data</h3>
                    <p className="text-sm text-gray-500">Set up sensors and record data in real-time from participants</p>
                  </div>
                </div>
                
                {/* Recommended Badge */}
                <span className="absolute right-14 top-5 rounded bg-violet-600 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
                  Recommended
                </span>

                <ChevronRight className="h-5 w-5 text-gray-400 transition-transform group-hover:translate-x-1 group-hover:text-violet-600" />
              </button>

              {/* Option 2: Pre-recorded Data */}
              <button className="group flex w-full items-center justify-between rounded-xl border border-gray-200 bg-white p-5 text-left transition-all hover:border-violet-300 hover:bg-violet-50/30">
                <div className="flex items-center gap-5">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white">
                    <Upload className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">Pre-recorded Data</h3>
                    <p className="text-sm text-gray-500">Import and analyze data from previous recording sessions</p>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-gray-400 transition-transform group-hover:translate-x-1 group-hover:text-violet-600" />
              </button>

            </div>
          </div>

        </div>
      )}

    </div>
  );
}