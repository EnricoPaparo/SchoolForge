# SchoolForge — Pattern UX della SPA

Questo documento definisce i pattern di stato dell'interfaccia per la singola SPA (sezione docente desktop-first e Portale mobile-first). L'obiettivo è coerenza, reattività percepita e accessibilità.

---

## Sistema UI condiviso

L'interfaccia usa tre livelli, senza librerie UI esterne:

1. **Token globali** in `apps/web/src/index.css`: colori, spaziature, raggi,
   ombre, focus e breakpoint.
2. **Primitive condivise** in `apps/web/src/components`: dialog, conferme,
   bottoni e future card di record. Le feature non devono duplicarne focus,
   viewport, backdrop o stati grafici.
3. **Pattern di prodotto**: barre filtri, liste di card, toolbar batch e stati
   vuoti. Il contenuto cambia fra docente e studente, non il linguaggio visivo.

### Gerarchia cromatica e interazioni navigative

- Blu/ciano comunica identità stabile, selezione e azione primaria.
- L'arancione SchoolForge segnala hover e focus delle sole superfici navigabili
  o esplorative che adottano esplicitamente i token `brand-interactive`.
- Una sezione selezionata conserva il riempimento blu anche durante
  l'interazione: bordo, focus e lieve profondità arancioni non sostituiscono lo
  stato attivo.
- Rosso resta riservato alle azioni distruttive, verde al successo
  semanticamente necessario e i neutri alle azioni secondarie.
- È vietato applicare l'arancione indistintamente a ogni `button`: il pattern è
  opt-in, con hover limitato ai puntatori fini, focus-visible indipendente e
  trasformazioni disattivate con `prefers-reduced-motion`.

### Bottoni

- Ogni azione testuale nuova usa un'icona coerente dal set interno.
- I bottoni con sola icona sono ammessi esclusivamente per azioni compatte;
  richiedono sempre `aria-label`, tooltip e target comodo anche su touch.
- Varianti ammesse: primaria blu, secondaria neutra, positiva verde,
  distruttiva rossa e discreta/ghost.
- Bottoni nella stessa toolbar hanno altezza e allineamento uniformi.
- Su schermi stretti non si tronca il testo: la toolbar usa una griglia
  esplicita o raccoglie le azioni secondarie in «Altre azioni».
- Le azioni distruttive sono ultime nell'ordine visivo e non usano il blu.

### Dialog

`apps/web/src/components/DialogShell.tsx` è l'unica primitiva modale:

- portal su `document.body`, backdrop scuro sfocato e pannello senza bordo
  pesante;
- `role`, `aria-modal`, titolo associato, focus iniziale, focus trap e ripristino
  del focus all'apertura;
- `max-height` basata su `100dvh`, scroll verticale interno e nessun overflow
  orizzontale: i comandi rimangono raggiungibili a 320 px e con tastiera mobile;
- `busy`, Escape e click sul backdrop governati da proprietà esplicite;
- variante normale per conferme/form brevi e `wide-scroll` per review o form
  lunghi;
- i footer azione sono distinti dal contenuto soltanto tramite `gap`, margine
  e padding: nessun bordo, `<hr>`, pseudo-elemento o ombra inset separatrice;
- un lavoro locale non salvato non può essere perso con un click accidentale:
  la feature disabilita la chiusura oppure mostra una conferma separata.

Non sono ammesse nuove implementazioni locali di backdrop, focus trap o
contenimento nel viewport.

### Card di record

Didattica e Verifiche usano liste di card a larghezza piena, mai griglie di card
multiple e mai tabelle con scroll orizzontale su mobile.

- Tutta la superficie apre il record; le azioni interne non propagano
  l'apertura.
- L'implementazione usa un elemento interattivo reale sovrapposto alla card e
  bottoni azione su un livello superiore: niente `div role=button` contenente
  altri bottoni.
- Hover desktop: sollevamento massimo di 2 px, ombra leggermente più profonda e
  accento cromatico sobrio.
- Pressione: ritorno verso il piano e scala massima `0.995`, senza rimbalzi.
- Focus da tastiera sempre visibile sull'intera card.
- `prefers-reduced-motion` annulla sollevamento e transizioni.
- Titoli, metadati e azioni non dipendono dall'hover per essere scoperti.

#### Card programma

- titolo, anno, classi;
- UDA, lezioni, domande e progresso;
- docente: apri/rinomina/elimina; studente: apertura tramite la superficie e
  progresso, senza un secondo pulsante `Apri` ridondante;
- il pulsante sovrapposto conserva il nome accessibile ma non usa il tooltip
  nativo del browser;
- in Didattica studente la lista non ha barra di ricerca: il numero contenuto
  di corsi non giustifica un controllo passivo aggiuntivo;
- su desktop il progresso studente parte blu e segue l'accento arancione della
  card su hover/focus; il comportamento touch resta invariato;
- mobile: metadati e statistiche su righe ordinate, azioni senza overflow.
- l'header studente riusa lo stesso modulo CSS opt-in dell'header docente per
  stato attivo blu, hover/focus arancione e reduced-motion; le shell mantengono
  separate soltanto struttura e logica di navigazione.

#### Card verifica

- docente: titolo, programma, classe, anno e date nella colonna identità;
  quattro riquadri stabili e indipendenti per `Stato`, `Domande`,
  `Disponibilità PDF` e `Online`; lo stato è icona + testo, senza un secondo
  badge bordato dentro il riquadro, e lo switch vive nel riquadro `Online`;
  la superficie apre il dettaglio e le azioni restano controlli fratelli con
  CTA contestuale;
