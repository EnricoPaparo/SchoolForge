# SchoolForge — Stati e invarianti di dominio

**Versione:** 3.2
**Autorità:** `analisi-requisiti.md` e `architettura.md`
**Destinatari:** M2-A, M2-D, M3-A, M4-A e relativi test

## 1. Regole generali

Il backend è l'unica autorità per le transizioni. Ogni transizione scrive audit con attore, oggetto, stato precedente, stato successivo, esito e motivazione quando richiesta. Il client non può modificare stati, lock, snapshot, punteggi o audit direttamente.

Il limite di un tentativo è la coppia `verificationId + participantKey`, dove `participantKey` deriva esclusivamente da nome e cognome dichiarati: trim, normalizzazione Unicode NFC, compressione degli spazi interni e confronto case-insensitive. Gli accenti non vengono rimossi. Firestore conserva solo `HMAC-SHA-256(participantKey, secretPerAmbiente)` nel documento lock; nome e cognome dichiarati restano nel tentativo per la consultazione del docente. Il lock non certifica l'identità.

## 2. Verifica

| Stato | Transizioni consentite | Effetto |
|---|---|---|
| `draft` | `active` | Il backend valida configurazione e disponibilità, crea il token pubblico e congela il `publishedQuestionSnapshot`. |
| `active` | `closed` | Accetta nuovi tentativi. |
| `closed` | `archived` | Blocca nuovi tentativi; quelli digitali già `in_progress` possono consegnare. |
| `archived` | nessuna | Nasconde la verifica dalle viste operative senza cancellare consegne o snapshot necessari. |

Il `publishedQuestionSnapshot` contiene domanda, opzioni, soluzione, punteggio massimo e origine delle sole domande eleggibili al momento dell'attivazione. Non è una versione del repository: è la definizione immutabile della verifica attiva. `tutte_uguali` seleziona e fissa un unico insieme dal snapshot; `tutte_diverse` usa il medesimo insieme con `schoolforge-selection/v1`: candidati ordinati per `lessonId/questionId`, HMAC-SHA-256 counter mode con `selectionSecret`, shuffle Fisher-Yates e rejection sampling. L'algoritmo soddisfa prima i minimi per difficoltà e poi completa senza duplicati; la versione dell'algoritmo è registrata nello snapshot.

## 3. Tentativi e lock

| Canale | Stati | Transizioni |
|---|---|---|
| Cartaceo | `reserved`, `sent`, `cancelled` | `reserved → sent` dopo accettazione del provider email; `reserved → cancelled` se l'invio fallisce prima dell'accettazione. |
| Digitale | `in_progress`, `submitted`, `cancelled` | `in_progress → submitted` alla consegna; `in_progress → cancelled` da docente; `submitted → cancelled` solo da docente con doppia conferma. |

- L'avvio crea in una sola transazione lock e tentativo. Se il lock esiste, il backend restituisce `PARTICIPANT_ALREADY_USED` senza inviare PDF, selezionare domande o esporre dati.
- Un errore cartaceo prima dell'accettazione dell'email cancella tentativo e lock. Dopo `sent`, il lock resta attivo.
- `cancelAttempt` richiede `confirmation: true`, motivazione e l'opzione esplicita `releaseParticipantLock`. Se la rilascia, il backend conserva l'audit, invalida il token di ripresa e consente un nuovo tentativo con lo stesso nome/cognome. Non rilascia mai il lock implicitamente.
- `deleteSubmission` rimuove dati personali, risposte e correzioni secondo i requisiti; non riapre automaticamente il limite di tentativo.

## 4. Snapshot, risposte e correzioni

Un tentativo digitale copia dal `publishedQuestionSnapshot` soltanto le domande assegnate. Alla consegna, snapshot e risposte diventano immutabili; correzione e export leggono esclusivamente questa copia.

Le risposte sono una unione discriminata:

```ts
type Answer =
  | { kind: 'text'; value: string }
  | { kind: 'optionIds'; value: string[] };
```

Le aperte usano `text`, massimo 10.000 caratteri Unicode; le chiuse usano `optionIds`. La singola richiede esattamente un ID valido dello snapshot; la multipla richiede ID validi, distinti e ordinati. Il backend accetta risposta vuota come bozza, ma rifiuta payload non coerenti alla domanda.

Il punteggio massimo è calcolato una volta all'attivazione in centesimi di punto: `roundHalfUp(100 × coefficiente_difficolta × coefficiente_peso)`. Ogni punteggio assegnato è un intero compreso tra zero e il massimo. La percentuale usa questi interi e viene arrotondata half-up a due decimali solo in visualizzazione ed export.

## 5. Invarianti verificabili

1. Una verifica attiva ha un `publishedQuestionSnapshot` valido e non modificabile.
2. Un lock attivo punta a un solo tentativo della relativa verifica.
3. Email, titolo, file name o classe non partecipano alla chiave del lock.
4. Il Portale non riceve mai soluzione, risposta corretta, punteggio assegnato, audit o campi interni dello snapshot.
5. Una consegna `submitted` non può cambiare risposta, domanda o punteggio massimo.
6. Ogni rilascio del lock richiede un'azione docente auditata; timeout, refresh e cancellazione del browser non lo rilasciano.
