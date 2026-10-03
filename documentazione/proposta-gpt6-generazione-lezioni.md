# SchoolForge — proposta GPT-6 per la generazione delle lezioni

**Stato:** fase 1 distribuita in DEV; tuning 1.1 della modalità Approfondita approvato; fasi 2–3 ancora proposte
**Data:** 3 ottobre 2026
**Ambito previsto:** configurazione dei modelli IA, progettazione didattica condivisa fra lezioni, pool e mappe, accounting dei costi e rollback
**Ambiente iniziale previsto:** DEV

## Stato di implementazione della fase 1

La fase 1 comprende esclusivamente modelli, listini, parametri provider e nuovo
prompt delle lezioni. Sul branch dedicato sono stati implementati:

- Economy → `gpt-6-luna`, `reasoning.effort: low`;
- Quality → `gpt-6.1-sol`, `reasoning.effort: medium`;
- listino immutabile GPT-6.1 Sol `v12-2026-09-29-gpt61-sol-standard`;
- `text.verbosity` delle sole lezioni: `low`, `medium`, `high` rispettivamente
  per sintetica, completa e approfondita;
- prompt lesson di fase 1 `lesson-gpt6-phase1-v1`, portato dal tuning 1.1 a
  `lesson-gpt6-phase1-1-v1`;
- politica precedente `lesson-depth-01-candidate-e-v1` conservata;
- selettore unico `ACTIVE_AI_RUNTIME_POLICY`: il valore `gpt56` ripristina
  insieme modelli, listini, prompt lesson e assenza dei parametri GPT-6;
- compatibilità di allowlist e reverse lookup con il precedente `gpt-6-sol`.

La prima prova docente ha mostrato che GPT-6.1 Sol tendeva a considerare
soddisfatta troppo presto la richiesta Approfondita. Il tuning 1.1:

- porta a `high` il reasoning della sola combinazione Quality + Approfondita;
- sostituisce la descrizione generica della profondità con un criterio di
  completezza didattica verificabile;
- rafforza il ruolo di esempi, casi, confronti e applicazioni senza introdurre
  quote di parole, durata, sezioni o autoverifiche;
- conserva i tetti tecnici, Economy, gli altri tipi di operazione e il rollback.

Non fanno parte della fase 1 o 1.1 `didacticCore`, modifiche al contratto del
pool o la mappa a grafo. Non sono state eseguite chiamate provider reali per il
tuning 1.1.

## 1. Scopo

Questa proposta descrive l'evoluzione della generazione IA di SchoolForge verso
GPT-6 Luna e GPT-6.1 Sol. L'obiettivo è produrre lezioni per la scuola secondaria
di secondo grado più chiare, approfondite, disciplinarmente corrette e naturali,
riducendo contemporaneamente il numero di istruzioni rigide presenti nel prompt.
La stessa progettazione didattica deve guidare anche il pool di domande e la
mappa concettuale, affinché i tre artefatti rappresentino lo stesso percorso di
apprendimento.

La proposta nasce da due osservazioni:

1. il precedente passaggio diretto da GPT-5.6 a GPT-6 Sol ha prodotto in DEV
   lezioni approfondite più brevi e qualitativamente più povere;
2. il prompt attuale è stato costruito e verificato su GPT-5.6, contiene regole
   accumulate nel tempo e non usa esplicitamente `reasoning.effort` o
   `text.verbosity`.

La modifica deve quindi essere trattata come una nuova politica di generazione,
composta da modello, listino, prompt e parametri. Cambiare soltanto il model ID
non costituisce una migrazione completa.

La revisione successiva dei tre flussi ha evidenziato un ulteriore limite: oggi
lezione, pool e mappa operano come generatori indipendenti. Pool e mappa devono
ricostruire a posteriori il progetto didattico leggendo il corpo della lezione.
La proposta definitiva introduce quindi una breve impronta didattica strutturata,
generata insieme alla lezione e riutilizzata dagli altri flussi.

## 2. Stato iniziale verificato

Al momento della stesura:

- il mapping operativo è ancora:
  - Economy → `gpt-5.6-luna`;
  - Quality → `gpt-5.6-sol`;
