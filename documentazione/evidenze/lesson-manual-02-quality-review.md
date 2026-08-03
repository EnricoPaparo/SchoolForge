# LESSON-MANUAL-02 — protocollo di review qualitativa

> **Stato: NON DISPONIBILE.** Gli scenari e la rubrica sono congelati, ma in
> questa attività non è stata generata alcuna lezione e non è stato sostenuto
> alcun costo. Nessun verdetto sulla qualità del prompt è quindi dichiarabile.

## Obiettivo

Determinare con evidenze osservabili se il prompt lezione attuale debba restare
invariato, ricevere una correzione leggera o essere rivisto sostanzialmente.
La review separa qualità del contenuto, resa del renderer, qualità dei metadati
e variabilità del modello: una resa grafica riuscita non rende corretta una
lezione e un buon Markdown non assolve un problema visivo.

## Baseline congelata

- dataset: `lesson-manual-02-scenarios-v1`;
- rubrica: `lesson-manual-02-rubric-v1`;
- profilo primario: `economy`, per minimizzare il costo;
- una generazione per scenario nel primo passaggio;
- prompt, payload, modello, parametri e scenario non modificati fra stima e
  generazione;
- output originale conservato senza correzioni prima della valutazione;
- renderer verificato nelle viste lezione docente e studente, non nella sola
  anteprima IA (che usa intenzionalmente il renderer legacy).

I limiti `synthetic=5000`, `complete=9000`, `in_depth=15000` token sono hard cap
tecnici, non obiettivi di lunghezza. Il cap temporaneo è 600.000 byte UTF-8 e
quello del salvataggio canonico è 700.000 byte: nessuno dei due autorizza testo
riempitivo.

## Sei scenari

| ID | Caso | Cosa stressa |
|---|---|---|
| LM02-01 | Teoria introduttiva | Chiarezza, essenzialità completa, nessuna anticipazione |
| LM02-02 | Procedura tecnica | Passi verificabili, diagnosi, relazione causa-effetto |
| LM02-03 | Esempi pratici | Trasferimento fra esempi e concetto, casi misti |
| LM02-04 | Esercizi svolti | Soluzioni motivate passo-passo e controllo del risultato |
| LM02-05 | Difficile/in-depth | Profondità, precisione e gestione del carico cognitivo |
| LM02-06 | Confine UDA | Richiami brevi al passato, nessun anticipo del futuro |

I payload completi e machine-readable sono in
[`lesson-manual-02-scenarios.json`](lesson-manual-02-scenarios.json).

## Procedura autorizzabile

1. Verificare che `main`, prompt contract, dataset e rubrica corrispondano alle
   versioni congelate; in caso contrario fermarsi.
2. Eseguire prima le sei **stime** e registrare il tetto complessivo. La stima
   non chiama il provider e non scrive un output.
3. Ottenere l'autorizzazione esplicita al costo reale. Questa documentazione da
   sola non la concede.
4. Generare i sei campioni con il profilo `economy`, una volta ciascuno, senza
   modificare i parametri durante il lotto.
5. Conservare localmente l'output Markdown originale con nome
   `LM02-XX-economy-original.md`; non commettere dati personali, chiavi, prompt
   grezzi o run document.
6. Aprire ogni campione nella vista lezione docente e nella vista studente a
   1440, 1024, 390 e 320 px. Annotare separatamente problemi del renderer.
7. Valutare l'output originale con la rubrica. Non correggere il testo prima
   dell'assegnazione dei punteggi.
8. Far effettuare la review pedagogica al docente; per punteggi 0–2 riportare
   un'evidenza concreta e non una sensazione generica.
9. Applicare prima il verdetto per scenario, poi quello aggregato sul prompt.
10. Solo dopo il verdetto scegliere fra prompt invariato, fix leggero o nuova
    progettazione. Ogni modifica richiede un nuovo datasetVersion o una nuova
    promptContractVersion e un confronto separato.

## Scheda da compilare per ogni scenario

```text
Scenario:
Profilo / modello dichiarato dal server:
Data e SHA:
Costo stimato / effettivo:
Output originale disponibile: sì/no
Vista docente 1440/1024/390/320: esito
Vista studente 1440/1024/390/320: esito
Punteggi 15 dimensioni:
Totale /60:
Blocker:
Verdetto scenario:
Problema attribuito a: prompt / renderer / metadati / variabilità / nessuno
Evidenze e correzioni necessarie:
```

## Stato iniziale

| Elemento | Stato |
|---|---|
| Scenari congelati | Disponibili |
| Rubrica congelata | Disponibile |
| Output reali | Assenti |
| Review docente | Non eseguita |
| Chiamate provider in questa attività | 0 |
| Costo reale in questa attività | 0 |
| Verdetto prompt | `NON_DISPONIBILE` |

## Vincoli

- nessun dato studente o docente nei campioni;
- nessuna modifica automatica del prompt a valle dei punteggi;
- nessun confronto `economy`/`quality` senza nuova autorizzazione;
- nessuna promozione in produzione derivata da questa sola review;
- nessuna chiamata, deploy o lettura di secret durante la preparazione del
  protocollo.
