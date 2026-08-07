# SchoolForge — Roadmap qualità e profondità delle lezioni generate

**Stato:** diagnosi conclusa e misurata; `LESSON-DEPTH-01` implementato ma **non
validato** (PR draft #353); `LESSON-DEPTH-02` pronto da eseguire (PR draft #355).
Nessun prompt nuovo è ancora passato dal benchmark. **Per riprendere il lavoro
partire dalla §10.**
**Data baseline:** 6 agosto 2026.
**Dipendenze:** M5 operativo su DEV con Gate G7 PASS; AIGEN-01→03,
AIGEN-PROMPT-01, AIGEN-CONTEXT-01, STRUCTURE-IMPORT-01→03 e SIMPLE-01 completati.

Questa roadmap affronta un solo problema, che il docente vive così: **le lezioni
generate con l'IA escono scarne.** Non è una percezione: la sezione 2 la misura.

Il flusso «dichiaro i metadati → genero la lezione» è il cuore del prodotto. Se
produce una lezione che il docente deve riscrivere, SchoolForge gli fa perdere
tempo invece di fargliene guadagnare, ed è la sola cosa che non può permettersi.

### Che cosa deve essere una lezione generata

Senza un bersaglio dichiarato non si può giudicare se una modifica migliora
qualcosa, quindi il bersaglio va scritto. Una lezione generata è accettabile
quando il docente **la porta in classe così com'è**.

In concreto significa che:

- **regge un'ora di lezione.** Non è un riassunto, non è una scaletta, non è un
  paragrafo: è il testo su cui uno studente studia e su cui un docente spiega;
- **ogni concetto chiave è sviluppato**, non nominato. Definirlo e passare oltre
  è il modo più comune di sembrare completi restando inutili;
- **è motivata.** Ogni affermazione a cui uno studente chiederebbe «perché?»
  riceve la risposta dove serve, non altrove;
- **è autosufficiente.** Si legge da sola, senza rimandi a ciò che il docente
  «dirà a voce» o ad altre lezioni;
- **contiene i passaggi intermedi**, cioè i prerequisiti e le definizioni che
  servono ad arrivare al concetto chiave, anche se nessuno li ha elencati.

La formulazione del docente è più diretta: *«le lezioni devono essere perfette,
senza se e senza ma»*. Operativamente il bersaglio è quello sopra; «perfetta»
qui non è un assoluto irraggiungibile, è **pronta all'uso senza riscrittura**.

### La regola economica che governa tutto

C'è un criterio che viene prima di ogni scelta tecnica, ed è quello che il
docente ha espresso così: *«i side concept sta al modello toccarli, non al
docente, altrimenti fa prima a scriverla lui a mano la lezione; deve far
risparmiare tempo, non richiederne di più del normale»*.

Da qui discende un vincolo che vale per **ogni** pacchetto futuro:

> Qualunque soluzione che richieda al docente di **descrivere di più** per
> ottenere una lezione migliore è una soluzione sbagliata, anche se funziona.

È la scorciatoia più tentante — «basta che il docente scriva cinque concetti
invece di due» — ed è esattamente il fallimento del prodotto: se compilare i
metadati costa quanto scrivere la lezione, lo strumento non serve. Il lavoro di
individuare i concetti di supporto appartiene al modello.

Questo non contraddice il perimetro: il docente resta l'autorità su **che cosa**
la lezione tratta. Non lo è su **quanto** e su **come** ci si arriva.

## 1. Principi invarianti

- I **concetti chiave dicono che cosa trattare, non quanto scrivere.** È il
  principio che governa tutta questa roadmap.
- L'unità di misura è la **lezione scolastica**, non il numero di voci che il
  docente ha digitato.
- Il perimetro resta vincolante: approfondire non significa divagare. Ogni
  ampliamento deve superare un criterio **decidibile**, non un'esortazione.
- I concetti di supporto sono **compito del modello**: il docente dichiara la
  meta, non ogni passo per arrivarci.
- Nessun prompt si considera valido senza **misura**. Il dataset congelato, la
  rubrica e lo split tuning/holdout esistono per questo.
- Il rigore epistemico già validato (niente dati inventati, niente causalità
  non provate, coerenza interna) **non si tocca**: si aggiunge profondità, non
  si toglie severità.
- **Nessuna soluzione può chiedere al docente di scrivere di più.** Il criterio
  economico sopra prevale: la ricchezza dell'input non è una leva ammessa.
- Il bersaglio è la lezione **pronta all'uso senza riscrittura**, non la lezione
  «migliore di prima».
- Nessuna modifica a Rules, indici, schema Firestore o dipendenze.

## 2. Evidenze — che cosa è stato misurato

**Il tetto di token non era il vincolo.** Ultima esecuzione reale registrata
(LESSON-TUNE-07, 4 agosto 2026, `gpt-5.6-luna`, quattro scenari holdout):

| Scenario | Profondità | Token di output | Tetto concesso | Utilizzo |
|---|---|---:|---:|---:|
| LM02-05 | complete | 6.164 | 9.000 | 68% |
| LM02-06 | complete | 3.628 | 9.000 | 40% |
| LT01-11 | in_depth | 4.567 | 15.000 | 30% |
| LT01-12 | in_depth | 4.538 | 15.000 | 30% |

Il modello si ferma da solo molto prima del limite, e a `in_depth` — dove il
tetto è quasi doppio — non produce più che a `complete`. **Alzare il tetto non
avrebbe cambiato nulla.**

**Il dataset di validazione non rappresenta l'uso reale.** Tutti e sei gli
scenari di tuning hanno **5-6 concetti chiave, 3 obiettivi e le indicazioni
docente compilate**. Le lezioni che hanno originato la segnalazione ne hanno
**2**, senza indicazioni. Il prompt è stato tarato su un input ricco in ogni
singolo caso; la configurazione povera non è mai stata misurata.

**Il contratto pedagogico è sbilanciato verso il taglio.** Conteggio sul prompt
congelato `lesson-tune-01-candidate-d-v1`:

| Categoria di istruzioni | Estensione | Operatività |
|---|---|---|
| Rigore epistemico | 14 righe | alta |
| Tetti alle attività | 4 righe | numerica |
| Sobrietà strutturale | 4 righe | alta |
| Controllo finale | 6 punti, 5 di potatura | alta |
| **Istruzioni che espandono** | **1 paragrafo** | **generica** |

L'unico acceleratore era «Non sacrificare spiegazioni per ragioni di brevità».
Quando un vincolo numerico compete con un'esortazione qualitativa, vince il
numero.

## 3. Diagnosi

La causa primaria è che **l'elenco dei concetti chiave faceva due lavori
insieme**: perimetro didattico e budget di contenuto. Il prompt chiedeva di
«fissare adeguatamente concetti chiave e obiettivi forniti» e di non trattare
«un argomento più ampio»: due concetti dichiarati diventavano due blocchi, e la
lezione usciva lunga la metà. Il modello non sbagliava, obbediva.

La catena, per esteso, è questa:

1. il docente dichiara due concetti chiave, perché sono davvero i due concetti
   della lezione — non sta sbagliando a compilare;
2. il prompt tratta quell'elenco come il **contenuto da produrre**, non come
   l'argomento da trattare;
3. il modello sviluppa due blocchi e considera il compito assolto;
4. nessuna istruzione gli dice che una lezione scolastica ha una consistenza
   propria, indipendente da quante voci ha ricevuto;
5. il controllo finale, tutto di verifica e potatura, gli fa semmai **togliere**
   qualcosa;
6. esce una lezione formalmente corretta, epistemicamente rigorosa e
   didatticamente insufficiente — la combinazione peggiore, perché supera ogni
   controllo automatico e fallisce l'unico che conta, cioè l'uso in classe.

Il punto 6 spiega anche perché il benchmark dava 12/12 PASS mentre il docente
vedeva lezioni scarne: la rubrica misurava correttezza e coerenza su un input
ricco, e su quello il modello lavorava bene davvero.

Cause concorrenti, in ordine di peso stimato:

1. la profondità era espressa solo in aggettivi («trattazione piena»), senza
   alcun criterio che dicesse al modello quando aveva finito;
2. il controllo finale era interamente di verifica e potatura: una rilettura
   senza contro-istruzione **comprime**;
3. i tetti alle attività erano identici a tutte le profondità;
4. il default della UI è `Completa`, e `Approfondita` non è descritta in modo da
   invogliare a provarla.

## 4. Decisioni da prendere

Sono aperte e bloccano i pacchetti indicati.

| # | Decisione | Blocca | Stato |
|---|---|---|---|
| D1 | Tetto di costo per operazione: resta condiviso con la correzione IA o diventa dedicato alla generazione di contenuti? | LESSON-DEPTH-03 | **aperta** |
| D2 | Nuovi valori di tetto per operazione, budget giornaliero e mensile. | LESSON-DEPTH-03 | **aperta** |
| D3 | Il ciclo di misura viene eseguito dal docente in locale (l'ambiente di sviluppo non ha `OPENAI_API_KEY`). | LESSON-DEPTH-02 | **aperta** |
| D4 | `Approfondita` diventa il default della UI, oppure resta `Completa` con una descrizione più esplicita? | LESSON-DEPTH-04 | **aperta** |

## 5. Pacchetti

### LESSON-DEPTH-00 — questa roadmap

Solo documentazione: diagnosi, evidenze, decisioni e sequenza. Nessun codice.

### LESSON-DEPTH-01 — candidato E: profondità e perimetro

**Implementato, non validato.** PR draft #353.

Separa perimetro e quantità nel contratto della lezione:

- blocco «Ampiezza e profondità» in cima al contratto, che prevale in caso di
  dubbio: i concetti chiave dicono che cosa, non quanto; l'unità è la lezione
  scolastica; **meno concetti chiave ⇒ più profondità**; i concetti di supporto
  li individua il modello;
- **criterio decidibile** contro le divagazioni: un contenuto è dentro il
  perimetro se togliendolo un concetto chiave diventa meno comprensibile, fuori
  se la sua assenza non toglie nulla;
- `DEPTH_SEMANTICS` ancorata al **singolo concetto chiave** invece che ad
  aggettivi, per i tre livelli;
- distinzione esplicita fra *più ampio* (vietato) e *più profondo* (richiesto);
- tetti alle attività condizionati alla profondità;
- **completezza come primo punto del controllo finale**, prima della potatura, ed
  è l'unico punto che può far crescere il testo;
- tetti di output 8.000 / 14.000 / 18.000, entro il limite di costo vigente;
- versione del prompt a `lesson-depth-01-candidate-e-v1`.

**DoD:** 13 test sul contratto, prompt del pool byte-identico, suite Functions e
web verdi. **Non mergiabile prima di LESSON-DEPTH-02.**

### LESSON-DEPTH-02 — dataset del caso povero e misura del candidato E

Dipende da: LESSON-DEPTH-01, D3.

Il benchmark attuale non può dire se il problema è risolto, perché non contiene
il caso che lo genera. Il pacchetto:

1. estende il dataset con scenari a **1, 2 e 3 concetti chiave** e **senza
   indicazioni docente**, su discipline diverse, in split `tuning`;
2. esegue la **baseline** (candidato D) su quegli scenari, per riprodurre il
   problema in modo misurabile invece che a impressione;
3. esegue il **candidato E** sugli stessi scenari e sugli 8 di tuning esistenti;
4. confronta con la rubrica congelata a 15 criteri, con attenzione a
   `Profondità coerente con depth`, `Densità informativa` e `Perimetro`;
5. solo se il candidato E non peggiora nessun criterio e migliora la profondità
   sul caso povero, procede all'**holdout**.

**DoD:** report di confronto in `evidenze/`, token di output prima/dopo per
scenario, verdetto esplicito. Un peggioramento del perimetro è un **blocker**:
significherebbe che il modello ha smesso di divagare meno.

**Stato:** il dataset è pronto — `evidenze/lesson-depth-02-sparse.json`, sei
scenari su sei discipline con 1, 2 e 3 concetti chiave, tutti senza indicazioni
docente, di cui uno a profondità `in_depth` per separare le due variabili. Il
modulo `lessonDepthSparseBenchmark.ts` lo consegna al pianificatore esistente,
quindi non esiste un secondo runner. **Resta da eseguire** (D3).

Il dataset è deliberatamente **separato** da quello congelato di LESSON-TUNE-01,
che non viene toccato: le evidenze 01→07 devono restare riproducibili
esattamente com'erano.

**Esecuzione.** Il CLI è compilato, quindi si passa da `pnpm build`. Senza i due
flag espliciti l'esecuzione è una simulazione a costo zero, che è il modo giusto
di controllare il piano prima di pagare:

```bash
cd functions
pnpm build

# 1. Simulazione: stampa il piano e i costi, non chiama nessuno.
SPARSE=1 pnpm benchmark:lesson-tune-quality \
  --benchmark-split=tuning --benchmark-model-profile=quality

# 2. Esecuzione reale.
SPARSE=1 OPENAI_API_KEY=… pnpm benchmark:lesson-tune-quality \
  --benchmark-split=tuning --benchmark-model-profile=quality \
  --execute-real-openai --i-understand-this-costs-money
```

Va lanciato **due volte**: una su `main` (candidato D, la baseline) e una sul
ramo di LESSON-DEPTH-01 (candidato E). Il confronto è fra i due report.

L'output finisce in `functions/lib/lesson-tune-01-tuning-<timestamp>/`, con
`lesson-tune-01-report.json` — token, costi ed esiti per scenario — accanto ai
Markdown generati, uno per scenario.

**Costo reale, calcolato dal pianificatore:**

| Profilo | Chiamate | Stima | Tetto prudenziale |
|---|---:|---:|---:|
| `economy` | 6 | 0,076 USD | 0,176 USD |
| `quality` | 6 | 0,366 USD | 0,850 USD |

Due esecuzioni su `quality` costano quindi circa **0,73 USD stimati**, con un
tetto prudenziale di 1,70 USD: rientra nel budget mensile da 5 USD, ma non è
trascurabile come sembrava. Su `economy` il ciclo completo sta sotto i 0,16 USD
e resta un'opzione se serve solo l'ordine di grandezza della differenza.

### LESSON-DEPTH-02B — dataset isovariante e misura a variabile singola

Dipende da: LESSON-DEPTH-02 (eseguito).

**Esito della misura A/B su dataset sparse** (A = candidato D, B = candidato E,
profilo `quality`, split `tuning`), parole per scenario:

| Scenario | Conc. | Depth | A | B | Δ |
|---|---:|---|---:|---:|---:|
| LD02-01 grammatica | 1 | complete | 1.141 | 1.498 | +31% |
| LD02-02 fisica | 1 | complete | 1.205 | 1.423 | +18% |
| LD02-03 storia | 2 | complete | 1.958 | 2.290 | +17% |
| LD02-04 programmazione | 2 | complete | 1.653 | 1.874 | +13% |
| LD02-05 biologia | 3 | complete | 1.275 | 1.818 | +43% |
| LD02-06 matematica | 2 | **in_depth** | 1.285 | 2.230 | +74% |

Il candidato E migliora tutti e sei gli scenari e corregge il difetto più grave
trovato in A: `in_depth` produceva meno testo di `complete` a parità di
concetti, e ora produce il testo più lungo del set. Il guadagno è massimo dove
l'input era più povero, che è il comportamento voluto.

**Ma il dataset sparse non può reggere la conclusione più importante.** Il suo
disegno fa variare due cose insieme — disciplina e numero di concetti — quindi
il residuo «+43% da uno a due concetti» non è attribuibile: LD02-05 ha tre
concetti e meno testo di uno scenario a due, il che mostra che la materia pesa
quanto il conteggio. Il difetto è nel disegno, non nella misura.

Il dataset `lesson-depth-03-isovariant-v1` corregge esattamente questo. Gli
scenari sono organizzati in **terne**: stessa materia, stessa lezione, stessi
obiettivi, stessa UDA, stessa profondità; cambia soltanto quanti concetti chiave
sono dichiarati, e i concetti sono **annidati come prefisso** (1 ⊂ 2 ⊂ 3). Due
terne su discipline diverse — storia e fisica — perché una sola non
distinguerebbe il comportamento del prompt da una peculiarità della materia. Il
parser rifiuta il caricamento se un solo invariante del disegno cade: un dataset
degradato continuerebbe a produrre numeri, ma i numeri non significherebbero più
quello che diciamo che significano.

**L'esito è decidibile senza rubrica:** se il prompt tratta i concetti chiave
come *perimetro*, le tre lezioni di una terna hanno lunghezza simile; se li
tratta come *budget di contenuto*, la lunghezza cresce con il conteggio — ed è
il difetto che LESSON-DEPTH-01 deve eliminare.

Esecuzione: identica a LESSON-DEPTH-02, con `ISOVARIANT=1` al posto di
`SPARSE=1` (le due variabili sono alternative e il comando si ferma se sono
attive entrambe, perché il report non direbbe da solo quale dataset è stato
eseguito). Sei chiamate su `quality`: stesso costo di un'esecuzione B.

**DoD:** una esecuzione reale sul dataset isovariante con il candidato E;
verdetto sul merge di LESSON-DEPTH-01 fondato su una variabile isolata; se la
lunghezza resta proporzionale al conteggio, apertura di un candidato F.

### LESSON-DEPTH-03 — limiti di spesa

Dipende da: LESSON-DEPTH-02 (per avere numeri fondati), D1, D2.

Oggi il vincolo non è tecnico ma economico, ed è a tre livelli:

| Limite | Valore | Alzabile da Firestore | Note |
|---|---|---|---|
| `MAX_OPERATION_COST_MICRO_USD` | 0,25 USD | no, solo abbassabile | condiviso con la correzione IA |
| `MAX_DAILY_BUDGET_MICRO_USD` | 1 USD | no, solo abbassabile | |
| `MAX_MONTHLY_BUDGET_MICRO_USD` | 5 USD | no, solo abbassabile | **il muro vero** |

Tre fatti da tenere fermi:

- il tetto per operazione vale sulla **prenotazione**, non sull'addebito:
  alzarlo non aumenta la spesa, cambia soltanto che cosa viene **rifiutato**;
- sono `hard ceiling` approvati in HG-M5-2/3: alzarli è una modifica di codice e
  una scelta di governance, non una correzione;
- il tetto per operazione è condiviso con la correzione IA, dove un'operazione
  raggruppa molte consegne: il raggio d'azione è più largo di una lezione (D1).

Con il listino `quality`, il tetto per operazione colloca il massimo di
`in_depth` a ~19.000 token a 0,25 USD e ~39.000 a 0,50 USD — quest'ultimo molto
oltre l'estensione di una lezione scolastica. **Il limite che si incontrerà per
primo è il budget mensile**, non quello per operazione.

**DoD:** limiti aggiornati con valori giustificati dai token realmente misurati
in LESSON-DEPTH-02; test di budget verdi su entrambi i profili; documentata la
scelta D1.

### LESSON-DEPTH-04 — la UI dice quanto conta l'input

Dipende da: LESSON-DEPTH-02, D4.

Se la ricchezza dei metadati determina la profondità, il docente deve saperlo
**mentre compila**, non scoprirlo dopo la generazione. Nel perimetro:

- default e descrizione dei livelli di profondità (D4);
- rendere evidente che concetti chiave e obiettivi guidano la lezione, e che le
  indicazioni docente sono un vincolo applicato davvero;
- nessun nuovo campo obbligatorio, nessun wizard, nessun passaggio in più: se
  compilare diventa lungo, il docente fa prima a scrivere la lezione a mano.

**Fuori perimetro:** suggerimenti automatici di concetti chiave generati dall'IA.
Sarebbe una seconda chiamata a modello e una seconda superficie di costo, e va
valutata a parte.

### Gate GLESSON

Chiusura della roadmap. Richiede:

- candidato E validato su tuning **e** holdout, senza regressioni di perimetro;
- caso povero (1-2 concetti chiave, senza indicazioni) misurato prima e dopo,
  con miglioramento dimostrato della profondità;
- limiti di spesa coerenti con i token realmente prodotti;
- smoke DEV su una lezione reale del docente;
- evidenze in `evidenze/`.

## 6. Sequenza autorizzata

```
LESSON-DEPTH-00 (questa roadmap)
  └── LESSON-DEPTH-01  candidato E                      [implementato, non validato]
        └── LESSON-DEPTH-02  dataset povero + misura    ← blocca il merge di 01
              ├── LESSON-DEPTH-03  limiti di spesa
              └── LESSON-DEPTH-04  UI dell'input
                    └── Gate GLESSON
```

Nessuna fase può dichiarare implementata la precedente senza le evidenze
previste. In particolare **LESSON-DEPTH-01 non va mergiato prima di 02**: un
prompt non misurato che sostituisce un prompt 12/12 PASS è un peggioramento
possibile travestito da miglioramento.

## 7. Costi

| Voce | Stima |
|---|---|
| LESSON-DEPTH-02, baseline caso povero | ~0,10 USD |
| LESSON-DEPTH-02, candidato E su tuning esteso | ~0,25 USD |
| LESSON-DEPTH-02, holdout | ~0,13 USD |
| **Totale del ciclo di validazione** | **~0,50 USD** |

A regime, una lezione oggi costa ~0,03 USD. Se il candidato E raddoppia
l'estensione, si va verso ~0,06-0,08 USD per lezione: è la voce che i budget
giornaliero e mensile devono accogliere.

## 8. Fuori scope

- generazione automatica dei concetti chiave o degli obiettivi;
- modifiche al prompt del **pool**, che resta byte-identico;
- modifiche al rigore epistemico già validato;
- cambio di modello o di profilo;
- Rules, indici, schema Firestore, dipendenze;
- deploy PROD.

## 9. Rischi

- **Il candidato E allunga senza approfondire.** È il rischio principale, ed è
  il motivo per cui la rubrica misura `Densità informativa` accanto alla
  profondità: una lezione più lunga e più diluita è un peggioramento.
- **Il criterio del perimetro non regge.** Se il modello comincia a trattare
  argomenti vicini ma non richiesti, il criterio decidibile va irrigidito prima
  del merge, non dopo.
- **Il caso povero non è risolvibile solo dal prompt.** Con un concetto chiave
  solo, una lezione formativa completa potrebbe richiedere che il modello
  costruisca gran parte della progressione: è esattamente ciò che si chiede, ma
  va verificato che non produca contenuto arbitrario.
- **Il budget mensile diventa il collo di bottiglia** prima che la qualità sia
  soddisfacente, e la decisione si sposta da tecnica a economica.

## 10. Stato operativo e ripresa

Questa sezione è **volatile**: serve a chi riprende il lavoro — persona o agente
— a sapere in trenta secondi dove siamo e qual è la prossima azione. Va
aggiornata o rimossa quando il Gate GLESSON chiude.

**Ultimo aggiornamento:** 6 agosto 2026.

### 10.1 La prossima azione, in una riga

**Eseguire il confronto A/B del benchmark** (§5, LESSON-DEPTH-02) e portare i due
report. Tutto il resto è pronto e verde; senza quella misura non si merga nulla.

### 10.2 Rami e PR

| Ramo | PR | Contenuto | Stato |
|---|---|---|---|
| — | #354 | Questa roadmap | **mergiata** |
| `lesson-depth-01` | #353 | Candidato E del prompt | aperta, draft, CI verde |
| `lesson-depth-02-sparse` | #355 | Dataset del caso povero | aperta, draft, CI verde |
| `lesson-depth-ab` | nessuna | Ramo di **sola misura**: dataset povero + candidato E | **non va mergiato** |

`lesson-depth-ab` esiste perché dataset e prompt vivono su due rami diversi:
eseguire la seconda misura da `lesson-depth-01` girerebbe sul dataset congelato
**senza segnalarlo**, ed è il modo peggiore di sbagliare — il report sembrerebbe
valido.

### 10.3 Che cosa cambia il candidato E

In `aiContentPrompt.ts`, sei modifiche: blocco «Ampiezza e profondità» in cima al
contratto; `DEPTH_SEMANTICS` ancorata al singolo concetto chiave; distinzione fra
*più ampio* (vietato) e *più profondo* (richiesto); criterio decidibile del
perimetro; tetti alle attività condizionati alla profondità; completezza come
primo punto del controllo finale. In `aiContentPayload.ts`, tetti di output
8.000 / 14.000 / 18.000. Versione del prompt a `lesson-depth-01-candidate-e-v1`.

Il prompt del **pool** resta byte-identico, ancorato a SHA-256 in test.

### 10.4 Come si esegue la misura

Due esecuzioni, stessa riga di comando, rami diversi:

| | Ramo | Prompt atteso nel report |
|---|---|---|
| **A — baseline** | `lesson-depth-02-sparse` | `lesson-tune-01-candidate-d-v1` |
| **B — candidato E** | `lesson-depth-ab` | `lesson-depth-01-candidate-e-v1` |

```bash
git checkout <ramo>
cd functions
pnpm build

# Simulazione, costo zero: verifica il piano prima di pagare.
SPARSE=1 node lib/lessonTuneQualityCli.js \
  --benchmark-split=tuning --benchmark-model-profile=quality

# Esecuzione reale.
SPARSE=1 OPENAI_API_KEY=sk-… node lib/lessonTuneQualityCli.js \
  --benchmark-split=tuning --benchmark-model-profile=quality \
  --execute-real-openai --i-understand-this-costs-money
```

In PowerShell le variabili si impostano prima, con
`$env:SPARSE = "1"`, e il comando va su una riga sola.

L'output finisce in `functions/lib/lesson-tune-01-tuning-<timestamp>/`:
`lesson-tune-01-report.json` più un Markdown per scenario. **`functions/lib` è in
`.gitignore`**, quindi i report restano locali e vanno copiati a mano se servono
altrove.

### 10.5 Perché un agente non può eseguirla

Il CLI ha tre guardrail espliciti, ed è giusto che li abbia:

1. `nodeMajorVersion !== 22` ⇒ rifiuto;
2. `!stdinIsTTY || !stdoutIsTTY` ⇒ rifiuto — un ambiente automatico non ha un
   terminale interattivo;
3. conferma da digitare a mano: `ESEGUI 8 LEZIONI TUNING REALI QUALITY` (dice
   «8» perché è il testo fisso del profilo; le chiamate reali sono 6).

Il secondo esiste **apposta** per impedire che uno script, una CI o un agente
spendano sul conto OpenAI senza una persona presente. Non va aggirato per
comodità: chi riprende il lavoro faccia eseguire la misura a una persona, oppure
proponga esplicitamente al proprietario di introdurre una modalità non
interattiva, che è una decisione di governance e non un dettaglio tecnico.

Nell'ambiente di sviluppo remoto non esiste `OPENAI_API_KEY`, e anche
aggiungendola il guardrail 2 resterebbe.

### 10.6 Come si legge il risultato

Nell'ordine, dal più decisivo:

1. **Token di output di LD02-01/02 (un concetto) contro LD02-05 (tre).** Se nel
   candidato E la lunghezza smette di essere proporzionale al numero di concetti,
   il principio ha funzionato. È la domanda originale.
2. **`Profondità coerente con depth`** e **`Densità informativa`** sulla rubrica:
   una lezione più lunga e più diluita è un peggioramento, non un progresso.
3. **`Perimetro`**: se peggiora, il candidato E ha smesso di divagare meno. È un
   **blocker**, non un compromesso accettabile.
4. Lettura a occhio di `LD02-03` (storia, due concetti) nelle due versioni.

**Criterio di decisione.** Merge di #353 solo se: nessun criterio della rubrica
peggiora, il perimetro resta intatto e la profondità migliora sul caso povero.
Altrimenti candidato F, ripartendo dal punto che i numeri indicano.

### 10.7 Trappole già incontrate

- I flag del CLI sono `--benchmark-split=` e `--benchmark-model-profile=`, non
  `--split`/`--profile`: documentato sbagliato una prima volta.
- Da dentro `functions/`, `pnpm benchmark:lesson-tune-quality` fallisce perché
  pnpm risolve lo script sul workspace radice: usare `node lib/…`.
- Il CLI scrive in `lib/` **relativo alla cartella corrente**: va lanciato da
  `functions/`.
- `estimatedCostMicroUsd` assume che il modello riempia tutto il budget di
  output, cosa che non fa: in LESSON-TUNE-07 il costo reale è stato il 38% della
  stima. Attesi ~0,34 USD reali per le due esecuzioni su `quality`.

### 10.8 Alternativa senza benchmark

Se la misura formale resta bloccata, esiste una verifica più povera ma non
inutile: generare **due lezioni a mano dall'app**, stesso titolo e stessi due
concetti chiave, una con il prompt attuale e una dopo aver deployato il candidato
E su DEV, e leggerle affiancate. Non produce punteggi e non chiude il Gate, ma
risponde alla domanda «il problema è risolto?» senza Node 22 e senza CLI.
