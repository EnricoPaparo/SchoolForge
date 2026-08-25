# AGENT-ORCHESTRATOR-00 — evidenza di review

## Stato

`PENDING` — contratto scritto; integrazione non ancora installata.

## Audit dell'ambiente al 25 agosto 2026

- repository su `main` dopo PR #418;
- unica automazione GitHub presente: `.github/workflows/ci.yml`;
- nessun `AGENTS.md`, `CLAUDE.md` o workflow Claude;
- Codex è disponibile tramite l'app desktop;
- il binario dell'app non è un adapter shell autorizzato in questo ambiente;
- `claude` CLI non è installato;
- nessuna chiave Anthropic è stata cercata o letta;
- nessuna automazione possiede oggi un percorso di merge o deploy.

## Decisione proposta

Il pilot usa un'architettura subscription-first:

1. il task Codex corrente resta orchestratore e reviewer;
2. Claude Code CLI è l'implementatore locale;
3. GitHub conserva task, PR, SHA e transizioni;
4. gli heartbeat Codex risvegliano il task dopo un limite dichiarato;
5. l'adapter API/GitHub Action resta facoltativo e mai automatico.

Questa scelta minimizza infrastruttura e costi aggiuntivi, ma richiede che il
PC rimanga disponibile durante l'implementazione. Un run può dormire durante
il reset della quota senza mantenere processi o consumare token.

## Rischi da verificare in ORCHESTRATOR-01

1. Il login Claude Code deve usare esplicitamente il piano desiderato e non
   passare a crediti API senza consenso.
2. L'output non interattivo deve fornire un session id riprendibile e un exit
   status distinguibile per quota, transient error e errore permanente.
3. Il processo Claude non deve avere permessi di merge, deploy o lettura dei
   secret.
4. La shell Windows e il worktree devono conservare correttamente sessione e
   branch dopo sospensione o riavvio.
5. Il heartbeat deve limitarsi a riprendere uno stato persistito, non
   ricostruire il task dalla memoria della chat.

## Gate umano GORCH-00

Per passare servono queste conferme:

- il confine di autorità è corretto;
- massimo quattro cicli di review è accettabile;
- DEV può essere mergiato/distribuito automaticamente solo quando il manifest
  lo autorizza;
- PROD, provider reali, dipendenze e migrazioni restano gate umani;
- il pilot `MULTI-VISUAL-00` può fermarsi alla review del prototipo.

## Azioni non eseguite

- nessuna installazione;
- nessun login Claude;
- nessuna chiamata Codex o Claude aggiuntiva;
- nessuna GitHub App o secret;
- nessuna nuova GitHub Action;
- nessun merge o deploy.

