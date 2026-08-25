# SchoolForge — Agent Orchestrator

## 1. Obiettivo

`AGENT-ORCHESTRATOR` rende ripetibile il flusso usato nello sviluppo di
SchoolForge:

1. Codex analizza il prodotto, scrive contratto e criteri di accettazione;
2. Claude implementa su branch dedicato e apre una PR draft;
3. la CI verifica il commit;
4. Codex revisiona il diff e invia a Claude soltanto blocker dimostrabili;
5. il ciclo continua fino al gate umano, senza passaggi manuali intermedi;
6. un limite d'uso, un arresto del processo o una risposta persa non fanno
   ripartire il lavoro da zero.

Il sistema è uno strumento di sviluppo del repository. Non entra nel runtime
web o Firebase, non usa dati scolastici e non modifica DEV o PROD da solo.

## 2. Principi

- **Leggero:** GitHub è il registro durevole; nessun database, servizio o
  dashboard aggiuntivo.
- **Un solo implementatore:** Claude scrive codice; Codex definisce il
  contratto e revisiona. Nessun conflitto di ownership sui file.
- **Event-driven:** CI, nuovi commit e commenti fanno avanzare il flusso. Sono
  vietati polling stretti e agenti lasciati in attesa.
- **Idempotente:** ogni transizione è legata a task id, PR e commit SHA.
- **Fail-closed:** uno stato ambiguo, un diff fuori scope o una quota esaurita
  ferma il flusso senza merge, deploy o nuova spesa.
- **Subscription-first:** il primo adapter Claude usa Claude Code autenticato
  con l'account dell'utente. L'API pay-as-you-go è un adapter distinto e non
  può attivarsi implicitamente.
- **PROD sempre umano:** nessun agente possiede un percorso automatico verso
  il deploy PROD.

## 3. Confine di autorità

### Codex orchestratore

Può:

- leggere codice, documentazione, issue, PR e CI;
- creare roadmap, task manifest e prompt implementativi;
- revisionare il diff e classificare i rilievi;
- chiedere a Claude una correzione sullo stesso branch;
- eseguire test locali, smoke e controlli read-only;
- mergiare e distribuire **solo DEV** quando il task lo autorizza in modo
  esplicito e tutti i gate automatici sono verdi.

Non può:

- cambiare lo scope dopo l'avvio;
- trasformare un suggerimento in blocker senza evidenza;
- autorizzare costi reali, migrazioni distruttive o PROD;
- aggirare una richiesta di approvazione dell'ambiente.

### Claude implementatore

Può:

- modificare i soli path ammessi dal task manifest;
- creare commit sul branch assegnato;
- aprire o aggiornare una sola PR draft;
- eseguire gate locali e correggere i blocker di Codex.

Non può:

- mergiare o distribuire;
- creare una seconda PR per lo stesso task;
- modificare il contratto per far passare il codice;
- usare provider reali o leggere secret;
- ignorare un gate umano.

### Utente

Interviene soltanto per:

- approvare una scelta di prodotto o architettura realmente biforcante;
- giudicare una UI o un output didattico nel gate umano;
- autorizzare chiamate IA reali con costo;
- autorizzare dipendenze, permessi o migrazioni con impatto materiale;
- autorizzare il deploy PROD.

## 4. Control plane

GitHub è la fonte di verità condivisa:

- una issue per task contiene il manifest immutabile;
- una sola PR draft contiene l'implementazione;
- i commit SHA identificano esattamente ciò che è stato revisionato;
- le label rappresentano lo stato corrente;
- commenti machine-readable append-only registrano le transizioni;
- la CI esistente resta l'oracolo dei gate automatici.

Label previste:

| Label | Significato |
|---|---|
| `agent:planned` | Contratto e manifest pronti. |
| `agent:implementing` | Claude sta lavorando. |
| `agent:ci` | Implementazione in attesa della CI. |
| `agent:review` | Codex deve revisionare il commit corrente. |
| `agent:fix-required` | Esistono blocker verificati. |
| `agent:quota-wait` | Un provider ha dichiarato un limite d'uso. |
| `agent:blocked` | Serve una decisione o il limite di recovery è esaurito. |
| `gate:human` | Il lavoro automatico è completo e attende l'utente. |
| `agent:complete` | Gate previsto superato e task chiuso. |

