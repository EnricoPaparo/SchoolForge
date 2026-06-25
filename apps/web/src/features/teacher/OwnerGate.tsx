import { type ReactNode, useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase.js';
import { useAuth } from '../../lib/auth.js';
import { OwnerSetup } from './OwnerSetup.js';
import styles from './OwnerSetup.module.css';

type GateState = 'loading' | 'owner' | 'setup';

export function OwnerGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [state, setState] = useState<GateState>('loading');

  useEffect(() => {
    if (!user) return;

    void getDoc(doc(db, 'settings', 'owner'))
      .then((snap) => {
        if (snap.exists() && snap.data()?.ownerUid === user.uid) {
          setState('owner');
        } else {
          // Successful read but uid mismatch — treat as setup so OwnerSetup handles the block.
          setState('setup');
        }
      })
      .catch(() => {
        // Permission denied: doc may not exist (first run) or uid doesn't match.
        // OwnerSetup resolves which case it is by attempting the write.
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
    return <OwnerSetup onComplete={() => setState('owner')} />;
  }

  return <>{children}</>;
}
