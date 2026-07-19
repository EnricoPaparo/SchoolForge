# SchoolForge — contratto tecnico pool V2

**Stato:** POOL-SIMPLE-01 implementa contratto, parser, serializer, fixture e template;
POOL-SIMPLE-02 e Gate GPOOL restano aperti.
**Data inventario:** 18 luglio 2026.
**Data implementazione contratto V2:** 20 luglio 2026.
**Prerequisito:** pulizia completa dei dati DEV dipendenti dal pool V1 prima del rollout.
**Dipendenza:** POOL-SIMPLE deve superare Gate GPOOL prima di VEX — Varianti equivalenti.

Per mantenere il workspace compilabile tra 01 e 02, l'editor produce già Markdown V2 e
i writer dell'indice usano temporaneamente `peso: 1` nella vecchia forma persistente.
Questo ponte non appartiene al contratto Markdown, non accetta V1 e deve essere rimosso
con tipi, picker e snapshot in POOL-SIMPLE-02. Nessun deploy applicativo è autorizzato
prima del completamento coordinato di 02.

## 1. Decisione e motivazione

Il contratto attuale usa due indicatori sovrapposti, `difficolta` e `peso`, e deriva
`maxPoints` dal loro prodotto. Questa duplicazione aumenta le combinazioni possibili,
espone concetti simili nell'editor e propaga `peso` in indice, snapshot, PDF e flussi di
correzione senza aggiungere un'informazione pedagogica necessaria.

Il contratto definitivo usa un solo indicatore quantitativo:

```text
difficolta = intero 1..5
maxPoints = difficolta
```

`peso` viene eliminato. `maxPoints` resta necessario nelle forme runtime congelate e
nei risultati di correzione, ma è sempre derivato dalla difficoltà della domanda e non
viene scritto nel Markdown. I punti attribuiti durante la correzione restano compresi
tra `0` e `maxPoints`, con incrementi di `0,25`.

Non esiste compatibilità legacy: V1 e file contenenti campi rimossi sono errori, non
input da convertire o tollerare.

## 2. Contratto canonico `schoolforge-pool/v2`

### 2.1 Struttura comune

Il file `.pool.md` contiene front matter YAML delimitato da `---`:

| Campo | Contratto |
|---|---|
| `schema` | Obbligatorio, valore esatto `schoolforge-pool/v2`. |
| `questions` | Obbligatorio, array di domande. Può essere vuoto. |
| `id` | Obbligatorio, stringa univoca nel pool, pattern `[a-z0-9-]+`. |
| `tipo` | Obbligatorio: `aperta`, `chiusa_singola` o `chiusa_multipla`. |
| `difficolta` | Obbligatorio, numero intero appartenente a `1 | 2 | 3 | 4 | 5`. |
| `testo` | Obbligatorio, stringa non vuota. |
| `soluzione` | Obbligatoria e coerente con il tipo. |
| `peso` | Vietato. La presenza rende invalida la domanda. |
| `maxPoints` | Vietato nel YAML; viene derivato come `difficolta`. |

Gli oggetti sono strict: campi sconosciuti non vengono ignorati silenziosamente.
Gli ID delle opzioni rispettano `[a-z0-9-]+` e sono univoci nella domanda.

### 2.2 Tipi domanda

**Aperta**

- `soluzione`: stringa non vuota, usata come riferimento e non come unica formulazione valida;
- `maxCharacters`: opzionale, solo per `aperta`, intero tra `1` e `10000`;
- se `maxCharacters` è assente, il limite effettivo è `2000`;
- `opzioni` non è ammesso.

**Chiusa singola**

- `opzioni`: almeno due elementi `{ id, testo }`;
- `soluzione`: array contenente esattamente un ID di opzione esistente;
- `maxCharacters` non è ammesso.

**Chiusa multipla**

- `opzioni`: almeno due elementi `{ id, testo }`;
- `soluzione`: array non vuoto di ID esistenti, senza duplicati;
- la soluzione contiene meno elementi del numero totale di opzioni;
- `maxCharacters` non è ammesso.

### 2.3 Tipo TypeScript target

```ts
type Difficolta = 1 | 2 | 3 | 4 | 5;

type PoolQuestionBase = {
  id: string;
  tipo: 'aperta' | 'chiusa_singola' | 'chiusa_multipla';
  difficolta: Difficolta;
  testo: string;
  maxPoints: number; // derivato: sempre uguale a difficolta
};

type ParsedPool = {
  schema: 'schoolforge-pool/v2';
  questions: PoolQuestion[];
};
```

