# SchoolForge — M3-full: Verifiche online e consegne studenti

**Versione:** 1.0
**Data:** 10 luglio 2026
**Stato:** in implementazione — M3F-00/M3F-01/M3F-02/M3F-03/M3F-04 completati (documentazione, tipi/indici, service layer client-only, Security Rules, UI studente flusso online); M3F-05/M3F-06 (UI docente monitor consegne, integrazione) non ancora implementati.
**Dipendenze:** M1, M2, M3-lite (tutti completati)
**Fuori scope in M3-full:** M4 (correzione/restituzione), M5 (AI), timer, anti-cheat aggressivo, tentativi multipli, allegati, voti.

---

## 1. Obiettivo

M3-full aggiunge al portale studente la possibilità di compilare e consegnare una verifica online direttamente nella SPA, senza strumenti esterni. Lo studente può salvare bozze, consegnare una sola volta per verifica e ricevere conferma con codice consegna. Il docente può monitorare lo stato delle consegne in tempo reale dalla propria dashboard.

M3-lite (login Google, portale read-only, download PDF) resta invariata e compatibile.

---

## 2. Decisioni di prodotto (formalizzate)

| # | Decisione |
|---|---|
| D-M3F-01 | M3-full è interno a SchoolForge; nessun servizio esterno (Google Forms, etc.). |
| D-M3F-02 | La verifica online è asincrona, una sola pagina con tutte le domande. |
| D-M3F-03 | Lo studente può salvare bozza in qualsiasi momento; la bozza è persistita in Firestore. |
| D-M3F-04 | La consegna finale rende la submission immutabile; nessuna modifica successiva. |
| D-M3F-05 | Dopo la consegna lo studente vede solo schermata di conferma: timestamp, titolo verifica, classe, codice consegna. Nessuna domanda né risposta è più visibile. |
| D-M3F-06 | Una sola submission per studente per verifica. Nessun tentativo multiplo in M3-full. |
| D-M3F-07 | Tipi di domanda supportati: `aperta` (textarea), `chiusa_singola` (radio), `chiusa_multipla` (checkbox). |
| D-M3F-08 | Consegna consentita anche con domande vuote, ma preceduta da alert con conteggio compilate/totali/vuote. |
| D-M3F-09 | Ogni domanda ha indicatore visivo compilata/non compilata e marcatore opzionale "da rivedere". |
| D-M3F-10 | Modalità verifica come deterrenza leggera (fullscreen, log eventi attenzione, no copy/paste). Non blocca né invalida automaticamente. |
| D-M3F-11 | Il docente vede un monitor consegne per verifica: stato per studente, ultimo salvataggio, consegnata il, eventi attenzione. |
| D-M3F-12 | Le domande online usano snapshot immutabile (`publishedProjection`) creato all'attivazione. |
| D-M3F-13 | Se il docente chiude la verifica: nessuno può iniziare; chi ha bozza non può consegnare; chi ha già consegnato resta consegnato. |

---

## 3. Modello dati proposto

### 3.1 Nuove collezioni Firestore

#### `submissions/{submissionId}`

Documento unico per (studentUid, verificationId). Creato all'avvio online; aggiornato a ogni salvataggio bozza; bloccato immutabile alla consegna.

**ID documento deterministico:** `submissionId = ${verificationId}_${studentUid}`. Questa scelta è vincolante: Firestore Security Rules non possono fare query per verificare l'unicità di `(studentUid, verificationId)` su un UUID arbitrario. L'unicità va quindi garantita dal path.

