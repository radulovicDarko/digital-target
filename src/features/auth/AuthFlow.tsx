import { useState } from 'react';

import { LoginScreen } from './LoginScreen';
import { RegisterScreen } from './RegisterScreen';
import { ResetPasswordScreen } from './ResetPasswordScreen';

type Mode = 'login' | 'register' | 'reset';

export const AuthFlow = () => {
  const [mode, setMode] = useState<Mode>('login');

  switch (mode) {
    case 'register':
      return <RegisterScreen onGoToLogin={() => setMode('login')} />;
    case 'reset':
      return <ResetPasswordScreen onCancel={() => setMode('login')} />;
    case 'login':
    default:
      return (
        <LoginScreen
          onGoToRegister={() => setMode('register')}
          onForgotPassword={() => setMode('reset')}
        />
      );
  }
};