Il tipo parsed non contiene `peso`. Parser e costruttori producono
`maxPoints: question.difficolta`; serializer omette sempre `maxPoints`.

## 3. Esempi YAML validi

### 3.1 Domanda aperta

```yaml
---
schema: schoolforge-pool/v2
questions:
  - id: q-001
    tipo: aperta
    difficolta: 4
    maxCharacters: 2000
    testo: Spiega il modello client-server.
    soluzione: Il client invia una richiesta e il server elabora una risposta.
---
```

`maxPoints` derivato: `4`.

### 3.2 Domanda chiusa singola

```yaml
---
schema: schoolforge-pool/v2
questions:
  - id: q-002
    tipo: chiusa_singola
    difficolta: 2
    testo: Quale protocollo protegge HTTP con TLS?
    opzioni:
      - id: a
        testo: HTTPS
      - id: b
        testo: FTP
      - id: c
        testo: DNS
    soluzione: [a]
---
```

`maxPoints` derivato: `2`.

### 3.3 Domanda chiusa multipla

```yaml
---
schema: schoolforge-pool/v2
questions:
  - id: q-003
    tipo: chiusa_multipla
    difficolta: 5
    testo: Quali sono protocolli del livello applicativo?
    opzioni:
      - id: a
        testo: HTTP
      - id: b
        testo: DNS
      - id: c
        testo: Ethernet
      - id: d
        testo: SMTP
    soluzione: [a, b, d]
---
```

`maxPoints` derivato: `5`.

## 4. Input invalidi e messaggi attesi

I messaggi definitivi possono seguire il formato strutturato già esistente
(`fileName`, `questionId`, `questionIndex`, `field`, `message`), ma devono essere
leggibili nella UI. Test e UI devono verificare almeno i seguenti significati:

| Caso invalido | Esempio | Messaggio atteso |
|---|---|---|
| Schema V1 | `schema: schoolforge-pool/v1` | `Schema pool non supportato: atteso schoolforge-pool/v2.` |
| `peso` presente | `peso: 2` | `Il campo "peso" non è ammesso nel contratto schoolforge-pool/v2.` |
| Difficoltà zero | `difficolta: 0` | `La difficoltà deve essere un intero compreso tra 1 e 5.` |
| Difficoltà sei | `difficolta: 6` | `La difficoltà deve essere un intero compreso tra 1 e 5.` |
| Difficoltà decimale | `difficolta: 2.5` | `La difficoltà deve essere un intero compreso tra 1 e 5.` |
| `maxPoints` scritto | `maxPoints: 4` | `Il campo "maxPoints" è derivato e non deve essere scritto nel pool.` |
| Difficoltà mancante | nessun campo | `Campo obbligatorio "difficolta" mancante.` |
| Soluzione mancante | nessun campo | `Campo obbligatorio "soluzione" mancante.` |
| Singola con due soluzioni | `soluzione: [a, b]` | `La soluzione di una chiusa singola deve contenere esattamente una opzione.` |
| Soluzione con ID ignoto | `soluzione: [z]` | `La soluzione fa riferimento a una opzione inesistente: "z".` |
| Opzioni duplicate | due opzioni `id: a` | `Gli ID delle opzioni devono essere univoci.` |
| Multipla con tutte le opzioni corrette | due opzioni e `soluzione: [a, b]` | `La soluzione di una chiusa multipla deve contenere meno elementi delle opzioni.` |
| `maxCharacters` su chiusa | `maxCharacters: 2000` | `maxCharacters è ammesso soltanto per le domande aperte.` |

Esempio minimo esplicitamente invalido:

```yaml
---
schema: schoolforge-pool/v1
questions:
  - id: q-legacy
    tipo: aperta
    difficolta: 2.5
    peso: 3
    maxPoints: 7.5
    testo: Domanda non valida
---
```

Il parser non corregge, arrotonda, converte o ignora nessuno di questi valori.

## 5. Inventario evidence-based

Ricerca eseguita sull'intero repository con `rg` per `peso`, `difficolta`,
`maxPoints` e `schoolforge-pool/v1`, escludendo dipendenze e output di build.
La ricerca trova `peso` in **55 file**: 7 in `lesson-contract`, 13 nel runtime web,
18 test web, 1 test Rules, 1 template e 15 documenti. Non esistono occorrenze
dirette di `peso` in `functions/src`; il percorso IA riceve oggi `maxPoints`, ma le
forme web upstream e lo snapshot conservano ancora `peso`.