```typescript
interface SubmissionDoc {
  // identità
  submissionId: string;           // == Firestore doc id deterministico: `${verificationId}_${studentUid}`
  verificationId: string;
  studentUid: string;
  ownerUid: string;

  // stato
  status: 'draft' | 'submitted';

  // risposte (sparse: solo domande toccate)
  answers: Record<string, AnswerValue>;
  // key = order.toString() (1-based, corrisponde a PublicVerificationQuestion.order)

  // marcatori UX; restano sul documento per docente/M4 ma non sono visibili allo studente dopo la consegna
  flagged: Record<string, boolean>;  // key = order.toString()

  // eventi attenzione (deterrenza leggera)
  attentionEvents: AttentionEvent[];

  // codice consegna leggibile
  deliveryCode: string | null;       // null finché status != 'submitted'

  // timestamp
  startedAt: Timestamp;
  lastSavedAt: Timestamp;
  submittedAt: Timestamp | null;

  // snapshot classe e titolo verifica al momento dell'avvio (per la schermata di conferma)
  verificationTitle: string;
  className: string | null;
}

type AnswerValue =
  | { tipo: 'aperta'; testo: string }
  | { tipo: 'chiusa_singola'; selectedId: string | null }
  | { tipo: 'chiusa_multipla'; selectedIds: string[] };

interface AttentionEvent {
  type:
    | 'fullscreen_exit'
    | 'copy_attempt'
    | 'cut_attempt'
    | 'paste_attempt'
    | 'context_menu_attempt'
    | 'drag_attempt'
    | 'tab_blur'
    | 'window_blur'
    | 'visibility_hidden';
  ts: number; // ms epoch
}
```

**Path:** `submissions/{verificationId}_${studentUid}`

**Unicità (studentUid, verificationId):** garantita dal path deterministico. Lo studente può creare o aggiornare solo `submissions/{verificationId}_${request.auth.uid}` e i campi `verificationId`/`studentUid` devono corrispondere al path. Se riapre la pagina, il client legge direttamente quel documento: non serve query preliminare e non può creare un secondo tentativo con altro id.

> **Alternativa considerata e scartata:** `submissions/{verificationId}/students/{studentUid}` offre un path naturale, ma complica le query del monitor docente e gli indici. Il path flat deterministico mantiene query semplici per il docente e Rules verificabili con confronti su path/campi, senza query impossibili in Security Rules.

#### Indici Firestore aggiuntivi

```json
{
  "indexes": [
    {
      "collectionGroup": "submissions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "verificationId", "order": "ASCENDING" },
        { "fieldPath": "ownerUid", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "submissions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "studentUid", "order": "ASCENDING" },
        { "fieldPath": "verificationId", "order": "ASCENDING" }
      ]
    }
  ]
}
```

#### `submissionReceipts/{submissionId}`

Documento minimale leggibile dallo studente dopo la consegna. Serve a rispettare il requisito "dopo consegna non vede più domande o risposte" anche a livello tecnico: la submission `submitted` contiene le risposte ed è leggibile dal docente, mentre lo studente legge solo la ricevuta.

```typescript
interface SubmissionReceiptDoc {
  submissionId: string;       // stesso id deterministico della submission
  verificationId: string;
  studentUid: string;
  ownerUid: string;
  verificationTitle: string;
  className: string | null;
  deliveryCode: string;
  submittedAt: Timestamp;
}
```

La consegna finale deve essere una write batch client-side: update della submission a `submitted` + create/set della receipt. Le Security Rules di M3F-03 dovranno validare che lo studente possa creare solo la propria receipt, con id coerente e campi minimi consentiti.

### 3.2 Campi aggiunti a documenti esistenti

#### `verifications/{verificationId}` — campo aggiunto

```typescript
// Aggiunto a VerificationDoc
onlineEnabled: boolean; // true = la verifica accetta submission online
```

Il docente può attivare la modalità online separatamente dalla visibilità. Una verifica `active` + `public` + `onlineEnabled: true` accetta submission. La chiusura (`status: 'closed'`) disabilita implicitamente l'online (le Security Rules negano nuove submission e aggiornamenti di bozze quando `status != 'active'`).

#### `verifications/{verificationId}/publishedProjection/data` — invariato

Il documento `publishedProjection` esiste già e contiene `questions: PublicVerificationQuestion[]`. M3-full lo usa direttamente per renderizzare il questionario online; nessuna modifica alla struttura.

### 3.3 Cosa NON viene aggiunto in M3-full

- Nessun campo punteggio/correzione su `SubmissionDoc` (appartiene a M4).
- Nessun campo `feedback` o `grade` (M4).
- Nessuna Cloud Function: tutte le operazioni sono scritture client dirette con Security Rules. La consegna è una `update` con `status: 'submitted'` protetta da Rules che impediscono la sovrascrittura.
- Nessun token sessione server-side o cookie HttpOnly (la baseline prevedeva questa opzione per M3-full ma la decisione prodotto esclude anti-cheat aggressivo — le Security Rules sono il perimetro sufficiente).

---

## 4. Security Rules desiderate

