# M4 — Concept UX della correzione docente

**Stato:** concept approvato; contratto dati, service/Rules, workspace docente, lettura studente, ciclo di vita, eliminazione e Registro Correzioni con export CSV (M4-00→M4-03A) implementati. Export PDF/Markdown (M4-03B) e Gate G6 non ancora completati.
**Data decisione:** 2026-07-12  
**Prerequisito:** chiusura di M3-full e superamento del Gate G5 — soddisfatto

## 1. Obiettivo

M4 deve permettere al docente di aprire le consegne digitali, correggerle manualmente, salvarne il progresso e restituire allo studente punteggio e feedback. L'esperienza deve riprendere il linguaggio visivo dello svolgimento verifica lato studente: workspace dedicato, gerarchia chiara, controlli compatti e contenuto principale leggibile.

La submission originale dello studente resta immutabile. Punteggi, feedback, stato della correzione e rettifiche vivono in documenti separati.

## 2. Collocazione nel portale

Non viene introdotta inizialmente una nuova voce principale **Correzioni**.

Il percorso approvato è:

```text
Verifiche
  → verifica selezionata
    → tabella Consegne online già esistente
      → studente selezionato
        → workspace di correzione
```

La tabella **Consegne online** è quindi il punto di ingresso unico. Durante una verifica attiva continua a funzionare come monitor; quando esistono submission consegnate consente anche di aprire la correzione dello studente.

## 3. Tabella consegne

La tabella deve restare compatta e filtrabile.

| Colonna | Contenuto |
|---|---|
| Studente | Nome e cognome dell'account Google |
| Consegnata | Data e ora definitive |
| Eventi | Conteggio con apertura della dialog eventi già esistente |
| Correzione | Da correggere, In correzione, Corretta o Restituita |
| Punteggio | Totale/massimo, se disponibile |
| Azione | Icona per aprire o visualizzare la correzione |

Filtri previsti:

- tutte;
- da correggere;
- in correzione;
- corrette;
- restituite;
- ricerca per nome studente.

Sintesi superiore minimale:

```text
Consegne: N · Da correggere: N · Corrette: N · Restituite: N
```

Niente griglie di grandi card per ogni studente.

> **Stato implementazione (M4-MON-01):** la tabella Consegne online mostra **Studente**, **Stato**, **Punteggio**, **Percentuale**, **Consegnata**, **Eventi**, **Codice** e **Azioni**. La colonna ridondante **Ultimo salvataggio** è stata rimossa. Le intestazioni utili ordinano le righe in memoria in entrambe le direzioni, con valori mancanti sempre in fondo e ordinamento stabile; non vengono aggiunte query o letture. Punteggio e percentuale provengono dal riepilogo owner-only `SubmissionDoc.correctionSummary`; per consegne non ancora corrette e documenti legacy viene mostrato `—`.

> **Export M4-03A:** questa stessa tabella è il Registro Correzioni — nessuna popup o seconda tabella duplicata. **Esporta CSV** usa esattamente le righe già visibili e il loro ordinamento corrente. Il file è UTF-8 con BOM, separatore `;`, decimali italiani, escaping CSV e protezione dai prefissi formula di Excel; contiene solo studente/email/stato/punteggio/massimo/percentuale/data consegna/codice. UID, risposte, soluzioni, feedback, eventi e id tecnici sono esclusi. Generazione e download avvengono interamente nel browser, senza Firebase.

## 4. Workspace di correzione

Il dettaglio non è una modale: usa lo spazio principale della sezione Verifiche, come lo svolgimento lato studente.

### 4.1 Pannello superiore

Un pannello sticky, opaco e responsive contiene:

- ritorno alla lista consegne;
- nome studente;
- titolo verifica e classe;
- stato della correzione;
- punteggio corrente/totale;
- studente precedente e successivo;
- accesso agli eventi di attenzione;
- stato ultimo salvataggio;
- azioni **Salva** e **Completa correzione**.

Il contenuto non deve scorrere visivamente dietro al pannello. Su mobile i controlli si ricompongono senza produrre overflow orizzontale della pagina.