- GPT-6 Luna e GPT-6 Sol sono già presenti nell'allowlist runtime e nei listini,
  ma non sono selezionati dai profili operativi;
- GPT-6.1 Sol non è ancora censito nel repository;
- la richiesta di generazione invia modello, prompt, schema JSON strict,
  `max_output_tokens` e `store: false`;
- la richiesta non invia `reasoning.effort` né `text.verbosity`;
- i tetti tecnici delle lezioni sono:
  - sintetica: 8.000 token di output;
  - completa: 14.000 token di output;
  - approfondita: 18.000 token di output;
- GPT-5.6 deve restare disponibile come rollback immediato.

## 3. Decisioni di prodotto concordate

### 3.1 Profili modello

| Profilo SchoolForge | Modello candidato | Reasoning | Uso previsto |
|---|---|---|---|
| Economy | `gpt-6-luna` | `low` | Generazioni frequenti e sensibili al costo |
| Quality | `gpt-6.1-sol` | `medium` | Generazioni in cui prevale la qualità didattica |

GPT-6 Astra non rientra nel normale flusso SchoolForge. Il suo costo è cinque
volte quello di GPT-6.1 Sol su input e output e non esiste ancora evidenza che
questo incremento produca un vantaggio proporzionato nelle lezioni.

Il precedente `gpt-6-sol` resta riconoscibile per compatibilità con run storici,
ma non viene proposto come nuovo modello Quality.

### 3.2 Verbosity delle lezioni

| Profondità richiesta | `text.verbosity` | Significato didattico |
|---|---|---|
| Sintetica | `low` | Nucleo dell'argomento e passaggi indispensabili |
| Completa | `medium` | Modello mentale, collegamenti ed esempi necessari |
| Approfondita | `high` | Motivazioni, implicazioni, applicazioni, limiti ed errori pertinenti |

`text.verbosity` controlla il livello di dettaglio predefinito. Il prompt
continua a definire la differenza pedagogica fra i tre livelli.

I tetti di 8.000, 14.000 e 18.000 token restano limiti tecnici contro il
troncamento. Non sono obiettivi di lunghezza e il prompt non deve chiedere di
raggiungerli.

### 3.3 Reasoning

- Economy usa `reasoning.effort: low`.
- Quality usa normalmente `reasoning.effort: medium`.
- Quality + Approfondita usa `reasoning.effort: high`, perché richiede una
  progettazione didattica e una sintesi più impegnative.
- Economy resta `low` a ogni profondità; pool, mappe, correzioni e visuali
  conservano il reasoning previsto dal profilo.

L'override è circoscritto al caso in cui il docente chiede esplicitamente sia il
profilo di qualità sia la massima profondità. Aumenta potenzialmente costo e
latenza, perciò non viene esteso alle altre operazioni.

## 4. Obiettivo didattico del nuovo prompt

Il nuovo prompt deve chiedere al modello di agire come autore didattico per la
scuola secondaria di secondo grado.

Il risultato atteso è una spiegazione che permetta allo studente di:

1. costruire un modello mentale corretto dell'argomento;
2. seguire la progressione dei passaggi;
3. comprendere motivazioni e collegamenti rilevanti;
4. applicare quanto appreso in situazioni pertinenti.

La qualità non viene misurata dal numero di sezioni, esempi, domande o parole.
Il contenuto deve essere ampio quanto serve alla comprensione richiesta e deve
evitare materiale riempitivo.

## 5. Riduzione del prompt attuale

### 5.1 Istruzioni da eliminare

Il nuovo prompt non deve più richiedere:

- una lezione capace di sostenere un'ora in classe;
- attività o domande di autoverifica;
- una o due sezioni di esercizi in base alla profondità;
- la copertura meccanica di ogni concetto chiave e di ogni obiettivo;
- quantità minime o massime di esempi, casi e applicazioni;
- riepiloghi, checklist o conclusioni obbligatorie;
- una revisione finale articolata in sette passaggi;
- regole specialistiche ripetute per singoli casi diagnostici;
- ripetizioni equivalenti sul perimetro della lezione e sulla necessità di
  approfondire.

Le autoverifiche e i pool di domande appartengono alle funzioni dedicate di
SchoolForge e non devono consumare spazio nella lezione.