> Queste sono le regole concettuali. Le regole operative verranno scritte, testate con Emulator Suite e committate nella loro milestone (M3F-03).

### 4.1 Principi

1. **Default-deny invariato.** Nessuna regola permissiva temporanea.
2. **Lo studente scrive solo le proprie submission.** `request.auth.uid == resource.data.studentUid` (o `request.resource.data.studentUid` alla creazione).
3. **Immutabilità alla consegna.** Se `resource.data.status == 'submitted'`, qualunque update è negato — anche dal proprio studente.
4. **Verifica deve essere online e aperta.** Prima di creare o aggiornare una submission, le Rules verificano che la verifica target sia `active` + `onlineEnabled == true`. Se la verifica è `closed`, le Rules negano la creazione e l'aggiornamento di bozze (non toccano le submission già `submitted`).
5. **Unicità (studentUid, verificationId).** La creazione è consentita solo sul path deterministico `submissions/{verificationId}_{request.auth.uid}`. Non si usano UUID arbitrari né query in Rules per cercare duplicati.
6. **Il docente legge tutte le submission della propria verifica.** `isOwner()` può leggere qualunque `submissions/{id}` dove `ownerUid == ownerUid`. Non può modificarle (M4 aggiungerà la correzione come campo separato).
7. **Lo studente NON legge le proprie risposte dopo la consegna.** Firestore non supporta field masking nelle Rules, quindi M3-full usa `submissionReceipts/{submissionId}` per la schermata post-consegna. Lo studente può leggere la propria submission solo finché è `draft`; dopo `submitted` legge solo la receipt. Il docente continua a leggere la submission completa.
8. **`attentionEvents` è scrivibile solo dallo studente, non dall'owner.** L'owner può solo leggere il campo aggregato nel monitor.

### 4.2 Sketch regole (pseudocodice, non definitivo)

```
match /submissions/{submissionId} {
  // Studente: può creare se autenticato, approvato, verifica active+onlineEnabled,
  //           e il path corrisponde a `${verificationId}_${uid}`
  allow create: if isApprovedStudent()
    && request.resource.data.studentUid == request.auth.uid
    && submissionId == request.resource.data.verificationId + '_' + request.auth.uid
    && request.resource.data.status == 'draft'
    && verificationIsOnlineAndActive(request.resource.data.verificationId);

  // Studente: può aggiornare solo la propria bozza, non può ri-aprire submitted
  allow update: if isApprovedStudent()
    && resource.data.studentUid == request.auth.uid
    && resource.data.status == 'draft'          // era draft
    && (request.resource.data.status == 'draft' || request.resource.data.status == 'submitted')
    && (resource.data.status == 'draft'
        ? verificationIsOnlineAndActive(resource.data.verificationId)
        : true);  // se sta consegnando, la verifica deve ancora essere active

  // Studente: può leggere la propria submission solo finché è draft.
  // Dopo submitted legge solo submissionReceipts/{submissionId}.
  allow read: if isApprovedStudent()
    && resource.data.studentUid == request.auth.uid
    && resource.data.status == 'draft';

  // Owner: può leggere tutte le submission delle proprie verifiche
  allow read: if isOwner()
    && resource.data.ownerUid == ownerUid();

  // Nessuno cancella submission (nemmeno il docente in M3-full — M4 aggiungerà l'archiviazione)
  allow delete: if false;
}

match /submissionReceipts/{submissionId} {
  allow create: if isApprovedStudent()
    && submissionId == request.resource.data.verificationId + '_' + request.auth.uid
    && request.resource.data.studentUid == request.auth.uid
    && request.resource.data.keys().hasOnly([
      'submissionId', 'verificationId', 'studentUid', 'ownerUid',
      'verificationTitle', 'className', 'deliveryCode', 'submittedAt'
    ]);

  allow read: if isApprovedStudent()
    && resource.data.studentUid == request.auth.uid;

  allow read: if isOwner()
    && resource.data.ownerUid == ownerUid();

  allow update, delete: if false;
}
```

> `verificationIsOnlineAndActive(verificationId)` richiede un `get()` cross-document sulla verifica: costoso ma necessario. Alternativa: denormalizzare `verificationStatus` e `onlineEnabled` sulla submission al momento della creazione e rifidarsi su quei campi — ma introduce derive. Si preferisce il `get()` per la correttezza, accettando il costo (1 read Firestore extra per ogni create/update).

