# C-03 — Regola didattica per l'uso della correzione automatica

**Stato:** aperta
**Owner:** Committente / Docente
**Scadenza:** prima dell'abilitazione della modalità automatica (gate G6)
**Ultima revisione:** 24 giugno 2026

---

## Contesto

La modalità automatica del Modulo 5 può assegnare e approvare correzioni senza intervento del docente. È una scelta con impatto valutativo su minori e va governata da una regola didattica esplicita: in quali casi è ammessa, con quale ambito di applicazione ed eventuale revisione umana obbligatoria. Il flag resta disabilitato per default fino a questa decisione (BR-AI-COR-01).

## Opzioni valutate

| Opzione | Pro | Contro | Impatto |
|---|---|---|---|
| Solo assistita (no automatica) | Massima governance umana | Nessun risparmio di tempo sull'approvazione | Default sicuro |
| Automatica con revisione a campione | Risparmio di tempo + controllo | Richiede definire la soglia di campionamento | Compromesso |
| Automatica piena | Massimo risparmio | Rischio valutativo elevato su minori | Sconsigliata senza vincoli forti |

## Decisione

(Da compilare. Deve fissare: ambito ammesso, eventuale revisione umana obbligatoria, criteri di disattivazione.)

- **Scelta effettuata:**
- **Data:**
- **Approvatore:**

## Conseguenze

Sblocca (o meno) il feature flag della modalità automatica. Aggiorna analisi-requisiti §15 e il gate G6.

## Revisioni

| Data | Modifica | Motivazione |
|---|---|---|
| 2026-06-24 | Creazione verbale (stato aperta) | Baseline documentale |