| File o modulo | Utilizzo attuale | Modifica richiesta | Pacchetto | Test da aggiornare | Rischio |
|---|---|---|---|---|---|
| `packages/lesson-contract/src/types.ts` | V1, difficoltà/peso 1–3, `maxPoints` parsed | V2, difficoltà 1–5, rimuovere `peso`, derivare punti | 01 | parser/serializer/index/maxCharacters | Alto: contratto condiviso |
| `packages/lesson-contract/src/schemas.ts` | Zod strict V1 e `peso` obbligatorio | literal V2; difficoltà intera 1–5; errori espliciti per `peso`/`maxPoints` | 01 | schema e casi invalidi | Alto: fail-closed |
| `packages/lesson-contract/src/parser.ts` | calcola `difficolta * peso` | calcolare `maxPoints = difficolta`; nessun ramo legacy | 01 | contract e cross-validation | Alto |
| `packages/lesson-contract/src/serializer.ts` | serializza `peso`, omette punti | omettere `peso` e punti; emettere solo V2 | 01 | round-trip/determinismo | Alto |
| `packages/lesson-contract/src/maxCharacters.ts` | default 2000, range 1–10000 | mantenere contratto; aggiornare commenti legacy | 01 | maxCharacters | Basso |
| Import e validazione (`buildImportPayload`, `validateImport`, tipi) | indicizza V1 con peso e prodotto | accettare solo V2; rifiuto leggibile; indice senza peso | 01 | import/validation/Rules fixture | Alto |
| `poolEditorService.ts` | riscrive indice con `peso` | consumare V2 e scrivere difficoltà/punti derivati | 02 | service pool | Alto: doppia scrittura |
| `QuestionPoolEditor.tsx` | template V1, selettori difficoltà/peso 1–3 | difficoltà 1–5, eliminare controllo peso, presentare punti uguali alla difficoltà | 02 | editor e CRUD | Medio |
| `QuestionIndexEntry` in `firestore.ts` | persiste difficoltà, peso, maxPoints | rimuovere peso; difficoltà 1–5; maxPoints derivato | 02 | index service/import | Alto |
| `questionIndexService.ts` | legge e restituisce peso | rimuovere campo e validare forma V2 | 02 | question index | Medio |
| `QuestionPicker.tsx` | mostra diff, peso e punti | mostra tipo, difficoltà e punti; filtri 1–5 | 02 | picker | Medio |
| `VerificationQuestionRef` / `VerificationsView.tsx` | congela peso nella selezione | rimuovere peso, mantenere difficoltà e punti derivati | 02 | VerificationsView/service | Alto |
| Loader domande con/senza soluzioni | porta metadati pool verso snapshot/PDF | forma V2 senza peso; `maxPoints === difficolta` | 02 | loadSelectedQuestions* | Alto |
| `verificationSnapshotMappers.ts` | copia peso nel teacher snapshot | nuovi snapshot senza peso; proiezione studente già senza soluzione/peso | 02 | snapshot/limits | Alto: dati congelati |
| Tipi snapshot/proiezione in `firestore.ts` | teacher snapshot può contenere peso; pubblico usa maxPoints | rimuovere peso dai nuovi snapshot, mantenere maxPoints derivato e dati student-safe | 02 | projection e Rules | Alto |
| `OnlineExamView` e servizi studente | usano testo/opzioni/maxPoints/maxCharacters | verificare forma V2 e punteggio derivato; nessun peso | 02 | online exam/student services | Medio |
| Correzione manuale (`correctionWorkspaceLoader`, workspace, contract/service) | loader espone difficoltà/peso; valutazioni congelano maxPoints | eliminare peso; mostrare `Difficoltà N · Max N punti`; preservare step 0,25 | 02 | workspace/correction service | Alto |
| Restituzione studente (`StudentCorrectionView`, correction return) | mostra punti/maxPoints | mantenere punti derivati; nessun peso nei nuovi documenti/UI | 02 | student correction/return | Medio |
| PDF verifica (`verificationPdf.ts`) | stampa `maxPoints` da ref/snapshot | mantenere punti ma provarne derivazione 1:1; mai peso | 02 | verificationPdf | Medio |
| CSV/PDF registro correzioni | esporta totali e maxPoints | mantenere totali derivati; assicurare assenza peso | 02 | register export/PDF | Basso |
| IA (`openAiGrader`, engine, gateway) | payload provider usa `maxPoints`; upstream snapshot conserva peso | mantenere domanda, soluzione, risposta, difficoltà e maxPoints; vietare peso; nessuna seconda chiamata | 02 | grader/engine/gateway | Alto: scoring/costo |
| `apps/web/public/templates/pool-template.pool.md` | template singolo V1 con peso | sostituire con esempio V2 importabile | 01 | import smoke/template | Alto |
| `apps/web/public/templates/lezione-template.md` | esempio metadati lezione con omonima difficoltà testuale | distinguere la difficoltà lezione da quella delle domande; aggiornare esempi pool se presenti | 01 | template/import | Basso |
| `templateKit.ts` | genera pool V1 con peso nel kit ZIP | generare esclusivamente pool V2 validi per tutti i tipi | 01 | test kit/import ZIP | Alto |
| Fixture e test repository/editor/import | incorporano V1 e peso | fixture V2 uniche; aggiungere rifiuto V1/peso/maxPoints | 01/02 secondo proprietario | suite lesson-contract/web | Alto |
| Smoke MVP cartaceo/import | usa evidenze e kit V1 | nuovo smoke dal kit V2 attraverso PDF | 02 / Gate | smoke documentato | Medio |
| Documentazione canonica | descrive V1, peso e prodotto | aggiornare solo durante 01/02, non in questa PR | 01/02 | format/link review | Medio: contratti discordanti temporanei |

