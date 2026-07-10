# SchoolForge — Roadmap Question Editor (Sezione "Domande")

**Versione:** 1.0
**Data:** 10 luglio 2026
**Stato:** specifica approvata — non ancora implementato
**Dipendenze:** M1, M2, M3-lite, RE (tutti completati)
**Fuori scope in QE:** M3-full, M4, M5, AI, timer, import formati esterni, immagini, scoring avanzato.

---

## 1. Obiettivo

Aggiungere al portale docente una sezione **"Domande"** che permette di visualizzare, creare, modificare ed eliminare le domande dei pool direttamente dall'interfaccia, senza dover rigenerare e reimportare lo ZIP didattico.

Il Repository Editor (RE-00→RE-07) ha reso editabili UDA e lezioni. Il passo successivo naturale è rendere editabili i pool di domande, che sono la materia prima del flusso verifiche. Senza questo editor il docente deve uscire da SchoolForge, aggiornare il file `.pool.md` esternamente, e reimportare l'intero corso per aggiungere o correggere una singola domanda.

L'editor delle domande mantiene il Markdown come formato canonico e portabile, aggiornando in modo atomico il file `.pool.md` su Storage e il `questionIndex` su Firestore — la stessa coppia già usata dall'import.

---

## 2. Fuori scope (QE-00 → QE-05)

| Categoria | Decisione |
|---|---|
| AI / generazione automatica | Fuori scope V1 (M5, V2) |
| Immagini e allegati alle domande | Fuori scope |
| Scoring avanzato / rubriche | Fuori scope — i campi `difficolta`, `peso`, `maxPoints` del contratto esistente sono sufficienti |
| Import da formati esterni (GIFT, Aiken, QTI) | Fuori scope — il formato `.pool.md` rimane l'unico ingresso |
| Riordino visuale drag-and-drop delle domande | Fuori scope in v1 dell'editor |
| Versioning / storico domande | Fuori scope |
| Collaborazione multiutente | Fuori scope (monoutente by design) |
| Sezione Domande nel portale studente | Fuori scope — i pool non sono mai esposti allo studente |
| Modifica delle verifiche già attivate o chiuse | Fuori scope — le verifiche usano snapshot immutabili |
| Cloud Functions per le operazioni di pool | Fuori scope — client + Storage/Firestore Security Rules, come RE |

---

## 3. Modello dati e Storage

### 3.1 File `.pool.md` — formato Markdown-first

Ogni lezione può avere zero o un pool di domande. Il pool vive in un file
`<nomelezione>.pool.md` nella stessa directory della lezione su Cloud Storage,
al percorso `repository/{ownerUid}/imports/{importId}/{udaDir}/{nomebase}.pool.md`.

Il formato è **YAML front matter embedded in Markdown**:

```markdown
---
schema: schoolforge-pool/v1
questions:
  - id: q1
    tipo: aperta
    difficolta: 2
    peso: 2
    testo: "Spiega la differenza tra HTTP e HTTPS."
    soluzione: "HTTPS aggiunge un layer TLS/SSL..."
  - id: q2
    tipo: chiusa_singola
    difficolta: 1
    peso: 1
    testo: "Quale porta usa HTTP di default?"
    opzioni:
      - id: a
        testo: "80"
      - id: b
        testo: "443"
    soluzione: [a]
---
```

Il parser canonico è `packages/lesson-contract/src/parser.ts` (`parsePool`).
Lo schema Zod è `packages/lesson-contract/src/schemas.ts` (`PoolFrontMatterSchema`).
Il formato non cambia con QE: l'editor produce e consuma lo stesso YAML.

### 3.2 Regole di validazione del contratto pool/v1

| Campo | Tipo | Vincoli |
|---|---|---|
| `schema` | literal | `"schoolforge-pool/v1"` |
| `id` | string | `[a-z0-9-]+`, unico nel pool |
| `tipo` | enum | `aperta`, `chiusa_singola`, `chiusa_multipla` |
| `difficolta` | 1\|2\|3 | — |
| `peso` | 1\|2\|3 | — |
| `maxPoints` | number | calcolato: `difficolta × peso` (1–9), non scritto nel YAML |
| `testo` | string | non vuoto |
| `soluzione` | string (aperta) \| string[] | non vuoto; per chiusa: deve referenziare id opzione validi; `chiusa_multipla`: meno elementi di `opzioni` |
| `opzioni[].id` | string | `[a-z0-9-]+`, unico nella domanda |
| `opzioni[].testo` | string | non vuoto |

