import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';

interface SetupLayoutProps {
  children: ReactNode;
  currentStep: number;
  totalSteps: number;
  title: string;
  subtitle: string;
  onBack?: () => void;
}

export default function SetupLayout({ 
  children, 
  currentStep, 
  totalSteps, 
  title, 
  subtitle, 
  onBack 
}: SetupLayoutProps) {
  
  // Calculate the progress percentage for the progress bar
  const progressPercentage = (currentStep / totalSteps) * 100;

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 font-sans text-gray-900">
      
      {/* Top Navigation */}
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-xl font-bold tracking-tight">
            {/* Mock Sensa Logo */}
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-black">
              <div className="h-2 w-2 rounded-full border-2 border-white"></div>
            </div>
            Sensa
          </div>
          <div className="border-l border-gray-300 pl-4 text-sm text-gray-500">
            Configuration • <span className="font-semibold text-gray-900">Study Setup</span>
          </div>
        </div>
        <div className="text-sm font-medium text-gray-500">
          Step {currentStep} of {totalSteps}
        </div>
      </header>

      {/* Progress Bar */}
      <div className="h-1 w-full bg-gray-100">
        <div 
          className="h-full bg-violet-600 transition-all duration-300 ease-in-out" 
          style={{ width: `${progressPercentage}%` }}
        ></div>
      </div>

      {/* Main Content Area */}
      <main className="flex flex-1 justify-center p-6 pb-20 md:p-10">
        <div className="w-full max-w-4xl">
          
          {/* Step Header */}
          <div className="mb-6">
            <button 
              onClick={onBack}
              className="mb-6 flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
            >
              <ChevronLeft className="h-5 w-5 text-gray-600" />
            </button>
            <h1 className="mb-1 text-2xl font-bold text-gray-900">{title}</h1>
            <p className="text-gray-500">{subtitle}</p>
          </div>

          {/* The White Card containing the form */}
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm md:p-8">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}