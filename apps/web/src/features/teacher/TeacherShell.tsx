import { useState } from 'react';
import { useAuth } from '../../lib/auth.js';

type Section = 'repository' | 'programmi' | 'verifiche' | 'impostazioni';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'repository', label: 'Repository didattico' },
  { id: 'programmi', label: 'Programmi / UDA / Lezioni' },
  { id: 'verifiche', label: 'Verifiche cartacee' },
  { id: 'impostazioni', label: 'Impostazioni' },
];

export function TeacherShell() {
  const { user, signOut } = useAuth();
  const [activeSection, setActiveSection] = useState<Section>('repository');

  const activeLabel = SECTIONS.find((s) => s.id === activeSection)?.label ?? '';

  return (
    <div>
      <header>
        <span>SchoolForge</span>
        <span>{user?.displayName ?? user?.email}</span>
        <button type="button" onClick={() => void signOut()}>
          Esci
        </button>
      </header>
      <nav aria-label="Sezioni docente">
        {SECTIONS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveSection(id)}
            aria-current={activeSection === id ? 'page' : undefined}
          >
            {label}
          </button>
        ))}
      </nav>
      <main>
        <h1>{activeLabel}</h1>
        <p>Funzione non ancora implementata.</p>
      </main>
    </div>
  );
}
