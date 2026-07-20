# Gate GPOOL — checklist finale

**Data audit:** 20 luglio 2026

**Baseline:** `origin/main` dopo POOL-SIMPLE-01 e POOL-SIMPLE-02

**Verdetto:** **PASS**

## 1. Perimetro e criterio del verdetto

Il Gate GPOOL verifica il rollout del contratto unico `schoolforge-pool/v2` lungo
l'intero flusso pool → verifica → svolgimento → correzione → restituzione/export.
Il gate è chiuso sulla combinazione di:

- test automatici già presenti su `main`, inclusi test di contratto e attraversamento
  delle forme persistite;
- POOL-SIMPLE-01/02 già mergiati e deployati su DEV;
- conferma generale del docente che il nuovo flusso su DEV appare funzionante;
- osservazione manuale specifica che un pool V1 viene rifiutato con «schema non
  supportato».

Non sono attribuiti al docente smoke puntuali non dichiarati. In particolare, la
cleanup completa di appunti reali introdotta da ANNOT-CLEANUP-01 non appartiene a
GPOOL e non è registrata come verificata manualmente.

## 2. Matrice delle evidenze

| Area | Evidenza automatica su `main` | Evidenza manuale DEV dichiarata | Limite residuo | Esito |
|---|---|---|---|---|
| Parser/serializer V2 | `packages/lesson-contract/src/parser.contract.test.ts`, `serializer.test.ts` e `index.test.ts` accettano e riemettono esclusivamente `schoolforge-pool/v2`, per tutti i tipi di domanda. | Compresa soltanto nella conferma generale del nuovo flusso DEV. | Nessun verbale manuale separato di round-trip parser/serializer. | PASS |
| Rifiuto V1 | `parser.contract.test.ts` verifica l'errore deterministico «Schema pool non supportato: atteso schoolforge-pool/v2.». | Il docente ha osservato realmente su DEV il messaggio «schema non supportato» importando un pool V1. | Nessuna conversione o migrazione, intenzionalmente. | PASS |
| Rifiuto `peso` | `parser.contract.test.ts` verifica che la chiave sia rifiutata; il parser produce un errore leggibile dedicato. | Nessuna evidenza specifica dichiarata. | I documenti storici possono ancora nominare il campo a fini di decisione/audit. | PASS |
| `difficolta` intera 1–5 | I test del contratto coprono valori validi e rifiutano assenza, decimali e valori fuori intervallo; i test import/editor attraversano anche difficoltà 4 e 5. | Compresa soltanto nella conferma generale DEV. | Nessun supporto ai valori legacy 1–3 come contratto distinto. | PASS |
| `maxPoints === difficolta` | `parser.contract.test.ts`, `buildImportPayload.test.ts`, `poolEditorService.test.ts`, `questionIndexService.test.ts`, `verificationSnapshotMappers.test.ts` e `poolSimpleV2Contract.test.ts` verificano la derivazione e il fail-closed sulle incoerenze. | Compresa soltanto nella conferma generale DEV. | `maxPoints` resta congelato nelle forme operative, ma non è una chiave Markdown modificabile. | PASS |
| `maxCharacters` e default 2.000 | `maxCharacters.test.ts`, `serializer.test.ts`, test editor/snapshot e `OnlineExamView.test.tsx` coprono range 1–10.000, default effettivo 2.000 e divieto sui tipi chiusi. | Nessuna evidenza specifica dichiarata. | Alcuni test chiamano ancora “legacy” l'assenza del campo: è compatibilità del valore opzionale V2, non del pool V1. | PASS |
| Template singolo e kit ZIP V2 | `templateKit.test.ts` analizza davvero il template pubblico e ogni pool generato nel kit, poi valida l'intero ZIP con l'importer V2 e tutti e tre i tipi. | Compresi soltanto nella conferma generale DEV. | Nessun artefatto V1 distribuibile resta supportato. | PASS |
| Import e Question Pool Editor | `buildImportPayload.test.ts`, test di validazione import, `poolEditorService.test.ts` e `QuestionPoolEditor.crud.test.tsx` verificano V2, difficoltà 4/5, punti derivati e serializzazione senza `peso`. | Compresi soltanto nella conferma generale DEV. | Nessun import o salvataggio duale V1/V2. | PASS |
| `questionIndex` e picker | `questionIndexService.test.ts`, `poolSimpleV2Contract.test.ts` e `QuestionPicker.test.tsx` verificano difficoltà 1–5, punti derivati e selezione priva di `peso`. | Compresi soltanto nella conferma generale DEV. | Il service resta l'autorità fail-closed contro documenti incoerenti. | PASS |
| Snapshot verifica | `verificationSnapshotMappers.test.ts`, `verificationsService.test.ts` e `poolSimpleV2Contract.test.ts` attraversano ref e teacher snapshot, inclusa difficoltà 5, con `maxPoints === difficolta` e senza `peso`. | Compreso soltanto nella conferma generale DEV. | Nessun backfill di snapshot V1, per decisione di rollout. | PASS |
| Svolgimento studente | `verificationSnapshotMappers.test.ts` copre la proiezione pubblica; `OnlineExamView.test.tsx` copre i limiti delle aperte e l'associazione stabile delle risposte. | Compreso soltanto nella conferma generale DEV. | Nessuno smoke puntuale domanda-per-domanda è stato dichiarato. | PASS |
| Correzione manuale | `CorrectionWorkspace.test.tsx` copre metadati difficoltà/max punti, validazione dei punteggi e step 0,25 senza campo `peso`. | Compresa soltanto nella conferma generale DEV. | Nessun verbale manuale separato della correzione è stato fornito per questo gate. | PASS |
| Correzione IA | `openAiGrader.test.ts` attraversa snapshot difficoltà 5 → input grader → payload OpenAI e verifica `maxPoints: 5` senza `peso`/`weight`; `aiCorrectionEngine.test.ts` rifiuta snapshot incoerenti e mantiene le chiuse deterministiche. | Compresa soltanto nella conferma generale DEV; non si dichiarano nuove chiamate IA per questo audit. | Qualità comparativa del modello e Gate G7 restano separati da GPOOL. | PASS |
| Restituzione studente | `StudentCorrectionView.test.tsx` verifica la restituzione da snapshot/correzione congelati e i relativi massimi. Il tipo condiviso non espone `peso`. | Compresa soltanto nella conferma generale DEV. | Nessun verbale manuale separato di restituzione è stato fornito. | PASS |
| PDF/CSV | I test `verificationPdf*.test.ts` e `correctionRegisterExport.test.ts` verificano renderer/export da snapshot e riepiloghi a `maxPoints`; i tipi sorgente non espongono `peso`. | Compresi soltanto nella conferma generale DEV. | Non viene dichiarata una revisione visuale/manuale separata dei file generati per GPOOL. | PASS |
| Assenza runtime/payload/persistenza di `peso` | La ricerca applicativa trova la parola soltanto nel rifiuto esplicito del parser e in commenti/invarianti di rimozione. I writer import/editor, i tipi Firestore, snapshot, export e payload IA non espongono il campo; `poolSimpleV2Contract.test.ts` e `openAiGrader.test.ts` verificano le catene persistita e provider. | Nessuna evidenza specifica dichiarata oltre al flusso generale DEV. | La parola resta legittimamente nei test negativi e nella documentazione storica; non equivale a un campo runtime. | PASS |

