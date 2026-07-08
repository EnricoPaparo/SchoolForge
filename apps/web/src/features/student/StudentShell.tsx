import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../lib/auth.js';
import logoScritta from '../../assets/logo-scritta-schoolforge.png';
import { StudentLessonsView } from './StudentLessonsView.js';
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
 */
export function StudentShell() {
  const { user, signOut } = useAuth();
  const [activeSection, setActiveSection] = useState<Section>('lezioni');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

      <main className={styles.main}>
        {activeSection === 'lezioni' ? (
          <StudentLessonsView />
        ) : (
          <p className={styles.placeholder}>Verifiche pubblicate — in arrivo</p>
        )}
      </main>
    </div>
  );
}
