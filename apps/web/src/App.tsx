import { AuthGuard } from './features/auth/AuthGuard.js';
import { OwnerGate } from './features/teacher/OwnerGate.js';
import { TeacherShell } from './features/teacher/TeacherShell.js';
import { AuthProvider } from './lib/auth.js';

export function App() {
  return (
    <AuthProvider>
      <AuthGuard>
        <OwnerGate>
          <TeacherShell />
        </OwnerGate>
      </AuthGuard>
    </AuthProvider>
  );
}
