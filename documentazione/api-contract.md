# SchoolForge — Contratto API

**Stato:** contratto logico pre-implementazione
**Autorità:** requisiti v3.0 e architettura v3.1

## 1. Convenzioni

Le API sono Cloud Functions v2. Le operazioni docente richiedono Firebase ID token e controllo server-side di `ownerUid`. Le operazioni Portale richiedono il token pubblico della verifica e, per bozze/consegne, il token opaco del tentativo. Nessun endpoint usa l'email come credenziale.

Ogni risposta usa:

```json
{ "requestId": "…", "data": {}, "error": null }
```

Gli errori di dominio usano almeno `VALIDATION_FAILED`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_STATE`, `RECIPIENT_ALREADY_USED`, `RATE_LIMITED`, `DELIVERY_FAILED` e `CONFIRMATION_REQUIRED`.

Le operazioni irreversibili richiedono `confirmation: true`: commit import, attivazione/chiusura/archiviazione verifica, eliminazione consegna e abilitazione automatica AI.

## 2. Sessione e repository

| Operazione | Attore | Esito |
|---|---|---|
| `getSession` | Docente | Owner, feature flag e ambiente. |
| `stageImport` / `previewImport` / `commitImport` | Docente | Staging, errori strutturati, promozione Markdown/asset. |
| `listPrograms`, `saveProgram`, `saveUda`, `listLessons` | Docente | Gestione struttura didattica. |
| `replaceContent`, `deleteContent` | Docente | Sostituzione/eliminazione auditata. |
| `exportRepository`, `exportProgrammaSvolto` | Docente | Download on-demand. |

## 3. Verifiche e canale cartaceo

| Operazione | Attore | Esito |
|---|---|---|
| `createVerificationDraft`, `updateVerificationDraft` | Docente | Bozza validabile. |
| `activateVerification`, `closeVerification`, `archiveVerification` | Docente | Transizione stato auditata. |
| `generateTeacherPdf` | Docente | Stream PDF senza persistenza. |
| `getPublicVerification` | Portale | Proiezione pubblica della verifica attiva. |
| `startPaperDelivery` | Portale | Lock recapito, PDF effimero e richiesta MailGateway. |

`startPaperDelivery` non restituisce il PDF al browser studente. Restituisce solo conferma o errore esplicito. Un secondo recapito normalizzato per la stessa verifica riceve `RECIPIENT_ALREADY_USED`.

## 4. Portale digitale

| Operazione | Attore | Esito |
|---|---|---|
| `startDigitalAttempt` | Portale | Lock, snapshot privato e token di ripresa. |
| `getAttempt` | Portale | Proiezione studente dello snapshot, senza soluzioni. |
| `saveDraft` | Portale | Bozza del medesimo tentativo. |
| `submitAttempt` | Portale | Consegna immutabile. |

Il token di ripresa è gestito come cookie sicuro dal Portale; non deve comparire in URL, log o payload esportati.

## 5. Correzione ed export

| Operazione | Attore | Esito |
|---|---|---|
| `listSubmissions`, `getSubmission` | Docente | Consultazione filtrata delle consegne digitali. |
| `setItemScore`, `rectifyScore` | Docente | Punteggi, commenti e audit. |
| `deleteSubmission` | Docente | Eliminazione dati personali e audit non identificativo. |
| `exportCompletedVerifications` | Docente | Unico documento da tutte le consegne definitive e snapshot. |

## 6. AI futura

`proposeCorrection`, `approveCorrection` e `bulkApproveCorrections` restano disabilitate finché C-02 non è approvata. `enableAutomaticCorrection` richiede anche C-03 e conferma esplicita per la verifica interessata.

## 7. Versionamento

Gli endpoint sono versionati sotto `/v1`. Cambi incompatibili richiedono nuova versione oppure compatibilità temporanea. Payload pubblici non espongono mai soluzioni, punteggi corretti o configurazioni interne.
