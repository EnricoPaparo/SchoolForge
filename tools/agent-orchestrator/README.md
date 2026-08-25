# SchoolForge — Agent Orchestrator, adapter Claude Code (ORCHESTRATOR-01)

Adapter locale, senza dipendenze, che invoca `claude` (Claude Code CLI,
autenticato con abbonamento `claude.ai`) in modo non interattivo e
riprendibile. Implementa il contratto ORCH-01 descritto in
[`../../documentazione/agent-orchestrator-roadmap.md`](../../documentazione/agent-orchestrator-roadmap.md).

Non è un servizio: ogni comando è una singola esecuzione one-shot che
termina con un oggetto JSON su stdout e un exit code chiuso. Non fa
polling, non resta in ascolto, non tocca Firebase, non legge secret, non
mergia e non distribuisce.

## Requisiti

- Node.js con supporto ESM e `node:test` (già presente nel repository).
- `claude` CLI installato e autenticato **esplicitamente** con un piano
  `claude.ai` (Pro/Max/Team/Enterprise). Nessuna installazione o login è
  eseguita da questo adapter.
- Nessuna dipendenza npm: solo API standard di Node (`node:fs/promises`,
  `node:child_process`, `node:crypto`, `node:path`, `node:process`,
  `node:timers`, `node:buffer`).

## Risoluzione del binario `claude`

Ordine di risoluzione (`src/resolveBinary.mjs`):

1. override esplicito (`--claude-bin` sulla CLI);
2. default Windows `%USERPROFILE%\.local\bin\claude.exe` (o
   `$HOME/.local/bin/claude` su POSIX, usato per sviluppo/test incrociato);
3. fallback: ricerca nelle directory di `PATH`/`Path`.

Se nessun candidato esiste sul filesystem, l'adapter fallisce chiuso
(`binary_not_found`) senza tentare download, installazione o fallback API.

## Preflight (`claude auth status`)

Prima di ogni invocazione:

1. se `ANTHROPIC_API_KEY` o `ANTHROPIC_AUTH_TOKEN` sono presenti
   nell'ambiente, l'adapter rifiuta **senza mai eseguire `claude`**
   (`api_credentials_present`) — evita che un abbonamento scivoli
   implicitamente su crediti API a pagamento;
2. altrimenti esegue `claude auth status` (che restituisce JSON) e ammette
   solo `loggedIn === true`, `authMethod === "claude.ai"` con
   `subscriptionType` in `pro`/`max`/`team`/`enterprise`;
3. il risultato del preflight non include mai email, `orgId`, token o altri
   campi di credenziale, anche se presenti nell'output di `claude`.

## Invocazione

`buildInvocationArgs` (`src/invoke.mjs`) costruisce sempre lo stesso
scheletro non interattivo:

```
claude -p --output-format json --max-turns <n> \
  --permission-mode <default|acceptEdits|plan> \
  --allowedTools <tool1,tool2,...> \
  --session-id <uuid>      # run
  --resume <sessionId>     # resume
```

Il prompt **non è mai passato su argv**: viene scritto su stdin del
processo figlio e mai persistito in chiaro — solo il suo SHA-256
(`promptHash`) finisce nel checkpoint o nei log.

