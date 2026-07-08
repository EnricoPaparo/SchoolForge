import { type ReactNode, useEffect, useRef, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase.js';
import { useAuth } from '../../lib/auth.js';
import { getStudentAccessSettings } from '../repository/students/studentAccessService.js';
import { getOwnStudentDoc, requestStudentAccess } from '../repository/students/studentsService.js';
import { OwnerSetup } from './OwnerSetup.js';
import { StudentShell } from '../student/StudentShell.js';
import styles from './OwnerSetup.module.css';

type GateState =
  | 'loading'
  | 'setup'
  | 'teacher'
  | 'student'
  | 'portalDisabled'
  | 'pending'
  | 'blocked'
  | 'requestsClosed'
  | 'error';

/**
 * Resolves docente vs. studente after AuthGuard confirms a Firebase user is
 * signed in, then — for a non-owner — resolves the M3-lite approval model
 * (settings/studentAccess + students/{uid}) before ever mounting StudentShell.
 * Being Google-authenticated only makes someone a *candidate* student: it
 * never implies approval, and TeacherShell is never reachable by a non-owner
 * regardless of any of this.
 *
 * State priority for a non-owner (matches the Security Rules gate exactly,
 * see firestore.rules isApprovedStudent()):
 *   1. settings/studentAccess.studentPortalEnabled === false -> 'portalDisabled'
 *      (checked before even looking at students/{uid} — when the portal is
 *      off, nobody's individual status is shown).
 *   2. students/{uid} exists:
 *        approved -> 'student' (StudentShell)
 *        pending  -> 'pending'
 *        blocked  -> 'blocked'
 *   3. students/{uid} missing:
 *        newStudentRequestsEnabled === true  -> create it (status 'pending'),
 *                                                then 'pending'
 *        newStudentRequestsEnabled === false -> 'requestsClosed' (no write)
 */
export function RoleGate({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const [state, setState] = useState<GateState>('loading');
  const requestAttempted = useRef(false);

  useEffect(() => {
    if (!user) return;
    let active = true;

    void (async () => {
      let ownerUid: string | null;
      try {
        const ownerPublicSnap = await getDoc(doc(db, 'settings', 'ownerPublic'));
        ownerUid = ownerPublicSnap.exists() ? (ownerPublicSnap.data()?.ownerUid ?? null) : null;
      } catch {
        // Permission denied or transient error: fall back to setup so
        // OwnerSetup can resolve which case it actually is by attempting
        // the write (blocked server-side if an owner already exists and
        // this user isn't it).
        if (active) setState('setup');
        return;
      }

      if (ownerUid === null) {
        if (active) setState('setup');
        return;
      }

      if (ownerUid === user.uid) {
        if (active) setState('teacher');
        return;
      }

      // Non-owner: resolve the approval model. Any failure here falls back
      // to a readable error screen rather than an infinite loading spinner
      // or a crash — it never falls through to TeacherShell.
      try {
        const access = await getStudentAccessSettings(db);
        if (!active) return;

        if (!access.studentPortalEnabled) {
          setState('portalDisabled');
          return;
        }

        const studentDoc = await getOwnStudentDoc(user.uid, db);
        if (!active) return;

        if (studentDoc) {
          if (studentDoc.status === 'approved') setState('student');
          else if (studentDoc.status === 'blocked') setState('blocked');
          else setState('pending');
          return;
        }

        if (!access.newStudentRequestsEnabled) {
          setState('requestsClosed');
          return;
        }

        if (requestAttempted.current) return;
        requestAttempted.current = true;

        await requestStudentAccess(
          { uid: user.uid, ownerUid, email: user.email ?? '', displayName: user.displayName },
          db,
        );
        if (active) setState('pending');
      } catch {
        if (active) setState('error');
      }
    })();

    return () => {
      active = false;
    };
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

  if (state === 'teacher') {
    return <>{children}</>;
  }

  const screen = STATUS_SCREENS[state];
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <main>
          <h1 className={styles.title}>{screen.title}</h1>
          <p className={styles.description}>{screen.description}</p>
          <div className={styles.actions}>
            <button type="button" className={styles.secondaryBtn} onClick={() => void signOut()}>
              Esci
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}

const STATUS_SCREENS: Record<
  Exclude<GateState, 'loading' | 'setup' | 'teacher' | 'student'>,
  { title: string; description: string }
> = {
  portalDisabled: {
    title: 'Portale studenti temporaneamente disabilitato',
    description: 'Il docente ha disattivato il portale studenti. Riprova più tardi.',
  },
  pending: {
    title: 'Richiesta inviata',
    description: 'Attendi l’approvazione del docente per accedere ai contenuti.',
  },
  blocked: {
    title: 'Accesso studente bloccato',
    description: 'Il docente ha bloccato l’accesso di questo account al portale studenti.',
  },
  requestsClosed: {
    title: 'Nuove richieste studenti chiuse',
    description: 'Il docente non sta accettando nuove richieste di accesso in questo momento.',
  },
  error: {
    title: 'Impossibile verificare l’accesso',
    description: 'Si è verificato un problema imprevisto. Riprova più tardi o contatta il docente.',
  },
};
