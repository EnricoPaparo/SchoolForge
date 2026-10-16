import { useEffect, useState } from 'react';
import { db } from '../../lib/firebase.js';
import { doc, onSnapshot } from 'firebase/firestore';
import { currentStudyPractice } from '../repository/programs/studyPractice.js';
import type { StudyPractice } from '../repository/programs/studyPractice.js';
import styles from './StudyPracticePlayer.module.css';
import { StudyPracticePlayer } from './StudyPracticePlayer.js';
export function StudentStudyPractice({
  publicLessonId,
  body,
}: {
  publicLessonId: string;
  body: string;
}) {
  const [retryNonce, setRetryNonce] = useState(0);
  const [practice, setPractice] = useState<StudyPractice | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    let parentAllowed = false;
    let raw: unknown = null;
    let cancelled = false;
    setPractice(null);
    setStatus('loading');
    function update() {
      if (!cancelled) {
        setPractice(parentAllowed ? currentStudyPractice(raw, body) : null);
        setStatus('ready');
      }
    }
    function unavailable() {
      parentAllowed = false;
      raw = null;
      update();
    }
    const parentUnsubscribe = onSnapshot(
      doc(db, 'publicLessons', publicLessonId),
      (snap) => {
        parentAllowed =
          snap.exists() && snap.data().completed === true && snap.data().content === body;
        update();
      },
      unavailable,
    );
    const practiceUnsubscribe = onSnapshot(
      doc(db, 'publicLessonPractice', publicLessonId),
      (snap) => {
        raw = snap.exists() ? snap.data().practice : null;
        update();
      },
      (error) => {
        raw = null;
        update();
        if (!String(error.code).includes('permission-denied')) setStatus('error');
      },
    );
    return () => {
      cancelled = true;
      parentUnsubscribe();
      practiceUnsubscribe();
    };
  }, [retryNonce, publicLessonId, body]);
  return (
    <section className={styles.container} aria-label="Esercitazioni della lezione">
      {status === 'loading' && <p aria-busy="true">Caricamento esercitazione…</p>}
      {status === 'error' && (
        <div className={styles.empty}>
          <p role="alert">Impossibile caricare l’esercitazione.</p>
          <button type="button" onClick={() => setRetryNonce((n) => n + 1)}>
            Riprova
          </button>
        </div>
      )}
      {status === 'ready' &&
        (practice ? (
          <StudyPracticePlayer key={JSON.stringify(practice)} practice={practice} />
        ) : (
          <div className={styles.empty}>
            <h4>Il percorso non è ancora disponibile</h4>
            <p>Nessuna esercitazione pubblicata per questa versione della lezione.</p>
            <p>Puoi continuare a studiare dal contenuto e dalla mappa della lezione.</p>
          </div>
        ))}
    </section>
  );
}
