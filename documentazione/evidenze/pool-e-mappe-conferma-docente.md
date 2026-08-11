# Conferma del docente — pool IA Quality e mappe concettuali

**Data della conferma:** 11 agosto 2026.
**Registrata in:** VDIF-00-REVIEW-FIX (PR #380, draft).
**Natura:** registrazione di una **conferma umana** già avvenuta. Questo
documento non introduce misure, costi, SHA, date di deploy o esiti automatici
che non siano già presenti nelle evidenze citate: dove un dato non è disponibile,
lo dice.

---

## 1. Perché esiste questo documento

Le evidenze tecniche di POOL-TUNE e CONCEPT-MAP erano complete fino al punto in
cui la decisione passa dalla misura alla persona: rollout eseguito e qualità
accettata sono fatti che **solo il docente responsabile può dichiarare**, e fino
a questa conferma la documentazione li riportava come pendenti. Il disallineamento
era stato segnalato in VDIF-00 e viene chiuso qui.

## 2. Pool IA — profilo Quality

**Confermato dal docente:**

| Punto | Stato |
|---|---|
| Tuning sul candidato congelato | **PASS** — evidenza tecnica in [`pool-tune-02-candidate-a-review.md`](pool-tune-02-candidate-a-review.md) e [`pool-tune-02-candidate-a-real-review.md`](pool-tune-02-candidate-a-real-review.md) |
| Holdout separato | **PASS** — evidenza tecnica in [`pool-tune-03-holdout-review.md`](pool-tune-03-holdout-review.md) |
| Gate GPOOL-QUALITY | **PASS**, esclusivamente per `pool-tune-02-candidate-a-v1` + profilo `quality` |
| **Rollout DEV di POOL-ROLLOUT-01** | **ESEGUITO** |
| **Smoke reale su DEV** | **PASS**: generazione di un nuovo pool, append su un pool esistente, revisione locale della proposta e singolo salvataggio canonico |

**Profilo `economy`:** resta **non qualificato** per la generazione dei pool.
Il fallimento 4/4 nel profile probe non è stato rieseguito sul candidato, e il
server continua a rifiutare `kind:'pool' + economy` con `invalid_input` prima di
config, secret, provider, stima, budget, lease, run e write. Questa conferma
**non** lo riabilita.

**Non disponibile e deliberatamente non riportato:** SHA del deploy DEV, data
esatta e ora del rollout, costo reale delle chiamate dello smoke. Non sono stati
registrati al momento dell'operazione e non vengono ricostruiti a posteriori.

## 3. Mappe concettuali della lezione

**Confermato dal docente:**

| Punto | Stato |
|---|---|
| CONCEPT-MAP-01→07 | **implementati** |
| Distribuzione su DEV | **eseguita** |
| Validazione con generazioni reali | **PASS** — generazioni reali eseguite su **più lezioni**, non su un singolo caso |
| Qualità dell'artefatto v2 (Sintesi + Diagramma) | **accettata** dal docente |

Il prompt di riferimento è `concept-map-07-v1`; l'artefatto persistito resta una
stringa non vuota entro 32 KB, il parser resta version-aware v1/v2 e la proiezione
studente resta condizionata a `completed === true`. Nulla di questo cambia con
questa conferma.

**Non disponibile e deliberatamente non riportato:** numero esatto di lezioni
generate, titoli, costi per generazione, SHA del deploy. La conferma è
qualitativa e viene registrata come tale.

## 4. Conseguenza sullo stato del percorso

Con questa conferma, e per quanto riguarda la linea di lavoro corrente:

- **l'unico blocco applicativo principale ancora aperto è VDIF**
  (VDIF-01→05 + Gate GVDIF), più il pacchetto **indipendente e successivo**
  ESITI-01;
- Gate GPOOL-QUALITY: **PASS** (solo `quality`), rollout DEV **eseguito**;
- mappe concettuali: **implementate, distribuite e validate**.

Restano fuori da questa affermazione, perché appartengono ad altre linee e sono
già tracciati altrove: Gate GAIGEN (rollout e smoke autenticati della
generazione IA di pool e lezioni), Gate GLESSON, Gate GSTRUCT, e ogni attività
di provisioning o deploy PROD — che nessun gate di questo percorso autorizza.

## 5. Che cosa questa conferma NON autorizza

- nessun provisioning o deploy su PROD;
- nessuna riabilitazione del profilo `economy` per i pool;
- nessuna modifica a prompt, payload, cap, Rules, indici, schema, dipendenze o
  cost model;
- nessuna chiusura dei gate di altre linee di lavoro.
