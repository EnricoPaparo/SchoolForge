# Qualità dei pool generati — roadmap POOL-TUNE

Stato: **POOL-TUNE-00 implementato; il profile probe reale ha già rilevato un
blocker strutturale su `PT00-01/economy` e deve completare le altre sette
combinazioni; POOL-TUNE-01 ancora aperto.**

Questa roadmap definisce come misurare e migliorare il prompt dei pool senza
ottimizzarlo su pochi esempi favorevoli. Il contratto canonico del pool, il
parser, il mapper, la persistenza e l'interfaccia non cambiano in questa fase.

## 1. Obiettivo

Un pool valido non basta: deve verificare davvero la lezione. Il benchmark deve
misurare insieme:

- fedeltà esclusiva al contenuto fornito;
- copertura equilibrata dei concetti chiave;
- chiarezza e autonomia delle domande, senza riferimenti alla posizione nel
  testo o alla «lezione» come oggetto;
- profondità cognitiva e ragionamento, non soltanto richiamo mnemonico;
- difficoltà coerente con il compito richiesto;
- soluzioni aperte formative, esaustive e passo-passo quando il quesito è un
  esercizio;
- distrattori credibili e soluzioni inequivocabili nelle domande chiuse;
- varietà, assenza di duplicazioni sostanziali e utilità didattica complessiva.

## 2. Dataset congelato

La fonte è
[`evidenze/pool-tune-00-dataset.json`](evidenze/pool-tune-00-dataset.json).
Contiene 12 lezioni reali già prodotte e validate nel tuning Quality delle
lezioni, copiate byte per byte in `evidenze/pool-tune-00-sources/` e ancorate a
SHA-256:

- 8 scenari `tuning`, utilizzabili per confrontare profili e candidati;
- 4 scenari `holdout`, vietati durante la modifica del prompt e apribili una
  sola volta dopo il congelamento del candidato;
- teoria, esercizi numerici, diagnosi tecnica, analisi storica, correzione di
  misconcezioni, debugging, argomentazione, basi di dati, reti e sistemi.

Per ogni scenario sono congelati livello, quantità per tipo, indicazioni del
docente, obiettivi di copertura e obiettivi di ragionamento. Gli ultimi due
servono soltanto alla valutazione: **non vengono mai inviati al provider**.

## 3. Profili e fasi

### POOL-TUNE-00 — infrastruttura (questa fase)

- dataset, sorgenti e hash congelati;
- runner locale dry-run di default;
- riuso del prompt, payload, validazione semantica, profili, listini e cost model
  effettivi;
- identità separata `AI_POOL_PROMPT_VERSION`, perché la versione condivisa era
  avanzata con il tuning delle lezioni mentre il prompt pool restava invariato;
- zero Firestore, Storage, callable o scritture applicative;
- nessuna chiamata OpenAI senza doppio flag, TTY, Node 22, chiave e frase esatta.

### POOL-TUNE-01 — profile probe

Quattro scenari rappresentativi sono eseguiti in coppia con input identico:
`economy` e `quality`, otto chiamate reali complessive. Si confrontano qualità,
blocker e costo. Il profilo da usare nel tuning viene deciso prima di modificare
il prompt; non è ammessa una promozione automatica del profilo runtime.

Frase di autorizzazione:

`ESEGUI 8 POOL PROFILE REALI`

### POOL-TUNE-02 — tuning

Si eseguono gli otto scenari `tuning` con un solo profilo e una versione di
prompt registrata. Un candidato può cambiare esclusivamente il prompt del pool;
dataset, richieste, schema, cap e criteri restano fermi. Ogni nuovo lotto reale
richiede una nuova autorizzazione esplicita.

Frasi:

- `ESEGUI 8 POOL TUNING REALI ECONOMY`
- `ESEGUI 8 POOL TUNING REALI QUALITY`

### POOL-TUNE-03 — holdout e congelamento

