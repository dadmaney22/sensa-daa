import { useState } from 'react';
import Home from './components/Home';
import SetupLayout from './components/SetupLayout';
import StudySetupStep from './components/steps/StudySetupStep';
import SensorRecommendationStep from './components/steps/SensorRecommendationStep';
import ManualSensorSelectionStep from './components/steps/ManualSensorSelectionStep';
import ProjectDetailsStep from './components/steps/ProjectDetailsStep';
import EnvironmentReadinessStep from './components/steps/EnvironmentReadinessStep';
import CalibrationStep from './components/steps/CalibrationStep';

export interface StudyConfig {
  studyName: string;
  studyType: string;
  selectedGoal: string;
  selectedEquipment: string[];
  interfaceType: string;
  environmentType: string;
}

export default function App() {
  const [appState, setAppState] = useState<'home' | 'wizard'>('home');
  const [currentStep, setCurrentStep] = useState(1);
  const totalSteps = 13;
  const [headerOverride, setHeaderOverride] = useState<{title: string, subtitle: string} | null>(null);
  const [backOverride, setBackOverride] = useState<(() => void) | null>(null);
  const [studyConfig, setStudyConfig] = useState<StudyConfig>({
    studyName: '',
    studyType: '',
    selectedGoal: '',
    selectedEquipment: [],
    interfaceType: '',
    environmentType: '',
  });

  if (appState === 'home') {
    return (
      <Home
        onStartWizard={() => {
          setCurrentStep(1);
          setAppState('wizard');
        }}
      />
    );
  }

  const stepContent = {
    1: { title: "Study Setup", subtitle: "Configure your research study parameters" },
    2: { title: "Sensor Recommendation", subtitle: "Based on your study configuration, we recommend the following setup:" },
    3: { title: "Manual Sensor Selection", subtitle: "Choose which sensors and metrics you want to use for your study" },
    4: { title: "Project Details", subtitle: "Add additional details about your research project" },
    5: { title: "Environment and Participant Readiness", subtitle: "Complete the readiness checklist before proceeding to calibration" },
    6: { title: "Calibration Overview", subtitle: "Follow the onscreen instructions and visuals properly connect, setup and calibrate your sensors" }
  };

  const currentContent = stepContent[currentStep as keyof typeof stepContent] || stepContent[1];

  return (
    <SetupLayout
      currentStep={currentStep}
      totalSteps={totalSteps}
      title={headerOverride?.title || currentContent.title}
      subtitle={headerOverride?.subtitle || currentContent.subtitle}
      onBack={() => {
        if (backOverride) { backOverride(); return; }
        if (currentStep === 1) {
          setAppState('home');
        } else {
          setHeaderOverride(null);
          setCurrentStep(prev => Math.max(1, prev - 1));
        }
      }}
    >
      {currentStep === 1 && (
        <StudySetupStep
          initialConfig={studyConfig}
          onContinue={(config) => {
            setStudyConfig(config);
            setCurrentStep(2);
          }}
        />
      )}

      {currentStep === 2 && (
        <SensorRecommendationStep
          onCustomize={() => setCurrentStep(3)}
          onAccept={() => setCurrentStep(4)}
        />
      )}

      {currentStep === 3 && (
        <ManualSensorSelectionStep onContinue={() => setCurrentStep(4)} />
      )}

      {currentStep === 4 && (
        <ProjectDetailsStep
          studyConfig={studyConfig}
          onContinue={() => setCurrentStep(5)}
          onEdit={() => setCurrentStep(1)}
        />
      )}

      {currentStep === 5 && (
        <EnvironmentReadinessStep onContinue={() => setCurrentStep(6)} />
      )}

      {currentStep === 6 && (
        <CalibrationStep
          onContinue={() => setCurrentStep(7)}
          onUpdateHeader={setHeaderOverride}
          onUpdateBack={(fn) => setBackOverride(fn ? () => fn : null)}
        />
      )}

      {currentStep === 7 && (
        <div className="py-10 text-center text-gray-500">
          <h2>Step 7 Phase (In Progress)</h2>
        </div>
      )}
    </SetupLayout>
  );
}
