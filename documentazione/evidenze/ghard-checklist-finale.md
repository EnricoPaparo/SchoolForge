# Gate GHARD — Checklist finale hardening V1

**Data:** 15 luglio 2026  
**Verdetto:** **PASS**  
**Ambito:** hardening finale della V1 SchoolForge su DEV. M5/AI escluso.

## Esito sintetico

La V1 non presenta finding P0/P1 aperti. I tre P2 iniziali di HARD-00 sono risolti:

- **HARD-F01:** runbook operativo, budget alert DEV, backup/ripristino e incident response documentati e approvati;
- **HARD-F02:** regioni DEV verificate, target PROD `europe-west8` e co-locazione formalizzati, nessuna migrazione dati DEV→PROD;
- **HARD-F03:** security header e cache policy deployati e verificati su DEV.

Sono inoltre completati il fix a11y P2 di `DialogShell` e il chunking resiliente dell'import oltre 500 mutazioni (**HARD-F06**). I residui P3 sono accettati con soglie esplicite e non bloccano il gate.

## Matrice delle evidenze

| Criterio | Esito | Tipo evidenza | Evidenza |
|---|---|---|---|
| Nessun P0/P1 aperto | PASS | Audit statico + CI | `hardening-audit-v1.md` |
| F01 operatività/costi | PASS | Human Gate + documentazione | `runbook-operativo-v1.md`, `hard-01a-human-gate.md` |
| F02 regioni/residenza | PASS | CLI + decisione docente | Firestore DEV `europe-west8`; Storage/Function DEV `us-central1`; target PROD `europe-west8`; `hard-01c-human-gate.md` |
| F03 header/cache Hosting | PASS | Test automatico + HTTP reale + smoke DEV | `hard-01b-dev-smoke.md` |
| Accessibilità P2 | PASS | Test componente + smoke manuale DEV | `hard-02a-a11y-audit.md`; `DialogShell` con Escape/focus trap/focus restore |
| Import resiliente F06 | PASS | Test unit/integration/Rules + smoke manuale DEV | HARD-02B-1/2; staging→switch atomico→cleanup chunked; import e re-import verificati |
| CI e regressioni | PASS | Automatica | pipeline verde sull'ultimo stato applicativo; il docente ha confermato tutti i test verdi |
| Flussi core DEV | PASS | Manuale docente | login docente/studente, Didattica read/write e read-only, import, verifiche online/modalità verifica, correzione/restituzione, PDF/CSV/ZIP |
| Coerenza documentale | PASS | Scan e revisione | README, INDEX, piano, architettura, sicurezza, runbook e audit riallineati |

## Rischi residui accettati

- **F04 App Check:** si rivaluta solo con traffico Function anomalo o costo osservato.
- **F05 paginazione verifiche:** si implementa solo con alcune centinaia di verifiche storiche o latenza misurata.
- **F07 banda monitor consegne:** schema separato rinviato finché il traffico reale non ne giustifica la complessità.
- **Polish a11y P3:** `aria-invalid`/`aria-describedby`, `scope="col"` e matrice AT completa restano miglioramenti non bloccanti.
- RPO resta best-effort con export manuale; la policy è esplicita nel runbook.

## Confine del verdetto

Il PASS certifica la chiusura dell'hardening della V1 e la stabilità dell'ambiente DEV secondo le evidenze disponibili. **Non autorizza** provisioning, migrazione dati o deploy PROD. Il progetto `schoolforge-prod` resta separato e non operativo finché il docente non autorizza esplicitamente quel lavoro.

## Passo successivo

Con GHARD superato, la baseline V1 è congelata. Il prossimo sviluppo è **M5 — Correzione AI**, da avviare con un pacchetto `M5-00` di contratto, cost model, privacy e UX batch prima di introdurre provider o chiamate AI.
