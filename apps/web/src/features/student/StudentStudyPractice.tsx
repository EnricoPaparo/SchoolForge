import { useEffect, useState } from 'react';
import { db } from '../../lib/firebase.js';
import { doc, onSnapshot } from 'firebase/firestore';
import { currentStudyPractice } from '../repository/programs/studyPractice.js';
import type { StudyPractice } from '../repository/programs/studyPractice.js';
import { StudyPracticePlayer } from './StudyPracticePlayer.js';
export function StudentStudyPractice({
  publicLessonId,
  body,
}: {
  publicLessonId: string;
  body: string;
}) {
  const [open, setOpen] = useState(false);
  const [practice, setPractice] = useState<StudyPractice | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  useEffect(() => {
    if (!open) return;
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
  }, [open, publicLessonId, body]);
  return (
    <section>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setPractice(null);
          setStatus('loading');
          setOpen((v) => !v);
        }}
      >
        {open ? 'Chiudi esercitazione' : 'Apri esercitazione'}
      </button>
      {open && (
        <>
          {status === 'loading' && <p aria-busy="true">Caricamento esercitazione…</p>}
          {status === 'error' && (
            <p role="alert">Impossibile caricare l’esercitazione. Chiudi e riprova.</p>
          )}
          {status === 'ready' &&
            (practice ? (
              <StudyPracticePlayer key={JSON.stringify(practice)} practice={practice} />
            ) : (
              <p>Nessuna esercitazione pubblicata per questa versione della lezione.</p>
            ))}
        </>
      )}
    </section>
  );
}