`maxPoints` nelle valutazioni, nei totali, nei run di correzione e negli export non
va eliminato: rappresenta il limite congelato della domanda. Deve però provenire
sempre da `difficolta`, mai da un campo Markdown o da input libero.

## 6. Confini dei pacchetti successivi

### POOL-SIMPLE-01 — contratto e ingressi

- tipi TypeScript `lesson-contract`;
- schema Zod, parser, serializer e messaggi di errore;
- fixture V2 e casi invalidi;
- template pool singolo ed eventuali esempi pool nel template lezione;
- generatore e test del kit ZIP completo;
- validazione import V2 e costruzione iniziale dell'indice;
- nessun parser duale, convertitore o fallback V1.

### POOL-SIMPLE-02 — superfici applicative

- Question Pool Editor;
- question index, relativo tipo Firestore e picker;
- selezione domande e snapshot docente/studente;
- svolgimento online;
- correzione manuale e restituzione;
- PDF verifica, PDF/CSV registro e altre esportazioni;
- input e payload IA, con difficoltà e `maxPoints` ma senza `peso`;
- rimozione finale di ogni riferimento applicativo a `peso` e aggiornamento dei
  documenti canonici rimandati da POOL-SIMPLE-00.

### Gate GPOOL

Il gate richiede, sul DEV pulito:

1. import del kit ZIP V2;
2. apertura e modifica di un pool nell'editor;
3. creazione di una verifica dal picker;
4. attivazione e costruzione degli snapshot;
5. svolgimento studente;
6. correzione manuale con step `0,25`;
7. correzione IA delle sole aperte e chiuse deterministiche;
8. restituzione allo studente;
9. generazione PDF e CSV;
10. ricerca conclusiva `rg` senza riferimenti applicativi a `peso`, salvo documenti
    storici nominati in una allowlist esplicita e revisionata.

POOL-SIMPLE-01 non rende il rollout completo: POOL-SIMPLE resta aperto finché 02 e Gate
GPOOL non sono completati.

## 7. Pulizia DEV obbligatoria

Il docente esegue la pulizia prima del deploy che introduce il contratto V2. La
checklist deve essere completata e verificata su DEV:

- [ ] esportare soltanto eventuali evidenze non operative che si desidera conservare;
- [ ] eliminare tutte le verifiche DEV create da pool V1, incluse bozze, attive,
      chiuse e archiviate;
- [ ] eliminare per tali verifiche consegne, ricevute, correzioni, eventi di
      correzione e restituzioni ancora presenti;
- [ ] verificare che non restino snapshot docente o proiezioni studente dipendenti
      dalle verifiche eliminate;
- [ ] eliminare tutti i programmi DEV e i relativi import, UDA, lezioni e
      `questionIndex` che derivano da pool V1;
