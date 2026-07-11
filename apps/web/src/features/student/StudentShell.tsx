import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../lib/auth.js';
import { db } from '../../lib/firebase.js';
import logoScritta from '../../assets/logo-scritta-schoolforge.png';
import { StudentLessonsView } from './StudentLessonsView.js';
import { StudentVerificationsView } from './StudentVerificationsView.js';
import { resolveActiveSession } from './examSessionService.js';
import styles from './StudentShell.module.css';

type Section = 'lezioni' | 'verifiche';

const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: 'lezioni', label: 'Lezioni', icon: '📖' },
  { id: 'verifiche', label: 'Verifiche', icon: '📝' },
];

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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  const displayName = user?.displayName ?? user?.email ?? 'Studente';
  const initials = displayName.charAt(0).toUpperCase();

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

      {!sessionChecked ? (
        <main className={styles.main}>
          <p aria-busy="true" className="state-loading">
            Caricamento…
          </p>
        </main>
      ) : (
        <>
          {!examInProgress && (
            <nav aria-label="Sezioni studente" className={styles.nav}>
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
          )}

          <main className={styles.main}>
            {activeSection === 'lezioni' ? (
              <StudentLessonsView />
            ) : (
              <StudentVerificationsView onSessionActiveChange={setExamInProgress} />
            )}
          </main>
        </>
      )}
    </div>
  );
}