## 3. Audit della rimozione di `peso`

La ricerca nei sorgenti applicativi non mostra letture o scritture del campo. Le sole
occorrenze non di test sono:

- il controllo negativo del parser che rifiuta la chiave;
- commenti e invarianti che dichiarano esplicitamente la sua assenza.

Le occorrenze nei test verificano il rifiuto o l'assenza. Le occorrenze nella
documentazione descrivono la decisione e il passaggio storico. Questa allowlist
semantica soddisfa il criterio del gate senza cancellare le evidenze storiche.

## 4. Conferme manuali utilizzate

Sono utilizzate esclusivamente le due dichiarazioni fornite dal docente:

1. POOL-SIMPLE-01/02 sono deployati su DEV e il nuovo flusso appare funzionante;
2. un pool V1 è stato realmente rifiutato con «schema non supportato».

Non vengono dedotti punteggi, file esportati, schermate o singoli passaggi di smoke
non dichiarati.

## 5. Limiti residui e confini

- La conferma DEV è generale; la granularità per area deriva soprattutto dai test
  automatici, non da un verbale manuale dettagliato.
- GPOOL non certifica la cleanup di appunti reali di ANNOT-CLEANUP-01.
- Il contratto non offre migrazione, conversione o compatibilità V1: il rifiuto è il
  comportamento definitivo approvato.
- M5-QUALITY-02, M5 e Gate G7 restano nello stato precedente; questo gate non ne
  anticipa la chiusura.
- VEX resta un pacchetto successivo: GPOOL ne sblocca il prerequisito contrattuale,
  ma non lo implementa né lo approva.

## 6. Decisione finale

La copertura automatica attraversa tutte le superfici richieste, il rollout V2 su DEV
è dichiarato eseguito e il comportamento fail-closed più critico è stato osservato
manualmente. I limiti residui sono documentali o appartengono ad altri gate e non
contraddicono il contratto GPOOL.

**Gate GPOOL: PASS.**