Una label è un indice; il commento di stato è il dato autorevole.

## 5. Task manifest v1

Il manifest è YAML chiuso e vive nel corpo dell'issue:

```yaml
schema: schoolforge-agent-task/v1
taskId: MULTI-VISUAL-00
baseRef: main
objective: Definire contratto e prototipo multi-immagine.
implementer: claude
reviewer: codex
allowedPaths:
  - documentazione/**
forbiddenOperations:
  - merge
  - deploy
  - real_provider_call
  - firebase_write
requiredGates:
  - format
  - diff_check
humanGate: visual_review
maxReviewCycles: 4
devDeploy: false
prodDeploy: false
```

Chiavi sconosciute, task id riutilizzato con manifest diverso, base non
raggiungibile o wildcard che include secret rendono il task invalido.

## 6. Macchina degli stati

```text
planned
  → implementing
  → ci
  → review
      ├─ nessun blocker → gate_human | merge_dev | complete
      ├─ blocker        → fix_required → implementing
      ├─ quota          → quota_wait → stato precedente
      └─ ambiguità      → blocked
```

Ogni transizione registra almeno:

```json
{
  "schema": "schoolforge-agent-state/v1",
  "taskId": "MULTI-VISUAL-00",
  "state": "review",
  "pr": 419,
  "headSha": "...",
  "reviewCycle": 1,
  "actor": "codex",
  "previousState": "ci",
  "occurredAt": "2026-08-25T00:00:00.000Z"
}
```

Un evento per uno SHA vecchio non può modificare lo stato del task.

## 7. Protocollo di review

Codex revisiona soltanto dopo CI verde o quando la CI fallisce per un motivo
che richiede diagnosi. L'output è chiuso:

- `pass`: nessun rilievo che impedisca il gate;
- `fix_required`: elenco numerato di blocker con file, evidenza, rischio e
  criterio di chiusura;
- `blocked`: manca una decisione umana o una nuova autorizzazione.

Preferenze, refactor facoltativi e idee future non riaprono il ciclo. Sono
registrati come rischi residui. Il massimo è quattro cicli; il quinto rilievo
porta a `agent:blocked` e non avvia un'altra chiamata.

Claude riceve soltanto:

1. manifest originale;
2. SHA revisionato;
3. blocker correnti;
4. gate da rieseguire;
5. divieto di nuova PR, merge e deploy.

Non riceve l'intera cronologia conversazionale a ogni giro.

## 8. Quote, rate limit e recovery

Le quote degli abbonamenti non sono trattate come contatori affidabili: variano
con modello, lunghezza del contesto e complessità. L'orchestratore non inventa
percentuali residue e non tenta di anticipare il provider.

### Rilevazione

Entra in `quota_wait` soltanto davanti a un segnale esplicito:

- errore o exit code di rate/usage limit;
- reset time dichiarato dal provider;
- stato esplicito restituito dal client.

Un timeout, un crash o una rete assente sono `transient_error`, non quota.

### Checkpoint

Prima di ogni invocazione vengono persistiti task id, stato, PR, head SHA,
session id dell'implementatore quando disponibile e prompt hash. Dopo una
risposta viene scritto l'esito prima di invocare lo step successivo.

Il resume:

- usa la stessa sessione Claude se il client restituisce un session id valido;
- altrimenti apre una sessione nuova con manifest, PR e soli blocker correnti;
- non rigenera roadmap o branch;
- non ripete provider call o deploy già registrati;
- verifica che il PR head SHA non sia cambiato fuori dal protocollo.

### Backoff

Se il provider dichiara `retryAt`, si usa quell'istante. Altrimenti:

1. primo controllo dopo 30 minuti;
2. secondo dopo 2 ore;
3. successivi ogni 6 ore;
4. dopo 72 ore senza progresso: `agent:blocked`.

