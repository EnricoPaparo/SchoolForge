# SchoolForge — Roadmap qualità e profondità delle lezioni generate

**Stato:** diagnosi conclusa e misurata; `LESSON-DEPTH-01` implementato ma **non
validato** (PR draft #353). Nessun prompt nuovo è ancora passato dal benchmark.
**Data baseline:** 6 agosto 2026.
**Dipendenze:** M5 operativo su DEV con Gate G7 PASS; AIGEN-01→03,
AIGEN-PROMPT-01, AIGEN-CONTEXT-01, STRUCTURE-IMPORT-01→03 e SIMPLE-01 completati.

Questa roadmap affronta un solo problema, che il docente vive così: **le lezioni
generate con l'IA escono scarne.** Non è una percezione: la sezione 2 la misura.

Il flusso «dichiaro i metadati → genero la lezione» è il cuore del prodotto. Se
produce una lezione che il docente deve riscrivere, SchoolForge gli fa perdere
tempo invece di fargliene guadagnare, ed è la sola cosa che non può permettersi.

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

**Costo stimato:** ~0,25 USD per il ciclo di tuning, ~0,13 USD per l'holdout.

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