> **Stato implementazione (M4-02):** pannello sticky con ritorno alla lista, nome studente, titolo verifica, classe, stato correzione e azioni **Salva**/**Completa** sono implementati. **Non implementati**: punteggio corrente/totale nell'intestazione (mostrato invece nel riepilogo laterale, §4.3), navigazione studente precedente/successivo, accesso agli eventi di attenzione dal workspace (restano nella tabella Consegne online) e uno stato "ultimo salvataggio" testuale (il badge "Modifiche non salvate" copre la stessa esigenza in forma più semplice).

### 4.2 Correzione per domanda

Ogni domanda mostra, in ordine:

1. numero, tipologia e punteggio massimo;
2. testo immutabile della domanda assegnata;
3. risposta consegnata dallo studente;
4. soluzione immutabile disponibile al docente;
5. campo punti assegnati `0..maxPoints`;
6. feedback facoltativo per la domanda.

Il layout usa sezioni e separatori, non una successione di card annidate.

Per domande chiuse il confronto è visivo:

- verde per opzione corretta selezionata;
- rosso per opzione errata selezionata;
- indicazione neutra dell'opzione corretta non selezionata.

Il sistema può proporre deterministicamente il punteggio massimo per una risposta chiusa esatta e zero per una risposta errata. Il docente mantiene sempre il controllo e può modificare il punteggio proposto. Le domande aperte restano manuali.

> **Stato implementazione (M4-02):** numero/tipo/punteggio massimo, testo, risposta consegnata, soluzione (visibile solo al docente), campo punti `0..maxPoints` e feedback opzionale per domanda sono implementati; per le domande chiuse, l'opzione selezionata e quella corretta sono distinte sia per colore sia per testo (" — selezionata" / " (corretta)"), non solo colore. **Non implementato**: la proposta automatica deterministica del punteggio massimo/zero per le domande chiuse — il docente inserisce sempre il punteggio manualmente, anche per le domande a risposta chiusa.

### 4.3 Riepilogo

Su desktop una colonna sticky compatta mostra:

- domande valutate;
- domande ancora da valutare;
- risposte mancanti;
- punteggio totale e massimo;
- eventuale percentuale;
- feedback generale;
- **Salva correzione**;
- **Completa correzione**.

Su mobile il riepilogo diventa un pannello espandibile o una sezione finale, non una sidebar laterale permanente.

> **Stato implementazione (M4-02):** domande valutate/totali, punteggio totale/massimo, percentuale, feedback generale, **Salva correzione** e **Completa correzione** sono implementati nel pannello laterale (sticky su desktop, sotto la card domanda a schermo stretto — `@media (max-width: 860px)`). **Non implementato**: un conteggio "risposte mancanti" separato da "domande ancora da valutare" (nel contratto M4-00 una domanda non valutata è già l'unico stato tracciato: non esiste una distinzione fra "non risposta dello studente" e "non ancora valutata dal docente" a questo livello).

## 5. Stati e transizioni

Gli stati UX approvati sono:

```text
Da correggere → In correzione → Corretta → Restituita
```

- **Da correggere:** submission consegnata, nessuna correzione salvata.
- **In correzione:** esiste una correzione modificabile non completata.
- **Corretta:** il docente ha completato la valutazione, ma lo studente non la vede ancora.
- **Restituita:** risultato reso visibile allo studente.

Una correzione completa può essere riaperta dal docente. Ogni rettifica significativa deve essere tracciata con evento append-only.

> **Stato implementazione (M4-02):** le quattro transizioni sono implementate nel workspace esattamente come da contratto M4-00/M4-01 — "Completa correzione" e "Riapri" richiedono conferma esplicita in una dialog; l'etichetta di stato mostrata (`STATUS_LABELS`) usa le stesse quattro parole di questo documento.

## 6. Visibilità e restituzione

La pubblicazione della verifica e la restituzione della correzione sono controlli distinti.

Sono previsti (formalizzati in M4-00 come `correctionReturns.visibleToStudent`/`solutionsVisible`, per singola correzione — non un interruttore a livello verifica):

- controllo per rendere visibile o nascondere allo studente la propria correzione (`visibleToStudent`);
- controllo **Mostra soluzioni dopo la restituzione** per singola correzione, disattivato per default (`solutionsVisible`);
- eventuale azione batch **Restituisci tutte le correzioni completate** (ed eventuali batch analoghi su `visibleToStudent`/`solutionsVisible`), da confermare durante M4-01.

Prima della restituzione lo studente continua a vedere soltanto la conferma di consegna. Dopo la restituzione vede:

- titolo e data della verifica;
- data di consegna;
- punteggio totale e massimo;
- percentuale, se prevista;
- feedback generale;
- per ogni domanda: propria risposta, punti e feedback;
- soluzione corretta solo quando il relativo controllo docente è abilitato.

Nascondere nuovamente una correzione non modifica né elimina i dati: cambia soltanto la proiezione leggibile dallo studente.

> **Stato implementazione (M4-02):** i due toggle per singola correzione (`visibleToStudent`, `solutionsVisible`) sono implementati nel workspace, visibili solo nello stato `returned`, con avviso esplicito che riaprire nasconde subito la restituzione. **Non implementata**: l'azione batch "Restituisci tutte le correzioni completate" (né batch analoghi sui due toggle) — resta un'azione per singola correzione, come esplicitamente delimitato in M4-00/M4-01. **Implementata in M4-02B**: la schermata studente che mostra il risultato dopo la restituzione — `StudentCorrectionView`, letta esclusivamente da `correctionReturns` con un'unica query (`studentUid`+`visibleToStudent`), integrata nella sezione Verifiche con badge "Vedi correzione" e sezioni distinte per correzioni restituite/consegne effettuate/verifiche disponibili.

## 7. Contratto dati (M4-00 — definito)

Il documento è separato dalla submission, sul path deterministico `corrections/{submissionId}` (stesso id di `submissions`/`submissionReceipts`, cioè `${verificationId}_${studentUid}` — non ripetuto come coppia di campi nel path):

```typescript
type CorrectionStatus = 'in_progress' | 'completed' | 'returned';

interface CorrectionDoc {
  submissionId: string;
  verificationId: string;
  studentUid: string;
  ownerUid: string;
  status: CorrectionStatus;
  evaluations: Record<string, QuestionEvaluation>; // key = order.toString()
  generalFeedback: string | null;
  totalPoints: number;   // derivato, mai scritto a mano
  maxPoints: number;     // derivato, mai scritto a mano
  percentage: number | null; // derivato, arrotondato — vedi §10.1
  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt: Timestamp | null;
  returnedAt: Timestamp | null;
  reopenCount: number;   // 0 alla creazione, incrementato a ogni riapertura, mai azzerato
}
```

Ogni domanda è collegata stabilmente tramite `order` (stessa chiave di `SubmissionDoc.answers` e `PublicVerificationQuestion.order`), non tramite un riferimento al pool corrente — vedi `documentazione/api-contract.md` per il tipo completo `QuestionEvaluation` e i contratti gemelli `CorrectionEventDoc`/`CorrectionReturnDoc`.

Le rettifiche vivono in eventi append-only separati, `correctionEvents/{eventId}` (id auto-generato, molti eventi per correzione). Il primo giro di compilazione (`reopenCount == 0`) non produce mai un evento, per quanti salvataggi avvengano: sarebbe un log di autosave, non un audit di rettifica. Solo un salvataggio dopo una riapertura (`reopenCount > 0`) che cambia effettivamente un punteggio o un feedback produce un evento `scoreAdjusted`, con un delta minimale per domanda (`order`, `previousPoints`/`nextPoints`, `previousFeedback`/`nextFeedback` solo se presenti) — mai l'intera mappa `evaluations` né la submission. `reopenCount` è quindi l'unico segnale persistente di cui il service M4-01 ha bisogno per distinguere le due situazioni.

Lo studente legge la propria correzione restituita da una proiezione separata e **autosufficiente**, `correctionReturns/{submissionId}`, scritta solo dal docente — mai il documento tecnico `corrections`. "Autosufficiente" perché la verifica potrebbe nel frattempo essere chiusa, nascosta o resa irraggiungibile dalla Modalità verifica: la proiezione copia quindi testo/opzioni della domanda, la risposta consegnata e il punteggio (sempre un `number`, mai `null` — una correzione incompleta non può essere restituita), invece di rimandare a `submissions`/`publishedProjection`. Le soluzioni **non** sono incluse per default: due booleani indipendenti sulla singola restituzione — `visibleToStudent` (mostra/nasconde il risultato senza cancellarlo) e `solutionsVisible` (quando `true`, ogni domanda ha `correctAnswer` popolato dalle soluzioni congelate; quando torna `false`, il campo viene **rimosso** dalla proiezione, non solo nascosto lato UI) — sostituiscono il toggle a livello `VerificationDoc` ipotizzato in una prima stesura: appartengono alla singola correzione/restituzione dello studente, non alla verifica nel suo complesso. Le eventuali azioni batch (es. "mostra soluzioni a tutta la classe") restano fuori scope M4-01.

Nessuna revisione/versione esplicita per la concorrenza sulle scritture ordinarie: la correzione è un flusso a singolo autore (un solo docente), a differenza dell'autosave concorrente dello studente in M3-full — non serve un revision guard. `reopenCount` non è un revision guard: è un contatore di stato di prodotto, non un meccanismo anti-concorrenza.

Il modello definitivo dei percorsi, dei tipi e dei valori ammessi è in `documentazione/api-contract.md`; le Security Rules e il service layer restano lo scope di **M4-01** (vedi `piano-implementazione.md`).

## 8. Principi di sicurezza ed efficienza

- La submission consegnata non viene mai riscritta dalla correzione.
- Solo il docente owner può leggere e scrivere le correzioni tecniche.
- Lo studente legge esclusivamente una proiezione restituita e limitata ai propri dati.
- Nessun listener globale sempre acceso: la correzione viene caricata quando il workspace è aperto.
- Salvataggio dirty-only e senza write per ogni digitazione.
- Nessuna Cloud Function se le Security Rules client-side sono sufficienti.
- Nessuna soluzione deve raggiungere lo studente prima della restituzione e dell'abilitazione esplicita.
- Correzione e export lavorano sullo snapshot immutabile assegnato, mai sui pool correnti.

## 9. Fuori scope del primo M4

- AI e correzione automatica generativa;
- voto su registro elettronico;
- rubriche complesse;
- correzione di prove cartacee;
- allegati e annotazione grafica;
- confronto tra più tentativi;
- analisi statistiche avanzate;
- email o notifiche push.

## 10. Decisioni formalizzate in M4-00 e decisioni ancora aperte

### 10.1 Formalizzate in M4-00

1. **Percentuale e arrotondamento**: `round(totalPoints / maxPoints * 100)` a numero intero (`Math.round`, arrotondamento standard); `null` solo quando `maxPoints == 0`. Vedi `computeCorrectionTotals` in `correctionContract.ts`.
2. **Range e granularità punteggio per domanda**: `[0, maxPoints]`, `maxPoints` congelato per domanda alla creazione della correzione e a sua volta validato (finito, non negativo). Ogni punteggio è inoltre un **multiplo esatto di `0,25`** (`QUESTION_POINTS_STEP`): validi `0`, `0,25`, `0,50`, `1,75`, `4`; invalidi `0,1`, `1,2`, `3,99`. Il controllo del quarto è fatto nel dominio intero (`points * 4`) per non essere fragile agli errori floating-point (`isQuarterPointStep`); il valore è **normalizzato** (`normalizeQuestionPoints`) prima della persistenza. Un punteggio fuori range, non multiplo di `0,25`, o con `maxPoints` malformato, è **rifiutato esplicitamente** (`assertValidQuestionPoints`), mai clampato in silenzio. L'input del campo accetta indifferentemente **virgola o punto** come separatore decimale (`1,25` = `1.25`, `parseQuestionPointsInput`); i controlli +/- incrementano/decrementano di `0,25`. Una correzione non può essere completata finché esiste un punteggio mancante, fuori intervallo o non multiplo di `0,25`.
3. **Completezza**: una correzione può passare a `completed` solo quando `evaluations` non è vuota **e** ogni domanda ha un punteggio non nullo (`0` conta come valutata, `null` no; una mappa vuota non è mai completa).
4. **Transizioni di stato ammesse**: `in_progress → completed`, `completed → returned`, `completed → in_progress` (riapertura), `returned → in_progress` (riapertura). Non è ammesso saltare `completed` né tornare direttamente da `returned` a `completed`.
5. **Riapertura**: sempre disponibile dal docente su una correzione `completed`/`returned`; riporta a `in_progress`, azzera `completedAt`/`returnedAt`, incrementa `reopenCount`, produce un evento append-only `'reopened'` in `correctionEvents`.
6. **Eventi append-only e delta minimale**: `correctionEvents` non contiene mai l'intera `evaluations` né la submission. Il primo giro di compilazione (`reopenCount == 0`) non produce mai un evento, indipendentemente da quanti salvataggi avvengano. Solo un salvataggio dopo una riapertura che cambia effettivamente un punteggio o un feedback produce `'scoreAdjusted'` con `questionDeltas`/`generalFeedbackDelta` limitati ai campi cambiati (`computeQuestionEvaluationDeltas`/`computeGeneralFeedbackDelta`). Nessun tipo evento `'hidden'`: mostrare/nascondere una restituzione è formalizzato come toggle di dato (`correctionReturns.visibleToStudent`), non come evento — il comportamento docente/audit che lo produce resta una decisione di M4-01.
7. **Compatibilità legacy**: `maxPoints` per domanda è sempre letto da `publishedProjection.questions[order]` (presente per ogni verifica che ha mai accettato consegne online), mai da `teacherSnapshot.questions` (assente sulle verifiche attivate prima del fix SEC-02) — nessuna dipendenza da quel campo opzionale. Il workspace di correzione compone una **rappresentazione canonica** delle domande (`correctionWorkspaceLoader`): quando `teacherSnapshot.questions` è presente mostra tipo/testo/opzioni/soluzione congelata; per una verifica legacy senza quel campo recupera tipo/testo/opzioni **esclusivamente dalla `publishedProjection` congelata** e dichiara esplicitamente «Soluzione non disponibile per questa verifica precedente allo snapshot con soluzioni». La soluzione storica non è **mai** ricostruita dal pool corrente (che potrebbe essere stato modificato) né da Storage. La proiezione è letta al massimo **una volta per apertura** del workspace: la lettura fatta da `openOrLoadCorrection` alla creazione della correzione viene riusata dal loader.

8. **Proiezione studente autosufficiente**: `correctionReturns` copia testo/opzioni/risposta consegnata/punteggio (mai un riferimento a `submissions`/`publishedProjection`, che potrebbero non essere più leggibili). `points` per domanda è sempre `number` una volta restituita (mai `null`: una correzione incompleta non può essere restituita). Le soluzioni non sono mai incluse per default; `visibleToStudent`/`solutionsVisible` sono due booleani indipendenti sulla singola restituzione, non su `VerificationDoc` — le azioni batch restano fuori scope M4-01.

9. **Difficoltà e peso congelati (M4-FIX-04)**: `VerificationTeacherQuestionSnapshot` porta anche `difficolta`/`peso` (opzionali), **congelati all'attivazione** dal `VerificationQuestionRef` già caricato — nessuna lettura extra di pool/Storage. Sono **owner-only** (mai copiati nella `publishedProjection`, che resta priva di soluzioni e metadati riservati) e mostrati nel workspace come `Difficoltà 2 · Peso 3 · Max 6 punti`. Sulle verifiche legacy prive dei due campi il workspace mostra `Difficoltà — · Peso — · Max N punti`, senza ricostruirli dal pool.

10. **Soluzioni multiple (M4-FIX-04)**: per `chiusa_multipla` `soluzione` è sempre l'array completo delle risposte corrette lungo tutta la catena `pool → parser → loadSelectedQuestionsWithSolutions → teacherSnapshot → loader → UI` (mai ridotto alla prima). Il workspace usa un'unica lista di opzioni con stato basato su **icone** (selezione azzurra dello studente, `✓` verde per corretta, `✕` rosso per selezionata-errata) e testo per screen reader — mai solo colore; la sezione «Soluzione» elenca **tutte** le risposte corrette.

12. **Eliminazione consegna e blocco verifica (M4-LIFE-02)**: `deleteSubmissionData` elimina una consegna e tutti i dati personali collegati — `correctionEvents` (per `correctionId`), `correctionReturns/{id}`, `corrections/{id}`, e per ultimi `submissionReceipts/{id}` e `submissions/{id}` — dipendenti prima, submission+receipt in fondo, così un'interruzione non lascia mai una submission "svuotata" ma ancora presente. Idempotente e ripetibile dopo un'interruzione (legge prima, elimina solo l'esistente, chunk ≤400). Owner-only sia lato UI (solo su verifica `closed`, con conferma esplicita) sia in Rules (delete owner-only verificato dal doc eliminato). Nessuna lettura Storage. Resta solo un audit **non identificativo** `submission.deleted` (ownerUid + verificationId + timestamp). `deleteVerification` è preceduto da un guard applicativo (`where verificationId== limit(1)` su `submissions`) che nega l'eliminazione finché esiste una consegna, perché le Rules non possono verificare l'assenza via query inversa nel modello single-owner.

11. **Salvataggio affidabile (M4-FIX-04)**: una scrittura Firestore riuscita è il salvataggio — nessuna rilettura successiva. `saveCorrection` restituisce lo stato normalizzato effettivamente persistito (`SaveCorrectionResult`: evaluations + generalFeedback + totali) e il workspace aggiorna baseline/dirty/totali/navigatore da quel risultato, **senza** una `get` aggiuntiva (che, se lenta o fallita, lasciava il pulsante bloccato su «Salvataggio…»). Guardia sincrona anti doppio-click (una sola scrittura), stato busy sempre rilasciato, errori che non perdono le modifiche locali, e un risultato asincrono vecchio che non sovrascrive modifiche più recenti. Numero di scritture invariato; una lettura in meno per salvataggio.

13. **Riepilogo monitor owner-only (M4-MON-01)**: ogni salvataggio reale della correzione aggiorna `SubmissionDoc.correctionSummary` (`totalPoints`, `maxPoints`, `percentage`) e `correctionSummaryUpdatedAt` nello stesso batch della correzione; se cambia anche lo stato, stato e riepilogo condividono un solo update della submission. I salvataggi identici restano no-op. Le Rules limitano campi, tipi, range, coppia riepilogo/timestamp e ownership; la coerenza aritmetica profonda con `evaluations` resta responsabilità del service owner-only. Il riepilogo non viene mai copiato in `submissionReceipts`: lo studente vede il risultato solo tramite la proiezione esplicita `correctionReturns` dopo la restituzione.

### 10.2 Ancora da formalizzare (M4-01)

1. presenza o meno di un voto distinto dal punteggio;
2. comportamento dell'eventuale restituzione batch (incluse eventuali azioni batch su `visibleToStudent`/`solutionsVisible`);
3. formato predefinito per PDF/Markdown richiesto da H-04 (il CSV tabellare M4-03A è già disponibile);
4. eliminazione o anonimizzazione di submission e correzione;
5. Security Rules esatte per `corrections`/`correctionEvents`/`correctionReturns` (il modello dati che devono applicare è però già definito — vedi §7 e §10.1);
6. soglia e messaggio UI per correzioni incomplete;
7. comportamento docente/audit dietro `visibleToStudent` (che tipo di evento, se non un tipo dedicato, o nessun evento).

Nessuna di queste è una decisione contrattuale bloccante per iniziare M4-01: sono scelte di service layer/UI/Rules, non ambiguità sul modello dati. Queste decisioni non cambiano il concept UX approvato; vengono chiuse durante M4-01.
