# M4 — Concept UX della correzione docente

**Stato:** concept approvato; contratto dati minimo (M4-00) implementato — tipi TypeScript e helper puri, nessun service layer/Rules/UI ancora  
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

## 6. Visibilità e restituzione

La pubblicazione della verifica e la restituzione della correzione sono controlli distinti.

Sono previsti:

- controllo per rendere visibile o nascondere allo studente la propria correzione;
- controllo a livello verifica **Mostra soluzioni dopo la restituzione**, disattivato per default;
- eventuale azione batch **Restituisci tutte le correzioni completate**, da confermare durante la specifica M4.

Prima della restituzione lo studente continua a vedere soltanto la conferma di consegna. Dopo la restituzione vede:

- titolo e data della verifica;
- data di consegna;
- punteggio totale e massimo;
- percentuale, se prevista;
- feedback generale;
- per ogni domanda: propria risposta, punti e feedback;
- soluzione corretta solo quando il relativo controllo docente è abilitato.

Nascondere nuovamente una correzione non modifica né elimina i dati: cambia soltanto la proiezione leggibile dallo studente.

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
}
```

Ogni domanda è collegata stabilmente tramite `order` (stessa chiave di `SubmissionDoc.answers` e `PublicVerificationQuestion.order`), non tramite un riferimento al pool corrente — vedi `documentazione/api-contract.md` per il tipo completo `QuestionEvaluation` e i contratti gemelli `CorrectionEventDoc`/`CorrectionReturnDoc`.

Le rettifiche vivono in eventi append-only separati, `correctionEvents/{eventId}` (id auto-generato, molti eventi per correzione) — solo per riaperture/rettifiche dopo `completed`/`returned`, mai per il progresso ordinario mentre la correzione è `in_progress`.

Se lo studente deve leggere la propria correzione restituita, legge una proiezione minima separata, `correctionReturns/{submissionId}`, scritta solo dall'azione di restituzione del docente — mai il documento tecnico `corrections`. Il contenuto esatto di questa proiezione (in particolare se includere la risposta consegnata e la soluzione corretta, §6) dipende da un toggle "mostra soluzioni dopo la restituzione" non ancora modellato su `VerificationDoc`, e resta una decisione di M4-01.

Nessuna revisione/versione esplicita per la concorrenza: la correzione è un flusso a singolo autore (un solo docente), a differenza dell'autosave concorrente dello studente in M3-full — non serve un revision guard.

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
2. **Range punteggio per domanda**: `[0, maxPoints]`, `maxPoints` congelato per domanda alla creazione della correzione. Un punteggio fuori range è **rifiutato esplicitamente** (`assertValidQuestionPoints`), mai clampato in silenzio.
3. **Completezza**: una correzione può passare a `completed` solo quando ogni domanda ha un punteggio non nullo (`0` conta come valutata, `null` no).
4. **Transizioni di stato ammesse**: `in_progress → completed`, `completed → returned`, `completed → in_progress` (riapertura), `returned → in_progress` (riapertura). Non è ammesso saltare `completed` né tornare direttamente da `returned` a `completed`.
5. **Riapertura**: sempre disponibile dal docente su una correzione `completed`/`returned`; riporta a `in_progress`, azzera `completedAt`/`returnedAt`, produce un evento append-only in `correctionEvents`.
6. **Eventi append-only**: solo per riaperture/rettifiche/restituzioni/nascondimenti dopo il primo completamento — non un log di autosave del progresso ordinario.
7. **Compatibilità legacy**: `maxPoints` per domanda è sempre letto da `publishedProjection.questions[order]` (presente per ogni verifica che ha mai accettato consegne online), mai da `teacherSnapshot.questions` (assente sulle verifiche attivate prima del fix SEC-02) — nessuna dipendenza da quel campo opzionale.

### 10.2 Ancora da formalizzare (M4-01)

1. presenza o meno di un voto distinto dal punteggio;
2. comportamento dell'eventuale restituzione batch;
3. formato export predefinito richiesto da H-04;
4. eliminazione o anonimizzazione di submission e correzione;
5. contenuto esatto di `correctionReturns` — se e come includere la risposta consegnata e la soluzione corretta (dipende dal toggle "mostra soluzioni dopo la restituzione", non ancora modellato);
6. Security Rules esatte per `corrections`/`correctionEvents`/`correctionReturns`;
7. soglia e messaggio UI per correzioni incomplete.

Queste decisioni non cambiano il concept UX approvato; vengono chiuse durante M4-01.
