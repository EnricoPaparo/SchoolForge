/**
 * Identità degli heading di una lezione: **una sola implementazione**.
 *
 * Fino a VE-04A questa logica era duplicata fra `apps/web` (che produce gli
 * `id` nel DOM) e `functions` (che memorizza l'ancora nel manifest), tenute
 * insieme da una tabella verificata dai due lati. Non è bastato: le due metà
 * erano già divergenti su apostrofi, duplicati e livelli di heading, e la
 * tabella era stata scritta guardando una sola delle due.
 *
 * Una tabella condivisa dimostra che due implementazioni **coincidono oggi**;
 * un modulo condiviso rende impossibile che divergano domani. Questo è il
 * modulo condiviso, e vive nel package che entrambi i lati possono importare.
 *
 * Puro: nessuna dipendenza, nessun parser Markdown, nessuno stato globale.
 */
/**
 * Testo canonico di un heading: ciò che resta togliendo la **sintassi** e
 * lasciando il contenuto.
 *
 * Non è un parser Markdown e non prova a esserlo: gli heading sono una riga di
 * testo, e ciò che serve è che `## **Reti**`, `## *Reti*`, `` ## `Reti` `` e
 * `## [Reti](https://esempio.it)` producano tutti lo stesso identificatore —
 * perché nella pagina mostrano tutti la stessa parola.
 *
 * L'ordine delle sostituzioni conta: i link vanno risolti **prima** di
 * rimuovere le parentesi quadre, altrimenti l'URL resterebbe nel testo.
 */
export declare function canonicalLessonHeadingText(rawText: string): string;
/**
 * Slug **deterministico** di un testo canonico: stesso testo ⇒ stesso slug,
 * indipendentemente dall'ordine di rendering e dalla sessione.
 *
 * Gli apostrofi sono **eliminati**, non trasformati in separatori: `L'acqua`
 * diventa `lacqua`, non `l-acqua`. È la regola che il renderer applica da
 * LESSON-MANUAL-01, ed è quella che vale — in italiano un apostrofo unisce due
 * parole, non le separa.
 */
export declare function lessonHeadingSlug(canonicalText: string): string;
/**
 * Assegna lo slug tenendo conto dei duplicati: il primo non porta suffisso, i
 * successivi ricevono `-2`, `-3`, … nell'ordine del documento.
 *
 * Il contatore è **sullo slug**, non sul testo: due titoli diversi che
 * producono lo stesso slug — `Reti locali` e `Reti, locali` — collidono
 * davvero nel DOM, e devono essere numerati come se fossero duplicati. Contare
 * per testo lascerebbe due elementi con lo stesso `id`.
 */
export declare function nextLessonHeadingSlug(base: string, occurrences: Map<string, number>): string;
/** Un heading ancorabile, con la sua posizione e il suo id definitivo. */
export interface LessonHeadingRef {
    /** Indice **zero-based** nell'elenco degli heading ancorabili (H2/H3). */
    index: number;
    /** Testo canonico: quello che l'utente legge, senza sintassi. */
    text: string;
    /** Id assegnato, suffisso dei duplicati compreso. */
    slug: string;
    level: 2 | 3;
}
/**
 * Assegna gli id a una sequenza di heading già estratti, nell'ordine del
 * documento.
 *
 * È l'unico posto in cui la numerazione dei duplicati viene decisa, e il
 * motivo per cui il web e il server non possono più divergere: entrambi
 * chiamano questa funzione con la propria estrazione, ma la **regola** è una
 * sola.
 */
export declare function assignLessonHeadingSlugs(headings: ReadonlyArray<{
    text: string;
    level: 2 | 3;
}>): LessonHeadingRef[];
//# sourceMappingURL=headingSlug.d.ts.map