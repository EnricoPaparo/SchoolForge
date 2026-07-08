import { type ReactNode, useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase.js';
import { useAuth } from '../../lib/auth.js';
import { OwnerSetup } from './OwnerSetup.js';
import { StudentShell } from '../student/StudentShell.js';
import styles from './OwnerSetup.module.css';

type GateState = 'loading' | 'teacher' | 'student' | 'setup';

/**
 * Resolves docente vs. studente after AuthGuard confirms a Firebase user is
 * signed in. Role is decided purely by comparing `user.uid` against the
 * configured `ownerUid` (via the public `settings/ownerPublic` projection),
 * never by "does a Firestore doc for this user exist" heuristics:
 *
 * - no owner configured yet  -> OwnerSetup (bootstrap the docente)
 * - uid matches ownerUid     -> TeacherShell (children)
 * - any other authenticated user -> StudentShell, read-only (M3-lite)
 *
 * There is no anonymous path: AuthGuard already guarantees `user` is set
 * before this component mounts.
 */
export function RoleGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [state, setState] = useState<GateState>('loading');

  useEffect(() => {
    if (!user) return;

    void getDoc(doc(db, 'settings', 'ownerPublic'))
      .then((snap) => {
        if (!snap.exists()) {
          // No owner configured yet — first authenticated user sets it up.
          setState('setup');
          return;
        }
        setState(snap.data()?.ownerUid === user.uid ? 'teacher' : 'student');
      })
      .catch(() => {
        // Permission denied or transient error: fall back to setup so
        // OwnerSetup can resolve which case it actually is by attempting
        // the write (blocked server-side if an owner already exists and
        // this user isn't it).
        setState('setup');
      });
  }, [user]);

  if (state === 'loading') {
    return (
      <div className={styles.loadingScreen}>
        <main>
          <p className={styles.loadingText} aria-busy="true">
            Caricamento…
          </p>
        </main>
      </div>
    );
  }

  if (state === 'setup') {
    return <OwnerSetup onComplete={() => setState('teacher')} />;
  }

  if (state === 'student') {
    return <StudentShell />;
  }

  return <>{children}</>;
}
