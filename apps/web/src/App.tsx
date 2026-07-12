import { lazy } from 'react';
import { AuthGuard } from './features/auth/AuthGuard.js';
import { RoleGate } from './features/auth/RoleGate.js';
import { AuthProvider } from './lib/auth.js';

/**
 * Lazy-loaded at the docente/studente role boundary (PERF-SEC-01B-4): this
 * is the one place TeacherShell — and everything it statically imports
 * (repository editors, verifications, pools, PDF generation, ...) — is
 * referenced from the initial render path. `RoleGate` only ever renders
 * these `children` after resolving the caller as the owner, and wraps them
 * in its own `Suspense` boundary (see `RoleGate.tsx`), so this chunk is
 * fetched only when a docente actually signs in — never for a student.
 */
const TeacherShell = lazy(() =>
  import('./features/teacher/TeacherShell.js').then((m) => ({ default: m.TeacherShell })),
);

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
