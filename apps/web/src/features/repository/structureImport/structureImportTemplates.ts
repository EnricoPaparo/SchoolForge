/**
 * STRUCTURE-IMPORT-01 — canonical, downloadable YAML templates.
 *
 * These are the files the future dialog will offer under «Scarica modello
 * YAML». They are deterministic constants, not generated text: byte-identical
 * on every download, so two teachers comparing their files see the same
 * starting point. A round-trip test parses each one with the real validator, so
 * a template can never drift away from the schema it is supposed to teach.
 *
 * They deliberately contain no id, no path, no body and no pool — the very
 * things the format forbids — and end with a single trailing newline.
 *
 * Pure module: strings only. Turning one into a download is UI work and belongs
 * to STRUCTURE-IMPORT-02A/02B.
 */

export const UDA_TEMPLATE_FILENAME = 'schoolforge-udas.yaml';
export const LESSON_TEMPLATE_FILENAME = 'schoolforge-lezioni.yaml';

export const UDA_METADATA_TEMPLATE = `# Modello SchoolForge — UDA senza contenuto.
# Aggiunge nuove UDA in coda a quelle esistenti: non modifica e non sostituisce
# nulla. Il contenuto delle lezioni non si scrive qui.
schema: schoolforge-uda-metadata/v1

udas:
  - titolo: Introduzione alle reti
    descrizione: Fondamenti della comunicazione tra dispositivi.
    competenze:
      - Comprendere il funzionamento generale di una rete
      - Distinguere i principali dispositivi di rete
    obiettivi:
      - Conoscere il concetto di protocollo
      - Comprendere il ruolo degli indirizzi IP

  - titolo: Il livello di trasporto
    descrizione: Affidabilità e comunicazione end-to-end.
    competenze:
      - Analizzare una comunicazione TCP e UDP
    obiettivi:
      - Comprendere affidabilità e ritrasmissione
      - Confrontare TCP e UDP
`;

export const LESSON_METADATA_TEMPLATE = `# Modello SchoolForge — lezioni senza contenuto.
# Aggiunge nuove lezioni in coda a quelle della UDA aperta. Ogni lezione nasce
# con il corpo vuoto: il testo si scrive poi nell'editor o si genera con l'IA.
schema: schoolforge-lesson-metadata/v1

lessons:
  - titolo: Che cos'è una rete
    sottotitolo: Dispositivi, collegamenti e comunicazione
    difficolta: introduttiva
    concettiChiave:
      - nodo
      - collegamento
      - protocollo
    obiettivi:
      - Definire correttamente una rete informatica
      - Distinguere nodi e collegamenti

  - titolo: Indirizzi IP e instradamento
    sottotitolo: Come i pacchetti raggiungono la destinazione
    difficolta: intermedia
    concettiChiave:
      - indirizzo IP
      - pacchetto
      - router
      - instradamento
    obiettivi:
      - Comprendere la funzione dell'indirizzo IP
      - Ricostruire il percorso logico di un pacchetto
`;

/** The two templates, in the shape a future download helper will consume. */
export const STRUCTURE_IMPORT_TEMPLATES = [
  { filename: UDA_TEMPLATE_FILENAME, content: UDA_METADATA_TEMPLATE },
  { filename: LESSON_TEMPLATE_FILENAME, content: LESSON_METADATA_TEMPLATE },
] as const;
