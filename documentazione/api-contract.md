# SchoolForge — Contratto API

**Versione:** 3.2
**Stato:** contratto logico e di payload pre-implementazione
**Autorità:** requisiti v3.2, architettura v3.2, stati e invarianti

## 1. Convenzioni

Le API sono Cloud Functions v2 sotto `/v1`. Le operazioni docente richiedono Firebase ID token e controllo server-side di `ownerUid`. Le operazioni Portale richiedono il token pubblico della verifica e, per bozze/consegne, il token opaco del tentativo. Nessun endpoint usa nome, cognome o email come credenziale.

Ogni risposta usa:

```json
{ "requestId": "…", "data": {}, "error": null }
```

Un errore è `{ "code": "…", "message": "…", "details": {} }`. I codici minimi sono `VALIDATION_FAILED`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_STATE`, `PARTICIPANT_ALREADY_USED`, `RATE_LIMITED`, `DELIVERY_FAILED`, `CONFIRMATION_REQUIRED` e `ATTEMPT_TOKEN_INVALID`.

Operazioni irreversibili richiedono `confirmation: true`: commit import, attivazione/chiusura/archiviazione verifica, annullamento tentativo, eliminazione consegna e abilitazione AI automatica. Il backend genera `requestId`, audit e idempotency key; il client non fornisce valori di stato o audit.

## 2. Tipi condivisi

```ts
type DeclaredStudent = {
  firstName: string;
  lastName: string;
  email: string;
  className?: string;
};

type Answer =
  | { kind: 'text'; value: string }
  | { kind: 'optionIds'; value: string[] };

type Confirmation = { confirmation: true };
```

`firstName` e `lastName` sono richiesti, Unicode NFC, con spazi esterni rimossi e spazi interni compressi prima della costruzione del participant key. `email` resta obbligatoria nel payload corrente per coerenza del dato dichiarato, ma è usata esclusivamente per il canale cartaceo e non entra nel lock. Il package condiviso esporta schema runtime e tipi TypeScript identici; non sono ammessi tipi duplicati tra frontend e backend.

## 3. Sessione e repository

| Operazione | Attore | Input essenziale | Esito |
|---|---|---|---|
| `getSession`, `getOwnerSettings` | Docente | — | Owner, feature flag, ambiente. |
| `stageImport` | Docente | metadati file, contenuti dichiarati | `importId`, URL temporanei e limiti. |
| `previewImport` | Docente | `importId` | Anteprima, errori strutturati, conteggi. |
| `commitImport` | Docente | `importId`, `confirmation` | Snapshot tecnico attivo e audit. |
| `replaceContent`, `deleteContent` | Docente | ID stabile, `confirmation` quando distruttivo | Operazione auditata. |
| `exportRepository`, `exportProgrammaSvolto` | Docente | filtri consentiti | Download on-demand. |
| `getReadinessDashboard`, `downloadRepositoryTemplate` | Docente | `programId` per dashboard | Stato di prontezza / ZIP template. |

`previewImport` restituisce ogni errore con `path`, `phase`, `code` e `message`. `commitImport` rifiuta un manifesto, UDA o lezione invalidi; un pool invalido è riportato ma non blocca la lezione.

## 4. Verifiche e canale cartaceo

| Operazione | Attore | Input essenziale | Esito |
|---|---|---|---|
| `createVerificationDraft`, `updateVerificationDraft` | Docente | configurazione e fonti | Bozza validabile. |
| `activateVerification`, `closeVerification`, `archiveVerification` | Docente | `verificationId`, `confirmation` | Transizione auditata. |
| `generateTeacherPdf` | Docente | `verificationId` | Stream PDF senza persistenza. |
| `getPublicVerification` | Portale | token pubblico | Proiezione minima della verifica attiva. |
| `startPaperDelivery` | Portale | token pubblico, `DeclaredStudent` | Participant lock, PDF effimero e richiesta MailGateway. |

`activateVerification` salva `publishedQuestionSnapshot`; non legge più Markdown o pool correnti nelle generazioni della verifica attiva. `startPaperDelivery` non restituisce il PDF al browser studente. Un lock già esistente restituisce `PARTICIPANT_ALREADY_USED` e non deve chiamare il renderer o il provider email.

## 5. Portale digitale

| Operazione | Attore | Input essenziale | Esito |
|---|---|---|---|
| `startDigitalAttempt` | Portale | token pubblico, `DeclaredStudent` | Lock, snapshot privato e cookie di ripresa. |
| `getAttempt` | Portale | cookie token | Proiezione studente dello snapshot, senza soluzioni. |
| `saveDraft` | Portale | cookie token, `itemId`, `Answer` | Bozza del medesimo tentativo. |
| `submitAttempt` | Portale | cookie token, `confirmation` | Consegna immutabile. |

Il token di ripresa è gestito come cookie di sessione `Secure`, `HttpOnly`, `SameSite=Strict`; non compare in URL, log o payload esportati. `saveDraft` rifiuta risposte incompatibili con tipo/opzioni dello snapshot e non crea mai un secondo tentativo.

## 6. Correzione, annullamento ed export

| Operazione | Attore | Input essenziale | Esito |
|---|---|---|---|
| `listSubmissions`, `getSubmission` | Docente | filtri dichiarati / `attemptId` | Consultazione delle consegne digitali. |
| `setItemScore`, `rectifyScore` | Docente | `attemptId`, `itemId`, centesimi, commento | Punteggi, percentuale e audit. |
| `cancelAttempt` | Docente | `attemptId`, motivazione, `releaseParticipantLock`, `confirmation`, `finalConfirmation` se `submitted` | Stato `cancelled`, token invalidato e rilascio lock solo esplicito. |
| `deleteSubmission` | Docente | `attemptId`, motivazione, `confirmation` | Rimozione dati personali e audit non identificativo; lock invariato. |
| `exportCompletedVerifications` | Docente | — | Unico documento da tutte le consegne definitive e snapshot. |

Punteggi e massimi viaggiano come interi `pointsCenti`; la UI converte esclusivamente per visualizzazione. Il backend rifiuta punteggi minori di zero o maggiori del massimo dello snapshot.

## 7. Limiti pubblici e idempotenza

Il backend applica finestre fisse per token verifica e impronta IP HMAC: 60 letture pubbliche in 15 minuti, 5 avvii tentativo in 15 minuti e 120 salvataggi bozza in 15 minuti. I contatori Firestore hanno TTL di 24 ore e vengono valutati prima di operazioni costose. I limiti sono soglie protettive iniziali; ogni modifica richiede aggiornamento di test, documentazione e valutazione del costo.

`startPaperDelivery` usa come idempotency key l'ID del tentativo. Retry di rete sulla stessa richiesta restituiscono l'esito già noto e non generano un secondo invio. `startDigitalAttempt` crea lock e tentativo in una transazione Firestore.

## 8. AI futura e compatibilità

`proposeCorrection`, `approveCorrection` e `bulkApproveCorrections` restano disabilitate finché C-02 non è approvata. `enableAutomaticCorrection` richiede anche C-03 e conferma esplicita per la verifica interessata.

Cambi incompatibili richiedono una nuova versione `/v2` oppure compatibilità temporanea documentata. Payload pubblici non espongono mai soluzioni, opzioni corrette, punteggi assegnati, audit o configurazioni interne.
