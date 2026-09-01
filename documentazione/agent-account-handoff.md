# SchoolForge — handoff tra account Codex

**Snapshot verificato:** 1 settembre 2026

**Scopo:** trasferire il ruolo di orchestratore a un altro account Codex senza
trasferire credenziali o dipendere dalla memoria di una conversazione.

## 1. Fonte di verità e stato corrente

- Repository: `EnricoPaparo/SchoolForge`.
- Branch autorevole: `main`.
- Baseline applicativa verificata prima della PR di handoff:
  `6af0e56f6484f94fff158b733347f49300218cb2`, merge della PR `#447`
  (`fix/complete-lesson-visual-proposal-recovery`).
- PR aperte al momento dello snapshot: nessuna.
- Ultima CI su `main`: verde (`Format · Lint · Typecheck · Test · Build`).
- DEV: `https://schoolforge-dev.web.app`, operativo. Hosting e la callable
  `aiVisualPlanAuthorize` della PR #447 sono stati distribuiti in DEV.
- PROD: `https://schoolforge-prod.web.app`, operativo e separato da DEV. Le
  correzioni #445–#447 non risultano distribuite in PROD in questo snapshot.
- I due ambienti Firebase sono `schoolforge-dev` e `schoolforge-prod`; regioni,
  comandi e limiti sono nel runbook operativo.

Prima di agire, l'orchestratore deve riverificare questi dati: lo snapshot non
sostituisce Git, GitHub o lo stato Firebase corrente.

## 2. Ultimo lavoro e prossimo gate

La generazione completa della lezione orchestra contenuto, mappa concettuale,
pool di domande e immagini in profilo Quality, preservando i metadati.

Ultime tre correzioni:

1. PR #445: memoria della Function di generazione slot visuale portata a
   512 MiB, concorrenza 1 e timeout 120 secondi per evitare OOM.
2. PR #446: eliminata la race React che ripristinava una mappa concettuale
   precedente dopo il salvataggio del pool.
3. PR #447: un output visuale con soggetto lievemente troppo lungo viene
   compattato al confine provider; un run fallito non viene più presentato come
   una decisione valida «nessuna immagine»; il retry usa una nuova identità del
   piano senza rigenerare contenuto, mappa o pool.

**Prossimo gate consigliato:** smoke umano su DEV della generazione completa.
Verificare che una lezione nuova produca e conservi contenuto, mappa, pool e
immagini; in caso di errore visuale, verificare che il messaggio sia corretto e
che il retry completi soltanto gli elementi mancanti. Dopo il PASS umano si può
decidere un eventuale rollout PROD, che richiede una nuova autorizzazione
esplicita.

## 3. Autorità già stabilita

- L'orchestratore può creare branch/PR, richiedere implementazioni, revisionare
  e mergiare autonomamente quando tutti i gate sono verdi.
- Può distribuire DEV solo entro uno scope già approvato e con deploy mirato,
  smoke e rollback identificato.
- Non può distribuire PROD, eseguire provider reali, spendere budget, leggere
  secret o compiere migrazioni distruttive senza autorizzazione esplicita nel
  task corrente.
- Una richiesta di diagnosi non autorizza automaticamente un fix; una richiesta
  di implementazione include invece le normali modifiche e verifiche necessarie.

## 4. Ruoli dopo lo switch

| Ruolo | Account/profilo locale | Compito |
|---|---|---|
| Orchestratore principale | altro account, Desktop app; profilo CLI esistente `C:\Users\Erry\.codex-account-2` | contratto, pianificazione, assegnazione, review finale, merge e DEV |
| Codex di supporto | account precedentemente usato nella Desktop app; profilo dedicato `C:\Users\Erry\.codex-schoolforge-support` | review indipendente o implementazione focalizzata su worktree separato |
| Claude Code | autenticazione `claude.ai` già gestita dall'adapter in `tools/agent-orchestrator/` | implementazione focalizzata e correzioni sul branch assegnato |
| Utente | gate umano | decisioni di prodotto, UI, costi reali e PROD |

I nomi dei profili non provano l'identità dell'account. Ogni profilo deve essere
autenticato separatamente e verificato prima dello switch. Non copiare mai
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

Usare Luna per controlli meccanici e circoscritti; usare un modello più capace
solo per architettura, race, sicurezza, accounting o review ad alto rischio.

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
4. esegue il preflight Claude senza chiamare il modello;
5. distingue chiaramente merge autonomo, deploy DEV e autorizzazione PROD;
6. conserva intatti i path protetti.

In caso di fallimento, effettuare nuovamente il login Desktop con l'account
precedente: repository e profili CLI restano indipendenti dal logout dell'app.
