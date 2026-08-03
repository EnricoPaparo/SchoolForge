# LESSON-MANUAL-00 — evidenza di review docente

**Stato: PENDING.** Nessun gate è superato.

**Aggiornamento (LESSON-MANUAL-01):** la resa è ora disponibile nel runtime come
**variante opt-in** delle due viste lezione, quindi la valutazione può avvenire
sull'applicazione reale invece che sul solo prototipo. Questo **non** cambia lo
stato del gate: il renderer legacy resta disponibile e nessuna sostituzione
definitiva è autorizzata finché questa checklist non è compilata con esito
`APPROVATO`.

- **Oggetto:** proposta di resa delle lezioni Markdown come manuale digitale.
- **Materiale da valutare:** [`../prototipi/lesson-manual.html`](../prototipi/lesson-manual.html)
  (aprire direttamente nel browser: è un file autonomo, senza rete).
- **Contratto:** [`../lesson-manual-contract.md`](../lesson-manual-contract.md)
- **Ambito:** solo documentazione e prototipo. Nessuna modifica al runtime,
  nessuna dipendenza, nessun deploy.

## Come valutare

Puoi valutare in due modi: sull'applicazione (consigliato, è la resa reale) o
sul prototipo (utile per il confronto affiancato «Attuale / Manuale», che
l'applicazione non offre).

**Sull'applicazione:** apri una lezione dal portale docente e la stessa lezione
dal portale studente — la resa deve essere equivalente. L'anteprima dell'editor
e quella della generazione IA devono invece essere rimaste **come prima**.

**Sul prototipo:**

1. Apri il prototipo nel browser.
2. Usa l'interruttore **Attuale / Manuale** in alto: il contenuto è identico
   nelle due modalità, cambia solo la presentazione. Confronta più volte.
3. Usa l'interruttore **2 heading / 6 heading** per vedere il comportamento
   dell'indice sopra e sotto la soglia.
4. Ripeti su desktop **e** su telefono (o restringendo la finestra sotto i
   960 px, poi sotto i 360 px).
5. Prova la sola tastiera: `Tab`, `Invio`, e il link «Vai al contenuto».

## Checklist

| # | Criterio | Esito | Note del docente |
|---|---|---|---|
| 1 | **Leggibilità desktop** — la riga non è troppo lunga; si legge senza affaticamento | ☐ sì ☐ no | |
| 2 | **Leggibilità mobile** — nessun testo compresso, nessuno scorrimento laterale | ☐ sì ☐ no | |
| 3 | **Identità SchoolForge** — sembra lo stesso prodotto del resto del portale | ☐ sì ☐ no | |
| 4 | **Assenza effetto blog** — non sembra un articolo, un social, una presentazione o una landing | ☐ sì ☐ no | |
| 5 | **Densità corretta** — né troppo arioso né compresso; resta una lezione, non un insieme di widget | ☐ sì ☐ no | |
| 6 | **Indice utile e non invasivo** — orienta senza rubare spazio; sparisce sotto i 3 heading | ☐ sì ☐ no | |
| 7 | **Heading** — si capisce a colpo d'occhio dove inizia una sezione | ☐ sì ☐ no | |
| 8 | **Callout** — i cinque tipi si distinguono, senza emoji e senza eccessi | ☐ sì ☐ no | |
| 9 | **Tabelle** — leggibili; lo scorrimento resta dentro la tabella | ☐ sì ☐ no | |
| 10 | **Codice** — leggibile; la barra del linguaggio e «Copia» sono utili, non decorativi | ☐ sì ☐ no | |
| 11 | **Formule / diagrammi (placeholder)** — la presentazione proposta è accettabile | ☐ sì ☐ no | |
| 12 | **Confronto attuale/manuale** — il confronto è onesto e il miglioramento è reale | ☐ sì ☐ no | |
| 13 | **Accessibilità** — focus sempre visibile, navigazione da tastiera possibile, nessun movimento fastidioso | ☐ sì ☐ no | |
| 14 | **Navigazione dall'indice** — cliccando una voce si arriva alla sezione *e* il punto di lettura si sposta davvero (provalo anche solo da tastiera) | ☐ sì ☐ no | |
| 15 | **Cronologia pulita** — dopo aver scorso la lezione, il pulsante «indietro» del browser non è pieno di passaggi intermedi | ☐ sì ☐ no | |

## Domande aperte per il docente

1. La colonna di lettura desktop (~42rem, circa 78 caratteri) è della larghezza
   giusta, o la preferisci più stretta / più larga?
2. L'indice laterale va tenuto, oppure basta la versione compatta anche su
   desktop?
3. La procedura numerata con i cerchi è adatta al contesto scolastico, o
   preferisci una normale lista numerata?
4. I cinque callout coprono i tuoi bisogni reali, o ne manca uno (per esempio
   «Approfondimento») / ne avanza uno?
5. Il pulsante «Copia» sui blocchi di codice serve nella tua materia?

## Vincoli tecnici già congelati (non oggetto di questa review)

Questi punti sono decisi nel contratto e non richiedono una valutazione estetica;
sono elencati perché la loro violazione, in LESSON-MANUAL-01, è motivo di rifiuto
indipendentemente dall'esito grafico:

- pipeline `Markdown → parser controllato → HTML → DOMPurify → render`, con
  **divieto assoluto** di iniettare HTML dopo la sanificazione (§5.1);
- **parser isolato** per la variante lesson: nessun `marked.use()` globale, e il
  renderer legacy deve produrre lo stesso DOM prima e dopo (§5.2);
- slug deterministici, suffissi progressivi sui duplicati, accenti stabili, `id`
  mai derivati da HTML non attendibile (§4.1);
- un solo `IntersectionObserver` con cleanup, nessun listener per heading,
  nessuna scrittura nella cronologia durante lo scroll (§4.2).

## Esito

- **Data della review:** ______
- **Esito:** ☐ APPROVATO ☐ APPROVATO CON MODIFICHE ☐ RIFIUTATO
- **Modifiche richieste prima di LESSON-MANUAL-01:**

  ```
  (da compilare)
  ```

- **Autorizzazione a procedere con LESSON-MANUAL-01:** ☐ sì ☐ no

> Finché questo documento riporta `PENDING`, il renderer attuale resta l'unica
> resa ufficiale delle lezioni.
