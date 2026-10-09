# Qualità didattica — UDA e controlli specialistici

> **Allineamento 9 ottobre 2026:** stato applicativo, modelli e rilascio DEV/PROD
> in [stato-release-2026-10.md](stato-release-2026-10.md). Le date, i gate,
> prezzi e limiti di autorizzazione delle fasi riportate sotto sono storici;
> non sostituiscono la policy corrente e non autorizzano nuovi sviluppi/deploy.

Task approvato il 5 ottobre 2026, issue #520. Baseline DEV `0dca4c8`, PR #519.
Rilascio esclusivamente DEV; niente versionamento editoriale, nuove dipendenze,
cambi di modello o riscrittura automatica di lezioni esistenti.

## Pool e valutazione

La matrice privata della generazione distribuisce concetti, scenari e operazioni
cognitive secondo fonte, livello e quantità. Niente percentuali rigide nei pool
piccoli. Le operazioni comprendono spiegare meccanismi, applicare, confrontare,
diagnosticare e motivare. I distrattori devono rappresentare errori plausibili e
risultare falsi nelle condizioni dichiarate; la difficoltà non viene costruita
con ambiguità o informazioni mancanti.

Le soluzioni aperte distinguono elementi essenziali richiesti dalla consegna,
criteri qualitativi di credito parziale e alternative valide. Gli approfondimenti
non diventano requisiti nascosti. Lo schema e la gestione dei punteggi restano
invariati.

Il correttore deriva criteri dalla domanda e dal riferimento prima di valutare la
risposta, tutela equivalenze e metodi alternativi, evita penalizzazioni ripetute
per un errore trascinato e produce feedback su parte corretta, lacuna osservata
e prossimo passo. La doppia valutazione e il gate del docente nei disaccordi
restano quelli del rilascio precedente.

## Coerenza UDA

Il client trasporta concetti e obiettivi già presenti nell'albero in memoria,
senza nuove letture Firebase o Storage. Mantiene ordine e titoli di tutte le
lezioni. I metadati opzionali rispettano 40 voci di 300 caratteri e il limite
complessivo di 20.000 byte: in un indice molto ricco, le lezioni più vicine hanno
priorità. Le voci troppo lunghe vengono omesse interamente, mai tagliate a metà.

Generazione e revisione ricevono posizione corrente e contesto, anche quando
due lezioni hanno lo stesso titolo. I metadati rappresentano un percorso
pianificato, non dimostrano che gli studenti abbiano già studiato una lezione.
Guidano richiamo minimo dei prerequisiti, progressione e terminologia; non sono
una verifica dei corpi delle altre lezioni. Le lezioni salvate non cambiano.

## Controlli specialistici

Le istruzioni condivise si applicano alle affermazioni effettive, senza scegliere
la materia da una parola nel titolo:

- matematica: passaggi, segni, equivalenze, ipotesi e dominio;
- scienze: unità, condizioni del modello, causalità e conservazione;
- informatica: semantica, stato, tracce ed estremi dei casi;
- umanistiche: cronologia, attribuzioni, fatti e interpretazioni.

Un verificatore puro ricalcola un sottoinsieme limitato di uguaglianze numeriche
isolate. Nessun `eval`, esecuzione di codice generato, shell o rete. Lunghezza,
token, profondità, grandezza numerica e quantità dei risultati sono limitati.
Prosa, unità, variabili, catene, confronti e blocchi di codice non supportati
vengono saltati. Le diagnostiche alimentano i revisori e il correttore:
un'opzione falsa o un errore citato intenzionalmente non autorizza una correzione
o penalizzazione automatica. Accordo numerico non significa correttezza
disciplinare; nessuna diagnostica significa nessuna verifica di quel caso.

## Identità e accounting

I prompt modificati hanno identità nuove negli hash, comprese le revisioni.
Metadati opzionali assenti o vuoti mantengono la stessa forma normalizzata;
metadati sostanziali partecipano al nuovo hash. Le prenotazioni usano il payload
provider effettivo, includendo contesto e diagnostiche. Non vengono aggiunte
chiamate di revisione rispetto ai percorsi ON/OFF già esistenti.

## Qualificazione

Baseline dei payload congelata prima dell'integrazione. Stessi materiali
sintetici per vecchi e nuovi prompt: pool e correzioni in quattro discipline,
generazione e revisione della densità nel contesto UDA, due mappe sane e quattro
soluzioni intenzionalmente difettose. Le 28 chiamate iniziali sono state seguite
da quattro affinamenti dei criteri dei pool e una revisione del formato delle
formule: 33 chiamate complessive, retry zero, costo effettivo 0,437424 USD entro
il tetto di 3 USD; nessun dato studente o PROD.

La revisione indipendente approva il campione: tutte le otto soluzioni aperte
finali esplicitano elementi essenziali, credito parziale e alternative valide.
Le quattro riparazioni cambiano soltanto la domanda difettosa; le lezioni
mantengono il perimetro UDA e la revisione finale usa formule leggibili senza
LaTeX. Molti confronti sono equivalenti: non si sostiene un miglioramento
uniforme di ogni contenuto. Nei quattro pool finali il costo aumenta del 20,7%,
circa 0,005 USD per pool; nelle quattro correzioni dello stesso campione aumenta
dello 0,74%. Sono misure del campione, non un preventivo universale.

Payload, risultati e riepilogo sono in
[`evidenze/didactic-specialist-v1/results-summary.json`](evidenze/didactic-specialist-v1/results-summary.json).

Il confronto combina validatori deterministici e revisione didattica
indipendente. Il metodo segue il confronto su criteri specifici illustrato nella
[documentazione ufficiale OpenAI sulle valutazioni](https://developers.openai.com/api/docs/guides/evaluation-best-practices).
Il campione non dimostra accuratezza universale, stabilità statistica o efficacia
nell'apprendimento. Risultati e limiti effettivi vengono registrati nell'issue
prima del rilascio; questo documento non costituisce prova del deploy.

Deploy DEV mirato: Hosting, `aiContentPreview`, `aiContentGenerate`,
`aiContentPromptExport`, `aiCorrectionPreview`, `aiCorrectionRun` e
`aiVisualPlanAuthorize`. Quest'ultima deve accettare i nuovi metadati UDA nella
generazione completa; un test copre questa compatibilità. Nessuna modifica a
Rules o indici. Il verbale del deploy e dello smoke viene registrato nell'issue #520.

## Collaudo docente

1. Generare una lezione intermedia in un'UDA e verificare prerequisiti, confini
   rispetto alle lezioni successive e chiarezza dei collegamenti, ON e OFF.
2. Generare pool in due materie: operazioni diverse, distrattori difendibili,
   soluzioni con criteri utilizzabili, senza requisiti nascosti.
3. Correggere una risposta completa sintetica, una alternativa valida, una
   parziale e una con errore: controllare equità e prossimo passo del feedback.
4. Generazione completa: salvare e riaprire lezione, mappa e pool; i controlli
   non devono accorciare o impoverire parti valide.

Rollback: disattivare la revisione per l'operazione se serve; rollback completo
del codice a `0dca4c8` con deploy mirato DEV. Nessuna migrazione dati.
