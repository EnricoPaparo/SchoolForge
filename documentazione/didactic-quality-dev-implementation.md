# Incremento qualità didattica — DEV

Data: 5 ottobre 2026. Issue: #518. Base: `ef588b5`. Ambito autorizzato: pool,
mappe, correzioni e coerenza del percorso, fino a DEV. Nessun rilascio PROD.

## Contratto del rilascio

### Pool

- Le aggiunte ricevono gli stem delle domande esistenti, delimitati come dati:
  massimo 1000 domande, 2000 caratteri ciascuna, cap richiesta totale invariato.
- Il revisore valuta ogni domanda contro la lezione: risolvibilità, ambiguità,
  soluzioni, distrattori e duplicazione concettuale.
- Ripara soltanto gli ordinali respinti. Le altre domande restano identiche.
  Conteggi, tipi, range di difficoltà e assenza di ID tecnici restano vincolanti.
- I duplicati esatti normalizzati sono respinti nel risultato revisionato;
  quelli semantici sono affidati al revisore, non dichiarati provati dal codice.

### Mappe

- Il revisore riceve il corpo canonico e il candidato, verifica concetti e
  relazioni e conserva sintesi in prosa e diagramma testuale accessibile.
- Un problema sostanziale nella fonte produce `sourceIssue`: l'applicazione
  viene bloccata. La lezione non viene riscritta dal revisore della mappa.
- `unchanged` conserva il Markdown originale byte per byte.

### Correzioni

- Due valutazioni ricevono lo stesso input congelato; la seconda non vede voto
  o feedback della prima. Le chiuse restano deterministiche.
- Il confronto usa punti esatti e campi strutturati, non equivalenza semantica
  del feedback. Nessuna media automatica dei voti.
- Disaccordo o incertezza richiedono revisione esplicita del docente: il voto
  primario resta provvisorio, non viene presentato come verificato.
- Un errore tecnico della seconda valutazione non applica risultati parziali.
  I checkpoint server conservano gli stadi già completati. Esiti con costo
  incerto non vengono ripetuti automaticamente.
- Nessun arbitraggio IA è aggiunto in questo incremento: il docente risolve i
  disaccordi, evitando un terzo giudizio arbitrario o una spesa implicita.

### Interfaccia e coerenza

- Revisione avanzata attiva per default a ogni apertura, switch accessibile,
  disattivabile prima dell'avvio. OFF percorre soltanto la generazione base.
- Esito e fase della revisione sono visibili; un errore non presenta una bozza
  come revisionata. Si può riprovare la sola fase fallita.
- Le revisioni pool/mappa sono run distinti con ID stabili, input hash,
  versione prompt, modello/listino e SHA256 dell'esatto corpo sorgente.
- La generazione completa crea mappa e pool dal corpo finale revisionato e
  conserva gli ID di revisione nel checkpoint per riprendere senza duplicare
  i passaggi completati. I costi sconosciuti restano sconosciuti dopo reload.
- Le prenotazioni contenuto sono separate per stadio: l'interfaccia dichiara
  che la revisione è stimata dopo la bozza. Il totale reale comprende entrambi
  gli stadi. Non è ancora una prenotazione atomica dell'intero percorso.

## Politiche e rollback

I generatori conservano le politiche correnti. I nuovi revisori pool/mappa
usano GPT-5.6 Luna indipendentemente dal profilo del generatore; la promozione
è subordinata alle prove descritte sotto. Le correzioni mantengono il modello
del profilo scelto per entrambe le valutazioni indipendenti.

Rollback funzionale esplicito: disattivare lo switch nella nuova operazione.
Rollback del codice: release precedente DEV `ef588b5`. Nessuna migrazione
distruttiva. I nuovi draft di correzione sono server-only e soggetti a TTL.

## Qualificazione

Dataset sintetico congelato: informatica, matematica, ragionamento storico e
scienze. Stessi candidati OFF/ON; errori intenzionali nelle soluzioni e nelle
relazioni. Dati studente, email e materiali PROD esclusi.

Lotto autorizzato: massimo 60 chiamate, retry zero, tetto 5 USD. Un primo
tentativo di revisione mappa non rispettava il contratto della sintesi in prosa;
il prompt è passato a `concept_map_review-v3`. Il tentativo iniziale viene
conteggiato e non confuso con un risultato valido. La latenza viene registrata
soltanto per affidabilità, non per scegliere il vincitore didattico.

I risultati e la review indipendente sono registrati in
`evidenze/didactic-quality-dev-v1/`. Lo stato del gate e il rilascio effettivo
verranno registrati nell'issue: questo documento da solo non prova il deploy.

## Collaudo docente

1. Pool nuovo e aggiunta a un pool esistente: ON/OFF, conteggi e tipi corretti,
   niente domande duplicate, soluzioni utilizzabili, modifica manuale e salva.
2. Mappa ON/OFF: relazioni corrette e leggibili; usa bozza, salva e riapri.
3. Correzione con risposta piena, parziale e alternativa valida: controlla
   feedback, badge di verifica e richiesta di revisione nei disaccordi.
4. Generazione completa: lezione, mappa, pool e immagini concordano; il retry
   conserva i passaggi già salvati, anche dopo F5.
5. Cambiare configurazione/switch invalida la stima; nessuna applicazione
   avviene prima del completamento del controllo richiesto.

## Evoluzioni distinte da questo incremento

Il masterplan include anche versionamento editoriale completo delle lezioni,
impronta didattica strutturata riutilizzabile, prenotazione aggregata atomica,
prototipo nodi/archi, verificatori specialistici e pilot sull'apprendimento.
Restano evoluzioni dedicate: i controlli di questo rilascio non dimostrano
ancora comprensione o ritenzione degli studenti e non sostituiscono il giudizio
disciplinare del docente. Nessun risultato di verifica modifica automaticamente
la lezione.

## Risultato della review indipendente

PASS senza blocker disciplinari sul lotto sintetico. Quattro pool con errori
intenzionali sono stati riparati conservando gli altri 12 quesiti. I quattro
holdout mappa v3 conservano formule e condizioni corrette e riparano i fault.
Le correzioni producono 20 confronti verificati e 10 segnalati al docente;
risposte complete e metodi alternativi validi ricevono pieno punteggio.

Limiti: beneficio della revisione sui pool già validi non sempre dimostrato;
un caso mappa v2 perdeva dettaglio, corretto con prompt conservativo v3 e
quattro holdout aggiuntivi. Campione piccolo: nessuna prova universale di
stabilità, copertura disciplinare o miglioramento dell’apprendimento.

Prove reali completate: 60 chiamate, retry zero; costo noto 0,317461 USD
più 0,009572 USD di tetto prudenziale per il primo output invalido (usage
non recuperata), totale conservativo 0,327033 USD. Pianificatore visuale
validato e due immagini ispezionate: RAM/SSD distinti, cucchiaino metallico
continuo immerso in acqua calda. Non sono prove del flusso autenticato Firebase.
