import { useState } from 'react';

import { PairingDiscoveryScreen } from './PairingDiscoveryScreen';
import { PairingManualScreen } from './PairingManualScreen';
import { PairingTrustScreen } from './PairingTrustScreen';
import { PairingWifiHelpScreen } from './PairingWifiHelpScreen';

type Step =
  | { name: 'discovery' }
  | { name: 'manual' }
  | { name: 'wifi' }
  | { name: 'trust'; baseUrl: string; displayName: string };

type Props = {
  onCompleted: () => void;
  /** When provided, the discovery screen shows a back arrow that calls this. */
  onCancel?: () => void;
};

export const PairingWizard = ({ onCompleted, onCancel }: Props) => {
  const [step, setStep] = useState<Step>({ name: 'discovery' });

  switch (step.name) {
    case 'manual':
      return (
        <PairingManualScreen
          onCancel={() => setStep({ name: 'discovery' })}
          onSubmit={(baseUrl) => setStep({ name: 'trust', baseUrl, displayName: baseUrl })}
        />
      );
    case 'wifi':
      return <PairingWifiHelpScreen onBack={() => setStep({ name: 'discovery' })} />;
    case 'trust':
      return (
        <PairingTrustScreen
          baseUrl={step.baseUrl}
          displayName={step.displayName}
          onBack={() => setStep({ name: 'discovery' })}
          onPaired={() => onCompleted()}
        />
      );
    case 'discovery':
    default:
      return (
        <PairingDiscoveryScreen
          onCandidateSelected={(baseUrl, displayName) =>
            setStep({ name: 'trust', baseUrl, displayName })
          }
          onManual={() => setStep({ name: 'manual' })}
          onWifiInstructions={() => setStep({ name: 'wifi' })}
          onPaired={() => onCompleted()}
          onCancel={onCancel}
        />
      );
  }
};