Il risveglio usa un heartbeat del task Codex, non un processo che consuma token
in attesa. È vietato eseguire Codex e Claude in parallelo sullo stesso task.

## 9. Adapter

### ORCH-01 — Claude Code subscription, preferito

- `claude` CLI installato e autenticato esplicitamente con Pro/Max;
- modalità non interattiva con output JSON;
- session id conservato per `--resume`;
- `--max-turns` finito;
- allowlist degli strumenti necessaria al task;
- nessun fallback automatico verso crediti API.

Vantaggi: usa il piano esistente e rispetta i suoi limiti. Limite: richiede il
PC acceso e un login locale; oggi il comando `claude` non è installato su
questa macchina.

### ORCH-ALT — Claude GitHub Action

Adapter facoltativo per esecuzione indipendente dal PC. Richiede una GitHub App
con permessi minimi e un secret API/Bedrock/Vertex. È fatturazione distinta
dall'abbonamento Claude e non può diventare fallback implicito di ORCH-01.

### Codex

La prima versione usa il task Codex corrente come orchestratore e reviewer,
con heartbeat per il resume. Un futuro controller esterno può usare Codex SDK;
non è necessario per il pilot.

## 10. Sicurezza e costi

- una sola esecuzione attiva per repository (`concurrency: 1`);
- branch protection e CI obbligatoria;
- nessun push diretto a `main`;
- permessi GitHub minimi e secret soltanto negli store dedicati;
- log senza prompt integrali quando contengono dati non pubblici;
- nessun `--dangerously-skip-permissions`;
- nessun auto-approve di nuove dipendenze o permessi cloud;
- nessun deploy PROD;
- nessun costo API senza `billingMode: api` nel manifest e gate umano.

Il protocollo registra numero di invocazioni, cicli e durata. Non dichiara un
costo monetario per l'uso incluso negli abbonamenti.

## 11. Roadmap

| Pacchetto | Contenuto | Gate |
|---|---|---|
| ORCHESTRATOR-00 | Contratto, stati, quota/recovery, sicurezza e pilot. | Review documentale. |
| ORCHESTRATOR-01 | Adapter Claude CLI subscription-first, parser output e checkpoint. | Simulazione senza modello. |
| ORCHESTRATOR-02 | Registro GitHub, label, commenti di stato e CI watcher. | Repository sandbox. |
| ORCHESTRATOR-03 | Ciclo Codex review → Claude fix con massimo quattro iterazioni. | Fault injection. |
| ORCHESTRATOR-04 | Pilot reale su `MULTI-VISUAL-00`, solo documentazione/prototipo. | Gate umano UI. |
| GORCH | Valutazione affidabilità, costi, recovery e qualità dei passaggi. | PASS umano. |

## 12. Pilot MULTI-VISUAL-00

Il primo task non modifica runtime, Firebase o dipendenze. Deve produrre:

- contratto per massimo tre immagini per lezione;
- compatibilità dell'immagine singola esistente;
- upload con normalizzazione server-side e limiti;
- orchestrazione «Genera lezione con immagini» a costi separati;
- prototipo desktop/mobile;
- roadmap eseguibile, cost model e rollback.

Il ciclo automatico termina a `gate:human`; solo il docente giudica il
prototipo. Il pilot non autorizza implementazione, merge runtime o deploy.

## 13. Definition of Done di ORCHESTRATOR-00

- nessuna dipendenza o file runtime modificato;
- confini Codex/Claude/utente non sovrapposti;
- task manifest e transizioni chiusi;
- quota diversa da timeout e crash;
- recovery idempotente legato a PR e SHA;
- massimo cicli e condizioni di arresto espliciti;
- API billing separato dall'abbonamento;
- PROD irraggiungibile dal ciclo automatico;
- pilot e gate umano definiti prima dell'integrazione.

## 14. Riferimenti operativi

- Codex App Server e SDK: https://learn.chatgpt.com/docs/app-server
- Claude Code CLI: https://docs.anthropic.com/en/docs/claude-code/cli-usage
- Claude Code GitHub Actions: https://code.claude.com/docs/it/github-actions

