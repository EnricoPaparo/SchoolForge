# LESSON-TUNE-01 — review baseline tuning e candidato A

> **Baseline reale completata il 4 agosto 2026.** Split `tuning`: 8/8 output
> originali, profilo `economy`, modello `gpt-5.4-nano-2026-03-17`, prompt
> `aigen-prompt-01-context-01-v1`. Costo effettivo: 33.237 µUSD
> (0,033237 USD), senza billing risk e senza scritture Firestore/Storage. I 4
> scenari `holdout` non sono stati eseguiti.

Questa review applica `lesson-manual-02-rubric-v1`. Il controllo disciplinare
finale e la conferma visiva del docente restano obbligatori; i punteggi servono
come base riproducibile per confrontare il candidato, non li sostituiscono.

## Punteggi baseline

Abbreviazioni: `Cor` correttezza; `Com` completezza; `Chi` chiarezza; `Pro`
progressione; `Dep` profondità; `Dif` difficoltà; `Con` concetti; `Obi`
obiettivi; `Per` perimetro; `Gui` indicazioni docente; `Ese` esempi; `Sol`
soluzioni; `Mar` Markdown; `Den` densità; `Sic` sicurezza.

| Scenario | Cor | Com | Chi | Pro | Dep | Dif | Con | Obi | Per | Gui | Ese | Sol | Mar | Den | Sic | Totale | Verdetto |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| LM02-01 | 3 | 4 | 4 | 4 | 3 | 3 | 4 | 4 | 4 | 4 | 4 | 3 | 2 | 2 | 4 | 52 | PASS_CON_RISERVE |
| LM02-02 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 2 | 2 | 4 | 55 | PASS_CON_RISERVE |
| LM02-03 | 2 | 4 | 4 | 4 | 3 | 3 | 4 | 4 | 4 | 4 | 4 | 3 | 2 | 2 | 4 | 51 | PASS_CON_RISERVE |
| LM02-04 | 3 | 3 | 2 | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 1 | 2 | 4 | 50 | FAIL |
| LT01-07 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 2 | 4 | 4 | 4 | 2 | 2 | 4 | 53 | PASS_CON_RISERVE |
| LT01-08 | 2 | 4 | 3 | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 1 | 3 | 4 | 52 | FAIL |
| LT01-09 | 3 | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 2 | 4 | 55 | PASS_CON_RISERVE |
| LT01-10 | 2 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 2 | 4 | 2 | 2 | 4 | 52 | PASS_CON_RISERVE |

`LM02-04` e `LT01-08` sono `FAIL`: le formule centrali sono state emesse in
LaTeX, non supportato dal renderer attuale. La pipeline reale `marked` elimina
parte degli escape e presenta costrutti come `\[ ax + b = c \]` come parentesi
e testo piano, rendendo inadeguata la parte formale della lezione. Il verdetto
complessivo della baseline è quindi **REVISIONE_SOSTANZIALE**.

## Evidenze per i punteggi 0–2

- **LM02-01 — Mar/Den 2:** dieci H2 e dieci separatori in 128 righe; chiusura
  «Obiettivi raggiunti» ripete il contratto invece di aggiungere contenuto.
- **LM02-02 — Mar/Den 2:** procedura valida ma 304 righe, 18 H3 e 13
  separatori; alcune verifiche di rete sono formulate con certezza maggiore di
  quella consentita da firewall e configurazione del contesto.
- **LM02-03 — Cor 2, Mar/Den 2:** «energia associata al moto delle particelle» e
  conduzione ridotta al «contatto diretto» sono semplificazioni che possono
  generare un modello causale impreciso; 11 H2, 19 H3 e riepilogo duplicativo.
- **LM02-04 — Chi 2, Mar 1, Den 2:** LaTeX non reso, refusi «Risolv i», struttura
  molto frammentata; non tratta chiaramente i casi degeneri quando il
  coefficiente dell'incognita si annulla.
- **LT01-07 — Per/Mar/Den 2:** anticipa esplicitamente «la prossima tappa
  naturale» e sviluppa il confronto con altre fonti; usa il termine non
  standard «inferenzione»; struttura ripetitiva.
- **LT01-08 — Cor 2, Mar 1:** formule LaTeX non rese; «la gravità spinge» e la
  bilancia descritta come misura diretta del peso sono formulazioni che
  richiedono correzione o delimitazione.
