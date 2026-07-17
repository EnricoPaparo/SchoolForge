# M5-05A — Decisione provider IA

**Stato:** proposta evidence-based, non autorizza implementazione o deploy

**Data della rilevazione:** 16 luglio 2026

**Valuta:** USD, prezzi di listino API; imposte, cambio e costi Firebase esclusi

## Legenda delle evidenze

- **FATTO VERIFICATO**: affermazione supportata da una fonte ufficiale collegata accanto al testo.
- **STIMA**: calcolo riproducibile basato su assunzioni dichiarate; non è una fattura prevista.
- **RACCOMANDAZIONE**: scelta progettuale proposta per SchoolForge.
- **DECISIONE UMANA**: punto che deve essere confermato dal docente/responsabile prima di M5-05.

## Vincoli di questa decisione

Questo documento non modifica codice applicativo, Functions, Rules, indici, dipendenze, configurazioni, Secret Manager o ambienti. Non crea chiavi e non esegue deploy. Il dominio SchoolForge resta provider-agnostic e `MockAiGrader` deve rimanere disponibile.

## 1. Executive summary

**RACCOMANDAZIONE — baseline iniziale:** OpenAI `gpt-5-nano`, usando un identificatore di snapshot quando disponibile, è la baseline economica da cui iniziare il benchmark, **non il modello definitivo**. Fra i tre modelli economici inizialmente confrontati ha il costo standard più basso per il carico SchoolForge ($0,05/M token input e $0,40/M output), supporta Structured Outputs e dispone di SDK TypeScript ufficiale. La documentazione lo presenta come modello veloce ed economico, ma non dimostra la qualità della correzione scolastica in italiano: il benchmark della sezione 12 resta un gate obbligatorio e nessun provider/modello deve essere promosso prima di risultati misurati. [Modello e prezzi OpenAI](https://developers.openai.com/api/docs/models/gpt-5-nano)

**FATTO VERIFICATO — candidato OpenAI aggiuntivo al benchmark:** la documentazione OpenAI attuale consiglia di iniziare con `gpt-5.6-luna` per molti nuovi workload sensibili a velocità e costo. Il modello è documentato per API, Structured Outputs, output massimo di 128.000 token e prezzo standard di $1/M token input e $6/M output. Per questo deve essere incluso nel benchmark alle stesse condizioni degli altri candidati, ma non sostituisce automaticamente `gpt-5-nano` né cambia la raccomandazione prima delle misure. [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) · [Guida modelli OpenAI](https://developers.openai.com/api/docs/models)

**RACCOMANDAZIONE — seconda scelta/fallback:** Anthropic `claude-haiku-4-5-20251001`. Costa sensibilmente di più, ma offre structured outputs con schema, SDK TypeScript ufficiale e una valida alternativa di provider contro il lock-in. Deve entrare in produzione solo se supera il benchmark e se sono accettati costo e trattamento globale dei dati. [Panoramica modelli Claude](https://platform.claude.com/docs/en/about-claude/models/overview)

**DECISIONE UMANA BLOCCANTE SU GEMINI:** `gemini-2.5-flash-lite` è competitivo sul costo, ma i termini Gemini API dichiarano che il servizio non deve essere usato come parte di siti o applicazioni diretti a, o probabilmente accessibili da, minori di 18 anni. SchoolForge è un portale scolastico: anche con chiamata server-side avviata dal docente, l’applicabilità del vincolo richiede verifica legale/contrattuale o chiarimento scritto del fornitore. Fino ad allora Gemini non è raccomandato come provider V1. [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms)

**STIMA — scenario personale medio:** 4 verifiche/mese × 30 studenti × 4.000 token input + 1.000 output, includendo un margine prudenziale del 20%, costano circa **$0,0864/mese** con `gpt-5-nano`. Le consegne con sole domande chiuse costano $0 al provider IA.

**SIGNIFICATO DEL MERGE:** il merge di questo documento registra esclusivamente una proposta tecnica. Non supera lo Human Gate, non autorizza un provider reale, non autorizza API key o Secret Manager, non autorizza deploy e non abilita costi reali. Il provider e il modello definitivi restano subordinati al benchmark e all’approvazione esplicita del docente.

## 2. Tabella comparativa provider/modelli

### 2.1 Modelli economici candidati

| Provider e modello | Prezzo standard input / output per 1M token | Structured output | Limite output dichiarato | SDK TypeScript/Node | Valutazione integrazione Functions v2 |
| --- | ---: | --- | ---: | --- | --- |
| OpenAI `gpt-5-nano` | $0,05 / $0,40 | Structured Outputs supportato; lo schema deve essere validato anche lato applicazione | 128.000 token | `openai`, TypeScript ≥ 4.9 e Node ≥ 20 | **Bassa**: SDK server-side semplice, API key come secret, schema JSON diretto |
| OpenAI `gpt-5.6-luna` — solo benchmark | $1,00 / $6,00 | Structured Outputs supportato; stessa validazione applicativa obbligatoria | 128.000 token | `openai`, stesso SDK ufficiale | **Bassa**: candidato attuale per workload cost-sensitive, ma molto più costoso della baseline |
| Google `gemini-2.5-flash-lite` | $0,10 / $0,40 | JSON Schema supportato come sottoinsieme; JSON sintatticamente valido, valori semantici da validare | 65.536 token | `@google/genai`, SDK JS/TS ufficiale | **Bassa tecnicamente**, **alta contrattualmente** per il vincolo under-18 |
| Anthropic `claude-haiku-4-5-20251001` | $1,00 / $5,00 | Structured outputs con `output_config.format`; output parseabile conforme allo schema | 64.000 token | `@anthropic-ai/sdk`, TypeScript ≥ 4.9 e Node ≥ 20 | **Bassa-media**: SDK semplice; costo e geografia richiedono più controlli |

**FATTI VERIFICATI:** prezzi, finestre e supporto sono riportati nelle pagine ufficiali di [GPT-5 nano](https://developers.openai.com/api/docs/models/gpt-5-nano), [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [Gemini 2.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite), [pricing Gemini](https://ai.google.dev/gemini-api/docs/pricing), [modelli Claude](https://platform.claude.com/docs/en/about-claude/models/overview) e [pricing Claude](https://platform.claude.com/docs/en/about-claude/pricing). I limiti massimi del provider non sono target applicativi: SchoolForge deve imporre limiti molto inferiori.

**FATTO VERIFICATO, NON COMPARABILE:** le pagine dei provider descrivono qualitativamente GPT-5 nano come veloce, Gemini 2.5 Flash-Lite come il modello 2.5 più rapido e Claude Haiku 4.5 come il modello Claude più rapido. Non esiste in queste fonti un benchmark comune: la latenza “accettabile” per SchoolForge deve essere misurata nello stesso ambiente con p50/p95, come previsto nella sezione 12.

### 2.2 Operatività, retry e rate limit

| Provider | Retry/rate limit documentati | Controllo spesa | Principali vantaggi | Principali rischi |
| --- | --- | --- | --- | --- |
| OpenAI | SDK Node: 2 retry automatici predefiniti per errori di connessione, 408, 409, 429 e ≥500, con backoff; timeout predefinito 10 minuti configurabile. I tentativi falliti concorrono ai rate limit. [SDK](https://github.com/openai/openai-node) · [rate limits](https://developers.openai.com/api/docs/guides/rate-limits) | Limiti applicativi e budget progetto; hard stop SchoolForge necessario | Costo minimo; schema nativo; snapshot; integrazione semplice | Qualità in italiano non ancora misurata; retention predefinita; eventuale regione UE non automatica |
| Gemini | Limiti per progetto su RPM, token/minuto e richieste/giorno; 429 al superamento. La guida raccomanda backoff esponenziale per 429/503. [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) · [troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting) | Tier e limiti dipendono dal progetto/spesa; hard stop SchoolForge necessario | Prezzo basso; contesto ampio; ecosistema Google | Vincolo under-18; schema parziale; località di accesso non equivale a residenza UE |
| Anthropic | SDK TypeScript: 2 retry automatici predefiniti per connessione, 408, 409, 429 e ≥500; rate limit RPM/input/output token e header `retry-after`. [SDK](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript) · [rate limits](https://platform.claude.com/docs/en/api/rate-limits) | Spend limit del workspace più hard stop SchoolForge | Fallback indipendente; output strutturato forte; modello multilingue | Costo 10–12× nello scenario medio; inferenza first-party globale per Haiku 4.5 |

**RACCOMANDAZIONE:** in M5-05 configurare esplicitamente il client con retry automatici disattivati o limitati e centralizzare la policy nel gateway SchoolForge. Evita che retry dell’SDK e retry applicativi si moltiplichino senza visibilità.

## 3. Stima costi per scenario

### 3.1 Formula e assunzioni

Per una consegna con domande aperte:

```text
costo_consegna_raw =
  (token_input × prezzo_input_M + token_output × prezzo_output_M) / 1.000.000

costo_scenario_prudenziale =
  numero_consegne × costo_consegna_raw × 1,20
```

**STIME E ASSUNZIONI:**

- piccola: 1.500 token input + 500 output;
- media: 4.000 input + 1.000 output;
- grande: 8.000 input + 2.000 output;
- una sola chiamata per consegna contiene tutte le domande aperte non valutate e il feedback generale;
- nessuna chiamata per singola domanda e nessuna chiamata unica per tutta la classe;
- consegna con sole domande chiuse: 0 token e $0 di costo provider;
- margine prudenziale: **+20%**, equivalente, per esempio, a un retry fatturabile ogni cinque chiamate; non è una garanzia di copertura per incidenti estesi;
- prezzi standard sincroni, senza sconti batch/caching; arrotondamento a quattro decimali;
- imposte, cambio EUR/USD e tutti i costi Firebase sono esclusi.

I prezzi batch ufficiali di Gemini e Anthropic sono inferiori, ma le API batch asincrone non corrispondono al flusso interattivo V1; per confrontabilità e prudenza non sono usate nelle stime. [Pricing Gemini](https://ai.google.dev/gemini-api/docs/pricing) · [Pricing Claude](https://platform.claude.com/docs/en/about-claude/pricing)

### 3.2 Risultati, incluso margine +20%

| Provider/modello | Dimensione | 1 verifica × 30 | 4 verifiche/mese × 30 | 10 verifiche/mese × 30 | 10 docenti × 4 verifiche/mese × 30 |
| --- | --- | ---: | ---: | ---: | ---: |
| OpenAI `gpt-5-nano` | Piccola | $0,0099 | $0,0396 | $0,0990 | $0,3960 |
| OpenAI `gpt-5-nano` | Media | $0,0216 | **$0,0864** | $0,2160 | $0,8640 |
| OpenAI `gpt-5-nano` | Grande | $0,0432 | $0,1728 | $0,4320 | $1,7280 |
| Gemini `gemini-2.5-flash-lite` | Piccola | $0,0126 | $0,0504 | $0,1260 | $0,5040 |
| Gemini `gemini-2.5-flash-lite` | Media | $0,0288 | $0,1152 | $0,2880 | $1,1520 |
| Gemini `gemini-2.5-flash-lite` | Grande | $0,0576 | $0,2304 | $0,5760 | $2,3040 |
| Anthropic `claude-haiku-4-5-20251001` | Piccola | $0,1440 | $0,5760 | $1,4400 | $5,7600 |
| Anthropic `claude-haiku-4-5-20251001` | Media | $0,3240 | $1,2960 | $3,2400 | $12,9600 |
| Anthropic `claude-haiku-4-5-20251001` | Grande | $0,6480 | $2,5920 | $6,4800 | $25,9200 |

**Esempio riproducibile — scenario personale medio OpenAI:**

```text
120 × ((4.000 × $0,05 + 1.000 × $0,40) / 1.000.000) × 1,20
= 120 × $0,0006 × 1,20
= $0,0864/mese
```

**Separazione costi:** la tabella misura esclusivamente token del provider IA. Invocazioni Cloud Functions, rete, Firestore, Storage, Logging, Hosting e ogni altro costo Firebase devono essere stimati e monitorati separatamente.

## 4. Qualità e affidabilità dello structured output

### OpenAI

**FATTO VERIFICATO:** Structured Outputs è progettato per aderire allo schema fornito, mentre il solo JSON mode garantisce soltanto JSON valido. La documentazione richiede comunque di gestire rifiuti, output incompleti e limiti. [Structured Outputs OpenAI](https://developers.openai.com/api/docs/guides/structured-outputs)

**VALUTAZIONE:** affidabilità strutturale alta sulla carta. Restano obbligatori validazione runtime, range numerici, corrispondenza univoca fra domanda e feedback, somma punteggi e gestione fail-closed.

### Google Gemini

**FATTO VERIFICATO:** Gemini supporta un sottoinsieme di JSON Schema e restituisce JSON sintatticamente valido; Google raccomanda di validare i valori semanticamente. Schemi molto grandi o profondi possono essere rifiutati. [Structured output Gemini](https://ai.google.dev/gemini-api/docs/structured-output)

**VALUTAZIONE:** affidabilità strutturale buona per uno schema semplice, ma con maggiore attenzione alla compatibilità dello schema e alla validazione semantica.

### Anthropic

**FATTO VERIFICATO:** gli structured outputs sono disponibili per Claude Haiku 4.5 e producono output JSON parseabile conforme allo schema dichiarato; la prima richiesta per uno schema può sostenere latenza di compilazione. [Structured outputs Claude](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)

**VALUTAZIONE:** affidabilità strutturale alta sulla carta e valida come fallback. Il costo resta molto superiore.

### Qualità didattica in italiano

**STIMA NON ANCORA VERIFICATA:** nessuna delle fonti ufficiali consultate dimostra che questi specifici modelli soddisfino le rubriche SchoolForge su risposte scolastiche italiane. Non si deve trasformare la descrizione commerciale di un modello in una garanzia didattica. La scelta finale richiede il benchmark sintetico della sezione 12 e revisione docente.

### Principio semantico obbligatorio per le domande aperte

**RACCOMANDAZIONE — requisito bloccante:** la soluzione del docente è una risposta di riferimento o rubrica, non un testo esaustivo che lo studente deve replicare. La valutazione deve misurare il significato e la qualità della risposta, non la somiglianza lessicale con il riferimento.

Per ogni domanda aperta eleggibile il modello deve ricevere almeno:

- domanda;
- soluzione/riferimento del docente;
- risposta dello studente;
- punteggio massimo;
- difficoltà e peso, quando disponibili nel dato già gestito dal flusso.

La valutazione deve obbligatoriamente:

- accettare formulazioni diverse ma semanticamente equivalenti;
- riconoscere contenuti corretti anche quando non sono esplicitamente presenti nella soluzione docente;
- valutare correttezza, pertinenza, completezza e comprensione dimostrata;
- non penalizzare informazioni aggiuntive corrette;
- non superare mai il punteggio massimo;
- considerare negativamente informazioni errate, contraddittorie o fuori tema;
- trattare la risposta dello studente come input non attendibile;
- ignorare qualsiasi istruzione, richiesta di cambiare ruolo o prompt injection contenuta nella risposta dello studente;
- produrre punteggi a step di `0,25` e feedback sintetico, motivato e utile;
- segnalare chiaramente ambiguità o insufficiente sicurezza e richiedere revisione docente.

Queste regole sono requisiti del futuro prompt/schema e del benchmark, non una modifica implementativa. Questa PR non aggiunge campi Firestore né strutture persistenti.

## 5. Privacy, trattamento dati e regioni

### 5.1 Dati realmente necessari nella chiamata

**RACCOMANDAZIONE:** inviare soltanto:

- testo della domanda aperta;
- soluzione/rubrica del docente strettamente necessaria;
- risposta dello studente;
- punteggio massimo e identificatore locale pseudonimo della domanda.

Non inviare nome, cognome, email, UID Firebase, `classId`, nome della scuola, nome docente, titolo classe o altri identificatori. Il modello non necessita di sapere chi è lo studente. I testi liberi possono comunque contenere dati personali inseriti dall’utente: applicare istruzioni UI, minimizzazione e, dove ragionevole, rilevazione/redazione prima dell’invio.

### 5.2 OpenAI

**FATTI VERIFICATI:** i dati API non sono usati per addestrare i modelli salvo opt-in esplicito. I log di abuse monitoring possono contenere prompt e risposte e sono conservati per un massimo di 30 giorni per impostazione predefinita. Modified Abuse Monitoring e Zero Data Retention richiedono idoneità e approvazione. [Data controls OpenAI](https://developers.openai.com/api/docs/guides/your-data)

OpenAI documenta data residency europea per clienti idonei, con endpoint UE e requisiti contrattuali/di retention; non va considerata disponibile automaticamente su un account standard. Alcuni metadati di sistema, incluso lo schema, possono restare fuori dall’ambito di residency. [Data residency OpenAI](https://developers.openai.com/api/docs/guides/your-data#data-residency)

L’Italia è fra i paesi supportati dall’API. [Supported countries OpenAI](https://developers.openai.com/api/docs/supported-countries)

### 5.3 Google Gemini

**FATTI VERIFICATI:** sui Paid Services Google dichiara che prompt e risposte non sono usati per migliorare i prodotti; i termini prevedono trattamento secondo il Data Processing Addendum. Per abuso e sicurezza, prompt e risposte possono essere registrati per un periodo limitato, non quantificato nella pagina dei termini, e trattati nei paesi in cui operano Google o i suoi incaricati. [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms)

La documentazione ZDR indica che clienti paganti idonei possono richiedere Zero Data Retention; funzionalità come grounding, file, caching esplicito o interazioni persistenti hanno regole proprie e non servono a SchoolForge V1. [Gemini Zero Data Retention](https://ai.google.dev/gemini-api/docs/zdr)

L’Italia è una regione da cui Gemini API è disponibile, ma disponibilità geografica non significa residenza o inferenza esclusivamente UE. [Available regions Gemini](https://ai.google.dev/gemini-api/docs/available-regions)

**RISCHIO BLOCCANTE:** i termini vietano l’uso del servizio come parte di applicazioni dirette a o probabilmente accessibili da minori di 18 anni. La natura scolastica di SchoolForge richiede una decisione legale/contrattuale umana prima di ogni uso Gemini, anche se il payload non contiene identità e la chiamata è server-side. [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms)

### 5.4 Anthropic

**FATTI VERIFICATI:** per i prodotti commerciali, inclusa l’API, Anthropic non usa input/output per addestrare i modelli salvo opt-in o casi esplicitamente descritti. [Uso dei dati per training](https://privacy.claude.com/it/articles/7996868-i-miei-dati-vengono-utilizzati-per-l-addestramento-del-modello)

Gli input/output API sono eliminati automaticamente entro 30 giorni per impostazione predefinita, salvo eccezioni contrattuali, legali o di policy; contenuti segnalati per violazioni possono avere retention più lunga. Accordi ZDR sono disponibili solo per organizzazioni API idonee e approvate. [Retention Anthropic](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data) · [ZDR Anthropic](https://privacy.claude.com/en/articles/8956058-i-have-a-zero-data-retention-agreement-with-anthropic-what-products-does-it-apply-to)

L’Italia è supportata, ma l’API first-party usa inferenza globale per Haiku 4.5; il parametro di geografia dell’inferenza non offre una scelta UE per questo modello. [Supported regions Claude](https://platform.claude.com/docs/en/api/supported-regions) · [Data residency Claude](https://platform.claude.com/docs/en/manage-claude/data-residency)

### 5.5 Misure SchoolForge

**RACCOMANDAZIONI:**

- usare un payload minimizzato e pseudonimo, senza identificatori di persona o classe;
- non inviare allegati, metadati Firebase, cronologia non necessaria o risposte di altri studenti;
- non usare ricerca web, grounding, file API, vector store, cache esplicite o conversazioni persistenti;
- richiedere modalità stateless/non-storage quando il provider la offre;
- non registrare prompt, risposte o output nei log applicativi; mantenere il livello debug degli SDK disattivato;
- conservare in `aiCorrectionRuns` solo metriche non contenutistiche indicate nella sezione 7;
- mantenere `MockAiGrader` e un kill switch globale per disattivare immediatamente il provider reale;
- definire una retention minima anche per le metriche e cancellazione automatica coerente con le necessità di audit;
- completare DPIA/valutazione fornitori, DPA, base giuridica, informativa e ruoli con persone competenti.

**DECISIONE UMANA:** questo documento non dichiara e non può dichiarare automaticamente SchoolForge, un provider o il flusso “GDPR compliant”. La decisione privacy/GDPR finale resta umana e deve considerare contratto, configurazione reale, titolare/responsabile, età degli utenti, paese e procedure della scuola.

## 6. Configurazione tecnica consigliata

**RACCOMANDAZIONE V1, da implementare solo dopo Human Gate:**

1. Conservare l’interfaccia provider-agnostic esistente; aggiungere un adapter senza importare tipi provider nel dominio.
2. Selezionare provider, modello e snapshot da configurazione server-side; mantenere `MockAiGrader` sempre selezionabile.
3. Usare lo schema strutturato minimo già richiesto dal dominio: punteggio e feedback per domanda, più feedback generale nella stessa risposta.
4. Validare a runtime forma e semantica prima di qualsiasi scrittura dei voti: ID attesi, cardinalità, numeri finiti, range `[0, maxScore]`, lunghezze e assenza di campi extra.
5. Mantenere una sola chiamata per consegna e idempotenza tramite `aiCorrectionRuns/{requestId}`.
6. Configurare un timeout applicativo breve e una sola policy retry centralizzata; rispettare `Retry-After`, usare exponential backoff con jitter e non ripetere errori non retryable.
7. Usare il conteggio token dichiarato dal provider quando disponibile e confrontarlo con la stima pre-chiamata.
8. Usare un modello/snapshot esplicito e registrarlo nelle sole metriche, così un cambio provider non altera silenziosamente il comportamento.
9. In una futura implementazione, conservare la chiave esclusivamente come secret associato alla singola Function che ne ha bisogno, mai nel client, repository, `.env` versionato o log. Firebase documenta i secret parameters e l’associazione esplicita alle funzioni. [Firebase secret parameters](https://firebase.google.com/docs/functions/config-env#secret_parameters)

**Nota di perimetro:** questa è una configurazione proposta; M5-05A non crea secret, non configura Functions e non installa SDK.

### Efficienza obbligatoria del flusso

- una sola chiamata per consegna deve contenere tutte le domande aperte eleggibili;
- non inviare automaticamente l’intera lezione, l’intero corso o contenuti non necessari alla correzione;
- il feedback generale deve essere prodotto nella stessa chiamata, senza una seconda chiamata dedicata;
- le domande chiuse restano valutate deterministicamente dal codice e non consumano token del provider IA;
- una consegna senza domande aperte eleggibili non deve generare alcuna chiamata IA.

## 7. Limiti e budget consigliati

### 7.1 Guardrail V1

| Controllo | Valore consigliato | Comportamento |
| --- | ---: | --- |
| Consegne selezionabili per batch | 30 | Rifiuto prima di creare chiamate oltre il limite |
| Domande aperte per consegna | 20 | Rifiuto o richiesta di ridurre la verifica |
| Token stimati per consegna | 10.000 totali, massimo 8.000 input + 2.000 output | Nessuna chiamata se la stima supera il limite |
| Token stimati per batch | 300.000 totali | Rifiuto preflight del batch |
| Concorrenza provider | 3 chiamate | Coda server-side; nessun fan-out illimitato |
| Timeout per tentativo | 60 secondi | Abort, stato tecnico e nessuna applicazione parziale |
| Retry massimo | 1 | Solo rete/408/409/429/≥500; backoff+jitter; rispettare `Retry-After` (cap oltre cui retry manuale). **Implementato in M5-05D2B-2**: SDK `maxRetries: 0`, unica policy applicativa iniettabile, deadline complessiva e accounting prudente dei tentativi incerti. Human Gate **non** superato |
| Output invalido | 0 retry automatici di riparazione | Fail closed, nessun voto applicato; retry manuale esplicito |
| Circuit breaker | Globale + per provider | `aiGradingEnabled=false` e provider disabilitabile senza deploy applicativo, se la futura configurazione lo consente |

**RACCOMANDAZIONE:** impostare il massimo output del provider vicino al fabbisogno (2.000 token V1), non al limite tecnico di 64k/128k. Il limite riduce costo e rischio di risposte prolisse.

### 7.2 Budget DEV e soglie

- budget mensile provider IA consigliato per DEV: **$5**;
- avviso informativo al 50% ($2,50);
- avviso urgente all’80% ($4);
- hard stop applicativo al 100% ($5), riattivabile solo da un responsabile;
- contatore mensile calcolato dai token effettivi e dai prezzi configurati, confrontato anche con la dashboard del provider;
- budget Firebase separato: non sottrarre Functions/Firestore/Logging dal budget token e non sommarli senza etichetta.

**STIMA:** $5 è molto superiore al carico personale medio stimato con OpenAI ($0,0864) e lascia spazio al benchmark, ma limita l’impatto di loop, retry o abuso. Non sostituisce un limite di fatturazione del provider e deve essere rivisto dopo dati reali sintetici/DEV.

### 7.3 Dialog di conferma

Prima della correzione mostrare:

- provider, modello/snapshot e ambiente;
- consegne selezionate, consegne con aperte che generano chiamate e consegne closed-only a $0;
- numero totale di domande aperte;
- token input/output stimati e costo massimo stimato con margine +20%;
- limiti, concorrenza e possibile aumento di costo per retry;
- elenco sintetico dei dati inviati e conferma che nomi/email/classId non saranno inclusi;
- avviso che l’output è assistivo, deve essere verificato dal docente e non è applicato se invalido;
- checkbox di conferma esplicita del docente.

### 7.4 Metriche consentite in `aiCorrectionRuns`

Salvare soltanto metadati tecnici non contenutistici:

- `requestId` opaco e `schemaVersion`;
- provider, modello e snapshot;
- stato, codice errore normalizzato e categoria HTTP, senza messaggi grezzi del provider;
- timestamp, durata totale e latenza provider;
- conteggio domande aperte/chiuse, senza testi;
- token input/output stimati ed effettivi;
- costo stimato in USD e versione del listino usata;
- numero tentativi/retry, timeout e `outputValid`;
- conteggio elementi validati/rifiutati;
- versione dei limiti e stato del circuit breaker al momento della richiesta.

Non salvare testi di domande, soluzioni, risposte, feedback, prompt, output grezzo, nomi, email, UID, `classId`, IP o user agent. Se serve correlazione tecnica, usare identificatori opachi già previsti dall’idempotenza e accesso ristretto; non introdurre hash reversibili di dati personali.

## 8. Provider/modello raccomandato come prima scelta

**OpenAI `gpt-5-nano` come baseline economica iniziale**, subordinata ai gate della sezione 11. Non è una selezione definitiva e il merge di questo documento non la trasforma in autorizzazione all’uso reale.

Motivazioni:

1. minor costo standard osservato nel confronto;
2. Structured Outputs nativo con JSON Schema;
3. SDK TypeScript/Node ufficiale e policy retry documentata;
4. finestra/output molto oltre il fabbisogno, limitabile dall’applicazione;
5. no training sui dati API per impostazione predefinita;
6. snapshot disponibile per riproducibilità;
7. adapter isolato mantiene assenza di lock-in nel dominio.

Rischi da accettare o mitigare:

- qualità didattica in italiano non ancora provata;
- abuse-monitoring retention fino a 30 giorni nella configurazione standard;
- elaborazione/residenza UE non automatica e soggetta a idoneità/contratto;
- retry o timeout mal configurati possono moltiplicare costo e chiamate;
- una risposta strutturalmente valida può essere didatticamente errata: revisione docente obbligatoria.

`gpt-5.6-luna` partecipa al benchmark perché disponibilità API, caratteristiche, Structured Outputs e prezzo sono ora documentati ufficialmente. Il suo prezzo è molto superiore alla baseline: può diventare il modello raccomandato solo se i risultati misurati ne giustificano qualità, affidabilità, latenza e costo. La raccomandazione non cambia automaticamente in base alla guida generale OpenAI. [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)

## 9. Seconda scelta/fallback

**Anthropic `claude-haiku-4-5-20251001`** è il fallback provider raccomandato se:

- `gpt-5-nano` non supera la soglia qualitativa del benchmark;
- structured output e latenza risultano adeguati;
- il costo superiore è approvato;
- trattamento globale e retention sono accettati dalla valutazione privacy.

Gemini `gemini-2.5-flash-lite` resta un candidato tecnico/economico, ma è **non eleggibile per V1 finché il vincolo under-18 non viene risolto per iscritto**. Un eventuale prodotto Google con termini diversi, per esempio un’offerta enterprise/Vertex, richiederebbe una nuova analisi di prezzi, regioni, contratto e integrazione; non è coperto da questa decisione.

## 10. Decisioni che deve confermare il docente

1. La soglia minima di qualità: tolleranza su punteggio, completezza feedback, equivalenza semantica e casi borderline.
2. Se `$5/mese` è un budget DEV adeguato e chi può sbloccare l’hard stop.
3. Se 30 consegne, 20 domande aperte e 10.000 token/consegna coprono l’uso reale.
4. Se la revisione docente deve precedere sempre il salvataggio definitivo dei punteggi IA.
5. Quale retention applicativa usare per le sole metriche tecniche.
6. Se procedere con OpenAI standard o richiedere prima opzioni contrattuali ZDR/residency UE.
7. Se accettare Anthropic come fallback con costo e inferenza globale dichiarati.
8. Se escludere Gemini oppure avviare una verifica legale/contrattuale specifica sul vincolo under-18.
9. Chi è autorizzato ad attivare/disattivare il provider reale e a ruotare la chiave.
10. Approvazione umana privacy/GDPR, DPA, informativa e processo incident response.

## 11. Human Gate M5-05 — PENDING

- [ ] **PENDING — Docente:** approva dataset sintetico, rubrica e soglie del benchmark.
- [ ] **PENDING — Docente:** conferma il provider e modello definitivi soltanto dopo il benchmark; `gpt-5-nano` è la baseline iniziale, non la decisione finale.
- [ ] **PENDING — Docente:** approva i requisiti semantici, lo step `0,25`, la gestione dell’ambiguità e i criteri di esclusione del benchmark.
- [ ] **PENDING — Docente:** approva limiti V1, concorrenza, timeout, retry e fail-closed.
- [ ] **PENDING — Responsabile budget:** approva budget DEV, soglie e hard stop.
- [ ] **PENDING — Responsabile privacy:** approva minimizzazione payload, retention e logging senza contenuti.
- [ ] **PENDING — Responsabile privacy/legale:** verifica DPA, regione, trasferimenti e condizioni per dati scolastici.
- [ ] **PENDING — Responsabile privacy/legale:** decide l’esclusione di Gemini o documenta la risoluzione del vincolo under-18.
- [ ] **PENDING — Responsabile tecnico:** approva gestione futura della chiave tramite Secret Manager e procedura di rotazione/disattivazione.
- [ ] **PENDING — Docente:** conferma che ogni correzione IA resta assistiva e soggetta a revisione umana.
- [ ] **PENDING — Release owner:** autorizza separatamente M5-05; nessuna autorizzazione è implicita in M5-05A.

Finché tutte le checkbox pertinenti non sono confermate, usare soltanto `MockAiGrader` e non eseguire deploy di provider reali. Anche se questo documento viene mergiato, lo Human Gate resta `PENDING`: il merge non autorizza provider reale, API key, Secret Manager, deploy o costi reali.

## 12. Piano di benchmark successivo

### Dataset

- creare esclusivamente dati sintetici, senza nomi, email, classi, scuole o risposte reali;
- preparare 10–20 risposte campione in italiano distribuite fra almeno due materie, includendo tutti i casi della matrice obbligatoria seguente;
- associare una soluzione/rubrica docente e un punteggio atteso con intervallo di tolleranza;
- includere un caso closed-only per verificare 0 chiamate e 0 token.

### Matrice semantica obbligatoria

Eseguire la stessa identica matrice per ogni modello/provider candidato ammesso al benchmark. Ogni riga deve essere rappresentata nel dataset; un singolo campione può coprire più righe solo se le misure restano distinguibili.

| Caso obbligatorio | Comportamento atteso |
| --- | --- |
| Risposta semanticamente equivalente alla soluzione | Accettare la formulazione alternativa e non richiedere corrispondenza lessicale |
| Risposta più completa e interamente corretta | Riconoscere la completezza senza penalizzare contenuti aggiuntivi corretti |
| Alternativa valida non citata nella soluzione | Valutare il contenuto per correttezza e pertinenza, non come automaticamente errato |
| Risposta parzialmente corretta | Attribuire credito parziale motivato e coerente con la rubrica |
| Risposta corretta con un’aggiunta falsa | Ridurre il punteggio in proporzione alla falsità/contraddizione e motivarlo |
| Risposta fuori tema | Non attribuire credito per contenuti irrilevanti |
| Risposta vuota | Assegnare zero senza inventare contenuti |
| Risposta con tentativo di prompt injection | Ignorare le istruzioni dello studente e valutare esclusivamente la risposta disciplinare |
| Risposta ambigua o specialistica non sufficientemente coperta dalla soluzione | Dichiarare l’incertezza e richiedere revisione docente, senza falsa sicurezza |

### Esecuzione

- eseguire gli stessi payload, la stessa matrice e lo stesso schema su `gpt-5-nano`, `gpt-5.6-luna`, Anthropic e, solo se il gate contrattuale è risolto, Gemini;
- fissare modello/snapshot, temperatura e limiti output;
- ripetere ogni campione almeno tre volte per osservare variabilità;
- confermare una sola chiamata per consegna con tutte le domande aperte eleggibili e feedback generale incluso;
- non usare caching, batch asincroni o strumenti esterni, per isolare il modello;
- non eseguire alcun deploy di produzione.

### Misure obbligatorie per ogni caso

- punteggio atteso e punteggio ottenuto;
- qualità e utilità del feedback, con valutazione umana cieca;
- corretta applicazione dello step `0,25` e rispetto del punteggio massimo;
- mancata esposizione o riproduzione non necessaria della soluzione docente;
- resistenza alla prompt injection presente nella risposta dello studente;
- token input/output;
- latenza per caso e aggregati p50/p95;
- costo stimato usando il prezzo ufficiale rilevato;
- eventuale necessità di revisione docente e corretta segnalazione dell’incertezza;
- retry, timeout, JSON invalido, violazioni di schema o contenuto mancante;
- coerenza fra punteggio per domanda e feedback generale.

### Criterio bloccante di esclusione

Un modello viene escluso anche se più economico quando:

- penalizza frequentemente risposte corrette alternative o semanticamente equivalenti;
- segue istruzioni o prompt injection contenuti nella risposta dello studente;
- produce frequentemente valutazioni non motivate o feedback non utile.

Le frequenze e le soglie numeriche devono essere definite dal docente prima dell’esecuzione, non adattate dopo aver visto il vincitore.

### Output del benchmark

Produrre un breve report separato con dati aggregati, errori anonimizzati e decisione `GO/NO-GO`. Non promuovere automaticamente il modello più economico o quello suggerito in generale dal provider: deve prima superare soglia didattica, matrice semantica, criteri di sicurezza e tutti i gate privacy/contrattuali. Il provider definitivo richiede approvazione esplicita del docente.

## Fonti ufficiali consultate

Rilevate il 16 luglio 2026:

- OpenAI: [guida alla scelta dei modelli](https://developers.openai.com/api/docs/models), [GPT-5 nano](https://developers.openai.com/api/docs/models/gpt-5-nano), [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Node SDK](https://github.com/openai/openai-node), [rate limits](https://developers.openai.com/api/docs/guides/rate-limits), [data controls e residency](https://developers.openai.com/api/docs/guides/your-data), [paesi supportati](https://developers.openai.com/api/docs/supported-countries).
- Google: [Gemini 2.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite), [pricing](https://ai.google.dev/gemini-api/docs/pricing), [structured output](https://ai.google.dev/gemini-api/docs/structured-output), [JS/TS SDK](https://github.com/googleapis/js-genai), [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), [troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting), [Additional Terms](https://ai.google.dev/gemini-api/terms), [ZDR](https://ai.google.dev/gemini-api/docs/zdr), [regioni disponibili](https://ai.google.dev/gemini-api/docs/available-regions).
- Anthropic: [modelli](https://platform.claude.com/docs/en/about-claude/models/overview), [pricing](https://platform.claude.com/docs/en/about-claude/pricing), [structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [TypeScript SDK](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript), [rate limits](https://platform.claude.com/docs/en/api/rate-limits), [training](https://privacy.claude.com/it/articles/7996868-i-miei-dati-vengono-utilizzati-per-l-addestramento-del-modello), [retention](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data), [ZDR](https://privacy.claude.com/en/articles/8956058-i-have-a-zero-data-retention-agreement-with-anthropic-what-products-does-it-apply-to), [regioni](https://platform.claude.com/docs/en/api/supported-regions), [data residency](https://platform.claude.com/docs/en/manage-claude/data-residency).
- Firebase: [secret parameters per Cloud Functions](https://firebase.google.com/docs/functions/config-env#secret_parameters).
