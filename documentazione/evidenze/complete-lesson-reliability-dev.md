# Affidabilità della generazione completa — DEV

**Data:** 5 ottobre 2026

**Issue:** #514

## Diagnosi

- `aiVisualPlanAuthorize` eseguiva una proposta IA con fino a due tentativi da
  60 secondi, ma conservava il timeout predefinito della Function di 60 secondi.
- Il client Firebase delle callable visuali conservava il timeout predefinito di
  70 secondi, anche per lo slot immagini che dispone di 300 secondi lato server.
- Il dialog completo traduceva errori di mappa, pool e immagini con il mapper
  generico dei contenuti. Un `invalid_input` visuale veniva quindi mostrato come
  «Configurazione non valida» anche quando i campi iniziali erano corretti.
- La telemetria contenuti non distingueva il `kind`; autorizzazione del piano e
  generazione slot non producevano un evento terminale per gli errori noti.
- I checkpoint di corpo, mappa, pool e piano esistevano soltanto nei `ref` React
  e venivano persi chiudendo o ricaricando la pagina.

## Correzione

1. timeout server del piano immagini a 300 secondi;
2. timeout client a 330 secondi per autorizzazione e generazione slot;
3. messaggi distinti per salvataggio, mappa, domande e piano immagini, indicando
   sempre quali risultati sono già salvi;
4. eventi terminali privacy-safe con soli `kind`, `stage`, `outcome` e
   `durationMs`;
5. checkpoint `sessionStorage` di 24 ore, per singola lezione, contenente solo
   impronta del corpo, ID opachi, opzioni, costi e flag di avanzamento. Il testo
   della lezione, prompt, indicazioni e identificativi utente non sono salvati;
6. ripresa esplicita senza rigenerare le fasi concluse; checkpoint eliminato al
   completamento, se scaduto, corrotto o riferito a corpo/lezione diversi;
7. guardrail del revisore: se dichiara `unchanged`, SchoolForge conserva
   byte-per-byte la bozza base e ignora eventuali riscritture incoerenti.

## Revisore didattico

Il modello resta `gpt-5.6-luna` con contratto `lesson-review-v1`. Non vengono
cambiati modello o prompt in questa patch: Luna è il revisore qualificato dal
benchmark congelato (8/8 tuning e 4/4 holdout), mentre i lotti 6.1 non hanno
prodotto un confronto completo. La patch riduce il rischio operativo senza
confondere affidabilità e qualità didattica.

## Confini

- nessuna chiamata provider reale;
- nessuna lettura di secret;
- nessuna migrazione dati;
- nessun deploy PROD;
- il checkpoint è limitato alla stessa sessione browser e non promette una
  ripresa fra dispositivi.
