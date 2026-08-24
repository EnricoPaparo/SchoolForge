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
export function canonicalLessonHeadingText(rawText) {
    return (rawText
        // 1. HTML inline: diventa spazio, non sparisce, così `a<br>b` non è `ab`.
        .replace(/<[^>]*>/g, ' ')
        // 2. Link inline `[testo](url)` e referenziati `[testo][rif]`: resta il
        //    testo. Prima delle parentesi quadre, o l'URL sopravvivrebbe.
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
        // 3. Immagini inline: `![alt](src)` ha già perso `[alt](src)` sopra e
        //    resta il `!`, che la punteggiatura eliminerà dallo slug.
        // 4. Marcatori di enfasi, codice, heading e parentesi residue.
        .replace(/[#*_`[\]]/g, '')
        // 5. Spazi collassati: `Reti   locali` e `Reti locali` sono lo stesso
        //    titolo, e devono produrre lo stesso id.
        .replace(/\s+/g, ' ')
        .trim());
}
/**
 * Slug **deterministico** di un testo canonico: stesso testo ⇒ stesso slug,
 * indipendentemente dall'ordine di rendering e dalla sessione.
 *
 * Gli apostrofi sono **eliminati**, non trasformati in separatori: `L'acqua`
 * diventa `lacqua`, non `l-acqua`. È la regola che il renderer applica da
 * LESSON-MANUAL-01, ed è quella che vale — in italiano un apostrofo unisce due
 * parole, non le separa.
 */
export function lessonHeadingSlug(canonicalText) {
    const slug = canonicalText
        .normalize('NFKD')
        // Diacritici combinanti lasciati dalla decomposizione NFKD.
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase('it')
        // Apostrofo dritto e tipografico: entrambi spariscono.
        .replace(/['\u2019]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    // Fallback deterministico per un heading senza testo utile (solo simboli,
    // solo un'immagine, …): mai un identificatore vuoto o casuale.
    return slug || 'sezione';
}
/**
 * Assegna lo slug tenendo conto dei duplicati: il primo non porta suffisso, i
 * successivi ricevono `-2`, `-3`, … nell'ordine del documento.
 *
 * Il contatore è **sullo slug**, non sul testo: due titoli diversi che
 * producono lo stesso slug — `Reti locali` e `Reti, locali` — collidono
 * davvero nel DOM, e devono essere numerati come se fossero duplicati. Contare
 * per testo lascerebbe due elementi con lo stesso `id`.
 */
export function nextLessonHeadingSlug(base, occurrences) {
    const count = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
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
export function assignLessonHeadingSlugs(headings) {
    const occurrences = new Map();
    return headings.map((heading, index) => ({
        index,
        text: heading.text,
        slug: nextLessonHeadingSlug(lessonHeadingSlug(heading.text), occurrences),
        level: heading.level,
    }));
}