### 3.3 `questionIndex` — indice Firestore

Il `questionIndex` vive sotto `programs/{programId}/imports/{importId}/questionIndex/{entryId}`.
È leggibile **solo dal docente** (owner): non è mai esposto allo studente né alle proiezioni pubbliche.

Il documento `QuestionIndexEntry` (da `firestore.ts`):

```typescript
interface QuestionIndexEntry {
  ownerUid: string;
  importId: string;
  udaDir: string;
  lessonPath: string;
  lessonFilename: string;
  poolStorageRef: string;        // percorso del file .pool.md in Storage
  questionLocalId: string;       // id della domanda dentro il pool
  tipo: 'aperta' | 'chiusa_singola' | 'chiusa_multipla';
  difficolta: 1 | 2 | 3;
  peso: 1 | 2 | 3;
  maxPoints: number;
  questionPreview: string;       // max 100 char, solo da testo, mai da soluzione
}
```

L'`entryId` è deterministico: `${lessonId}_${toDocId(q.id)}`.

### 3.4 Invariante di doppia scrittura

Ogni modifica al pool deve aggiornare **entrambi**:

1. **Storage** — file `.pool.md` riscritto integralmente con il nuovo YAML
2. **Firestore** — `questionIndex` sotto l'`importId` attivo aggiornato (`set`/`delete` per entrata)

Strategia: Storage-poi-Firestore (lo stesso pattern usato dall'editor lezioni in `repositoryEditorService.ts`). Se Storage fallisce, Firestore non viene toccato. Se Storage riesce ma Firestore fallisce, un errore distinto avvisa il docente di riprovare.

I campi derivati su `Lesson` (`poolStatus`, `questionCount`) e su `publicLessons` (nessun dato pool, ma nessun campo da aggiornare) **non richiedono aggiornamento** quando cambia solo il contenuto del pool — `poolStatus` e `questionCount` sono calcolati all'import e aggiornati esplicitamente dall'editor tramite un `update` separato su `lessons/{lessonId}` nello stesso flusso di salvataggio.

---

## 4. Relazione con `questionIndex` e il picker verifiche

Il `questionIndex` è la sorgente usata dal picker domande nella creazione/modifica delle verifiche (`listQuestionIndex` in `questionIndexService.ts`). Il picker legge metadati e anteprima (`questionPreview`), mai il testo completo né la soluzione.

Quando l'editor modifica il pool:

- Le domande **aggiunte** vengono aggiunte anche al `questionIndex` (con preview ricalcolata).
- Le domande **modificate** aggiornano l'entry nel `questionIndex` (testo, tipo, difficolta, peso, maxPoints, preview).
- Le domande **eliminate** vengono rimosse dal `questionIndex`.

L'`entryId` nel `questionIndex` è stabile finché il `questionLocalId` della domanda non cambia. Un editor che modifica solo `testo`, `soluzione`, `difficolta` o `peso` non causa riassegnazione degli `entryId`.

---

## 5. Relazione con le verifiche (draft / active / closed)

Le verifiche usano una **snapshot immutabile** (`publishedSnapshot`) creata all'attivazione: contengono il testo e la soluzione al momento dell'attivazione, indipendentemente da modifiche successive al pool.

| Stato verifica | Effetto di una modifica al pool |
|---|---|
| `bozza` | Il picker rilegge `questionIndex` ad ogni apertura. Le domande modificate appaiono aggiornate alla prossima apertura della bozza. Le domande eliminate spariscono dal picker; se erano già selezionate nella bozza, il docente dovrà rimuoverle manualmente prima dell'attivazione (la validazione all'attivazione le segnala). |
| `attiva` | Nessun effetto — la verifica usa `publishedSnapshot`, immutabile. Il pool può essere modificato liberamente. |
| `chiusa` | Nessun effetto — `publishedSnapshot` è immutabile. |