---

## 5. Stati e transizioni

### 5.1 Stati di una submission

```
[non esiste]
    │
    │ studente avvia online (verifica active+onlineEnabled)
    ▼
  DRAFT ──────────────────────────────── studente salva bozza (rimanendo DRAFT)
    │
    │ studente consegna (alert + conferma)
    ▼
SUBMITTED (immutabile — nessuna transizione successiva in M3-full)
```

**Nota:** se la verifica viene chiusa mentre la submission è DRAFT, lo studente non può più consegnare (Rules negano l'update a SUBMITTED quando la verifica è closed). La bozza resta in Firestore ma è inaccessibile. Il monitor docente mostra lo stato `draft` anche per queste submission "orfane".

### 5.2 Stati di una verifica rispetto all'online

| `status` | `onlineEnabled` | `visibility` | Studente può avviare? | Studente con bozza può consegnare? |
|---|---|---|---|---|
| `active` | `true` | `public` | Sì | Sì |
| `active` | `true` | `hidden` | No (non vede la verifica) | No (non scopre la verifica) |
| `active` | `false` | `public` | No (vede solo download PDF) | No |
| `closed` | qualsiasi | qualsiasi | No | No |
| `draft` | qualsiasi | qualsiasi | No | No |

### 5.3 Transizioni sul lato docente

Il docente può:
- **Attivare online** (`onlineEnabled = true`) su una verifica già `active`.
- **Disattivare online** (`onlineEnabled = false`) senza chiudere la verifica — le nuove submission non vengono accettate ma le bozze esistenti restano accessibili; non possono però essere consegnate (verifica non onlineEnabled).
- **Chiudere la verifica** (`status = 'closed'`) — blocca tutto.

---

## 6. UX docente — alto livello

### 6.1 Attivazione online

In `VerificationsView`, per una verifica nello stato `active`, il docente vede un toggle o pulsante **"Abilita online"** che imposta `onlineEnabled: true`. Può anche disabilitarlo. La visibilità (`public`/`hidden`) resta separata.

### 6.2 Monitor consegne

Nuova sezione/tab nella vista dettaglio verifica. Mostra una riga per ogni studente della classe assegnata:

| Studente | Stato | Ultimo salvataggio | Consegnata il | Eventi attenzione |
|---|---|---|---|---|
| Nome Cognome | Non iniziata | — | — | — |
| Nome Cognome | In corso (bozza) | 10:32 | — | 2 |
| Nome Cognome | Consegnata | — | 10:45 | 5 |

**Polling / real-time:** il monitor usa `onSnapshot` Firestore per aggiornamenti in tempo reale. Il costo è 1 read per ogni submission aggiornata mentre il docente ha il monitor aperto.

**Codice consegna:** generato lato client al momento della consegna come stringa leggibile (es. `SF-2026-A3B7`). Appare nella colonna "Consegnata il" e nella schermata studente.

### 6.3 Chiusura verifica

Comportamento invariato rispetto a M3-lite: `closeVerification` imposta `status: 'closed'` e `visibility: 'hidden'`. In M3-full aggiunge semantica: le Rules negano automaticamente nuove submission e aggiornamenti di bozze.

---

## 7. UX studente — alto livello

### 7.1 Lista verifiche (StudentVerificationsView — estesa)

Ogni verifica che supporta online (`onlineEnabled: true`, `active`, `public`, classe corretta) mostra due pulsanti:
- **Scarica PDF** (già presente in M3-lite)
- **Svolgi online** (nuovo in M3-full)

Se lo studente ha già una submission `submitted`, mostra solo: **"Consegnata il [data] — Codice: [codice]"**. Se ha una bozza, mostra: **"Riprendi bozza"**.

### 7.2 Schermata verifica online (OnlineExamView — nuova)

Layout a pagina singola:

- **Header sticky:** titolo verifica, classe, badge "Modalità verifica", pulsante **Salva bozza**, pulsante **Consegna**.
- **Barra di progresso laterale o superiore:** indicatori per ogni domanda (compilata / non compilata / da rivedere).
- **Body:** lista verticale di domande, ciascuna con:
  - numero d'ordine e testo
  - input appropriato al tipo (`textarea` / `radio` / `checkbox`)
  - badge "Da rivedere" toggle
  - indicatore visivo stato compilazione

**Salva bozza:** scrive `answers` e `flagged` in Firestore (`status` resta `draft`). Feedback visivo (es. "Bozza salvata alle 10:32").

**Consegna:**
1. Alert: "Hai compilato X/Y domande. Z domande sono vuote. Vuoi consegnare?" con pulsante Annulla e Conferma.
2. Se Conferma: update `status: 'submitted'`, imposta `deliveryCode`, `submittedAt`.
3. Redirect a schermata di conferma.

### 7.3 Schermata di conferma (ConfirmationView)

Mostra solo:
- Titolo verifica
- Classe
- Timestamp consegna (formato `gg/mm/aaaa HH:MM`)
- Codice consegna (`SF-YYYY-XXXX`)
- Messaggio: "La tua consegna è stata registrata. Non è possibile modificarla."

Nessun link al form. Lo studente non vede più domande o risposte.

### 7.4 Modalità verifica (deterrenza leggera)

All'avvio della schermata verifica:

1. Richiesta fullscreen (`document.documentElement.requestFullscreen()`); se rifiutata o non supportata, non bloccante.
2. Listener su `fullscreenchange` → registra evento `fullscreen_exit`.
3. Listener su `document.visibilitychange` (hidden) → registra `visibility_hidden`.
4. Listener su `window.blur` → registra `tab_blur` o `window_blur`.
5. `document.addEventListener('copy', e => e.preventDefault())` — stessa logica per `cut`, `paste`, `contextmenu`, `dragstart`; registra rispettivamente `copy_attempt`, `cut_attempt`, `paste_attempt`, `context_menu_attempt`, `drag_attempt`.
6. Gli eventi vengono accumulati in memoria e scritti periodicamente su Firestore insieme al salvataggio bozza automatico (o alla consegna).

**Non implementato in M3-full:** blocco automatico della consegna, invalidazione submission, screenshot, screen recording detection, DevTools detection.

---

## 8. Roadmap M3F-00 → M3F-06

| Pacchetto | Scope | File principali | Dipendenze | DoD essenziale |
|---|---|---|---|---|
| **M3F-00** | Design e documentazione (questo documento) | `documentazione/m3-full-roadmap.md`, aggiornamenti a `INDEX.md`, `piano-implementazione.md`, `api-contract.md`, `sicurezza.md` | M3-lite completato | Documento approvato, PR draft aperta. |
| **M3F-01** | Tipi Firestore + indici | `src/types/firestore.ts` (aggiunta `SubmissionDoc`, `AnswerValue`, `AttentionEvent`), `firestore.indexes.json` | M3F-00 | Typecheck verde; indici JSON validi. |
| **M3F-02** | Service layer submission (client-only) | `src/features/student/submissionsService.ts`, test unitari | M3F-01 | Test unitari verdi; nessuna Cloud Function. |
| **M3F-03** | Security Rules submission | `firestore.rules` (aggiunta blocco `submissions`), test Rules con Emulator Suite | M3F-01 | Tutti i casi positivi e negativi da §4 coperti da test Rules. |
| **M3F-04** | UI studente — OnlineExamView + ConfirmationView | `src/features/student/OnlineExamView.tsx`, `ConfirmationView.tsx`, CSS modules, test componente | M3F-02, M3F-03 | Flusso completo: avvio → bozza → consegna → schermata conferma. Modalità verifica attiva. |
| **M3F-05** | UI docente — onlineEnabled toggle + Monitor consegne | `src/features/teacher/VerificationsView.tsx` (aggiunta toggle + monitor), test componente | M3F-02, M3F-03 | Toggle onlineEnabled funzionante; monitor mostra stati e aggiornamento real-time. |
| **M3F-06** | Integrazione, smoke test, aggiornamento evidenze | `documentazione/evidenze/m3f-checklist.md`, `documentazione/evidenze/smoke-m3f.md` | M3F-04, M3F-05 | Smoke test manuale su DEV completo; checklist gate G5 superata. |

### Gate G5 — M3-full

| Criterio | Verifica |
|---|---|
| Studente può avviare, salvare bozza e consegnare (flusso felice) | Smoke test manuale DEV |
| Consegna immutabile: nessuna modifica dopo `submitted` | Test Security Rules (M3F-03) |
| Studente dopo consegna legge solo la receipt, non la submission con risposte | Test Security Rules (M3F-03) |
| Unicità submission: un solo tentativo per studente per verifica | Test Security Rules (M3F-03) |
| Verifica chiusa blocca consegna bozze | Test Security Rules (M3F-03) |
| Monitor docente aggiorna real-time | Test componente manuale |
| Modalità verifica: eventi registrati nel documento | Test componente |
| Format check e typecheck verdi | CI |

---

## 9. Fuori scope in M3-full

I seguenti elementi sono documentati qui per chiarezza ma **non vengono implementati**:

- **Timer e scadenza automatica.** Nessun server-side timer; il docente chiude manualmente.
- **Anti-cheat aggressivo.** Nessun blocco automatico, nessuna invalidazione per eventi attenzione, nessuna detection DevTools/screenshot.
- **Tentativi multipli.** Una sola submission per (studentUid, verificationId). In futuro si potrebbe aggiungere un reset docente (M4 o feature separata).
- **Allegati.** Nessun upload file nelle risposte.
- **Voti e punteggi.** Appartengono a M4.
- **Visualizzazione risposte post-consegna.** Lo studente non vede le proprie risposte dopo la consegna (schermata di sola conferma).
- **Cloud Functions.** Tutte le operazioni sono scritture client dirette. Non ci sono operazioni che richiedono chiavi server o cookie HttpOnly in M3-full (la deterrenza leggera non è anti-cheat e non richiede server-side enforcement).
- **Email di conferma.** Nessun servizio email.
- **Export submission.** Appartiene a M4.

---

## 10. Dipendenza da M4

M4 (correzione/restituzione) dipende da M3-full perché:

- Le submission `submitted` sono i documenti su cui il docente corregge.
- M4 aggiungerà campi `scores`, `feedback`, `correctedAt` alle submission (o in una sotto-collezione separata per mantenere l'immutabilità del corpo studente).
- M4 aggiungerà un export CSV/PDF delle consegne.
- Le Security Rules di M4 dovranno permettere al docente di **scrivere** campi di correzione su `submissions/{id}` senza toccare i campi studente (`answers`, `attentionEvents`, `submittedAt`).

**Raccomandazione:** al momento della progettazione di M4, valutare se aggiungere la correzione come documento separato `submissions/{id}/corrections/data` (più pulito, evita scritture miste docente/studente sullo stesso documento) oppure come campo top-level (più semplice per le query). La scelta è rimandato a M4.

---

## 11. Rischi e costi Firebase

| Rischio | Impatto | Mitigazione |
|---|---|---|
| **Costo letture Firestore — monitor docente real-time** | `onSnapshot` su `submissions` filtrando per `verificationId` mantiene un listener aperto: ogni aggiornamento di qualunque studente genera 1 read. Con 30 studenti e salvataggi frequenti può generare centinaia di read/ora. | Limitare il polling automatico (es. autosave ogni 30s, non su ogni keystroke). Considerare un salvataggio bozza debounced a 10s. Chiudere il listener quando il docente lascia il monitor. |
| **Costo lettura cross-doc nelle Rules** | `get()` sulla verifica a ogni create/update submission = 1 read extra per operazione. | Accettabile: frequenza bassa (1 per studente per avvio + N salvataggi bozza). Alternativa: campo `verificationStatus` denormalizzato sulla submission e validato al create. |
| **Contention scrittura su submission** | Improbabile (ogni studente scrive solo il proprio documento), ma possibile in caso di doppio tab. | Il path deterministico `verificationId_studentUid` forza entrambi i tab sullo stesso documento; le Rules negano ogni tentativo con id diverso. |
| **Indici compositi** | I nuovi indici su `submissions` richiedono deploy in Firestore prima che le query funzionino in produzione. | Aggiungere a `firestore.indexes.json` in M3F-01; deployare prima dello smoke test DEV. |
| **Storage** | M3-full non usa Cloud Storage: nessun costo aggiuntivo su Storage. | — |
| **Dimensione documento submission** | `answers` e `attentionEvents` crescono nel tempo. Con 50 domande aperte (1000 char/risposta) + 100 eventi: ~60 KB per documento. Firestore limit è 1 MB. | Entro i limiti per qualunque scenario realistico. Limitare `attentionEvents` a max 200 voci (trimmare i più vecchi se superati). |
