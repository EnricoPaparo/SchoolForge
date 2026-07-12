import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../lib/auth.js';
import { db } from '../../lib/firebase.js';
import { countPendingStudents } from '../repository/students/studentsService.js';
import { DidatticaView } from './DidatticaView.js';
import { ProgramsView } from './ProgramsView.js';
import { LessonsView } from './LessonsView.js';
import { TemplateKitView } from './TemplateKitView.js';
import { VerificationsView } from './VerificationsView.js';
import { ClassesView } from './ClassesView.js';
import { StudentsView } from './StudentsView.js';
import { DomandeView } from './DomandeView.js';
import logoScritta from '../../assets/logo-scritta-schoolforge.png';
import styles from './TeacherShell.module.css';

type Section =
  | 'didattica'
  | 'lezioni'
  | 'corsi'
  | 'verifiche'
  | 'classi'
  | 'studenti'
  | 'template'
  | 'domande';

// "Didattica" (DUX-01) è la nuova sezione che assorbirà progressivamente
// Corsi/Lezioni/Domande; durante la migrazione convivono tutte, invariate.
const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: 'didattica', label: 'Didattica', icon: '📚' },
  { id: 'lezioni', label: 'Lezioni', icon: '📖' },
  { id: 'corsi', label: 'Corsi', icon: '📚' },
  { id: 'domande', label: 'Domande', icon: '❓' },
  { id: 'verifiche', label: 'Verifiche', icon: '📝' },
  { id: 'classi', label: 'Classi', icon: '🏫' },
  { id: 'studenti', label: 'Studenti', icon: '🎓' },
  { id: 'template', label: 'Template', icon: '📄' },
];

export function TeacherShell() {
  const { user, signOut } = useAuth();
  const ownerUid = user?.uid ?? '';
  const [activeSection, setActiveSection] = useState<Section>('didattica');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pendingStudentsCount, setPendingStudentsCount] = useState(0);
  // DUX-01 → DUX-02 bridge: quando la libreria Didattica apre un corso,
  // inoltriamo alla sezione "Corsi" con quel programma già espanso. Viene
  // azzerato appena il docente naviga manualmente, per evitare che una
  // successiva apertura di "Corsi" ri-espanda un programma non richiesto.
  const [coursesInitialProgramId, setCoursesInitialProgramId] = useState<string | null>(null);

  function selectSection(id: Section) {
    setCoursesInitialProgramId(null);
    setActiveSection(id);
  }

  function openCourseFromDidattica(programId: string) {
    setCoursesInitialProgramId(programId);
    setActiveSection('corsi');
  }

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
            onClick={() => selectSection(id)}
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
        {activeSection === 'didattica' ? (
          <DidatticaView ownerUid={ownerUid} onOpenCourse={openCourseFromDidattica} />
        ) : activeSection === 'template' ? (
          <TemplateKitView />
        ) : activeSection === 'corsi' ? (
          <ProgramsView initialExpandedProgramId={coursesInitialProgramId} />
        ) : activeSection === 'lezioni' ? (
          <LessonsView />
        ) : activeSection === 'verifiche' ? (
          <VerificationsView />
        ) : activeSection === 'classi' ? (
          <ClassesView />
        ) : activeSection === 'domande' ? (
          <DomandeView />
        ) : activeSection === 'studenti' ? (
          <StudentsView ownerUid={ownerUid} onStudentsChanged={refreshPendingStudentsCount} />
        ) : null}
      </main>
    </div>
  );
}
