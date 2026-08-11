# POOL-TUNE-02 — candidato A, review statica e dry-run

Stato: **candidato implementato; lotto reale non eseguito.**

## Origine delle modifiche

Il candidato nasce esclusivamente dai difetti misurati nel profile probe
[`pool-tune-01-profile-review.md`](pool-tune-01-profile-review.md):

- Economy ha usato indici 1-based nelle chiavi delle risposte;
- Quality ha duplicato scenario e operazione cognitiva in `PT00-01`;
- Quality ha scritto `\\n` letterali invece di vere interruzioni di riga in
  `PT00-07`.

Non sono state aggiunte preferenze stilistiche prive di evidenza.

## Contratto del candidato

Versione: `pool-tune-02-candidate-a-v1`.

1. `soluzione` usa soltanto indici zero-based, con primo indice `0` e ultimo
   `numero_opzioni - 1`;
2. audit silenzioso dopo la definizione definitiva delle opzioni: ogni indice
   selezionato punta a una proposizione vera e ogni non selezionato a una falsa;
3. la singola contiene esattamente una soluzione; la multipla almeno due e
   lascia almeno un distrattore;
4. matrice privata concetto/scenario/operazione cognitiva, mai restituita;
5. vietato riutilizzare insieme stesso scenario e stessa operazione cognitiva,
   anche fra tipi di domanda diversi;
6. vere interruzioni di riga; `\\n`, `\\r` e `\\t` non possono simulare la
   formattazione;
7. requisiti riusciti invariati: autonomia, fedeltà, soluzioni aperte formative,
   esercizi passo-passo, difficoltà cognitiva e trabocchetti non ambigui.

## Confine della modifica

Modificati soltanto prompt pool, sua versione, sentinelle hash e test del
benchmark. Invariati:

- prompt lezione e mappa concettuale;
- payload, Structured Output e validatore semantico;
- quantità, tipi, difficoltà, cap e tentativi;
- modello runtime selezionato dall'utente;
- listino, stima, prenotazione e budget;
- Firestore, Storage, Rules, indici e dipendenze.

Il benchmark userà `quality`, ma il candidato non forza Quality nel prodotto e
non promuove automaticamente alcun profilo.

## Dry-run Quality

Eseguito localmente l'11 agosto 2026 dopo la build Functions, senza API key,
provider o rete:

- fase: `tuning`;
- scenari: 8/8 appartenenti allo split `tuning`;
- profilo: `quality`;
- modello: `gpt-5.6-luna`;
- chiamate pianificate: 8;
- tentativi massimi: 16;
- stima nominale: **216.257 µUSD (0,216257 USD)**;
- tetto prudenziale: **676.954 µUSD (0,676954 USD)**.

Il tetto è un'autorizzazione massima, non una previsione del costo effettivo.
Il profile probe Quality è costato in media circa 0,017 USD per pool, ma il lotto
di tuning contiene scenari diversi e non si usa quella media come garanzia.

## Test statici

Le sentinelle verificano:

- versione esatta del candidato;
- presenza esplicita di indici zero-based e divieto della numerazione da 1;
- audit delle opzioni definitive;
- anti-duplicazione anche attraverso tipi diversi;
- divieto degli escape letterali;
- assenza dei target privati di valutazione dal prompt inviato al provider;
- hash SHA-256 del prompt pool aggiornato intenzionalmente;
- hash del system prompt pool e prompt lezione invariati.

## Gate successivo

Prima del lotto reale servono review della PR e autorizzazione economica distinta
con la frase esatta mostrata dal runner:

`ESEGUI 8 POOL TUNING REALI QUALITY`

Questa evidenza non autorizza la chiamata, il merge, il deploy o l'holdout.
