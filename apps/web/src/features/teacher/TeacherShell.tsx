import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../lib/auth.js';
import { db } from '../../lib/firebase.js';
import { countPendingStudents } from '../repository/students/studentsService.js';
import { ProgramsView } from './ProgramsView.js';
import { LessonsView } from './LessonsView.js';
import { TemplateKitView } from './TemplateKitView.js';
import { VerificationsView } from './VerificationsView.js';
import { ClassesView } from './ClassesView.js';
import { StudentsView } from './StudentsView.js';
import logoScritta from '../../assets/logo-scritta-schoolforge.png';
import styles from './TeacherShell.module.css';

type Section = 'lezioni' | 'corsi' | 'verifiche' | 'classi' | 'studenti' | 'template';

const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: 'lezioni', label: 'Lezioni', icon: '📖' },
  { id: 'corsi', label: 'Corsi', icon: '📚' },
  { id: 'verifiche', label: 'Verifiche', icon: '📝' },
  { id: 'classi', label: 'Classi', icon: '🏫' },
  { id: 'studenti', label: 'Studenti', icon: '🎓' },
  { id: 'template', label: 'Template', icon: '📄' },
];

export function TeacherShell() {
  const { user, signOut } = useAuth();
  const ownerUid = user?.uid ?? '';
  const [activeSection, setActiveSection] = useState<Section>('lezioni');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pendingStudentsCount, setPendingStudentsCount] = useState(0);

  const displayName = user?.displayName ?? user?.email ?? 'Docente';
  const initials = displayName.charAt(0).toUpperCase();

  const refreshPendingStudentsCount = useCallback(() => {
    if (!ownerUid) return;
    void countPendingStudents(ownerUid, db)
      .then(setPendingStudentsCount)
      .catch(() => {
        // Non-fatal: the badge simply won't show/update.
      });
  }, [ownerUid]);

  useEffect(() => {
    refreshPendingStudentsCount();
  }, [refreshPendingStudentsCount]);

  useEffect(() => {
    if (!menuOpen) return;
    function handlePointerDown(e: MouseEvent | TouchEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <img src={logoScritta} alt="SchoolForge" className={styles.logo} />
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
              <div className={styles.dropdownIdentity}>
                {user?.photoURL && (
                  <img
                    src={user.photoURL}
                    alt=""
                    aria-hidden="true"
                    className={styles.dropdownAvatar}
                    referrerPolicy="no-referrer"
                  />
                )}
                <div className={styles.dropdownIdentityText}>
                  {user?.displayName && (
                    <span className={styles.dropdownName}>{user.displayName}</span>
                  )}
                  <span className={styles.dropdownEmail}>{user?.email}</span>
                </div>
              </div>
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
            {id === 'studenti' && pendingStudentsCount > 0 && (
              <span className={styles.navBadge} aria-label={`${pendingStudentsCount} in attesa`}>
                {pendingStudentsCount}
              </span>
            )}
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
        ) : activeSection === 'studenti' ? (
          <StudentsView ownerUid={ownerUid} onStudentsChanged={refreshPendingStudentsCount} />
        ) : null}
      </main>
    </div>
  );
}
