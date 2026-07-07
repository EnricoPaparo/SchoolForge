import { useRef, useState } from 'react';
import { useAuth } from '../../lib/auth.js';
import { ProgramsView } from './ProgramsView.js';
import { LessonsView } from './LessonsView.js';
import { TemplateKitView } from './TemplateKitView.js';
import { VerificationsView } from './VerificationsView.js';
import { ClassesView } from './ClassesView.js';
import styles from './TeacherShell.module.css';

type Section = 'template' | 'corsi' | 'lezioni' | 'verifiche' | 'classi';

const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: 'template', label: 'Template', icon: '📄' },
  { id: 'corsi', label: 'Corsi', icon: '📚' },
  { id: 'lezioni', label: 'Lezioni', icon: '📖' },
  { id: 'verifiche', label: 'Verifiche', icon: '📝' },
  { id: 'classi', label: 'Classi', icon: '🏫' },
];

export function TeacherShell() {
  const { user, signOut } = useAuth();
  const [activeSection, setActiveSection] = useState<Section>('template');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const displayName = user?.displayName ?? user?.email ?? 'Docente';
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <span className={styles.logo}>SchoolForge</span>
        <div className={styles.userMenu} ref={menuRef}>
          <button
            type="button"
            className={styles.avatarBtn}
            aria-label={`Account: ${displayName}`}
            aria-expanded={menuOpen}
            aria-haspopup="true"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <span className={styles.avatar}>{initials}</span>
          </button>
          {menuOpen && (
            <div className={styles.dropdown} role="menu">
              <span className={styles.dropdownEmail}>{user?.email}</span>
              <button
                type="button"
                role="menuitem"
                className={styles.dropdownSignOut}
                onClick={() => {
                  setMenuOpen(false);
                  void signOut();
                }}
              >
                Esci
              </button>
            </div>
          )}
        </div>
      </header>

      <nav aria-label="Sezioni docente" className={styles.nav}>
        {SECTIONS.map(({ id, label, icon }) => (
          <button
            key={id}
            type="button"
            className={styles.navBtn}
            onClick={() => setActiveSection(id)}
            aria-current={activeSection === id ? 'page' : undefined}
            title={label}
          >
            <span className={styles.navIcon} aria-hidden="true">
              {icon}
            </span>
            <span className={styles.navLabel}>{label}</span>
          </button>
        ))}
      </nav>

      <main className={styles.main}>
        {activeSection === 'template' ? (
          <TemplateKitView />
        ) : activeSection === 'corsi' ? (
          <ProgramsView />
        ) : activeSection === 'lezioni' ? (
          <LessonsView />
        ) : activeSection === 'verifiche' ? (
          <VerificationsView />
        ) : activeSection === 'classi' ? (
          <ClassesView />
        ) : null}
      </main>
    </div>
  );
}
