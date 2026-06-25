import { useState } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase.js';
import { useAuth } from '../../lib/auth.js';
import styles from './OwnerSetup.module.css';

interface Props {
  onComplete: () => void;
}

export function OwnerSetup({ onComplete }: Props) {
  const { user, signOut } = useAuth();
  const [status, setStatus] = useState<'idle' | 'loading' | 'blocked'>('idle');

  const claim = async () => {
    if (!user) return;
    setStatus('loading');
    try {
      await setDoc(doc(db, 'settings', 'owner'), {
        ownerUid: user.uid,
        createdAt: serverTimestamp(),
      });
      onComplete();
    } catch {
      setStatus('blocked');
    }
  };

  if (status === 'blocked') {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <main>
            <h1 className={styles.title}>Accesso non autorizzato</h1>
            <p className={styles.description}>
              Un altro account è già configurato come proprietario di SchoolForge. Questo account (
              {user?.email}) non può accedere.
            </p>
            <div className={styles.actions}>
              <button type="button" className={styles.primaryBtn} onClick={() => void signOut()}>
                Esci
              </button>
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <main>
          <h1 className={styles.title}>Inizializza SchoolForge</h1>
          <p className={styles.description}>
            Nessun proprietario configurato. L&apos;account corrente ({user?.email}) diventerà
            l&apos;unico docente di questo portale.
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => void claim()}
              disabled={status === 'loading'}
            >
              {status === 'loading' ? 'Configurazione…' : 'Diventa proprietario'}
            </button>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={() => void signOut()}
              disabled={status === 'loading'}
            >
              Annulla ed esci
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