- **LT01-09 — Den 2:** buon percorso di debugging, ma 287 righe e ripetizioni;
  il refuso `parì` rompe la coerenza col nome della variabile `pari`.
- **LT01-10 — Cor/Ese/Mar/Den 2:** presenta percentuali e osservazioni costruite
  come possibili prove senza separare abbastanza chiaramente evidenza reale e
  caso ipotetico; quindici blockquote e forte frammentazione editoriale.

## Obiettivi, progressione e misconcezioni

| Scenario | Obiettivo → evidenza osservabile | Progressione | Misconcezione da correggere o prevenire |
|---|---|---|---|
| LM02-01 | nodo/collegamento/protocollo/risorsa → definizioni, analogia e autoverifica | oggetti → relazioni → regole → risorse | protocollo non coincide con identità, formato o applicazione |
| LM02-02 | configurare e diagnosticare IPv4 → procedura, casi di errore e verifiche | parametri → ordine operativo → diagnosi | un ping fallito non identifica da solo la causa |
| LM02-03 | distinguere conduzione/convezione/irraggiamento → esempi e casi misti | energia termica → tre meccanismi → combinazioni | conduzione e convezione non vanno ridotte a slogan assoluti |
| LM02-04 | risolvere e verificare equazioni → principi, esempi, sostituzione | equivalenza → isolamento → verifica | simboli non renderizzati e casi degeneri lasciati impliciti |
| LT01-07 | analizzare una fonte → griglia autore/contenuto/scopo/limiti | osservazione → inferenza → attendibilità | ciò che la fonte afferma non è automaticamente un fatto storico |
| LT01-08 | distinguere massa e peso → confronto Terra/Luna, unità e calcolo | concetti → formula → applicazione | bilancia, forza normale e peso non sono sinonimi perfetti |
| LT01-09 | riconoscere errori di sintassi/runtime/logica → trace table e correzioni | esecuzione → localizzazione → correzione | un programma eseguibile non è necessariamente corretto |
| LT01-10 | costruire argomento e confutazione → tesi/ragione/evidenza/obiezione | preferenza → tesi → prova → replica | un esempio inventato non diventa evidenza empirica |

## Difetti sistematici attribuiti al prompt

1. Compatibilità del formato non abbastanza esplicita: LaTeX compare in due
   discipline e il renderer non lo supporta.
2. Struttura meccanica: 8–11 H2 e 9–13 separatori per campione, spesso con
   riepilogo/checklist finale predefiniti.
3. Precisione epistemica insufficiente: esempi ipotetici, comportamenti
   dipendenti dal contesto e semplificazioni non sono sempre delimitati.
4. Controllo finale debole: refusi, terminologia e nomi di variabili incoerenti
   ricorrono in più campioni.
5. Esercizi non differenziati per natura della lezione: serve proteggere la
   completezza della spiegazione ed evitare attività riempitive.

## Candidato A congelato nel codice

Versione: `lesson-tune-01-candidate-a-v1`.

- solo corpo lezione, senza ripetere titolo/metadati;
- struttura proporzionata, niente separatori o recap meccanici;
- Markdown supportato e callout SchoolForge facoltativi; LaTeX e Mermaid
  vietati finché il renderer non li supporta;
- fatti/ipotesi/semplificazioni e condizioni contestuali distinti;
- esercizi operativi solo se utili e completamente svolti; per teoria al
  massimo 1–2 autoverifiche ragionate e risolte; nessuna quota obbligatoria;
- controllo finale silenzioso su fatti, ortografia, termini, variabili, unità,
  calcoli e soluzioni;
- nessun limite pedagogico di caratteri o parole e nessun cambio ai token cap
  tecnici, al modello, al listino, al payload o alla sicurezza.

## Passi successivi

Il dry-run del candidato A, verificato con Node 22.23.1, pianifica 8 chiamate e
al massimo 16 tentativi: stima 94.084 µUSD e tetto prudenziale 212.588 µUSD
(0,212588 USD). Non legge la chiave, non costruisce il provider e non usa la
rete.

1. richiedere nuova autorizzazione economica;
2. rigenerare gli stessi 8 scenari `tuning` e confrontarli dimensione per
   dimensione con questa baseline;
3. congelare il candidato solo se migliora senza regressioni;
4. eseguire una sola volta i 4 `holdout`, che restano intatti fino ad allora.
