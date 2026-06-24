# C-02 — Provider AI, condizioni contrattuali, residenza dati e consenso

**Stato:** aperta
**Owner:** Committente
**Scadenza:** prima dell'avvio del Modulo 5 (gate G5-AI)
**Ultima revisione:** 24 giugno 2026

---

## Contesto

Il Modulo 5 (generazione domande e correzione assistita) richiede un provider AI concreto. L'architettura isola ogni chiamata dietro `AiGateway` (ADR-07) e mantiene il provider non selezionato fino a questa decisione. Da C-02 dipendono: l'implementazione concreta del gateway, la residenza dei dati inviati (risposte di minori), le condizioni contrattuali e il modello di consenso (NFR-AI-02).

Finché C-02 non è `decisa`, nessuna chiamata AI reale è ammessa; i percorsi manuali (Moduli 1–4) funzionano senza AI.

## Opzioni valutate

| Opzione | Pro | Contro | Impatto |
|---|---|---|---|
| Provider con residenza dati UE e DPA | Coerente con dati di minori; base giuridica più semplice | Possibile minore scelta di modelli | Consigliata |
| Provider extra-UE | Ampia scelta di modelli | Trasferimento dati di minori extra-UE: vincoli GDPR aggiuntivi | Richiede garanzie specifiche |
| Nessun provider (rinuncia a M5) | Zero rischio dati verso terzi | Si perde la correzione assistita | Fallback sempre valido |

## Decisione

(Da compilare. Deve fissare: provider, modello/i, residenza dati, presenza di DPA, modalità e granularità del consenso del docente.)

- **Scelta effettuata:**
- **Data:**
- **Approvatore:**
- **Parametri fissati:** provider = …; residenza = …; consenso = per-verifica / per-consegna / persistente revocabile

## Conseguenze

Sblocca l'implementazione concreta di `AiGateway` e i test del Modulo 5. Aggiorna sicurezza §10 e §9.3.

## Revisioni

| Data | Modifica | Motivazione |
|---|---|---|
| 2026-06-24 | Creazione verbale (stato aperta) | Baseline documentale |
