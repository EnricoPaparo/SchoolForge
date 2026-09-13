import { AiContentError, validateAiContentRequest } from './aiContentCore.js';
import { buildConceptMapPrompt, buildLessonPrompt, buildPoolPrompt } from './aiContentPrompt.js';
import { composeConceptMapMarkdown } from './aiContentConceptMap.js';

export const RESPONSE_FORMAT_HEADING = '## Formato di risposta per SchoolForge';

// Work only on the trusted instruction prefix. Fenced teacher/context materials
// are kept byte-for-byte, even when they contain words used by format rules.
export function exportCurrentContentPrompt(input: unknown): { prompt: string } {
  const request = validateAiContentRequest(input);
  if (request.kind !== 'lesson' && request.kind !== 'concept_map' && request.kind !== 'pool')
    throw new AiContentError('invalid_input', 'Tipo di prompt non supportato.');
  const built =
    request.kind === 'lesson'
      ? buildLessonPrompt(request)
      : request.kind === 'pool'
        ? buildPoolPrompt(request)
        : buildConceptMapPrompt(request);
  const boundary = built.user.indexOf('<<<');
  if (boundary < 0) throw new Error('Prompt export material boundary changed');
  let instructions = built.user.slice(0, boundary);
  const materials = built.user.slice(boundary);
  const format: string[] = [];
  const move = (pattern: RegExp, replacement = '') => {
    if (!pattern.test(instructions)) throw new Error('Prompt export format boundary changed');
    instructions = instructions.replace(pattern, (text) => {
      format.push(text.trim());
      return replacement;
    });
  };
  let system = built.system
    .replace(
      'sicurezza, schema di output e limiti tecnici del server;',
      'sicurezza e limiti tecnici;',
    )
    .replaceAll('contratto di output', 'contratto didattico')
    .replace('- Rispetta ESATTAMENTE lo schema di output richiesto; nessun campo extra.\n', '')
    .replace(
      '- Non produrre HTML, script o front matter; non richiedere strumenti, rete, file o segreti.',
      '- Non produrre script; non richiedere strumenti, rete, file o segreti.',
    );
  // References to schema in injection protection are not output instructions.
  system = system.trim();
  if (request.kind === 'lesson') {
    instructions = instructions.replace('Scrivi il corpo Markdown', 'Scrivi il corpo');
    move(/Struttura editoriale e compatibilità SchoolForge:[\s\S]*?(?=Prima di rispondere)/);
    move(
      /6\) verifica numero e collocazione[\s\S]*?(?=7\))/,
      '6) verifica numero e collocazione delle attività;\n',
    );
    move(/Restituisci soltanto il Markdown finale corretto\./);
    move(
      /Scegli tu il tono[\s\S]*?nessuno script\)\./,
      'Scegli tu il tono e l’organizzazione più efficaci entro questi criteri.',
    );
    format.push(
      'Rispondi con il solo corpo Markdown da incollare nell’editor della lezione, senza oggetto JSON né fence attorno all’intera risposta. Esempio di struttura (da sostituire con il contenuto richiesto):\n\n## Concetto principale\n\nSpiegazione motivata.\n\n### Esempio svolto\n\nDati, metodo, passaggi, risultato e motivazione.',
    );
  } else if (request.kind === 'concept_map') {
    move(/Restituisci esattamente due campi\./);
    instructions = instructions
      .replace('summaryMarkdown —', 'Sintesi —')
      .replace('diagram —', 'Diagramma —');
    move(
      /- PROFONDO, non largo:[\s\S]*?(?=Vincoli tecnici)/,
      '- preferisci una gerarchia profonda a una struttura larga.\n\n',
    );
    move(/Vincoli tecnici su entrambi i campi:[\s\S]*?(?=Controllo finale)/);
    // The external assistant must compose the document, unlike the provider
    // whose two fields are wrapped by our server.
    format.splice(
      0,
      format.length,
      ...format.filter(
        (part) => !part.startsWith('Restituisci') && !part.startsWith('Vincoli tecnici'),
      ),
    );
    format.push(
      'Rispondi con il documento Markdown completo da incollare nell’editor della mappa: intestazioni, fence text del diagramma e avvertenza come nell’esempio canonico seguente. Non restituire JSON. Dentro sintesi e diagramma non aggiungere altre intestazioni, HTML, front matter, LaTeX, Mermaid, script o link esterni. Non citare la lezione come oggetto, il prompt o l’IA. Sostituisci i contenuti dell’esempio mantenendo la struttura e l’avvertenza:\n\n' +
        composeConceptMapMarkdown({
          summaryMarkdown:
            'Il concetto centrale dipende dai suoi prerequisiti e determina una conseguenza.',
          diagram:
            'CONCETTO CENTRALE\n├─ dipende da ──▶ prerequisito\n└─ determina ──▶ conseguenza',
        }),
    );
  } else {
    move(
      /Nel campo soluzione[\s\S]*?(?=Formattazione di testo)/,
      'Dopo aver fissato le opzioni, controlla che tutte le opzioni selezionate siano vere e tutte quelle non selezionate false. La singola seleziona una sola opzione; la multipla almeno due e lascia almeno un’opzione non selezionata.\n\n',
    );
    move(/Formattazione di testo e codice:[\s\S]*?(?=Difficoltà:)/);
    move(/Le soluzioni delle chiuse[\s\S]*?(?=Controllo finale)/);
    move(
      /Controllo finale silenzioso[\s\S]*?formattazione\./,
      'Controllo finale silenzioso: quantità e tipi esatti; copertura senza duplicazioni; soluzioni coerenti con le opzioni definitive.',
    );
    const textFormatting = format.find((part) => part.startsWith('Formattazione'))!;
    format.splice(0, format.length, textFormatting);
    format.push(
      'Restituisci soltanto un file .pool.md: front matter YAML schoolforge-pool/v2 delimitato da --- come nell’esempio. Non aggiungere campi extra rispetto alla struttura mostrata (salvo maxCharacters nelle aperte). È il formato accettato dall’editor YAML del pool e dall’importatore, senza fence esterne. Usa id domanda univoci e id opzione univoci nella domanda. Per le chiuse soluzione contiene gli ID delle opzioni corrette (NON indici numerici): una per singola, almeno due e non tutte per multipla. Per le aperte soluzione è testo; maxCharacters è facoltativo. Non inserire punteggi o pesi. Mantieni quantità, tipi e difficoltà richiesti sopra: l’esempio illustra soltanto la sintassi. Per testi multilinea usa scalari YAML | con indentazione corretta.\n\n' +
        POOL_FORMAT_EXAMPLE,
    );
  }
  return {
    prompt: [
      '# Istruzioni didattiche',
      system,
      instructions.trim(),
      '# Materiali e contesto',
      materials.trimEnd(),
      RESPONSE_FORMAT_HEADING,
      'Questa sezione finale è rimovibile per ottenere una risposta libera. Se presente, applicala come contratto di formato della risposta.',
      'Non produrre HTML o script. Rispetta la struttura richiesta senza campi extra.',
      ...format,
    ].join('\n\n'),
  };
}

export const POOL_FORMAT_EXAMPLE = `---
schema: schoolforge-pool/v2
questions:
  - id: q1
    tipo: aperta
    difficolta: 1
    testo: Spiega il concetto centrale.
    soluzione: |
      Definizione e spiegazione motivata.
      Esempio con passaggi e risultato.
  - id: q2
    tipo: chiusa_singola
    difficolta: 2
    testo: Quale affermazione è corretta?
    opzioni:
      - id: a
        testo: Affermazione corretta
      - id: b
        testo: Distrattore plausibile
    soluzione: [a]
  - id: q3
    tipo: chiusa_multipla
    difficolta: 3
    testo: Quali affermazioni sono corrette?
    opzioni:
      - id: a
        testo: Prima affermazione corretta
      - id: b
        testo: Seconda affermazione corretta
      - id: c
        testo: Distrattore plausibile
    soluzione: [a, b]
---`;