### 5.2 Istruzioni da conservare

Devono restare:

- il trattamento dei metadati come dati e non come istruzioni eseguibili;
- titolo, difficoltà, indicazioni del docente e contesto dell'UDA;
- la posizione della lezione rispetto alle altre lezioni dell'UDA;
- il divieto di sviluppare in modo sostanziale argomenti riservati a lezioni
  successive;
- accuratezza disciplinare, coerenza e assenza di fatti o fonti inventati;
- output limitato al corpo Markdown della lezione;
- sintassi compatibile con il renderer SchoolForge;
- assenza di HTML, front matter, Mermaid e LaTeX non supportato;
- struttura editoriale proporzionata al contenuto.

## 6. Nuovi criteri didattici

### 6.1 Progressione

Il modello deve organizzare i contenuti nella sequenza più comprensibile e
introdurre ogni passaggio quando lo studente possiede già le informazioni
necessarie per capirlo.

Quando utile, la progressione può includere:

- un punto di partenza accessibile;
- una spiegazione intuitiva;
- definizione o formalizzazione;
- esempio concreto;
- applicazione o conseguenza;
- limite, eccezione o errore frequente.

Questi elementi sono criteri di progettazione, non sezioni obbligatorie. Il
modello non deve produrre automaticamente un heading per ciascun elemento.

### 6.2 Adattamento disciplinare

Il prompt deve richiedere esempi, rappresentazioni e argomentazioni coerenti
con la disciplina:

- contenuti quantitativi: passaggi significativi e risultati verificati;
- storia e scienze sociali: distinzione fra fatti, cause, conseguenze e
  interpretazioni;
- scienze: distinzione fra fenomeni, modelli, evidenze e limiti;
- lingua e letteratura: esempi testuali concreti e analisi fondata;
- discipline tecniche: collegamento fra principio, procedura, vincoli ed esito.

Il prompt deve contenere questo blocco in forma compatta. Non deve replicare un
manuale completo per ciascuna disciplina.

### 6.3 Esempi e definizioni

- Un esempio deve chiarire un passaggio reale della spiegazione.
- Sono da evitare esempi decorativi, generici o inseriti per allungare il testo.
- Dati, condizioni, calcoli e risultati devono essere coerenti e verificabili.
- Una definizione nuova deve chiarire, quando utile, perché serve, come si
  riconosce e con quali concetti rischia di essere confusa.

### 6.4 Concetti e obiettivi

Concetti chiave e obiettivi identificano il centro della lezione. Non sono una
checklist editoriale.

Il modello deve poter:

- integrare nella stessa spiegazione voci sovrapposte;
- gerarchizzare le informazioni;
- privilegiare i passaggi necessari alla comprensione;
- evitare di nominare meccanicamente ogni voce.

Non deve allargare liberamente l'argomento. Può introdurre prerequisiti e
concetti di supporto soltanto quando servono a capire il nucleo della lezione.

### 6.5 Registro linguistico

La lezione deve avere un tono preciso, naturale e adatto agli studenti delle
superiori.

Sono da evitare:

- linguaggio infantilizzante;
- stile da manuale universitario non richiesto;
- introduzioni generiche o motivazionali;
- metadiscorso come «in questa lezione vedremo»;
- ripetizioni e parafrasi dello stesso concetto;
- anticipazioni dell'indice interno;
- conclusioni rituali;
- titoli per paragrafi troppo brevi;
- elenchi usati al posto di una spiegazione.

## 7. Semantica dei livelli di profondità

### Sintetica

Presenta con chiarezza il nucleo dell'argomento e i passaggi indispensabili.
Riduce esempi, applicazioni e dettagli secondari prima di comprimere le
spiegazioni necessarie.

### Completa

Sviluppa l'argomento in modo autosufficiente. Include spiegazioni, collegamenti
ed esempi che servono realmente a costruire il modello mentale.

### Approfondita

Esplora motivazioni, implicazioni, applicazioni, limiti, condizioni ed errori
frequenti quando sono pertinenti. La maggiore profondità deve derivare da una
comprensione più ricca, non da ripetizioni o digressioni.

## 8. Controllo finale

La lunga checklist attuale viene sostituita da un unico controllo interno:

