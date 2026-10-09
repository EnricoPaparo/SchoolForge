# SchoolForge — handoff tra account Codex

**Snapshot aggiornato:** 9 ottobre 2026. Stato applicativo del rollout dell'8 ottobre.

**Scopo:** riprendere il lavoro senza trasferire credenziali o dipendere dalla
memoria di una conversazione. Git e GitHub prevalgono sempre su questo snapshot.

## 1. Fonte di verità e stato corrente

- Repository `EnricoPaparo/SchoolForge`, branch autorevole `main`.
- Versione applicativa DEV e PROD: `c8b36d5447fdd2e4ce15d61ade846cf44efacc87`.
- Rilascio consolidato PROD: 8 ottobre 2026, 18:44 Europe/Rome; DEV allineato
  allo stesso codice applicativo, con build e dati separati per ambiente.
- PR #525/#527/#529/#531 rilasciate; CI main 37807117941 verde.
- Dettaglio di target, modelli/listini, limiti dello smoke e prove:
  [stato-release-2026-10.md](stato-release-2026-10.md).
- Nessuna PR aperta alla ricognizione iniziale del task documentale.
  Verificare nuovamente status, HEAD e PR a ogni ripresa.

## 2. Ultimo lavoro e prossimo gate

Completati i tre upgrade approvati: spiegazioni/esempi delle lezioni,
correzioni e affinamenti leggeri di mappe/immagini. Il revisore lezione usa
GPT-6.1 Sol per entrambi i profili; pool e mappa usano GPT-5.6 Luna.
Resoconti del revisore transienti con «i», anche nel completamento; portal
contenuto nel viewport e chiusura esterna senza azioni sottostanti.

Nessun deploy residuo per questo blocco. Prossimo controllo: collaudo docente
nell'uso reale dopo F5 e osservazione di errori riproducibili. Lo smoke pubblico
PROD non prova tutti i flussi autenticati. Gli esercizi svolti restano una
proposta separata non implementata, esclusa dalla generazione completa.

## 3. Autorità già stabilita

- L'orchestratore può creare branch/PR, richiedere implementazioni, revisionare
  e mergiare autonomamente quando tutti i gate sono verdi.
- Può distribuire DEV solo entro uno scope già approvato e con deploy mirato,
  smoke e rollback identificato.
- Non può distribuire PROD, eseguire provider reali, spendere budget, leggere
  secret o compiere migrazioni distruttive senza autorizzazione esplicita nel
  task corrente.
- Lo scope richiesto guida l'autonomia: una richiesta di implementazione include
  le modifiche reversibili e le verifiche necessarie. Chiarire soltanto decisioni
  materialmente fuori scope o autorizzazioni riservate all'utente.

## 4. Ruoli dopo lo switch

| Ruolo | Account/profilo locale | Compito |
|---|---|---|
| Orchestratore principale | altro account, Desktop app; profilo CLI esistente `C:\Users\Erry\.codex-account-2` | contratto, pianificazione, assegnazione, review finale, merge e DEV |
| Codex di supporto | account precedentemente usato nella Desktop app; profilo dedicato `C:\Users\Erry\.codex-schoolforge-support` | review indipendente o implementazione focalizzata su worktree separato |
| Claude Code | adapter storico in `tools/agent-orchestrator/`; account non disponibile nel flusso attuale secondo il docente | non richiesto per sviluppo o review correnti |
| Utente | gate umano | decisioni di prodotto, UI, costi reali e PROD |

Il supporto Codex e gli agenti delegati coprono implementazione e review
indipendente: un solo writer per branch/worktree. I percorsi dei profili sono
riferimenti locali, non prova di autenticazione o quota. Questo allineamento
non ha controllato login, credenziali o disponibilità degli account. Non copiare mai
`auth.json`, token o altre credenziali fra directory `CODEX_HOME`.

## 5. Regola di efficienza

Per ogni task:

1. l'orchestratore esegue una sola ricognizione e pubblica un contratto breve;
2. un solo agente implementa;
3. un secondo agente riceve soltanto diff/SHA e criteri di accettazione;
4. i blocker devono avere evidenza, rischio e criterio di chiusura;
5. preferenze e refactor non bloccanti restano rischi residui;
6. massimo quattro cicli di review;
7. quote esplicite producono checkpoint e attesa, non polling o ricostruzione.

Proporzionare il lavoro delegato al rischio e al contratto. Non presumere
disponibilità, autenticazione o quota di uno specifico modello/account; seguire
le istruzioni della sessione per le scelte di modello e mantenere indipendente
la review di architettura, race, sicurezza e accounting.

## 6. Invocare il Codex di supporto

Il wrapper `tools/agent-orchestrator/invoke-codex-support.ps1` usa il profilo
dedicato senza leggere o stampare credenziali. La modalità predefinita è
read-only ed effimera:

```powershell
pwsh -File tools/agent-orchestrator/invoke-codex-support.ps1 `
  -PromptFile C:\percorso\review-prompt.md
```

Su Windows il sandbox `read-only` del Codex CLI può impedire anche i comandi
Git di sola lettura. Per una review, il wrapper può quindi incorporare il diff
staged nel prompt prima dell'invocazione, lasciando il modello privo di accesso
alla shell:

```powershell
pwsh -File tools/agent-orchestrator/invoke-codex-support.ps1 `
  -PromptFile C:\percorso\review-prompt.md `
  -IncludeStagedDiff
```

Questa è la modalità preferita: evita una seconda ricognizione del repository e
non espone file non staged.

Per una modifica, preparare prima un worktree su un branch diverso da `main` e
autorizzare esplicitamente la scrittura:

```powershell
pwsh -File tools/agent-orchestrator/invoke-codex-support.ps1 `
  -PromptFile C:\percorso\task-prompt.md `
  -WorkingDirectory C:\percorso\worktree `
  -Sandbox workspace-write `
  -AllowWrite
```

Il wrapper accetta `workspace-write` soltanto su un worktree registrato di
SchoolForge, separato dalla checkout primaria e fermo su un branch diverso da
`main`. Non deve essere eseguito in parallelo con un altro writer sugli stessi
file.

## 7. Baseline tecnica

- Node.js 22.
- pnpm 9.15.9.
- Java 21 per gli emulatori Firebase.
- Gate CI: format, lint, typecheck, test, build e Security Rules Emulator.
- Deploy mirati: non eseguire mai `firebase deploy` privo di `--only`.
- Per PROD usare `firebase.prod.json` e seguire il runbook; l'alias da solo non
  è una protezione sufficiente.

## 8. Stato locale da preservare

La checkout principale contiene intenzionalmente file non tracciati protetti,
elencati in `AGENTS.md`. Non appartengono ai task futuri e non vanno letti,
inclusi nei commit o eliminati.

Non usare operazioni Git distruttive per ottenere una working tree vuota. Lo
stato accettabile è `main` sincronizzato più i soli path protetti.

## 9. Collaudo del passaggio

Lo switch è riuscito soltanto se il nuovo orchestratore:

1. legge `AGENTS.md` e questo handoff;
2. riferisce correttamente HEAD, PR, CI, DEV/PROD e prossimo gate senza scrivere;
3. invoca il Codex di supporto in read-only e riceve una review coerente;
4. distingue l’adapter Claude storico dal supporto Codex corrente;
5. distingue chiaramente merge autonomo, deploy DEV e autorizzazione PROD;
6. conserva intatti i path protetti.

In caso di fallimento, effettuare nuovamente il login Desktop con l'account
precedente: repository e profili CLI restano indipendenti dal logout dell'app.
