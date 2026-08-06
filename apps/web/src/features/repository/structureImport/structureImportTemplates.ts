/**
 * STRUCTURE-IMPORT-01 — modelli YAML canonici.
 *
 * Sono l'**unica fonte autorevole** degli esempi: la sezione Template li usa
 * per la visualizzazione e per il pulsante Copia, mentre un test di round-trip
 * li parsa con i validatori reali. Nessuno dei due percorsi ha una propria copia
 * del testo, quindi ciò che il docente vede e copia è sempre lo stesso byte per
 * byte, e un modello non può allontanarsi dallo schema che dovrebbe insegnare.
 *
 * STRUCTURE-TEMPLATE-GENERIC-01 — i modelli sono **segnaposto generici**, non
 * esempi disciplinari. Da quando lo YAML si incolla in una textarea, un esempio
 * concreto smette di essere un aiuto: il docente dovrebbe cancellarlo riga per
 * riga prima di scrivere il proprio, e i commenti `#` sono la parte che più
 * facilmente sopravvive per sbaglio all'incollaggio. Qui non c'è nulla da
 * ripulire: si sostituiscono i valori e si importa.
 *
 * `schema` resta, ed è l'unica riga da non toccare: è la proprietà che i
 * validatori esigono per riconoscere il formato.
 *
 * Non contengono id, path, order, corpo Markdown, pool o dati studente — le
 * cose che il formato vieta — e terminano con una sola newline finale.
 *
 * Modulo puro: solo stringhe.
 */

export const UDA_TEMPLATE_FILENAME = 'schoolforge-udas.yaml';
export const LESSON_TEMPLATE_FILENAME = 'schoolforge-lezioni.yaml';

export const UDA_METADATA_TEMPLATE = `schema: schoolforge-uda-metadata/v1

udas:
  - titolo: Titolo della prima UDA
    descrizione: Breve descrizione della prima UDA
    competenze:
      - Prima competenza sviluppata dalla UDA
      - Seconda competenza sviluppata dalla UDA
    obiettivi:
      - Primo obiettivo didattico della UDA
      - Secondo obiettivo didattico della UDA

  - titolo: Titolo della seconda UDA
    descrizione: Breve descrizione della seconda UDA
    competenze:
      - Prima competenza sviluppata dalla UDA
      - Seconda competenza sviluppata dalla UDA
    obiettivi:
      - Primo obiettivo didattico della UDA
      - Secondo obiettivo didattico della UDA
`;

export const LESSON_METADATA_TEMPLATE = `schema: schoolforge-lesson-metadata/v1

lessons:
  - titolo: Titolo della prima lezione
    sottotitolo: Breve sottotitolo della prima lezione
    difficolta: Livello di difficoltà della prima lezione
    concettiChiave:
      - Primo concetto chiave della lezione
      - Secondo concetto chiave della lezione
    obiettivi:
      - Primo obiettivo didattico della lezione
      - Secondo obiettivo didattico della lezione

  - titolo: Titolo della seconda lezione
    sottotitolo: Breve sottotitolo della seconda lezione
    difficolta: Livello di difficoltà della seconda lezione
    concettiChiave:
      - Primo concetto chiave della lezione
      - Secondo concetto chiave della lezione
    obiettivi:
      - Primo obiettivo didattico della lezione
      - Secondo obiettivo didattico della lezione
`;

/** I due modelli, nella forma che la sezione Template consuma. */
export const STRUCTURE_IMPORT_TEMPLATES = [
  { filename: UDA_TEMPLATE_FILENAME, content: UDA_METADATA_TEMPLATE },
  { filename: LESSON_TEMPLATE_FILENAME, content: LESSON_METADATA_TEMPLATE },
] as const;
