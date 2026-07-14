import { useEffect, useRef, useState } from 'react';
import { IconBookOpen, IconChevronDown, IconClipboardCheck } from '../../components/icons.js';
import { useAuth } from '../../lib/auth.js';
import { db } from '../../lib/firebase.js';
import logoScritta from '../../assets/logo-scritta-schoolforge.png';
import { StudentDidatticaView } from './StudentDidatticaView.js';
import { StudentVerificationsView } from './StudentVerificationsView.js';
import { resolveActiveSession } from './examSessionService.js';
import { getOwnStudentDoc } from '../repository/students/studentsService.js';
import { watchStudentAccessSettings } from '../repository/students/studentAccessService.js';
import { isExamModeActiveForClass } from '../repository/students/examMode.js';
import styles from './StudentShell.module.css';

type Section = 'lezioni' | 'verifiche';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'lezioni', label: 'Didattica' },
  { id: 'verifiche', label: 'Verifiche' },
];

function SectionIcon({ section }: { section: Section }) {
  return section === 'lezioni' ? <IconBookOpen size={17} /> : <IconClipboardCheck size={17} />;
}

/**
 * Read-only student portal (M3-lite). Mounted for any authenticated Google
 * user that is not the configured owner — see RoleGate. Must never import
 * teacher features/components: no repository, classes, templates,
 * import/export, correction, or solutions ever reach this shell.
 *
 * M3F-06: a draft online-exam submission is a mandatory session (D-M3F-14).
 * Before the nav/section switcher ever renders, a single deterministic
 * check (`resolveActiveSession`) decides whether the student has a draft in
 * progress; if so, the section switcher is forced to "verifiche" and the
 * nav bar stays hidden for as long as `StudentVerificationsView` reports an
 * exam in progress (see `onSessionActiveChange`) — there is no menu, deep
 * link or UI state that can show Lezioni or leave the exam other than a
 * successful delivery.
 */
export function StudentShell() {
  const { user, signOut } = useAuth();
  const [activeSection, setActiveSection] = useState<Section>('lezioni');
  const [sessionChecked, setSessionChecked] = useState(false);
  const [examInProgress, setExamInProgress] = useState(false);
  const [myClassId, setMyClassId] = useState<string | null>(null);
  const [examModeSettings, setExamModeSettings] = useState<unknown>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mobileNavRef = useRef<HTMLDivElement>(null);

  const uid = user?.uid;
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    resolveActiveSession(uid, db)
      .then((session) => {
        if (cancelled) return;
        if (session) {
          setActiveSection('verifiche');
          setExamInProgress(true);
        }
        setSessionChecked(true);
      })
      .catch(() => {
        if (!cancelled) setSessionChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    getOwnStudentDoc(uid, db)
      .then((studentDoc) => {
        if (!cancelled) setMyClassId(studentDoc?.classId ?? null);
      })
      .catch(() => {
        // Non-fatal — myClassId stays null, which fails Modalità verifica's
        // per-class check safe (never "active" for an unknown class).
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  // Modalità verifica (M3F-07): a single onSnapshot on settings/studentAccess
  // — never a listener per lesson or class — so a teacher toggling it takes
  // effect immediately for an already-open session, without a new login.
  useEffect(() => {
    const unsubscribe = watchStudentAccessSettings(db, (settings) => {
      setExamModeSettings(settings.examMode);
    });
    return unsubscribe;
  }, []);

  const examModeActive = isExamModeActiveForClass(examModeSettings, myClassId);

  // A blocked class must never keep showing Didattica once the teacher
  // activates Modalità verifica — force the section switch immediately,
  // unmounting StudentDidatticaView (and any lesson content in the DOM) on
  // the very next render. A mandatory exam session (examInProgress) always
  // wins regardless — it already forces 'verifiche' on its own.
  useEffect(() => {
    if (examModeActive && activeSection === 'lezioni') setActiveSection('verifiche');
  }, [examModeActive, activeSection]);

  const displayName = user?.displayName ?? user?.email ?? 'Studente';
  const initials = displayName.charAt(0).toUpperCase();

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

  const availableSections = SECTIONS.filter(({ id }) => id !== 'lezioni' || !examModeActive);
  const currentSection =
    availableSections.find(({ id }) => id === activeSection) ?? availableSections[0] ?? SECTIONS[1];

  function selectSection(section: Section) {
    setActiveSection(section);
    setMobileNavOpen(false);
  }

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <img src={logoScritta} alt="SchoolForge" className={styles.logo} />

        {sessionChecked && !examInProgress && (
          <>
            <nav aria-label="Sezioni studente" className={styles.nav}>
              {availableSections.map(({ id, label }) => (
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
                  {availableSections.map(({ id, label }) => (
                    <button
                      key={id}
                      type="button"
                      role="menuitem"
                      aria-current={activeSection === id ? 'page' : undefined}
                      onClick={() => selectSection(id)}
                    >
                      <SectionIcon section={id} />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

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

      {!sessionChecked ? (
        <main className={styles.main}>
          <p aria-busy="true" className="state-loading">
            Caricamento…
          </p>
        </main>
      ) : (
        <main className={styles.main}>
          {activeSection === 'lezioni' && !examModeActive ? (
            <StudentDidatticaView />
          ) : (
            <StudentVerificationsView
              onSessionActiveChange={setExamInProgress}
              examModeActive={examModeActive}
            />
          )}
        </main>
      )}
    </div>
  );
}