- [ ] verificare la rimozione degli oggetti Storage sotto gli import dei programmi
      eliminati, inclusi tutti i file `.pool.md` V1;
- [ ] eliminare file ZIP locali V1 destinati a futuri import, per evitare reimport
      accidentali;
- [ ] verificare che non esistano operazioni IA in corso sulle consegne eliminate;
- [ ] lasciare intatte le collezioni tecniche server-only non dipendenti dal
      contenuto (`settings/aiConfig`, ledger budget); i run tecnici scadono secondo
      la loro retention e non sono una fonte per ricostruire dati V1;
- [ ] confermare che PROD non contiene dati da migrare;
- [ ] registrare Human Gate di pulizia DEV prima del rollout.

Non viene introdotta una routine di pulizia, un backfill o una migrazione automatica.

## 8. Ordine sicuro di rollout e rollback

### 8.1 Deploy

1. congelare nuovi import e creazione/attivazione verifiche su DEV;
2. completare la pulizia DEV e verificarne le dipendenze;
3. unire POOL-SIMPLE-01 e verificare parser, template e kit V2 senza importare dati
   operativi persistenti;
4. unire POOL-SIMPLE-02, aggiornando in modo coordinato tutte le superfici che
   leggono e scrivono il contratto;
5. eseguire test automatici completi;
6. deploy DEV coordinato del frontend e degli eventuali componenti backend toccati;
7. importare per la prima volta il kit V2;
8. eseguire Gate GPOOL end-to-end;
9. riaprire gli import soltanto dopo il gate.

Non deve esistere una finestra in cui un writer V2 alimenta un reader V1 o viceversa.

### 8.2 Rollback prima del primo import V2

Prima del primo import persistito V2 il rollback è semplice: ripristinare insieme
gli artefatti applicativi precedenti. Il DEV resta vuoto; non esistono dati da
convertire e nessun file V1 deve essere reimportato durante la finestra.

### 8.3 Dopo il primo utilizzo V2

Dopo il primo import, la prima verifica o il primo snapshot V2, il rollback al codice
V1 non è sicuro: quel codice richiede `peso`, limita la difficoltà a 1–3 e non può
interpretare il nuovo contratto. Le opzioni ammesse sono:

- correggere in avanti e mantenere V2;
- oppure cancellare integralmente i nuovi dati DEV V2 e solo dopo ripristinare la
  precedente release, sempre senza conversione.

Non si mescolano dati V1 e V2 e non si modifica manualmente un pool per simulare una
conversione.

## 9. Relazione con VEX — Varianti equivalenti

POOL-SIMPLE è prerequisito bloccante di VEX. Le alternative nello stesso gruppo
saranno confrontate usando esclusivamente:

- UDA;
- tipo domanda;
- difficoltà intera `1..5`;
- `maxCharacters` effettivo per le domande aperte (`valore esplicito` oppure `2000`).

`peso` non viene confrontato perché non esiste. Stessa difficoltà implica
automaticamente stesso `maxPoints`.

Un gruppo con una sola domanda è valido e produce il warning non bloccante:

> **Una alternativa possibile — questa domanda sarà assegnata a tutti gli studenti.**

Una sola combinazione complessiva è valida e non blocca l'attivazione. VEX non deve
reintrodurre un secondo indicatore di peso o punteggio per distinguere alternative.

## 10. Rischi e decisioni operative

- **Contratto atomico:** il cambio attraversa package condiviso, indice, snapshot e
  UI; un rollout parziale rende i dati illeggibili.
- **Dati stale:** un solo snapshot o indice V1 residuo può propagare `peso` o punti
  calcolati col prodotto; la pulizia DEV è quindi un gate, non un suggerimento.
- **Ambiguità di `difficolta`:** esiste anche metadato testuale per lezioni; la
  rimozione riguarda la difficoltà numerica delle domande, non il front matter delle
  lezioni.
- **Punteggi congelati:** `maxPoints` resta nei documenti operativi; i test devono
  dimostrare che nei nuovi flussi è sempre uguale alla difficoltà originaria.
- **IA:** nessun `peso` è oggi inviato direttamente al provider, ma devono essere
  rimossi i campi upstream e testata l'esatta forma del payload.
- **Documentazione transitoria:** fino a POOL-SIMPLE-01/02 i documenti canonici
  continuano correttamente a descrivere il sistema implementato V1; questo documento
  descrive il target e non dichiara il rollout completato.
