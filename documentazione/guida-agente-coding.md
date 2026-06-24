# SchoolForge — Guida di avvio per l'agente di coding

**Versione:** 3.2
**Uso:** allegare questa guida al mandato di ogni agente.

## 1. Ordine obbligatorio di lettura

1. `documentazione/brief.md`
2. `documentazione/analisi-requisiti.md`
3. `documentazione/architettura.md`
4. `documentazione/contratto-importazione.md` e `documentazione/stati-e-invarianti.md`
5. `documentazione/api-contract.md`, `sicurezza.md`, `test-strategy.md`
6. `documentazione/piano-implementazione.md` e il pacchetto assegnato

In caso di conflitto prevalgono requisiti, architettura, contratti di dominio, piano. Una lacuna non autorizza una scelta silenziosa: l'agente la registra come blocker con opzioni e impatto.

## 2. Vincoli non negoziabili

- Un solo docente autorizzato; nessun account, ruolo o roster studente.
- Markdown e asset restano esportabili; nessun editor integrato.
- Backend Cloud Functions autorevole; client senza scritture di dominio dirette in Firestore o Storage.
- Un tentativo è limitato da verifica più nome/cognome normalizzati, mai dall'email.
- PDF cartacei ed export sono on-demand e non persistenti.
- Snapshot delle verifiche e delle consegne sono necessari alla coerenza didattica; non sono un sistema di versioning del repository.
- AI assente dai moduli M1–M4; nessun web/retrieval o generazione AI di domande.

## 3. Regole di esecuzione

L'agente lavora su un solo pacchetto del piano, verifica DoR prima di modificare file e non esegue deploy, billing, configurazione di segreti o modifiche `prod` senza autorizzazione esplicita del Docente. Usa fixture sintetiche ed Emulator Suite; non introduce dati reali nei test.

Il primo pacchetto è F-01. Il suo output è soltanto il monorepo TypeScript, qualità locale e CI senza deploy. Non implementa Firebase, dominio, UI di prodotto o integrazioni email/AI.

## 4. Handoff richiesto

Ogni consegna riporta: pacchetto, requisito coperto, file modificati, test e comandi eseguiti, risultati, confini rispettati, rischi residui, gate coinvolto e una sola prossima azione. Un test non eseguito va dichiarato; non può essere descritto come superato.
