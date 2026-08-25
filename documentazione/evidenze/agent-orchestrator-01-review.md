# AGENT-ORCHESTRATOR-01 — evidenza di review

## Stato

`IMPLEMENTATO` — adapter locale scritto e testato. Claude Code 2.1.231 è
installato e autenticato con `authMethod: claude.ai` e piano Pro; il preflight
dell'adapter è stato verificato contro il binario reale senza chiamare un
modello.

## Cosa è stato costruito

Adapter `tools/agent-orchestrator/` (Node ESM, zero dipendenze):

- `src/ports.mjs` — porte iniettate per filesystem, clock, UUID ed
  esecuzione processo; l'unica implementazione reale wrappa API standard
  di Node.
- `src/resolveBinary.mjs` — risoluzione del binario `claude`: override →
  default Windows (`%USERPROFILE%\.local\bin\claude.exe`) → fallback
  `PATH`, con path handling esplicitamente per piattaforma (non dipende
  dal sistema operativo host che esegue i test).
- `src/preflight.mjs` — blocca prima ancora di eseguire `claude` se
  `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` sono presenti; altrimenti
  ammette solo `authMethod: "claude.ai"` con `subscriptionType` in
  pro/max/team/enterprise; non espone mai email/orgId/token.
- `src/processRunner.mjs` — spawn non interattivo, timeout con kill del
  solo processo figlio, cap di stdout/stderr con troncamento esplicito.
- `src/invoke.mjs` — costruzione argomenti (`-p`, `--output-format json`,
  `--max-turns` finito, `--permission-mode` non-bypass, `--allowedTools`,
  `--session-id`/`--resume`), mai `--dangerously-skip-permissions`, mai
  `--bare`, mai un flag di modello/API; orchestrazione checkpoint
  prima/dopo l'invocazione; prompt passato su stdin, mai su argv o nel
  checkpoint (solo il suo hash SHA-256).
- `src/checkpoint.mjs` — schema chiuso e versionato
  (`schoolforge-agent-checkpoint/v1`), scrittura atomica (temp + rename)
  in `.git/schoolforge-agent/<taskId>.json`; fail-closed su chiavi
  sconosciute/mancanti, tipi errati o `manifestHash` divergente — mai
  riparato automaticamente.
- `src/classify.mjs` — cinque esiti separati (`success`,
  `explicit_quota`, `transient_error`, `permanent_error`, `interrupted`);
  quota riconosciuta solo da segnale esplicito con `retryAt` opzionale;
  timeout/crash/spawn-error sono sempre `transient_error`.
- `src/manifest.mjs` — hash SHA-256 del testo del manifest e del prompt.
- `src/cli.mjs` + `bin/agent-orchestrator.mjs` — comandi `preflight`,
  `run`, `resume`, `status`; un solo oggetto JSON su stdout per
  invocazione; `status` non invoca mai `claude`.
- `test/*.test.mjs` — 73 test `node:test`, tutti con porte finte e senza rete.

## Gate eseguiti localmente

Questa directory non è un pacchetto pnpm (nessuna modifica a
`package.json`, `pnpm-workspace.yaml` o al lockfile, come richiesto dal
contratto: né nuove dipendenze né path fuori da `allowedPaths`). I gate
richiesti dal task sono stati quindi soddisfatti così:

| Gate | Comando eseguito | Esito |
|---|---|---|
| `format` | `pnpm exec prettier --check "tools/agent-orchestrator/**/*.mjs"` e sul `README.md` | PASS |
| `lint` | `pnpm exec eslint tools/agent-orchestrator` (stessa configurazione condivisa `eslint.config.js`, non modificata) | PASS |
| `typecheck` | codice JS puro per contratto (punto 1): nessun file `.ts` aggiunto, quindi `pnpm typecheck` (`pnpm -r typecheck`) resta invariato e verde; nessun nuovo errore di tipo introdotto in nessun pacchetto esistente | PASS (invariato) |
| `unit_test` | `node --test tools/agent-orchestrator/test/*.test.mjs` | PASS — 73/73 |
| `diff_check` | `git status --porcelain` verificato manualmente: unico path nuovo `tools/agent-orchestrator/**` più i file di documentazione in `allowedPaths`; `windows-tuning-backup-2026-08-21/` non toccata | PASS |

