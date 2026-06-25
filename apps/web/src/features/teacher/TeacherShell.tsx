import { useState } from 'react';
import { useAuth } from '../../lib/auth.js';
import { ProgramsView } from './ProgramsView.js';
import { TemplateKitView } from './TemplateKitView.js';
import { VerificationsView } from './VerificationsView.js';
import { ClassesView } from './ClassesView.js';
import styles from './TeacherShell.module.css';

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
    <div className={styles.layout}>
      <header className={styles.header}>
        <span className={styles.logo}>SchoolForge</span>
        <span className={styles.userEmail}>{user?.displayName ?? user?.email}</span>
        <button type="button" className={styles.logoutBtn} onClick={() => void signOut()}>
          Esci
        </button>
      </header>

      <nav aria-label="Sezioni docente" className={styles.nav}>
        {SECTIONS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className={styles.navBtn}
            onClick={() => setActiveSection(id)}
            aria-current={activeSection === id ? 'page' : undefined}
          >
            {label}
          </button>
        ))}
      </nav>

      <main className={styles.main}>
        <h1 className={styles.sectionTitle}>{activeLabel}</h1>
        {activeSection === 'repository' ? (
          <TemplateKitView />
        ) : activeSection === 'programmi' ? (
          <ProgramsView />
        ) : activeSection === 'verifiche' ? (
          <VerificationsView />
        ) : activeSection === 'impostazioni' ? (
          <ClassesView />
        ) : null}
      </main>
    </div>
  );
}