> Prima di rispondere, verifica silenziosamente correttezza disciplinare,
> progressione logica, validità degli esempi e assenza di ripetizioni; correggi
> gli eventuali problemi.

Non è prevista una seconda chiamata IA di revisione. Il controllo avviene nella
stessa generazione.

## 9. Bozza del nucleo del prompt

La formulazione seguente rappresenta il nucleo proposto. Durante
l'implementazione dovrà essere integrata con sicurezza, metadati, contesto UDA,
indicazioni del docente e regole Markdown.

> Scrivi esclusivamente il corpo Markdown di una lezione in italiano per
> studenti della scuola secondaria di secondo grado. Costruisci una spiegazione
> che permetta allo studente di comprendere il modello mentale dell'argomento,
> seguirne i passaggi e applicarlo in situazioni pertinenti.
>
> Usa titolo, difficoltà, concetti, obiettivi, indicazioni del docente e
> contesto UDA per individuare argomento, livello e confini della lezione.
> Gerarchizza e integra le informazioni senza trasformarle in una checklist.
>
> Organizza i contenuti nella sequenza che facilita maggiormente la
> comprensione. Spiega i termini prima di usarli, motiva i passaggi importanti
> e usa esempi soltanto quando chiariscono davvero. Adotta il modo di spiegare
> proprio della disciplina.
>
> Scrivi con tono preciso, naturale e adatto alle superiori. Evita testo
> riempitivo, ripetizioni, introduzioni generiche, metadiscorso, sezioni
> artificiali e conclusioni rituali. Non includere autoverifiche o batterie di
> domande.
>
> Prima di rispondere, verifica silenziosamente correttezza disciplinare,
> progressione logica, validità degli esempi e assenza di ripetizioni; correggi
> gli eventuali problemi.

## 10. Progettazione didattica condivisa

### 10.1 Limite dell'architettura attuale

Il corpo della lezione è attualmente l'unico collegamento semantico fra i tre
flussi. Il generatore della lezione decide implicitamente che cosa è centrale;
pool e mappa devono dedurlo nuovamente dal testo. Questo può produrre:

- domande concentrate sui dettagli più facili da interrogare;
- mappe che riproducono l'indice editoriale invece del modello concettuale;
- differenze fra ciò che la lezione vuole insegnare e ciò che viene verificato;
- tre prompt lunghi che ripetono ragionamenti simili senza condividere il
  risultato di quei ragionamenti.

### 10.2 Impronta didattica

La stessa chiamata che genera una nuova lezione deve restituire una breve
struttura interna insieme al corpo Markdown:

```text
{
  didacticCore: {
    centralIdea,
    essentialConcepts,
    relations,
    misconceptions,
    applicableSkills
  },
  body
}
```

L'impronta non è una catena di ragionamento privata e non deve contenere analisi
libera. È un artefatto didattico strutturato, limitato e validabile, persistito
come metadato della lezione e non mostrato automaticamente allo studente.

Campi proposti:

- `centralIdea`: formulazione concisa del modello mentale centrale;
- `essentialConcepts`: concetti effettivamente sviluppati, con identificatore
  stabile all'interno della lezione e descrizione breve;
- `relations`: relazioni essenziali fra concetti, espresse con identificatori e
  una relazione esplicita;
- `misconceptions`: errori plausibili che la lezione permette di riconoscere o
  correggere;
- `applicableSkills`: operazioni che lo studente può compiere dopo aver studiato
  la lezione, per esempio spiegare, distinguere, calcolare, analizzare o
  applicare.

L'ordine dello Structured Output deve collocare `didacticCore` prima di `body`.
Il modello definisce così una progettazione compatta prima di redigere il testo,
restando all'interno di una sola chiamata provider.

Ogni elemento dell'impronta deve essere concretamente sostenuto dal corpo. Il
corpo resta la fonte autorevole del contenuto disciplinare; l'impronta ne è
l'indice semantico e il contratto di coordinamento per i flussi successivi.

### 10.3 Beneficio atteso sulla lezione

Prima di scrivere, il modello deve decidere:

