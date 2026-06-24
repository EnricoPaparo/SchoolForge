# SchoolForge — Pattern UX della SPA

Questo documento definisce i pattern di stato dell'interfaccia per la singola SPA (sezione docente desktop-first e Portale mobile-first). L'obiettivo è coerenza, reattività percepita e accessibilità.

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