- studente: correzioni restituite, consegne effettuate e verifiche disponibili
  adottano lo stesso telaio, ma senza overlay quando non esiste una destinazione
  neutra e sicura; esame, PDF, ricevuta e correzione richiedono azioni esplicite;
- azioni delle card docente corso e verifica raccolte nello stesso wrapper
  `RecordActionsMenu`, che apre il menu portalato condiviso `ActionsMenu`:
  il portale su `document.body` evita il ritaglio da parte
  dell'`overflow` della card, Escape chiude e riporta il focus sul trigger, la
  selezione di una voce esegue prima il relativo handler React e poi chiude il
  menu; una voce disabilitata non esegue né chiude. Lo switch `Online` resta fuori dal menu
  perché è un controllo di stato, non un'azione;
- finché il menu di una card è aperto, la card mantiene il proprio stato
  interattivo arancione anche se il menu vive nel portale; nessun listener
  nativo anticipa o annulla gli handler React;
- la CTA di apertura della card compare solo su hover reale
  (`hover: hover` + `pointer: fine`) o focus da tastiera della superficie
  apribile: mai a riposo, mai su touch, con lo spazio riservato in anticipo per
  non introdurre spostamenti di layout. Il contratto è **opt-in per variante**
  (`ctaFollowsCard` per corso e verifica studente, `ctaFollowsSurface` per la
  verifica docente): nessun selettore hover generico sulla CTA e nessuna regola
  di neutralizzazione, quindi il risultato non dipende dall'ordine delle
  dichiarazioni CSS;
- mobile studente: azioni testuali responsive, senza griglie multi-card;
- `Nuova verifica` risiede nella barra filtri accanto a
  `Impostazioni correzione IA` e apre `DialogShell`;
- la tabella delle consegne nel dettaglio verifica resta una tabella dati
  intenzionale e non adotta questo pattern.

### Responsive

Breakpoint di verifica obbligatori: 1440, 1024, 390 e 320 px. Nessuna feature
docente è esentata dal mobile. Docente e studente condividono primitive e
pattern, mantenendo azioni e informazioni specifiche del ruolo.

L'header studente usa le stesse interazioni brand del docente su desktop:
arancione su hover/focus, sollevamento di 2 px e pressione `scale(0.97)`. Il
menu compatto mobile non eredita effetti hover desktop.

---

## Stati di caricamento

- **Liste e tabelle:** usare skeleton loader che riproducono la struttura del contenuto in arrivo (righe, card). Non mostrare uno spinner a tutto schermo per il caricamento di una lista.
- **Azioni puntuali (click su bottone):** mostrare uno spinner inline nel bottone che ha avviato l'azione, lasciando il resto della pagina interattivo.
- **Mai bloccare l'intera pagina:** il caricamento di una sezione non deve impedire l'interazione con il resto dell'interfaccia.

## Stati di errore

- Mostrare l'errore **inline**, vicino all'elemento che lo ha generato (campo, riga, bottone).
- L'errore deve essere **dismissibile** dall'utente.
- **Mai modale** per errori non critici. La modale è riservata esclusivamente alle **conferme di azioni distruttive** (eliminazione consegna, chiusura/archiviazione verifica, abilitazione correzione automatica).
- Ogni messaggio indica causa e azione correttiva.

## Stati vuoti

- Mostrare un messaggio amichevole accompagnato da una **CTA primaria**.
- Esempio: "Nessuna lezione importata. Importa la prima lezione →".
- Lo stato vuoto è un'opportunità di guida, non un vicolo cieco.

## Aggiornamenti ottimistici

- Applicare aggiornamenti ottimistici per le **scritture non critiche** (es. salvataggio del punteggio di una correzione).
- In caso di errore, **revertire** lo stato e mostrare una notifica inline accanto all'elemento interessato.
- Non usare aggiornamenti ottimistici per operazioni distruttive o irreversibili.

## Validazione dei form

- Validare **on blur** (uscita dal campo), non a ogni battitura.
- Mostrare gli errori **sotto il campo** interessato.
- I vincoli (es. lunghezza, caratteri ammessi) sono comunicati prima del submit quando possibile.

## Generazione PDF

- Mostrare un indicatore di avanzamento **all'interno del bottone** (non un loader a tutta pagina).
- **Disabilitare il bottone** durante la generazione per evitare doppi click.
- Al termine, il download parte automaticamente; nessun file persiste.

## Portale studente

- **Indicatore di autosave** sempre visibile, con stati: "Salvato" / "Salvataggio..." / "Errore — riprova".
- **Nessun prompt di navigazione** ("vuoi davvero uscire?"): la ripresa del tentativo è garantita dal cookie di sessione, quindi un'uscita accidentale non perde lo stato.
- Coerente con la deterrenza descritta nel brief (fullscreen, avvisi), senza ostacolare l'usabilità mobile.

## Accessibilità

- **ARIA label** su tutti i bottoni con sola icona.
- **Navigazione da tastiera** per ogni elemento interattivo.
- **Gestione del focus** dopo la chiusura di una modale: il focus torna all'elemento che l'aveva aperta.
- Target di riferimento: WCAG 2.2 livello AA (cfr. `analisi-requisiti.md`, NFR-ACC-01).