- quale comprensione unitaria deve costruire;
- quali concetti sono davvero essenziali;
- quali relazioni devono risultare comprensibili;
- quali errori frequenti meritano prevenzione;
- quali capacità applicative deve lasciare allo studente.

Il corpo non deve avere una sezione per ciascun campo dell'impronta. La
progettazione resta invisibile nella struttura editoriale quando una forma più
naturale è didatticamente migliore.

## 10A. Miglioramento del pool di domande

### 10A.1 Obiettivo

Il pool deve misurare la comprensione costruita dalla lezione, non la memoria
della sua formulazione o posizione editoriale. Deve usare corpo e impronta
didattica insieme, considerando sempre il corpo come fonte disciplinare
autorevole.

### 10A.2 Istruzioni da ridurre o eliminare

Dal prompt attuale del pool vanno rimossi o ridotti:

- il riferimento favorevole alle domande-trabocchetto;
- la copertura uniforme di tutti i contenuti;
- l'obbligo di variare artificialmente ogni combinazione di scenario e
  operazione cognitiva;
- ripetizioni sulle caratteristiche delle soluzioni;
- la matrice mentale privata non ispezionabile.

### 10A.3 Nuovo principio di selezione

Il contratto centrale diventa:

> Seleziona ciò che è didatticamente più significativo. Dai priorità ai concetti
> centrali, alle relazioni importanti, alle capacità applicative e agli errori
> che rivelano una comprensione incompleta.

Le domande possono verificare:

- comprensione del significato;
- spiegazione di relazioni;
- applicazione;
- confronto;
- analisi di un errore;
- trasferimento a un caso nuovo.

La distribuzione dipende dalla disciplina, dal livello e dal contenuto
effettivamente insegnato. Non è una quota rigida per categoria.

### 10A.4 Metadati interni delle domande

Ogni domanda dovrebbe includere metadati strutturati interni:

```text
{
  targetConceptId,
  cognitiveOperation,
  misconceptionTested,
  question,
  solution
}
```

- `targetConceptId` deve riferirsi a un concetto dell'impronta;
- `cognitiveOperation` descrive che cosa deve fare lo studente;
- `misconceptionTested` è facoltativo semanticamente e indica l'errore
  diagnostico quando la domanda ne verifica uno;
- `question` e `solution` alimentano il contratto applicativo già esistente.

I metadati non devono essere mostrati allo studente. Possono sostenere
diversificazione, tracciabilità e futura correzione IA.

### 10A.5 Distrattori

Ogni distrattore di una domanda chiusa deve rappresentare un errore plausibile,
una confusione concettuale o l'applicazione scorretta di una regola. Sono da
evitare alternative assurde, estranee al materiale o riconoscibili tramite
indizi grammaticali e formali.

### 10A.6 Soluzioni

Le soluzioni aperte devono identificare:

- la risposta attesa;
- i passaggi essenziali;
- i criteri che rendono corretta la risposta;
- gli errori rilevanti da non accettare, quando pertinenti.

La rappresentazione pubblica può restare compatibile con il campo `soluzione`.
Gli eventuali criteri strutturati aggiuntivi devono essere valutati insieme al
flusso di correzione e non introdotti nel client senza una necessità concreta.

## 10B. Miglioramento della mappa concettuale

### 10B.1 Limite dell'albero ASCII generato dal modello

Un albero rappresenta gerarchie, ma molti argomenti scolastici formano grafi:
un concetto può dipendere da più elementi, condizioni e conseguenze possono
attraversare rami differenti e un confronto può collegare concetti allo stesso
livello. Chiedere al modello di comporre direttamente caratteri, rientri e
frecce mescola ragionamento concettuale e impaginazione.

### 10B.2 Grafo strutturato

Il modello dovrebbe restituire:

```text
{
  summaryMarkdown,
  nodes: [
    { id, label, meaning }
  ],
  edges: [
    { from, to, relation }
  ]
}
```

- `summaryMarkdown` ricostruisce il filo logico in forma compatta;
- `nodes` contiene i nuclei selezionati;
- `edges` rende esplicite cause, dipendenze, condizioni, confronti, sequenze e
  altre relazioni significative;
- nodi ed edge devono essere coerenti con corpo e impronta didattica.

