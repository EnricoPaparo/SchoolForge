import { AuthGuard } from './features/auth/AuthGuard.js';
import { TeacherShell } from './features/teacher/TeacherShell.js';
import { AuthProvider } from './lib/auth.js';

export function App() {
  return (
    <AuthProvider>
      <AuthGuard>
        <TeacherShell />
      </AuthGuard>
    </AuthProvider>
  );
}
