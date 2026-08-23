import { useEffect, useRef, useState } from 'react';
import type { LessonVisualBytes } from './visualReadClients.js';

/**
 * VISUAL-ENRICHMENT-04A — lettura dei byte con cancellazione e memoria.
 *
 * Due problemi, entrambi banali da sbagliare:
 *
 * 1. **setState tardivo.** Il docente cambia lezione mentre la lettura è in
 *    volo; la risposta arriva dopo, e senza guardia scriverebbe l'immagine
 *    della lezione precedente sopra quella corrente — o su un componente
 *    smontato. Ogni lettura porta con sé il proprio numero di sequenza, e solo
 *    l'ultima ha il diritto di scrivere.
 * 2. **riletture inutili.** Tornare su una lezione già vista non deve
 *    ricomprare gli stessi byte: la memoria è per `assetId`, che è l'identità
 *    dell'immagine — se il docente la sostituisce l'`assetId` cambia e la
 *    memoria non risponde per quella vecchia.
 *
 * La memoria vive quanto la vista: non è una cache persistente e non prova a
 * esserlo. Chiudere il corso e riaprirlo rilegge, ed è giusto così — è l'unico
 * momento in cui i byte potrebbero essere cambiati davvero.
 */

export type LessonVisualState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; bytes: LessonVisualBytes }
  | { status: 'unavailable' };

export interface LessonVisualRequest {
  /** Identità dell'immagine: chiave della memoria e del confronto. */
  assetId: string;
  /** Chiave della lezione: cambiandola, ogni lettura in volo diventa obsoleta. */
  lessonKey: string;
}

/**
 * `request` a `null` significa «questa lezione non ha immagine»: non parte
 * alcuna lettura, e questo è il caso della quasi totalità delle lezioni.
 */
export function useLessonVisual(
  request: LessonVisualRequest | null,
  load: (request: LessonVisualRequest) => Promise<LessonVisualBytes | null>,
): LessonVisualState {
  const [state, setState] = useState<LessonVisualState>({ status: 'idle' });
  const cache = useRef(new Map<string, LessonVisualBytes>());
  const sequence = useRef(0);

  const assetId = request?.assetId ?? null;
  const lessonKey = request?.lessonKey ?? null;

  useEffect(() => {
    if (assetId === null || lessonKey === null) {
      setState({ status: 'idle' });
      return;
    }

    const cached = cache.current.get(assetId);
    if (cached) {
      setState({ status: 'ready', bytes: cached });
      return;
    }

    // Il numero di sequenza è l'unica cosa che decide chi può scrivere: una
    // risposta che arriva dopo un cambio lezione trova un numero più alto e si
    // limita a essere scartata.
    sequence.current += 1;
    const ticket = sequence.current;
    let active = true;
    setState({ status: 'loading' });

    load({ assetId, lessonKey })
      .then((bytes) => {
        if (!active || ticket !== sequence.current) return;
        if (bytes === null) {
          setState({ status: 'unavailable' });
          return;
        }
        cache.current.set(assetId, bytes);
        setState({ status: 'ready', bytes });
      })
      .catch(() => {
        if (!active || ticket !== sequence.current) return;
        // Nessun retry: la lezione si legge senza figura, com'era prima.
        setState({ status: 'unavailable' });
      });

    return () => {
      // Smontaggio o cambio dipendenze: la risposta in volo perde il diritto di
      // scrivere anche se il numero di sequenza non è ancora avanzato.
      active = false;
    };
  }, [assetId, lessonKey, load]);

  return state;
}