Il server deve validare e trasformare il grafo nella rappresentazione
supportata da SchoolForge. La rappresentazione persistita non deve dipendere da
un formato grafico generato liberamente dal provider.

Questa struttura permette:

- relazioni verificabili;
- assenza di alberi ASCII malformati;
- collegamenti incrociati;
- rilevazione di nodi orfani e riferimenti inesistenti;
- evoluzione futura verso una visualizzazione interattiva senza rigenerare il
  contenuto semantico.

### 10B.3 Selezione dei concetti

Non deve esistere un numero editoriale fisso di nodi. Il criterio è:

> Includi il numero minimo di nodi necessario per ricostruire senza ambiguità
> il modello mentale centrale. Unisci concetti equivalenti e ometti dettagli
> che non modificano le relazioni essenziali.

La sintesi spiega il filo logico; il grafo lo rende visibile. I due elementi
devono completarsi senza duplicarsi frase per frase.

## 10C. Parametri per tipo di operazione

| Operazione | Economy | Quality | `text.verbosity` |
|---|---|---|---|
| Lezione | GPT-6 Luna, `low` | GPT-6.1 Sol, `medium` | `low` / `medium` / `high` secondo profondità |
| Pool | GPT-6 Luna, `low` | GPT-6.1 Sol, `medium` | `medium` |
| Mappa | GPT-6 Luna, `low` | GPT-6.1 Sol, `medium` | `low` |
| Correzione | GPT-6 Luna, `low` | GPT-6.1 Sol, `medium` | `medium` |

Reasoning e verbosity devono essere risolti server-side per tipo di richiesta.
La profondità della lezione non deve influenzare correzioni, mappe, pool o
immagini.

Per proposta e pianificazione delle immagini la configurazione deve essere
valutata separatamente, perché brevità e capacità di rispettare vincoli visuali
sono più importanti della ricchezza editoriale.

## 10D. Metadati didattici futuri

La qualità può crescere ulteriormente se SchoolForge rende disponibili, senza
obbligare il docente a ripeterli per ogni lezione:

- disciplina;
- anno scolastico;
- indirizzo di studi;
- prerequisiti già posseduti;
- materiale fonte facoltativo del docente.

Disciplina, anno e indirizzo dovrebbero essere ereditati dal programma quando
già presenti. Un materiale fonte, quando fornito, può diventare il riferimento
autorevole per terminologia, definizioni e impostazione. Questa estensione è
separabile dalla prima implementazione e richiede una valutazione del modello
dati e dell'esperienza docente.

## 10E. Compatibilità con contenuti esistenti

Le lezioni già salvate non possiedono `didacticCore`. Devono continuare a poter
generare pool e mappe con il percorso legacy basato sul solo corpo.

Per le nuove lezioni:

- corpo e impronta vengono salvati insieme;
- pool e mappa usano l'impronta quando presente e valida;
- un'impronta assente o malformata non deve essere ricostruita con una chiamata
  provider implicita;
- il fallback legacy deve essere esplicito, osservabile e privo di costi
  aggiuntivi nascosti.

## 10F. Validazione didattica deterministica

Il server non può dimostrare automaticamente la qualità pedagogica complessiva,
ma può verificare alcune invarianti utili senza un'altra chiamata IA:

- ogni `targetConceptId` del pool esiste nell'impronta;
- nessuna domanda dichiara come bersaglio un concetto non insegnato;
- ogni nodo e ogni estremo di un edge della mappa è valido;
- non esistono nodi isolati privi di funzione;
- etichette, concetti e domande non sono duplicati in modo evidente;
- il pool non concentra quasi tutte le domande sullo stesso concetto senza una
  richiesta esplicita;
- conteggi, tipi, difficoltà, opzioni e soluzioni rispettano i contratti già
  esistenti;
- la rappresentazione della mappa rispetta i limiti tecnici del renderer.

Non va introdotto un punteggio automatico generico di «qualità didattica»: non
sarebbe sufficientemente affidabile per sostituire il giudizio del docente.

## 11. Listini e accounting

### 11.1 Prezzi Standard per milione di token

