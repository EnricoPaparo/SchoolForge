# Resoconto transiente del revisore — DEV

> **Allineamento 9 ottobre 2026:** stato applicativo, modelli e rilascio DEV/PROD
> in [stato-release-2026-10.md](stato-release-2026-10.md). Le date, i gate,
> prezzi e limiti di autorizzazione delle fasi riportate sotto sono storici;
> non sostituiscono la policy corrente e non autorizzano nuovi sviluppi/deploy.

## Contratto

Il docente può aprire un piccolo pulsante «i» dopo una revisione completata
di lezione, pool o mappa. Il pannello è di sola lettura e mostra fino a tre
interventi concreti descritti dal revisore nella stessa risposta IA.
Le generazioni semplici e complete condividono il componente.
Nessuna modifica a correzioni verifiche, modelli, limiti, motore immagini o
generazione di esercizi. Nessuna chiamata IA aggiuntiva.

## Dati e persistenza

Il nuovo campo provider `reviewChanges` è obbligatorio negli schemi SDK dei
tre revisori, limitato a tre stringhe di 240 caratteri. L'engine lo separa
prima della validazione chiusa del contenuto. Il risultato callable espone
`reviewFeedback` al livello superiore; il contenuto canonico salvato nei run
rimane identico. Metadata mancanti o malformati vengono scartati senza
invalidare contenuti validi o ripetere chiamate. Campi sconosciuti del contenuto
continuano a essere rifiutati.

Nessun resoconto viene scritto in Firestore, Storage, log, checkpoint o
cronologia. Il checkpoint del completamento serializza solo i suoi campi
autorizzati e le opzioni esistenti. I report delle fasi mappa/pool viaggiano
tramite callback di progresso e riepilogo transiente e restano disponibili
in memoria durante errori immagini e relativi tentativi successivi.

Un replay restituisce il contenuto salvato senza resoconto: l'interfaccia
dichiara il dettaglio non disponibile. Una finestra ripristinata non inventa
report delle fasi già salvate. `unchanged` mostra nessuna modifica necessaria
e ignora eventuali interventi dichiarati dall'IA. Una revisione disabilitata,
fallita o con sorgente non adeguata non viene presentata come completata.
Le stringhe sono testo React, senza rendering HTML o Markdown.

## Identità e costo

Versioni: `lesson-review-v6`, `pool_review-v4`, `concept_map_review-v6`.
Le nuove richieste hanno un'identità canonica diversa: nessuna migrazione
di run esistenti e nessuna rigenerazione automatica. Le stime utilizzano il
payload SDK completo, quindi includono schema e istruzioni aggiunti; la
contabilizzazione continua a utilizzare l'uso effettivo del provider.
Il resoconto è una descrizione accessoria delle modifiche, non un nuovo
controllo di qualità.

## Verifica docente in DEV

1. Generare una lezione con revisore attivo: aprire «i», leggere il resoconto,
   chiuderlo cliccando fuori, premendo nuovamente «i» oppure Escape.
   Il clic esterno viene consumato: chiude solo il resoconto, senza attivare
   il comando sottostante o chiudere la generazione. Il pannello esce dai
   confini del dialogo, resta nel viewport e scorre internamente se necessario.
   Il contenuto resta modificabile normalmente.
2. Ripetere con pool e mappa; verificare interventi pertinenti al contenuto
   oppure indicazione di nessuna modifica necessaria.
3. Disattivare revisione: nessun pulsante «i» per quella fase.
4. Generazione completa: resoconti distinti per lezione, mappa e domande.
   Se le immagini si interrompono, i resoconti delle fasi completate restano
   visibili durante il nuovo tentativo.
5. Chiudere e riaprire/ripristinare: niente cronologia dei resoconti;
   eventuali operazioni ripristinate mostrano dettaglio non disponibile.

## Gate

Test mirati: estrazione e limiti metadata, validatori chiusi, nessuna
persistenza engine/replay, whitelist checkpoint, testo sicuro/apertura/chiusura
e perdita allo smontaggio, completamento con errore immagini e retry senza
nuove chiamate reviewer. Preview browser del componente reale: resoconto
concreto, unchanged, fallback legacy ed Escape verificati; console pulita.
Rilascio previsto: solo hosting DEV e funzioni callable AI content interessate,
dopo review indipendente e CI completa. PROD richiede nuova autorizzazione.