Il repository non dichiara un gate `typecheck` dedicato per directory
esterne al workspace pnpm (`apps/*`, `packages/*`, `functions`); questa
directory resta deliberatamente fuori da quel workspace per non introdurre
nuove dipendenze né modificare `pnpm-workspace.yaml` (fuori da
`allowedPaths`).

Il gate completo del repository viene demandato alla CI della PR. Il test
locale autorevole di questo pacchetto è `node --test` sull'adapter, che non
richiede provider, rete o dipendenze aggiuntive.

## Matrice esiti / exit code

Vedi [`../../tools/agent-orchestrator/README.md`](../../tools/agent-orchestrator/README.md#matrice-esiti--exit-code)
per la tabella completa. Sintesi:

| Exit code | Esito |
|---|---|
| 0 | successo (`success`, o `preflight`/`status` ok) |
| 1 | errore d'uso della CLI |
| 2 | `explicit_quota` |
| 3 | `transient_error` |
| 4 | `permanent_error` |
| 5 | `interrupted` |
| 6 | `needs_new_session` |
| 7 | preflight non ammesso |
| 8 | checkpoint invalido/hash divergente (fail-closed) |
| 9 | checkpoint non trovato (solo `status`) |

## Cost model

- zero costo passivo: nessun processo persistente tra un comando e
  l'altro, nessun polling, nessun webhook;
- una sola invocazione `claude -p` per comando `run`/`resume` (più il
  breve `claude auth status` del preflight); nessun retry automatico
  nello stesso comando;
- nessun costo API: la presenza di credenziali API blocca l'esecuzione
  prima di qualunque spawn; l'adapter opera solo sull'abbonamento
  verificato in preflight.

## Test (sintesi)

73 test `node:test`, nessuna rete e spawn sempre iniettato via porte finte:

- **auth**: presenza `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` blocca
  prima dello spawn; `authMethod`/`subscriptionType` idonei vs non idonei;
  nessun campo sensibile (`email`, `orgId`, token) mai restituito.
- **argomenti**: nessun flag proibito emesso; `permissionMode` bypass
  rifiutato; `maxTurns` non finito/non positivo rifiutato; forma
  `--session-id` (run) vs `--resume` (resume).
- **checkpoint**: scrittura atomica senza file temporanei residui;
  fail-closed su JSON invalido, chiavi sconosciute, chiavi mancanti.
- **resume**: riuso dello stesso `sessionId`; `resume` senza sessione
  valida restituisce `needs_new_session` **senza** invocare `claude`.
- **quota**: riconosciuta solo da segnale esplicito, con conservazione di
  `retryAt` quando dichiarato; testo di rete generico senza segnale
  esplicito **non** è quota.
- **timeout**: allo scadere uccide solo il processo figlio, classificato
  `transient_error`.
- **crash**: terminazione per segnale non inviato dall'adapter è
  `transient_error`, mai quota.
- **output JSON invalido**: fail-closed come `permanent_error`.
- **limite log**: buffer stdout/stderr troncato oltre soglia, senza
  rompere classificazione o scrittura del checkpoint.
- **hash divergente**: `manifestHash` diverso da quello del checkpoint
  esistente è fail-closed, checkpoint non modificato.
- **idempotenza**: scritture ripetute dello stesso checkpoint convergono
  senza file temporanei residui; `status` è una lettura pura ripetibile
  senza effetti collaterali.

## Rischi noti / limiti residui

Vedi la sezione "Limiti residui" in
[`../../tools/agent-orchestrator/README.md`](../../tools/agent-orchestrator/README.md#limiti-residui).
In sintesi: il formato reale del segnale di usage-limit non è stato
osservato contro l'installazione locale autenticata; la validazione completa
dello schema del manifest resta
di competenza di ORCHESTRATOR-02/03; il kill del figlio non insegue
eventuali processi nipote.

## Conferme

- quattro invocazioni Claude Code tramite abbonamento Pro sono state usate
  per implementare e correggere il pacchetto; nessuna API key o fatturazione
  API è stata usata;
- il preflight reale ha eseguito soltanto `claude auth status`, senza chiamata
  al modello; tutti i test automatici usano spawn iniettati;
- nessuna lettura o scrittura Firebase;
- nessun merge, nessun deploy DEV/PROD;
- nessuna nuova dipendenza né modifica a `package.json`,
  `pnpm-workspace.yaml` o al lockfile;
- `windows-tuning-backup-2026-08-21/` non toccata;
- ORCHESTRATOR-02/03/04 e Gate GORCH **non** dichiarati completati da
  questo pacchetto.