| Modello | Input | Input da cache | Scrittura cache | Output |
|---|---:|---:|---:|---:|
| `gpt-6-luna` | $0,10 | $0,01 | $0,125 | $0,50 |
| `gpt-6.1-sol` | $2,00 | $0,10 | $2,50 | $10,00 |
| `gpt-6-astra` | $10,00 | $1,00 | $12,50 | $50,00 |
| `gpt-5.6-luna` | $0,20 | $0,02 | $0,25 | $1,20 |
| `gpt-5.6-sol` | $4,00 | $0,40 | $5,00 | $20,00 |

Per endpoint con trattamento regionale europeo si applica il sovrapprezzo
previsto dal listino OpenAI. Il calcolo SchoolForge deve continuare a usare
listini immutabili e versionati e deve contabilizzare separatamente input non
memorizzato, lettura cache, scrittura cache e output.

Fonti ufficiali:

- https://developers.openai.com/api/docs/models/gpt-6.1-sol
- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://developers.openai.com/api/docs/pricing
- https://developers.openai.com/api/docs/guides/latest-model

### 11.2 Nuovo listino

GPT-6.1 Sol deve ricevere una nuova versione di listino. I listini esistenti non
devono essere modificati in loco. Il vecchio GPT-6 Sol e i modelli GPT-5.6
restano disponibili per la riconciliazione dei run storici.

## 12. Versionamento e rollback

Il rollback deve ripristinare l'intera politica nota come funzionante:

- modello GPT-5.6 associato al profilo;
- relativo listino cache-aware;
- prompt precedente;
- assenza dei nuovi parametri o relativi valori compatibili;
- comportamento di prenotazione e accounting coerente con quel modello.

Per questo motivo il nuovo prompt deve avere una propria versione e il runtime
deve selezionare una politica di generazione coerente. La coppia
modello/listino, da sola, non è sufficiente per un rollback completo.

Una possibile risoluzione server-side è:

```text
profilo
  → modello
  → listino
  → versione prompt
  → reasoning effort
  → politica verbosity
  → versione schema didattico
```

Il client continua a inviare soltanto `economy` o `quality` e la profondità
della lezione. Non può scegliere model ID, listino o versione del prompt.

## 13. Ambito implementativo previsto

La futura implementazione dovrà comprendere:

1. registrazione di `gpt-6.1-sol` e del nuovo listino;
2. aggiornamento dell'allowlist runtime;
3. mapping candidato Economy/Quality;
4. estensione del tipo di richiesta OpenAI per reasoning e verbosity;
5. applicazione dei parametri in base a profilo e tipo di richiesta;
6. nuovo prompt versionato per le lezioni;
7. schema strict e validazione dell'impronta didattica;
8. persistenza coordinata di corpo e impronta per le nuove lezioni;
9. nuovo contratto del pool fondato sull'impronta, con metadati interni delle
   domande;
10. nuovo contratto della mappa come grafo strutturato;
11. composizione server-side della rappresentazione della mappa;
12. percorso legacy per lezioni esistenti prive dell'impronta;
13. conservazione dei prompt e degli schemi GPT-5.6 precedenti;
14. accounting e prenotazione coerenti con la richiesta realmente inviata;
15. test dei payload, dei profili, dei listini, degli schemi e del rollback;
16. documentazione della configurazione effettivamente distribuita.

Non è prevista alcuna modifica dell'interfaccia docente: Economy, Quality,
Sintetica, Completa e Approfondita mantengono i nomi attuali.

## 14. Verifiche senza chiamate provider

Prima di usare budget reale devono essere verificati localmente:

- corrispondenza esatta profilo → modello → listino → prompt;
- `reasoning.effort` corretto per Economy e Quality;
- `text.verbosity` corretto per le tre profondità;
- verbosity specifica corretta per pool, mappe e correzioni;
- presenza di Structured Outputs e dello schema strict esistente;
- conservazione di `store: false`;
- tetti `max_output_tokens` invariati;
- stima e prenotazione costruite dalla stessa richiesta inviata;
- accounting di input, cache read, cache write e output;
- riconoscimento dei run storici GPT-5.6 e GPT-6 Sol;
- rollback unitario alla politica GPT-5.6;
- assenza di autoverifiche nel nuovo prompt;
- permanenza dei vincoli di sicurezza e compatibilità Markdown;
- validità referenziale di concetti, relazioni, nodi ed edge;
- assenza di nodi orfani e riferimenti a concetti inesistenti;
- compatibilità delle lezioni legacy prive di `didacticCore`;
- assenza di chiamate provider implicite per ricostruire metadati mancanti;
- coerenza fra metadati interni delle domande e impronta didattica.