Dopo il verdetto sul tuning il candidato viene congelato. Solo allora si
eseguono i quattro holdout, una volta sola, senza ritoccare il prompt in base al
loro contenuto. Un fallimento riapre il lavoro con un nuovo candidato e un nuovo
protocollo: l'holdout già visto non torna a essere tuning nascosto.

Frasi:

- `ESEGUI 4 POOL HOLDOUT REALI ECONOMY`
- `ESEGUI 4 POOL HOLDOUT REALI QUALITY`

## 4. Rubrica 0–4

Ogni pool riceve un punteggio intero per ciascuna dimensione applicabile:

| Punteggio | Significato |
|---|---|
| 0 | Assente, errato o inutilizzabile. |
| 1 | Grave insufficienza; richiede riscrittura sostanziale. |
| 2 | Parziale; utilizzabile solo dopo correzioni importanti. |
| 3 | Buono; sono ammesse soltanto correzioni locali. |
| 4 | Eccellente, preciso e immediatamente utilizzabile. |

Dimensioni congelate:

1. fedeltà alla fonte;
2. copertura;
3. chiarezza e autonomia;
4. profondità cognitiva;
5. calibrazione della difficoltà;
6. qualità delle soluzioni aperte;
7. qualità delle domande chiuse;
8. varietà e non duplicazione;
9. ragionamento e applicazione;
10. utilità formativa.

Le dimensioni non applicabili sono dichiarate `N/A` e non entrano nella media;
non possono essere trasformate in un 4 implicito.

## 5. Blocker

Un solo blocker impedisce il PASS, indipendentemente dalla media:

- soluzione errata;
- contenuto richiesto non sostenuto dalla fonte;
- domanda chiusa ambigua o con soluzione non univoca;
- soluzione aperta incompleta rispetto a quanto richiesto;
- esercizio incoerente, con dati insufficienti o irrisolto;
- riferimento alla posizione nella lezione («il terzo passaggio», «come detto
  sopra»);
- duplicazione sostanziale di domande;
- squilibrio grave di copertura.

## 6. Soglie di accettazione

Un candidato passa il tuning solo se:

- il 100% degli output supera la validazione strutturale e semantica;
- non compare alcun blocker;
- ogni dimensione applicabile è almeno 3/4;
- la media complessiva è almeno 3,4/4;
- `fedelta_alla_fonte` e `qualita_soluzioni_aperte`, quando applicabile, hanno
  media almeno 3,5/4.

L'holdout passa con le stesse condizioni, calcolate separatamente. Il verdetto
finale richiede PASS sia sul tuning sia sull'holdout; i punteggi non vengono
aggregati per nascondere un fallimento del secondo.

## 7. Procedura di review

Per ciascun output si conserva il JSON originale e si compila una scheda con:

- punteggi e motivazione breve per dimensione;
- blocker presenti;
- copertura dei target congelati, con domande che li verificano;
- duplicazioni o lacune;
- controllo puntuale di ogni soluzione e distrattore;
- modifiche minime che un docente dovrebbe apportare;
- verdetto `PASS`, `REVISIONE_LOCALE` o `REVISIONE_SOSTANZIALE`.

La review deve leggere prima la fonte e poi il pool. Non valuta il tono in
astratto e non premia la lunghezza: premia precisione, spiegazione e valore
diagnostico.

## 8. Runner e sicurezza economica

Comando, dalla root del repository dopo la build Functions:

`pnpm --filter @schoolforge/functions benchmark:pool-tune`

Senza flag produce soltanto il piano dei costi: non legge la API key, non crea il
provider e non usa la rete. L'esecuzione reale richiede entrambi i flag
`--execute-real-openai` e `--i-understand-this-costs-money`, una fase, il profilo
quando previsto, Node 22, terminale interattivo e la frase esatta mostrata dal
runner. Gli output restano in `functions/lib/`, fuori da Firestore e Storage.

### 8.1 Checkpoint e ripresa

