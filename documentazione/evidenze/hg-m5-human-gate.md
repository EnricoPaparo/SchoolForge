# HG-M5 — Human Gate provider, costi e retention

**Stato:** APPROVATO dal docente il 17 luglio 2026  
**Pacchetto tecnico:** M5-05E-1  
**Stato storico del documento:** decisioni HG approvate; la successiva chiusura di M5 e Gate G7 è registrata in [g7-m5-checklist-finale.md](g7-m5-checklist-finale.md).

## Significato dell’approvazione

Questa evidenza registrava decisioni umane vincolanti per la futura attivazione DEV. Al momento della sua approvazione non abilitava provider, API key, Secret Manager, chiamate, costi o deploy e il kill switch restava spento. Il successivo rollout è documentato separatamente nella checklist finale G7.

## Decisioni approvate

| Gate | Stato | Decisione |
| --- | --- | --- |
| HG-M5-1 | **APPROVATO** | OpenAI, Responses API, Structured Outputs obbligatori, snapshot pinned `gpt-5.4-nano-2026-03-17`; alias `gpt-5.4-nano` vietato. |
| HG-M5-2 | **APPROVATO** | Costo massimo per operazione: 250.000 micro-USD (0,25 USD), hard ceiling server-side applicato alla prenotazione conservativa comprensiva dei tentativi. |
| HG-M5-3 | **APPROVATO** | Budget giornaliero UTC: 1.000.000 micro-USD; mensile UTC: 5.000.000 micro-USD. Entrambi hard ceiling server-side. |
| HG-M5-4 | **APPROVATO** | Retention `aiCorrectionRuns`: 30 giorni tramite `expireAt` server-generated. La policy TTL reale è rinviata a M5-05E-2. |

## Modello e listino approvati

Fonte ufficiale verificata il **17 luglio 2026**: [OpenAI — GPT-5.4 nano](https://developers.openai.com/api/docs/models/gpt-5.4-nano).

- modello pinned: `gpt-5.4-nano-2026-03-17`;
- API: Responses API;
- Structured Outputs: obbligatori;
- input: 200.000 micro-USD per 1.000.000 token ($0,20/M);
- output: 1.250.000 micro-USD per 1.000.000 token ($1,25/M);
- listino corrente: `v2-2026-07-17-hg-m5`.

Il listino storico `v1-2026-07-16` resta disponibile soltanto per compatibilità tecnica. Non è una coppia valida per una nuova configurazione reale.

## Contratto esatto `settings/aiConfig`

La futura configurazione DEV deve avere tutti i campi seguenti. In M5-05E-1 non viene creato né valorizzato alcun documento reale.

```json
{
  "enabled": false,
  "provider": "openai",
  "model": "gpt-5.4-nano-2026-03-17",
  "environment": "dev",
  "limits": {
    "maxSubmissionsPerOperation": 30,
    "maxOpenQuestionsPerSubmission": 20,
    "maxEstimatedTokensPerSubmission": 10000,
    "maxEstimatedTokensPerOperation": 300000,
    "maxProviderConcurrency": 3,
    "attemptTimeoutMs": 60000,
    "maxApplicationRetries": 1
  },
  "maxOperationCostMicroUsd": 250000,
  "dailyBudgetMicroUsd": 1000000,
  "monthlyBudgetMicroUsd": 5000000,
  "configVersion": "cfg-m5-05e1-v1",
  "priceListVersion": "v2-2026-07-17-hg-m5"
}
```

Campi mancanti, tipi errati, valori non interi, negativi, zero o superiori ai ceiling rendono l’intera configurazione invalida. Modello, alias o versione listino differenti sono rifiutati. Non esiste fallback verso mock o un altro modello.

## Contratto esatto `aiBudgetLedger/{YYYY-MM}`

Il documento mensile server-only mantiene nella stessa transazione limite mensile e aggregati giornalieri:

```text
monthKey: string                       // YYYY-MM UTC
budgetMicroUsd: integer                // limite mensile validato
dailyBudgetMicroUsd: integer           // limite giornaliero validato
spentMicroUsd: integer                 // spesa mensile riconciliata
dailySpentMicroUsd: {
  [dayKey: YYYY-MM-DD]: integer        // spesa riconciliata del giorno UTC
}
reservations: {
  [requestIdOpaco]: {
    microUsd: integer
    expiresAtMs: integer
    status: "reserved" | "pending"
    dayKey: string                     // YYYY-MM-DD UTC fissato alla reserve
  }
}
updatedAt: server timestamp
```

Nel calcolo giornaliero rientrano la spesa riconciliata del `dayKey`, le prenotazioni `reserved` ancora valide e tutte le `pending`, incluse quelle scadute. Una `pending` scaduta viene addebitata prudentemente al tetto; una `reserved` scaduta viene rilasciata. La riconciliazione usa sempre `monthKey` e `dayKey` originali della prenotazione, anche oltre la mezzanotte UTC.

Il ledger contiene soltanto importi tecnici e `requestId` opachi. Non contiene UID, `submissionId`, `verificationId`, nomi, email, domande, risposte, soluzioni o feedback.

## Ordine fail-closed

Sul percorso futuro `openai`:

1. autenticazione e verifica owner;
2. lettura config, validazione integrale e kill switch;
3. classificazione e hard ceiling tecnici;
4. costruzione del grader e calcolo della prenotazione comprensiva dei tentativi;
5. hard ceiling per operazione;
6. acquisizione lease;
7. transazione atomica giornaliera + mensile;
8. `reserved → pending` gated dalla lease;
9. solo dopo, eventuale chiamata provider;
10. commit atomici, riconciliazione sul giorno/mese originali e finalizzazione run.

`operation_budget_exceeded`, `daily_budget_exceeded` e `budget_exceeded` terminano prima del provider. Il primo termina anche prima di lease e prenotazione ledger.

## Retention e prossimo gate operativo

`AI_RUN_RETENTION_DAYS = 30` determina `expireAt` tramite clock server-side iniettabile. `expireAt` da solo non elimina documenti: la policy TTL Firebase reale non è configurata né deployata da M5-05E-1.

Il prossimo pacchetto è **M5-05E-2**: Secret Manager, policy TTL reale, configurazione Firestore con `enabled=false`, deploy DEV con kill switch spento e primo smoke controllato. Ogni attivazione/costo reale richiede ancora l’esecuzione esplicita di quel pacchetto; M5 e G7 non sono superati automaticamente.
