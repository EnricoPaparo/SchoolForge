import { useState } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase.js';
import { useAuth } from '../../lib/auth.js';

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
      <main>
        <h1>Accesso non autorizzato</h1>
        <p>
          Un altro account è già configurato come proprietario di SchoolForge. Questo account (
          {user?.email}) non può accedere.
        </p>
        <button type="button" onClick={() => void signOut()}>
          Esci
        </button>
      </main>
    );
  }

  return (
    <main>
      <h1>Inizializza SchoolForge</h1>
      <p>
        Nessun proprietario configurato. L&apos;account corrente ({user?.email}) diventerà
        l&apos;unico docente di questo portale.
      </p>
      <button type="button" onClick={() => void claim()} disabled={status === 'loading'}>
        {status === 'loading' ? 'Configurazione…' : 'Diventa proprietario'}
      </button>
      <button type="button" onClick={() => void signOut()} disabled={status === 'loading'}>
        Annulla ed esci
      </button>
    </main>
  );
}
