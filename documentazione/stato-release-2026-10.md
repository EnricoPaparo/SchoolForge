# SchoolForge — stato operativo e rilascio corrente

**Allineamento documentale:** 9 ottobre 2026. **Versione applicativa DEV e PROD:**
`c8b36d5447fdd2e4ce15d61ade846cf44efacc87`, pubblicata in PROD l'8 ottobre
alle 18:44 Europe/Rome. Un successivo commit solo documentale non cambia la
versione servita. Gli ambienti e i dati restano separati.

## Rilascio e prove

Il rilascio include PR #525 (upgrade didattici), #527 (calibrazione lezioni e
revisore Sol), #529 (resoconti transienti), #531 (popover e chiusura discreta).
Fonte operativa: [issue #530, prova del rollout](https://github.com/EnricoPaparo/SchoolForge/issues/530#issuecomment-6064675350).
[CI main 37807117941](https://github.com/EnricoPaparo/SchoolForge/actions/runs/37807117941)
e review dei contributi verdi.

Deploy mirato di sette target: hosting, `aiContentPreview`, `aiContentGenerate`,
`aiContentPromptExport`, `aiCorrectionPreview`, `aiCorrectionRun`,
`aiVisualPlanAuthorize`. Functions PROD in `europe-west8`; DEV in
`us-central1`. Nessun deploy di Rules, Storage o indici, nessuna migrazione,
riscrittura di materiali esistenti o chiamata IA reale durante il rollout.

Smoke rilascio: hosting 200, bundle PROD verificato byte per byte contro il
build locale, sei Functions rispondono 401 senza autenticazione, login pubblico
senza errori/warning console. **Non è un collaudo autenticato completo in PROD.**
Accettazione docente su DEV e qualificazioni reali precedenti sostengono il
rilascio; non dimostrano qualità universale né risultati di apprendimento.
Rollback documentato ai medesimi sette target della base `31c826d`, mai eseguito.

## Policy effettiva nel codice

Fonti: [risoluzione per operazione](../functions/src/aiContentCore.ts),
[profili condivisi](../functions/src/aiCorrectionModelProfile.ts),
[listini versionati](../functions/src/aiCorrectionCost.ts).

| Operazione | Economy | Quality |
|---|---|---|
| Generazione lezione | `gpt-5.6-luna` | `gpt-6.1-sol` |
| Revisione lezione | `gpt-6.1-sol` | `gpt-6.1-sol` |
| Generazione pool/mappa e proposta visuale testuale | `gpt-6-luna` | `gpt-6.1-sol` |
| Revisione pool/mappa | `gpt-5.6-luna` | `gpt-5.6-luna` |
| Correzione IA aperte | `gpt-6-luna` | `gpt-6.1-sol` |

La generazione raster delle immagini è un flusso distinto: la riga visuale
indica il modello della proposta testuale, non il motore delle immagini.
Nel client attuale pool e mappa consentono entrambi i profili; il vecchio gate
POOL-TUNE Quality-only resta una qualificazione storica del candidato di allora,
non una prova di qualità equivalente per tutti i profili e tutte le materie.
Fonte UI: [opzioni dei profili](../apps/web/src/features/repository/pools/aiContentClient.ts).
I profili restano nel run/accounting anche quando i revisori risolvono lo
stesso modello. Le coppie GPT-5.6 restano rollback espliciti, senza fallback
automatico. Kill switch e budget rimangono autorevoli; questa pagina verifica
il mapping nel codice, non esegue letture della configurazione cloud.

Tariffe registrate nel codice, USD per milione di token (non una nuova ricerca
di mercato):

| Modello/listino | Input | Cache lettura | Cache scrittura | Output |
|---|---:|---:|---:|---:|
| GPT-5.6 Luna / `v8-2026-09-26-luna-cache-standard` | 0,20 | 0,02 | 0,25 | 1,20 |
| GPT-6 Luna / `v10-2026-09-26-gpt6-luna-standard` | 0,10 | 0,01 | 0,125 | 0,50 |
| GPT-6.1 Sol / `v12-2026-09-29-gpt61-sol-standard` | 2,00 | 0,10 | 2,50 | 10,00 |

Generazione e revisione hanno stima/prenotazione e accounting separati; la UI
non promette una stima preventiva unica di tutta la pipeline. Il costo effettivo
dipende dall'uso restituito dal provider, inclusi i dettagli cache. Nei due
confronti biologici del [test #526](lesson-quality-calibration-2026-10-dev.md)
il revisore Sol costa 0,035470–0,046286 USD contro 0,005455 USD di Luna:
l'aumento è reale, quel campione limitato non stima tutti i costi futuri.

Identità attuali: `lesson-explanations-v2`, rollback
`lesson-depth-explanations-v2`, `lesson-review-v6`, `pool-specialist-v2`,
`pool_review-v4`, `concept-map-relations-v1`, `concept_map_review-v6`,
`visual-proposal-01-v8`, `visual-plan-proposal-02-v3`.
Schema feedback e prompt partecipano alle nuove richieste/stime; nessuna
migrazione dei run storici.

## Upgrade completati e comportamento docente

I tre blocchi approvati sono rilasciati: spiegazioni con passaggi motivati,
esempi e condizioni senza comprimere dettagli; correzioni con equivalenze,
credito parziale e feedback specifico; affinamenti leggeri delle relazioni
nelle mappe e dell'ancoraggio/didascalie delle immagini. Riferimento di scope:
[upgrade didattico](didactic-upgrade-2026-10-dev.md).

Revisione lezioni/pool/mappe attiva di default, disattivabile mediante switch.
La correzione conserva i suoi controlli docente e la doppia valutazione;
non restituisce risultati agli studenti automaticamente. Un errore di revisione
non viene presentato come revisione completata.

«i» mostra un breve resoconto di sola lettura per ciascuna revisione completata,
anche nelle fasi lezione/mappa/domande della generazione completa. Secondo «i»,
Escape o clic esterno chiudono soltanto il pannello; il clic esterno non attiva
comandi sottostanti. Portal fuori dal dialogo, contenimento viewport e scroll
interno. Niente pulsante Chiudi né frase di durata. Feedback transiente senza
cronologia, persistenza o chiamate IA aggiuntive; su replay il dettaglio non è
disponibile. `unchanged` conserva il contenuto senza inventare interventi.

## Confini e prossime proposte

- **Esercizi svolti non implementati:** eventuale funzione separata, visibile
  allo studente, con indicazioni opzionali del docente; esclusa dalla generazione
  completa. Richiede progettazione e autorizzazione propria.
- Versionamento/confronto delle revisioni escluso dal piano prioritario:
  niente promessa di `lessonRevisionId`, storico editoriale o ripristino versioni.
  Checkpoint tecnici/replay non sono versionamento del materiale.
- Nessuna durata obbligatoria di un'ora, autoverifica o sezione errori comuni
  obbligatoria nelle lezioni. Non reintrodurle come requisito.
- Impronta didattica comune e soglie di qualità del masterplan sono proposte,
  non un runtime implementato o una nuova autorizzazione.

Il prossimo passo operativo è osservare uso reale e collaudo docente dopo F5;
non resta un rollout DEV/PROD pendente per questi tre blocchi. Nuovi sviluppi,
provider reali, secret o futuri deploy PROD richiedono le autorizzazioni previste
in `AGENTS.md` nel task corrente.