Sono vietati per costruzione (mai presenti, indipendentemente
dall'input): `--dangerously-skip-permissions`, `--bare`, `--model`,
`--api-key`. Un `permissionMode` di tipo bypass viene rifiutato prima di
costruire gli argomenti.

Timeout, cap di stdout/stderr (troncati con marcatore, mai il prompt) e
kill sono gestiti da `src/processRunner.mjs`: allo scadere del timeout o su
interruzione (`SIGINT`/`SIGTERM` del processo host) viene ucciso **solo il
processo figlio** spawnato, mai un albero di processi o processi terzi.

## Checkpoint

Percorso: `.git/schoolforge-agent/<taskId>.json` nella working copy target
(`--repo-root`). Scrittura atomica: file temporaneo `<taskId>.json.tmp-<uuid>`
seguito da `rename` sul percorso finale.

Schema chiuso (`schoolforge-agent-checkpoint/v1`):

| Campo | Tipo | Note |
|---|---|---|
| `schema` | string | sempre `schoolforge-agent-checkpoint/v1` |
| `taskId` | string | id del task |
| `manifestHash` | string | SHA-256 hex del testo del manifest |
| `state` | enum | vedi macchina degli stati sotto |
| `previousState` | enum \| null | stato precedente alla transizione |
| `branch` | string \| null | pass-through fornito dal controller |
| `pr` | integer \| null | pass-through fornito dal controller |
| `headSha` | string \| null | pass-through fornito dal controller |
| `sessionId` | string \| null | sessione Claude corrente/riprendibile |
| `promptHash` | string \| null | SHA-256 hex dell'ultimo prompt, mai il testo |
| `invocationCount` | integer | numero di invocazioni eseguite |
| `reviewCycle` | integer | riservato ai pacchetti successivi |
| `retryCount` | integer | incrementato su `transient_error`/`explicit_quota` |
| `retryAt` | string \| null | ISO 8601, se dichiarato dal provider |
| `lastOutcome` | enum \| null | ultimo esito classificato |
| `updatedAt` | string | ISO 8601 dell'ultima scrittura |

Un checkpoint che non rispetta esattamente questo schema (chiavi
sconosciute, chiavi mancanti, tipi errati) è **fail-closed**: viene
segnalato e non viene mai riparato o riscritto automaticamente. Lo stesso
vale per un `manifestHash` che diverge da quello atteso dalla chiamata
corrente.

### Macchina degli stati (adapter locale)

Questo adapter opera all'interno di `implementing` e vi transita solo
verso `quota_wait` o `blocked`; gli altri stati della macchina completa
(`planned`, `ci`, `review`, `fix_required`, `gate_human`, `merge_dev`,
`complete`) sono di competenza di ORCHESTRATOR-02/03 e sono accettati in
lettura per riusare lo stesso file.

| Esito invocazione | Transizione di stato | Altri effetti |
|---|---|---|
| `success` | invariato | `lastOutcome = success` |
| `explicit_quota` | → `quota_wait` (con `previousState`) | `retryCount += 1`, `retryAt` se dichiarato |
| `transient_error` | invariato | `retryCount += 1` |
| `permanent_error` | → `blocked` (con `previousState`) | nessun retry automatico |
| `interrupted` | invariato | nessun retry automatico; resume esplicito richiesto |

## Classificazione degli esiti

`src/classify.mjs` distingue cinque esiti, mai dedotti implicitamente da un
solo segnale:

- **`success`**: exit 0, JSON valido, nessun errore applicativo dichiarato;
- **`explicit_quota`**: **solo** su un segnale esplicito (frase di limite
  d'uso/rate limit riconosciuta nel risultato o in stderr, con
  `is_error`/exit non-zero); se il messaggio dichiara un orario di reset,
  viene conservato in `retryAt`;
- **`transient_error`**: timeout, spawn fallito, o crash (il processo
  termina per un segnale che l'adapter non ha inviato). Un timeout, una
  rete assente o un crash **non sono mai** trattati come quota;
- **`permanent_error`**: un errore applicativo dichiarato esplicitamente da
  Claude (non di quota), oppure un output non parsabile come JSON
  (fail-closed: non è sicuro dedurre altro da un output rotto);
- **`interrupted`**: l'host ha ricevuto `SIGINT`/`SIGTERM` e ha ucciso
  deliberatamente il processo figlio; distinto sia dal timeout sia dal
  crash.

## Resume

`resume` richiede un checkpoint esistente con `sessionId` non nullo e con
lo stesso `manifestHash` della chiamata corrente. Se manca o è nullo,
l'adapter restituisce l'esito tipizzato `needs_new_session` **senza
invocare `claude`**: la decisione di aprire una sessione nuova spetta al
controller (ORCHESTRATOR-02/03), non a questo comando. Il comando `run` su
un task che ha già una sessione attiva restituisce `active_session_exists`
per lo stesso motivo simmetrico.

## CLI

```
node bin/agent-orchestrator.mjs preflight [--claude-bin <path>]

node bin/agent-orchestrator.mjs status \
  --repo-root <path> --task-id <id>

node bin/agent-orchestrator.mjs run \
  --repo-root <path> --task-id <id> \
  --manifest-file <path> --prompt-file <path> \
  --allowed-tools <tool1,tool2,...> --max-turns <n> \
  [--permission-mode default|acceptEdits|plan] \
  [--timeout-ms <n>] [--claude-bin <path>] \
  [--branch <name>] [--pr <n>] [--head-sha <sha>]

node bin/agent-orchestrator.mjs resume \
  --repo-root <path> --task-id <id> \
  --manifest-file <path> --prompt-file <path> \
  --allowed-tools <tool1,tool2,...> --max-turns <n> \
  [--permission-mode default|acceptEdits|plan] \
  [--timeout-ms <n>] [--claude-bin <path>]
```

`status` **non invoca mai `claude`**: legge solo il checkpoint. Ogni
comando stampa un unico oggetto JSON su stdout (schema
`schoolforge-agent-orchestrator-cli/v1`) e termina con uno degli exit code
seguenti.

### Matrice esiti / exit code

| Exit code | Significato | Comandi |
|---|---|---|
| 0 | `SUCCESS` — esito `success`, oppure preflight/status ok | tutti |
| 1 | `USAGE_ERROR` — argomenti CLI invalidi, opzioni di invocazione invalide, o `run` con sessione già attiva | tutti |
| 2 | `EXPLICIT_QUOTA` — esito `explicit_quota` | `run`, `resume` |
| 3 | `TRANSIENT_ERROR` — esito `transient_error` (timeout, crash, spawn fallito) | `run`, `resume` |
| 4 | `PERMANENT_ERROR` — esito `permanent_error` (errore applicativo o JSON invalido) | `run`, `resume` |
| 5 | `INTERRUPTED` — esito `interrupted` (kill volontario del solo figlio) | `run`, `resume` |
| 6 | `NEEDS_NEW_SESSION` — `resume` senza sessione valida nel checkpoint | `resume` |
| 7 | `PREFLIGHT_FAILED` — preflight non ammesso (credenziali API, auth non idonea, binario assente, ecc.) | `preflight`, `run`, `resume` |
| 8 | `CHECKPOINT_INVALID` — checkpoint malformato o `manifestHash` divergente (fail-closed, mai riparato) | `status`, `run`, `resume` |
| 9 | `CHECKPOINT_NOT_FOUND` | `status` |

## Cost model

- **Zero costo passivo**: nessun processo resta in esecuzione tra un
  comando e l'altro; nessun polling, nessun timer server-side, nessun
  webhook.
- **Una invocazione per step**: ogni `run`/`resume` esegue **al più un**
  processo `claude` (più, per il preflight, un secondo processo breve
  `claude auth status`). Non ci sono retry automatici nello stesso
  comando: un esito non-`success` termina il comando e restituisce il
  controllo al chiamante.
- **Nessun costo API**: l'adapter opera esclusivamente sull'abbonamento
  `claude.ai` verificato in preflight; la presenza di credenziali API
  blocca l'esecuzione prima di qualunque chiamata.

## Limiti residui

1. Il formato esatto del segnale di "usage limit" di `claude -p
   --output-format json` non è ancora stato osservato sull'installazione
   locale autenticata. Il riconoscimento in `src/classify.mjs` è centralizzato in
   una lista di frasi esplicite e va corretto da un solo punto non appena
   si osserva un output reale, senza toccare i chiamanti.
2. La validazione dello schema del task manifest (chiavi sconosciute,
   wildcard su secret, ecc. — roadmap §5) è delegata al controller
   GitHub-facing (ORCHESTRATOR-02/03); questo adapter calcola solo lo
   SHA-256 del testo del manifest per rilevare divergenze contro il
   checkpoint.
3. Il kill del processo figlio usa `child.kill()`: se `claude` dovesse
   creare a sua volta processi figli propri su Windows, questo adapter non
   li insegue (per contratto uccide solo il processo che ha spawnato, mai
   un albero o processi terzi).
4. `resolveClaudeBinary` non verifica che il file trovato sia eseguibile o
   sia realmente `claude`: si limita a un controllo di esistenza sul
   filesystem, coerente con l'assenza di un binario reale in questo
   ambiente di sviluppo.
5. Questa directory non è un pacchetto pnpm (nessuna modifica a
   `package.json`/`pnpm-workspace.yaml`/lockfile, come richiesto dal
   contratto). I gate `format`/`lint` la coprono tramite i comandi globali
   di repository (`prettier`, `eslint .`); i gate `typecheck`/`unit_test`
   sono eseguiti localmente con `node --test` perché il codice è
   volutamente JavaScript puro, senza tipi — vedi
   [`../../documentazione/evidenze/agent-orchestrator-01-review.md`](../../documentazione/evidenze/agent-orchestrator-01-review.md)
   per il dettaglio di come ciascun gate richiesto dal task è stato
   soddisfatto.
