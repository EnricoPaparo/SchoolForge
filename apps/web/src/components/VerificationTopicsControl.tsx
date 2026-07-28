import { useState } from 'react';
import { VerificationTopicsDialog } from './VerificationTopicsDialog.js';
import type { VerificationTopicUda } from '../types/firestore.js';
import styles from './VerificationTopicsControl.module.css';

export const TOPICS_UNAVAILABLE_LABEL = 'Argomenti non disponibili per questa verifica';

export type VerificationTopicsControlProps = {
  verificationTitle: string;
  /**
   * Perimetro già in memoria. `null` su una verifica legacy (o su un valore
   * malformato): il controllo resta **visibile ma disabilitato**, con una
   * spiegazione esplicita. Nascondere il riquadro cambierebbe l'anatomia della
   * card da una verifica all'altra; disabilitarlo dice invece la verità — il
   * dato non esiste, e non verrà cercato con una lettura.
   */
  topicOutline: VerificationTopicUda[] | null | undefined;
};

/**
 * UI-VERIFICHE-06B — controllo «Argomenti» condiviso da card docente e card
 * studente: stesso pulsante, stessa popup, stesso dato. Aprire la popup non
 * esegue **nessuna** lettura: mostra l'array già presente in memoria.
 *
 * Vive dentro una metrica `interactive` della record card, quindi il click
 * arriva al pulsante e non alla superficie di apertura della card.
 */
export function VerificationTopicsControl({
  verificationTitle,
  topicOutline,
}: VerificationTopicsControlProps) {
  const [open, setOpen] = useState(false);
  const available = Array.isArray(topicOutline) && topicOutline.length > 0;
  const count = available ? topicOutline.length : 0;

  return (
    <>
      <button
        type="button"
        className={styles.topicsBtn}
        disabled={!available}
        aria-label={
          available
            ? `Argomenti della verifica — ${verificationTitle}`
            : `${TOPICS_UNAVAILABLE_LABEL} — ${verificationTitle}`
        }
        title={available ? undefined : TOPICS_UNAVAILABLE_LABEL}
        onClick={() => setOpen(true)}
      >
        {/* «UDA» è invariabile al plurale: 1 UDA, 3 UDA. */}
        {available ? `${count} UDA →` : 'Non disponibili'}
      </button>
      {open && available && (
        <VerificationTopicsDialog
          verificationTitle={verificationTitle}
          topicOutline={topicOutline}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