Ogni sessione reale crea la propria directory in `functions/lib/` **prima**
della prima chiamata e aggiorna in modo atomico il report dopo ogni risposta del
provider. Il report può essere `running`, `failed` o `complete`. Un pool valido
viene conservato come campione; un output ricevuto ma respinto dal contratto
semantico viene conservato separatamente come evidenza negativa e conta come
combinazione già eseguita. Solo un errore che non produce una risposta
revisionabile (`pre_invocation` o `invocation_unknown`) interrompe la sessione e
lascia quella combinazione da ritentare.

La ripresa richiede gli stessi flag economici, una nuova conferma interattiva e
`--resume-session=<directory>`. Prima della rete il runner rilegge e valida
fail-closed:

- versione di dataset, rubrica e prompt, fase, profilo, piano e tetto di costo;
- prefisso esatto degli scenari e dei profili previsti, comprendendo campioni
  validi e output rifiutati;
- ogni JSON valido tramite il contratto semantico del pool e il DTO persistito
  canonico;
- ogni JSON rifiutato riproducendo lo stesso errore semantico registrato;
- usage, listino, costo per risultato e totale;
- stato e identità dell'eventuale errore.

Una ripresa chiama il provider soltanto per il suffisso mancante. Un checkpoint
completo rimasto `running` per un'interruzione fra l'ultimo salvataggio e la
finalizzazione viene marcato `complete` senza leggere la API key e senza nuove
chiamate. Directory esterne a `functions/lib`, report incompleti, alterati o
appartenenti a un altro piano sono rifiutati; non vengono corretti né
sovrascritti.

Il formato `pool-tune-session-v2` conserva anche il raw output rifiutato. Un
checkpoint legacy v1 che si era fermato su un errore di validazione viene
recuperato senza ripetere la chiamata, ma resta marcato esplicitamente come
`legacy_checkpoint_without_raw`: non inventa usage, costo o risposta perduti e
non può essere revisionato oltre al blocker registrato.

### 8.2 Evidenza del tentativo interrotto del 10 agosto 2026

Il primo profile probe reale ha completato in memoria le prime quattro
combinazioni e ha ricevuto `invocation_unknown` su `PT00-04/economy`, la quinta.
La versione del runner allora disponibile scriveva soltanto al termine del lotto:
non è stata creata una directory di output e i primi quattro pool non sono
revisionabili. Il tentativo **non produce alcun verdetto qualitativo** e non
completa POOL-TUNE-01.

Il costo effettivo non è ricostruibile dall'output locale. Il limite prudenziale
per le cinque combinazioni che possono avere raggiunto il provider è
`201.192 µUSD` (`0,201192 USD`); la loro stima nominale era `65.389 µUSD`. Non si
dichiara come costo reale né l'uno né l'altra. Poiché il vecchio runner non ha
salvato checkpoint, la prossima esecuzione autorizzata dovrà ripartire dall'intero
profile probe; da quel momento un'eventuale nuova interruzione sarà riprendibile.

### 8.3 Evidenza del nuovo tentativo dell'11 agosto 2026

Il nuovo profile probe ha ricevuto una risposta per `PT00-01/economy`, ma il
validator l'ha respinta con «La soluzione deve riferirsi alle opzioni fornite»:
almeno una domanda chiusa indicava quindi una soluzione fuori dall'insieme delle
opzioni. È già un **blocker** e impedisce al profilo Economy di superare il probe
col prompt corrente.

La versione v1 del checkpoint ha conservato scenario, profilo e motivo, ma non
raw output né usage. Il loader v2 la rappresenta come evidenza legacy
incompleta, assume costo non conoscibile e riparte dalla seconda combinazione:
restano **sette** chiamate, senza ripagare `PT00-01/economy`. Il profile probe non
ha ancora un verdetto comparativo: deve completare il suffisso e revisionare gli
output validi e rifiutati.

## 9. Gate GPOOL-QUALITY

Il gate resta **APERTO** finché non sono completati profile probe, tuning e
holdout con evidenze revisionate. POOL-TUNE-00 dimostra soltanto che il protocollo
è riproducibile e fail-closed: non afferma ancora che il prompt attuale sia
buono, né autorizza modifiche runtime o deploy.
