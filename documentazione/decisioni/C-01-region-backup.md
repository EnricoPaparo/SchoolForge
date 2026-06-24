# C-01 — Regione Firebase, backup, RPO/RTO e responsabilità operativa

**Stato:** aperta
**Owner:** Committente / Responsabile operativo
**Scadenza:** prima del go-live del Modulo 1 in produzione (gate G1)
**Ultima revisione:** 24 giugno 2026

---

## Contesto

L'architettura (ADR-01) fissa Firebase come piattaforma ma lascia aperti i parametri di esercizio: in quale regione provisionare i servizi, con quale politica di backup, con quali obiettivi di RPO/RTO e con quale responsabile operativo. Da questa decisione dipendono il provisioning dell'ambiente `prod`, il piano di restore e la verifica di backup richiesta al gate G1.

In assenza di questa decisione, l'ambiente `prod` non può essere avviato; lo sviluppo su `dev`/`test` non è bloccato.

## Opzioni valutate

| Opzione | Pro | Contro | Impatto |
|---|---|---|---|
| Regione UE (es. `europe-west`) | Coerente con dati di minori UE/GDPR; latenza adeguata in Italia | — | Consigliata per la residenza dati |
| Regione US | Maggiore disponibilità di feature in anteprima | Residenza dati extra-UE: complica la base giuridica | Sconsigliata |
| Backup: export Firestore schedulato + protezione bucket | Recupero dati operativi; coerente con il contratto di uscita | Richiede pianificazione cron e storage di destinazione | Baseline proposta |

## Decisione

(Da compilare. Deve fissare almeno: regione, frequenza di backup, RPO, RTO, destinazione degli export, responsabile del restore.)

- **Scelta effettuata:**
- **Data:**
- **Approvatore:**
- **Parametri fissati:** regione = …; backup = …; RPO = …; RTO = …

## Conseguenze

Sblocca il provisioning `prod` e il restore drill richiesto a G1. Aggiorna i parametri citati in architettura §12.2 e nel piano §10.

## Revisioni

| Data | Modifica | Motivazione |
|---|---|---|
| 2026-06-24 | Creazione verbale (stato aperta) | Baseline documentale |
