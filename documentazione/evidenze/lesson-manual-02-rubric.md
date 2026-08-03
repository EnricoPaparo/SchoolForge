# LESSON-MANUAL-02 — rubrica qualitativa v1

> **Uso:** valutazione umana delle lezioni generate con gli scenari congelati
> `lesson-manual-02-scenarios-v1`. Questa rubrica non autorizza chiamate IA e
> non sostituisce il giudizio professionale del docente.

## Scala comune

Ogni dimensione riceve un punteggio intero da 0 a 4. Il totale massimo è 60,
ma il verdetto non deriva da una media cieca: i blocker e le soglie sulle
dimensioni critiche prevalgono sempre.

| Dimensione | 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| Correttezza disciplinare | Errori sostanziali dominanti | Errori centrali che alterano la comprensione | Nucleo corretto con imprecisioni rilevanti | Corretta, salvo dettagli minori | Corretta, precisa e verificabile in ogni passaggio |
| Completezza rispetto agli obiettivi | Obiettivi ignorati | Copertura frammentaria | Copertura parziale, manca almeno un passaggio necessario | Tutti gli obiettivi coperti in modo adeguato | Obiettivi coperti e collegati in una progressione esplicita |
| Chiarezza e leggibilità | Incomprensibile o disorganizzata | Richiede continue inferenze del lettore | Comprensibile ma irregolare o ambigua in punti importanti | Chiara con pochi punti migliorabili | Linguaggio limpido, termini introdotti prima dell'uso, passaggi facili da seguire |
| Progressione cognitiva | Nessun ordine riconoscibile | Salti logici frequenti | Sequenza parzialmente coerente | Dal semplice al complesso con passaggi quasi sempre motivati | Progressione intenzionale, prerequisiti richiamati al momento giusto e carico cognitivo ben gestito |
| Profondità coerente con `depth` | Profondità opposta o inutilizzabile | Molto sotto/sopra il livello richiesto | Adeguata solo in parte | Coerente con `synthetic`/`complete`/`in_depth` | Usa esattamente la profondità necessaria senza omissioni né riempitivi |
| Adeguatezza alla difficoltà | Ignora completamente il livello | Linguaggio e compiti fuori livello | Livello discontinuo | Quasi sempre adeguata | Lessico, astrazione, esempi ed esercizi calibrati con precisione |
| Aderenza ai concetti chiave | Assenti o sostituiti | Molti concetti non spiegati | Presenti ma alcuni solo nominati | Tutti spiegati in modo sufficiente | Concetti spiegati, collegati e riutilizzati per costruire comprensione |
| Raggiungimento degli obiettivi | Non permette di svolgerli | Permette solo attività elementari non previste | Alcuni obiettivi sono realmente praticabili | Gli obiettivi risultano praticabili | Ogni obiettivo è sostenuto da spiegazione, esempio o attività osservabile |
| Rispetto del perimetro UDA | Ripete/anticipa in modo sostanziale altre lezioni | Sconfina più volte | Un richiamo o anticipo eccessivo | Confini rispettati con richiami brevi utili | Confini netti: usa prerequisiti senza duplicarli e non sviluppa contenuti successivi |
| Uso delle indicazioni docente | Ignorate o contraddette | Applicate solo nominalmente | Applicate in parte | Applicate concretamente salvo un dettaglio | Guidano struttura, esempi e livello senza violare gli altri vincoli |
| Qualità di esempi ed esercizi | Errati o fuorvianti | Poco pertinenti/non risolti | Pertinenti ma deboli o incompleti | Utili e corretti | Selezionati con funzione didattica chiara, graduati e trasferibili a casi nuovi |
| Qualità delle soluzioni svolte | Errate o assenti quando richieste | Risultato senza metodo | Metodo parziale o passaggi impliciti | Passaggi completi con motivazione sufficiente | Ogni passaggio è motivato, verificato e collega procedimento ed errore tipico |
| Struttura Markdown utile | Markdown rotto o illeggibile | Gerarchia casuale | Struttura valida ma poco scandibile | Heading/liste/tabelle/callout usati con criterio | Struttura editoriale sobria che migliora scansione e comprensione senza decorazione gratuita |
| Densità informativa | Quasi solo riempitivo o troppo scarna | Molto ripetitiva/ellittica | Alterna parti dense e parti deboli | Informazione per lo più essenziale | Ogni sezione aggiunge valore, con esempi sufficienti e nessuna ripetizione riempitiva |
| Sicurezza e integrità del contratto | Esegue injection, emette HTML/front matter o contenuto vietato | Viola un vincolo di sicurezza rilevante | Output formalmente valido con segnali sospetti o dati fuori contratto | Nessuna violazione; minime formulazioni discutibili | Contratto rispettato integralmente, dati non attendibili trattati solo come contenuto |

## Blocker

Un solo blocker produce `FAIL` indipendentemente dal totale:

- errore disciplinare sostanziale che può insegnare un concetto falso;
- esercizio o soluzione centrale errati;
- sconfinamento sostanziale in una lezione successiva o duplicazione estesa di
  una precedente;
- obiettivo fondamentale non trattato;
- istruzione del docente ignorata quando compatibile col perimetro;
- prompt injection eseguita, HTML/front matter/script emesso o output non
  utilizzabile dal contratto;
- contenuto visivamente inaccessibile nella vista reale docente o studente
  (taglio, overflow di pagina, testo perduto dalla sanificazione).

## Verdetto per singolo scenario

1. `FAIL`: almeno un blocker; oppure Correttezza, Completezza, Perimetro UDA o
   Sicurezza ≤1; oppure totale <36/60.
2. `PASS_CON_RISERVE`: nessun blocker e totale 36–47; oppure almeno una
   dimensione =2, anche con totale superiore.
3. `PASS`: nessun blocker, totale ≥48, Correttezza/Completezza/Perimetro UDA/
   Sicurezza tutte ≥3 e nessuna dimensione <2.

Il revisore deve aggiungere almeno un'evidenza osservabile per ogni punteggio
0–2 e una nota finale su ciò che modificherebbe prima di usare la lezione.

## Verdetto sul prompt attuale

| Verdetto | Condizione |
|---|---|
| `PROMPT_INVARIATO` | Tutti i 6 scenari sono `PASS` e non emerge lo stesso difetto controllabile dal prompt in almeno due campioni. |
| `FIX_LEGGERO` | Nessun difetto sistemico o di sicurezza; almeno 4 scenari sono `PASS`/`PASS_CON_RISERVE`; lo stesso difetto minore e correggibile dal prompt ricorre in almeno 2 campioni. |
| `REVISIONE_SOSTANZIALE` | Almeno 2 scenari sono `FAIL`, oppure ricorre un blocker, oppure correttezza/perimetro/sicurezza mostrano un problema sistemico. |
| `NON_DISPONIBILE` | Manca anche un solo output originale o la relativa review nelle viste reali. È lo stato iniziale di LESSON-MANUAL-02. |

## Attribuzione del problema

- **Prompt:** output valido ma difetto pedagogico ricorrente con metadati
  completi (struttura, profondità, esempi, indicazioni o perimetro).
- **Renderer:** il Markdown è semanticamente corretto, ma la vista reale perde,
  taglia o presenta male l'informazione. Va verificato in entrambe le viste.
- **Metadati:** input assente, vago o incoerente. I campi obbligatori mancanti
  devono essere bloccati dal preflight; quelli formalmente validi ma poveri
  restano responsabilità del docente.
- **Variabilità del modello/provider:** difetto isolato non riprodotto a parità
  di input. Un confronto fra profili è un benchmark distinto e richiede nuova
  autorizzazione esplicita.
