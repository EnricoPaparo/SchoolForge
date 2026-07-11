# M4 — Concept UX della correzione docente

**Stato:** concept approvato, non ancora implementato  
**Data decisione:** 2026-07-12  
**Prerequisito:** chiusura di M3-full e superamento del Gate G5

## 1. Obiettivo

M4 deve permettere al docente di aprire le consegne digitali, correggerle manualmente, salvarne il progresso e restituire allo studente punteggio e feedback. L'esperienza deve riprendere il linguaggio visivo dello svolgimento verifica lato studente: workspace dedicato, gerarchia chiara, controlli compatti e contenuto principale leggibile.

La submission originale dello studente resta immutabile. Punteggi, feedback, stato della correzione e rettifiche vivono in documenti separati.

## 2. Collocazione nel portale

Non viene introdotta inizialmente una nuova voce principale **Correzioni**.

Il percorso approvato è:

```text
Verifiche
  → verifica selezionata
    → tabella Consegne online già esistente
      → studente selezionato
        → workspace di correzione
```

La tabella **Consegne online** è quindi il punto di ingresso unico. Durante una verifica attiva continua a funzionare come monitor; quando esistono submission consegnate consente anche di aprire la correzione dello studente.

## 3. Tabella consegne

La tabella deve restare compatta e filtrabile.

| Colonna | Contenuto |
|---|---|
| Studente | Nome e cognome dell'account Google |
| Consegnata | Data e ora definitive |
| Eventi | Conteggio con apertura della dialog eventi già esistente |
| Correzione | Da correggere, In correzione, Corretta o Restituita |
| Punteggio | Totale/massimo, se disponibile |
| Azione | Icona per aprire o visualizzare la correzione |

Filtri previsti:

- tutte;
- da correggere;
- in correzione;
- corrette;
- restituite;
- ricerca per nome studente.

Sintesi superiore minimale:

```text
Consegne: N · Da correggere: N · Corrette: N · Restituite: N
```

Niente griglie di grandi card per ogni studente.

## 4. Workspace di correzione

Il dettaglio non è una modale: usa lo spazio principale della sezione Verifiche, come lo svolgimento lato studente.

### 4.1 Pannello superiore

Un pannello sticky, opaco e responsive contiene:

- ritorno alla lista consegne;
- nome studente;
- titolo verifica e classe;
- stato della correzione;
- punteggio corrente/totale;
- studente precedente e successivo;
- accesso agli eventi di attenzione;
- stato ultimo salvataggio;
- azioni **Salva** e **Completa correzione**.

Il contenuto non deve scorrere visivamente dietro al pannello. Su mobile i controlli si ricompongono senza produrre overflow orizzontale della pagina.

### 4.2 Correzione per domanda

Ogni domanda mostra, in ordine:

1. numero, tipologia e punteggio massimo;
2. testo immutabile della domanda assegnata;
3. risposta consegnata dallo studente;
4. soluzione immutabile disponibile al docente;
5. campo punti assegnati `0..maxPoints`;
6. feedback facoltativo per la domanda.

Il layout usa sezioni e separatori, non una successione di card annidate.

Per domande chiuse il confronto è visivo:

- verde per opzione corretta selezionata;
- rosso per opzione errata selezionata;
- indicazione neutra dell'opzione corretta non selezionata.

Il sistema può proporre deterministicamente il punteggio massimo per una risposta chiusa esatta e zero per una risposta errata. Il docente mantiene sempre il controllo e può modificare il punteggio proposto. Le domande aperte restano manuali.

### 4.3 Riepilogo

Su desktop una colonna sticky compatta mostra:

- domande valutate;
- domande ancora da valutare;
- risposte mancanti;
- punteggio totale e massimo;
- eventuale percentuale;
- feedback generale;
- **Salva correzione**;
- **Completa correzione**.

Su mobile il riepilogo diventa un pannello espandibile o una sezione finale, non una sidebar laterale permanente.

## 5. Stati e transizioni

Gli stati UX approvati sono:

```text
Da correggere → In correzione → Corretta → Restituita
```

- **Da correggere:** submission consegnata, nessuna correzione salvata.
- **In correzione:** esiste una correzione modificabile non completata.
- **Corretta:** il docente ha completato la valutazione, ma lo studente non la vede ancora.
- **Restituita:** risultato reso visibile allo studente.

Una correzione completa può essere riaperta dal docente. Ogni rettifica significativa deve essere tracciata con evento append-only.

## 6. Visibilità e restituzione

La pubblicazione della verifica e la restituzione della correzione sono controlli distinti.

Sono previsti:

- controllo per rendere visibile o nascondere allo studente la propria correzione;
- controllo a livello verifica **Mostra soluzioni dopo la restituzione**, disattivato per default;
- eventuale azione batch **Restituisci tutte le correzioni completate**, da confermare durante la specifica M4.

Prima della restituzione lo studente continua a vedere soltanto la conferma di consegna. Dopo la restituzione vede:

- titolo e data della verifica;
- data di consegna;
- punteggio totale e massimo;
- percentuale, se prevista;
- feedback generale;
- per ogni domanda: propria risposta, punti e feedback;
- soluzione corretta solo quando il relativo controllo docente è abilitato.

Nascondere nuovamente una correzione non modifica né elimina i dati: cambia soltanto la proiezione leggibile dallo studente.

## 7. Contratto dati candidato

La direzione approvata è un documento separato dalla submission, per esempio:

```text
corrections/{verificationId}_{studentUid}
```

Contenuto candidato:

- `verificationId`, `studentUid`, `ownerUid`;
- stato della correzione;
- punteggi per domanda;
- feedback per domanda;
- feedback generale;
- totale, massimo e percentuale derivata;
- `createdAt`, `updatedAt`, `correctedAt`, `returnedAt`;
- revisione/versione per gestire salvataggi concorrenti.

Le rettifiche candidate vivono in eventi append-only separati, per esempio `correctionEvents`. Il modello definitivo, i path e le Security Rules vengono formalizzati in M4-A.

## 8. Principi di sicurezza ed efficienza

- La submission consegnata non viene mai riscritta dalla correzione.
- Solo il docente owner può leggere e scrivere le correzioni tecniche.
- Lo studente legge esclusivamente una proiezione restituita e limitata ai propri dati.
- Nessun listener globale sempre acceso: la correzione viene caricata quando il workspace è aperto.
- Salvataggio dirty-only e senza write per ogni digitazione.
- Nessuna Cloud Function se le Security Rules client-side sono sufficienti.
- Nessuna soluzione deve raggiungere lo studente prima della restituzione e dell'abilitazione esplicita.
- Correzione e export lavorano sullo snapshot immutabile assegnato, mai sui pool correnti.

## 9. Fuori scope del primo M4

- AI e correzione automatica generativa;
- voto su registro elettronico;
- rubriche complesse;
- correzione di prove cartacee;
- allegati e annotazione grafica;
- confronto tra più tentativi;
- analisi statistiche avanzate;
- email o notifiche push.

## 10. Decisioni ancora da formalizzare

Prima dell'implementazione servono decisioni operative su:

1. percentuale e arrotondamento;
2. presenza o meno di un voto distinto dal punteggio;
3. comportamento dell'eventuale restituzione batch;
4. formato export predefinito richiesto da H-04;
5. eliminazione o anonimizzazione di submission e correzione;
6. gestione di rettifiche già restituite;
7. soglia e messaggio per correzioni incomplete;
8. modello definitivo delle proiezioni studente e relative Rules.

Queste decisioni non cambiano il concept UX approvato; vengono chiuse durante M4-00/M4-A.