Una domanda nel `questionIndex` il cui `questionLocalId` corrisponde a una `VerificationQuestionRef` in una bozza non è eliminabile senza avviso: l'editor deve rilevare il conflitto e mostrare un messaggio operativo (analogo al blocco eliminazione lezione di RE-05), oppure — dato che le bozze sono modificabili — avvisare il docente e procedere comunque (decisione di UX da formalizzare in QE-03).

**Vincolo fondamentale**: le modifiche al pool non toccano mai `publishedSnapshot`, `publishedProjection` o verifiche attive/chiuse. Non c'è propagazione retroattiva.

---

## 6. UX del docente — alto livello

### 6.1 Voce di menu "Domande"

La sezione "Domande" è una nuova voce nel menu laterale del portale docente, accanto a "Lezioni", "Verifiche", "Corsi", "Classi", "Impostazioni".

### 6.2 Navigazione sidebar

La sidebar replica la stessa struttura ad albero della sezione "Lezioni":

```
Domande
└── [Corso A]
    └── [UDA 1 — Reti]
        ├── lezione-001-http.md         (5 domande)
        ├── lezione-002-tcp.md          (3 domande)
        └── lezione-003-dns.md          (nessun pool)
    └── [UDA 2 — Sicurezza]
        └── lezione-004-tls.md          (7 domande)
```

Ogni lezione mostra un **indicatore** accanto al titolo:
- pool assente → etichetta "Nessun pool"
- pool presente → conteggio domande (es. "5 domande")

### 6.3 Pannello domande di una lezione

Cliccando su una lezione si apre il pannello principale con:
- Elenco domande del pool (tipo, difficoltà, peso, anteprima testo)
- Azioni per ogni domanda: modifica, elimina
- Azione globale: nuova domanda
- Azioni lezione: crea pool (se assente), elimina pool (se presente e vuoto)

### 6.4 Form domanda

Il form domanda è inline o in modal, con campi:
- `tipo` (select: aperta / chiusa_singola / chiusa_multipla)
- `id` (slug leggibile, suggerito automaticamente, validato `[a-z0-9-]+`)
- `difficolta` (1 / 2 / 3)
- `peso` (1 / 2 / 3)
- `testo` (textarea, Markdown)
- `soluzione` (textarea per aperta; checklist/radio per chiusa)
- `opzioni` (per chiuse: lista id+testo, almeno 2)

`maxPoints` è calcolato e mostrato in sola lettura (`difficolta × peso`).

### 6.5 Modalità editMode

Come nella sezione "Lezioni" (RE), la sezione "Domande" usa un `editMode` boolean che
deve essere attivato esplicitamente prima di poter creare, modificare o eliminare domande.
In sola lettura il pannello mostra solo testo e metadati, senza form aperti.

---

## 7. Rischi tecnici

| Rischio | Probabilità | Impatto | Mitigazione |
|---|---|---|---|
| Desincronizzazione Storage / `questionIndex` | Media | Alto | Storage-poi-Firestore con errore distinto su fallimento Firestore; no silently partial updates |
| Pool corrotto da errore di serializzazione YAML | Bassa | Alto | Sempre validare con `parsePool` prima di scrivere; non scrivere se validazione fallisce |
| Eliminazione domanda referenziata da bozza | Media | Medio | Rilevare conflitti con query su `verifications` (stato bozza) prima di rimuovere dal `questionIndex`; avvisare il docente |
| `questionCount` / `poolStatus` non sincronizzati | Media | Basso | Aggiornare `lessons/{id}.questionCount` e `poolStatus` come parte del flusso di salvataggio, non come side-effect separato |
| Dimensione pool eccede quota documento Firestore | Molto bassa | Alto | Pool con >300–400 domande causerebbe un documento `questionIndex` aggregato troppo grande se serializzato — ma `questionIndex` è strutturato come una sotto-collezione con un documento per domanda, quindi il problema non si pone nella struttura attuale |
| Regressione sul flusso import ZIP | Bassa | Alto | I test esistenti `buildImportPayload.test.ts` e `questionIndexService.test.ts` devono restare verdi; nessuna modifica al contratto Zod che non sia backward-compatible |

---

## 8. Costi Firebase

L'editor delle domande aumenta le scritture rispetto al solo import ZIP, ma i volumi restano contenuti per uso monodocente:

| Operazione | Letture Firestore | Scritture Firestore | Storage |
|---|---|---|---|
| Apri sezione Domande | O(programmi + publicLessons) | — | — |
| Apri pool di una lezione | 1 (lessons/{id}) | — | 1 GET `.pool.md` |
| Salva modifica domanda | — | 1–2 (questionIndex entry + lessons/{id}) | 1 PUT `.pool.md` |
| Elimina domanda | 1 (query verifications per blocco) | 1 (questionIndex entry) + 1 (lessons/{id}) | 1 PUT `.pool.md` |
| Crea nuovo pool | — | N (questionIndex entries) + 1 (lessons/{id}) | 1 PUT `.pool.md` |
| Elimina pool | 1 (query verifications per blocco) | N (delete questionIndex entries) + 1 (lessons/{id}) | 1 DELETE `.pool.md` |

Nessuna Cloud Function. Costo mensile stimato trascurabile per uso personale (<100 operazioni/giorno).

---

## 9. Roadmap QE-00 → QE-05

| ID | Nome | Risultato | Note |
|---|---|---|---|
| QE-00 | Specifica e roadmap | Questo documento; nessun codice runtime. | Completato. |
| QE-01 | Parser e serializzatore pool | `poolSerializer.ts`: serializza `ParsedPool` → YAML front matter da riscrivere nel file `.pool.md`. Test unitari round-trip (parse→serialize→reparse). Nessuna UI, nessuna scrittura Firebase. | Input: `packages/lesson-contract`; output: nuovo modulo `poolSerializer` nello stesso package o in `apps/web/src/features/repository/pools/`. |
| QE-02 | Service layer Domande | `poolEditorService.ts`: `loadPool(lessonId, importId)` (legge `.pool.md` da Storage, `parsePool`), `savePool(lessonId, importId, pool)` (serialize → upload Storage → update `questionIndex` + `lessons/{id}`), `deletePool(lessonId, importId)`. Guard: controlla conflitti con bozze prima di eliminare domande o pool. Test di integrazione con Emulator. | Dipende da QE-01. Riusa `fetchLessonContent` / `getBytes` già esistenti per la lettura. |
| QE-03 | UI sezione Domande | Nuova voce "Domande" nel menu docente; `DomandeView.tsx` con sidebar Corso→UDA→Lezione e indicatore conteggio/assenza pool; pannello lista domande con editMode; form inline crea/modifica domanda; eliminazione domanda/pool con conferma; messaggi blocco per conflitti bozze. | Dipende da QE-02. Riusa `LessonsView` come riferimento UX per sidebar, editMode, iconBtn. |
| QE-04 | Integrazione picker verifiche e contatori | Verifica che `listQuestionIndex` del picker veda le domande create/modificate dall'editor. Aggiorna la dashboard di prontezza (`readinessReport.ts`) con i contatori `questionCount` / `poolStatus` aggiornati dall'editor. Test di regressione sul flusso pick→activate. | Dipende da QE-03. Nessuna modifica al contratto picker; solo verifica integrazione. |
| QE-05 | Hardening e checklist DEV | Test integrazione end-to-end: crea domanda → appare nel picker → attiva verifica → modifica domanda → verifica attiva non cambia → chiudi verifica. Checklist manuale DEV (analoga a `repository-editor-checklist-manuale.md`). Aggiornamento documentazione operativa. | Dipende da QE-04. Gate di stabilità prima di nuovi sviluppi. |

---

## 10. Vincoli non negoziabili per l'implementazione

1. Il formato `.pool.md` (contratto `schoolforge-pool/v1`) non cambia con QE.
2. Nessuna Cloud Function: client + Storage/Firestore Security Rules.
3. La modifica di un pool non altera mai `publishedSnapshot` né verifiche attive/chiuse.
4. Storage-poi-Firestore in ogni operazione di scrittura; nessun partial update silenzioso.
5. Nessun pool è mai esposto allo studente (Storage Rules, Firestore Rules, proiezioni).
6. `maxPoints` è sempre calcolato (`difficolta × peso`), mai scritto nel YAML.
7. Nessuna AI, nessun riordino visuale (drag-and-drop) domande in v1.
8. L'export ZIP deve continuare a produrre il file `.pool.md` corretto dopo modifiche da editor.