## 15. Valutazione umana in DEV

Dopo deploy DEV, le chiamate IA reali richiedono un'autorizzazione esplicita.
È sufficiente una prova mirata su pochi casi rappresentativi, usando gli stessi
metadati per confrontare gli output.

Il giudizio umano dovrebbe osservare:

1. correttezza disciplinare;
2. chiarezza e progressione;
3. profondità effettiva;
4. qualità e utilità degli esempi;
5. adeguatezza alle superiori;
6. assenza di ripetizioni e testo riempitivo;
7. rispetto del perimetro dell'UDA;
8. differenza percepibile fra sintetica, completa e approfondita;
9. coerenza fra lezione, domande e mappa;
10. capacità dei distrattori di rappresentare errori plausibili;
11. utilità diagnostica e varietà cognitiva del pool;
12. chiarezza delle relazioni nella mappa;
13. costo e latenza registrati.

La prova non deve diventare un benchmark esteso. Due o tre unità complete,
ciascuna composta da lezione, pool e mappa, possono evidenziare regressioni
macroscopiche. È utile includere almeno un contenuto teorico e uno quantitativo
o tecnico.

## 16. Sequenza di rilascio proposta

1. Implementazione su branch dedicato.
2. Test mirati durante lo sviluppo.
3. Gate completo del repository e review indipendente.
4. Merge con configurazione candidata e rollback verificato.
5. Deploy mirato delle sole componenti modificate in DEV.
6. Smoke tecnico senza provider reale.
7. Autorizzazione separata per le poche generazioni reali di confronto.
8. Generazione delle unità complete di confronto: lezione, pool e mappa.
9. Valutazione umana degli output e della loro coerenza reciproca.
10. Eventuali correzioni di prompt, schema o parametri in DEV.
11. Decisione separata sull'eventuale distribuzione in PROD.

Il deploy PROD non rientra in questa proposta e richiederà una nuova
autorizzazione esplicita nel task in cui verrà eseguito.

## 17. Criteri di accettazione

La modifica è pronta per il gate umano in DEV quando:

- Economy risolve esclusivamente a GPT-6 Luna con il suo listino;
- Quality risolve esclusivamente a GPT-6.1 Sol con il suo listino;
- le lezioni inviano reasoning e verbosity secondo le tabelle concordate;
- pool, mappe e correzioni inviano i parametri specifici concordati;
- il nuovo prompt non contiene durata di un'ora, autoverifiche o copertura
  meccanica di ogni obiettivo;
- il prompt conserva sicurezza, delimitazione UDA e compatibilità Markdown;
- le nuove lezioni producono un'impronta didattica breve, valida e persistita;
- il pool usa concetti, capacità ed errori dell'impronta senza introdurre
  contenuti estranei alla lezione;
- le domande chiuse usano distrattori plausibili e diagnosticamente utili;
- la mappa è prodotta come grafo strutturato validabile;
- la rappresentazione della mappa viene composta dal server;
- le lezioni esistenti continuano a usare il percorso legacy senza nuove
  chiamate provider implicite;
- GPT-5.6 può essere ripristinato insieme al prompt precedente;
- il rollback ripristina anche schemi e comportamento legacy di pool e mappa;
- l'accounting considera correttamente la cache;
- i test automatici e la CI sono verdi;
- DEV supera lo smoke tecnico;
- nessuna modifica è stata distribuita in PROD.

## 18. Limiti della proposta

Un prompt, da solo, non garantisce la migliore lezione possibile per qualsiasi
disciplina. La qualità finale dipende anche dalla precisione dei metadati, dalle
indicazioni del docente, dal modello e dalla natura dell'argomento.

La proposta evita di dichiarare GPT-6.1 Sol superiore per le lezioni prima di
aver osservato output reali. Stabilisce invece una configurazione coerente e
reversibile con cui effettuare una valutazione significativa in DEV.
