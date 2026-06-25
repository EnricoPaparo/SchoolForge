import { useAuth } from '../../lib/auth.js';

export function TeacherShell() {
  const { user, signOut } = useAuth();

  return (
    <div>
      <header>
        <span>SchoolForge</span>
        <span>{user?.email}</span>
        <button onClick={() => void signOut()}>Esci</button>
      </header>
      <main>
        <p>Area docente — funzionalità implementate in M1.</p>
      </main>
    </div>
  );
}
