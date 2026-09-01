# SchoolForge — istruzioni per gli agenti

Queste istruzioni valgono per l'intero repository.

## Avvio obbligatorio

Prima di pianificare o modificare codice, leggere:

1. `documentazione/agent-account-handoff.md` per stato operativo, autorità e
   prossimo gate;
2. `documentazione/agent-orchestrator-roadmap.md` per il protocollo tra agenti;
3. `documentazione/runbook-operativo-v1.md` prima di qualunque deploy.

Verificare sempre `git status --short --branch`, `git log -1` e le PR aperte.
Lo stato osservato nel repository prevale su uno snapshot datato del handoff.

## Confini permanenti

- PROD richiede sempre un'autorizzazione esplicita dell'utente nel task
  corrente. Non dedurla da autorizzazioni passate.
- Chiamate provider IA reali, consumo di budget, migrazioni distruttive e
  lettura di secret richiedono autorizzazione esplicita.
- Il merge può essere eseguito autonomamente quando scope, review indipendente,
  gate locali proporzionati e CI sono verdi.
- Un deploy DEV è ammesso solo quando rientra nel task approvato; deve essere
  mirato ai componenti modificati e seguito da smoke.
- Non usare `git reset --hard`, `git checkout --` o altre operazioni distruttive
  per ripulire modifiche non proprie.

## File locali protetti

Non leggere, modificare, spostare, includere nei commit o eliminare:

- `.tmp-codex2-mv03a-result.md`
- `.tmp-multi-visual-03a-closure.md`
- `.tmp-multi-visual-03a-issue.md`
- `.tmp-multi-visual-03a-prompt.md`
- `.tmp-multi-visual-03a-resume.md`
- `.tmp-multi-visual-03a-reviewfix.md`
- `.tmp-multi-visual-03a-reviewfix2.md`
- `windows-tuning-backup-2026-08-21/`

Questi path sono intenzionalmente non tracciati e non rendono sporco il lavoro
dell'agente.

## Metodo di lavoro

- Un solo agente scrive su un branch o worktree; gli altri revisionano in
  lettura o lavorano su worktree distinti.
- Riutilizzare issue, branch e PR esistenti. Non creare una seconda PR per lo
  stesso task.
- Passare agli agenti soltanto contratto, SHA corrente, blocker dimostrabili e
  gate richiesti; non ripetere l'intera cronologia.
- Dopo massimo quattro cicli di review senza convergenza, fermarsi e presentare
  la causa invece di continuare il rimbalzo.
- Durante una vera attesa comunicare una sola volta: motivo, fase/commit/PR e
  prossimo evento. Non inviare aggiornamenti duplicati a stato invariato.

## Gate tecnici

La baseline della CI è Node.js 22, pnpm 9.15.9 e Java 21. Il gate completo è:

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:rules
git diff --check
```

Per modifiche ristrette sono ammessi test mirati durante lo sviluppo, ma CI e
review devono coprire il rischio prima del merge.
