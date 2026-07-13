import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IconBookOpen,
  IconChevronDown,
  IconClipboardCheck,
  IconFileText,
  IconGraduationCap,
} from '../../components/icons.js';
import { useAuth } from '../../lib/auth.js';
import { db } from '../../lib/firebase.js';
import { countPendingStudents } from '../repository/students/studentsService.js';
import { DidatticaView } from './DidatticaView.js';
import { TemplateKitView } from './TemplateKitView.js';
import { VerificationsView } from './VerificationsView.js';
import { StudentsView } from './StudentsView.js';
import logoScritta from '../../assets/logo-scritta-schoolforge.png';
import styles from './TeacherShell.module.css';

type Section = 'didattica' | 'verifiche' | 'studenti' | 'template';

// DUX-04D: "Didattica" ha assorbito Corsi/Lezioni/Domande (parità verificata,
// vedi documentazione/evidenze/dux-04d-matrice-parita.md) — le tre voci legacy
// sono state rimosse. DUX-05A ha inoltre assorbito Classi dentro Studenti.
const SECTIONS: { id: Section; label: string }[] = [
  { id: 'didattica', label: 'Didattica' },
  { id: 'verifiche', label: 'Verifiche' },
  { id: 'studenti', label: 'Studenti' },
  { id: 'template', label: 'Template' },
];

function SectionIcon({ section }: { section: Section }) {
  if (section === 'didattica') return <IconBookOpen size={17} />;
  if (section === 'verifiche') return <IconClipboardCheck size={17} />;
  if (section === 'studenti') return <IconGraduationCap size={17} />;
  return <IconFileText size={17} />;
}

export function TeacherShell() {
  const { user, signOut } = useAuth();
  const ownerUid = user?.uid ?? '';
  const [activeSection, setActiveSection] = useState<Section>('didattica');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mobileNavRef = useRef<HTMLDivElement>(null);
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
    if (!menuOpen && !mobileNavOpen) return;
    function handlePointerDown(e: MouseEvent | TouchEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
      if (mobileNavRef.current && !mobileNavRef.current.contains(e.target as Node)) {
        setMobileNavOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        setMobileNavOpen(false);
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen, mobileNavOpen]);

  const currentSection =
    SECTIONS.find(({ id }) => id === activeSection) ??
    ({ id: 'didattica', label: 'Didattica' } satisfies { id: Section; label: string });

  function selectSection(section: Section) {
    setActiveSection(section);
    setMobileNavOpen(false);
  }

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <img src={logoScritta} alt="SchoolForge" className={styles.logo} />

        <nav aria-label="Sezioni docente" className={styles.nav}>
          {SECTIONS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={styles.navBtn}
              onClick={() => selectSection(id)}
              aria-current={activeSection === id ? 'page' : undefined}
              title={label}
            >
              <span className={styles.navIcon} aria-hidden="true">
                <SectionIcon section={id} />
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

        <div className={styles.mobileNav} ref={mobileNavRef}>
          <button
            type="button"
            className={styles.mobileNavToggle}
            aria-label={`Sezione corrente: ${currentSection.label}. Apri menu sezioni`}
            aria-haspopup="menu"
            aria-expanded={mobileNavOpen}
            onClick={() => {
              setMenuOpen(false);
              setMobileNavOpen((open) => !open);
            }}
          >
            <SectionIcon section={currentSection.id} />
            <span>{currentSection.label}</span>
            <span className={styles.mobileNavCaret} aria-hidden="true">
              <IconChevronDown size={14} />
            </span>
          </button>
          {mobileNavOpen && (
            <div className={styles.mobileNavMenu} role="menu" aria-label="Cambia sezione">
              {SECTIONS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  role="menuitem"
                  aria-current={activeSection === id ? 'page' : undefined}
                  onClick={() => selectSection(id)}
                >
                  <SectionIcon section={id} />
                  <span>{label}</span>
                  {id === 'studenti' && pendingStudentsCount > 0 && (
                    <span
                      className={styles.navBadge}
                      aria-label={`${pendingStudentsCount} in attesa`}
                    >
                      {pendingStudentsCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={styles.userMenu} ref={menuRef}>
          <button
            type="button"
            className={styles.avatarBtn}
            aria-label={`Account: ${displayName}`}
            aria-expanded={menuOpen}
            aria-haspopup="true"
            onClick={() => {
              setMobileNavOpen(false);
              setMenuOpen((o) => !o);
            }}
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

      <main className={styles.main}>
        {activeSection === 'didattica' ? (
          <DidatticaView ownerUid={ownerUid} />
        ) : activeSection === 'template' ? (
          <TemplateKitView />
        ) : activeSection === 'verifiche' ? (
          <VerificationsView />
        ) : activeSection === 'studenti' ? (
          <StudentsView ownerUid={ownerUid} onStudentsChanged={refreshPendingStudentsCount} />
        ) : null}
      </main>
    </div>
  );
}
