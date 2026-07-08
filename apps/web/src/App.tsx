import { AuthGuard } from './features/auth/AuthGuard.js';
import { RoleGate } from './features/auth/RoleGate.js';
import { TeacherShell } from './features/teacher/TeacherShell.js';
import { AuthProvider } from './lib/auth.js';

export function App() {
  return (
    <AuthProvider>
      <AuthGuard>
        <RoleGate>
          <TeacherShell />
        </RoleGate>
      </AuthGuard>
    </AuthProvider>
  );
}
