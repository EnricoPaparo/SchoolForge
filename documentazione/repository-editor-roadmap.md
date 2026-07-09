# SchoolForge — Roadmap Repository Editor

**Stato:** proposta operativa approvata come prossima fase dopo M3-lite  
**Nome fase:** RE — Repository Editor  
**Obiettivo:** ridurre la dipendenza dall'import ZIP e rendere SchoolForge usabile ogni giorno dal docente per creare, correggere e riorganizzare materiale didattico.

---

## 1. Perché questa fase viene prima di M3-full

Il portale docente e il portale studente M3-lite sono ora usabili. Il limite operativo più evidente è che il repository didattico dipende ancora troppo dall'import ZIP: è ottimo per caricare un corso iniziale, ma è macchinoso per modifiche quotidiane.

Il Repository Editor è quindi il prossimo sviluppo più utile perché:

- aumenta subito il valore per il docente;
- non introduce consegne online, tentativi, correzioni o AI;
- resta coerente con l'approccio minimale e a basso costo;
- usa Firestore e Storage già presenti;
- mantiene il Markdown come formato portabile ed esportabile.

M3-full, correzione online e AI restano rinviati.

---

## 2. Principi di prodotto

1. **Markdown-first, non CMS proprietario.** Il docente modifica contenuti Markdown e front matter, non oggetti opachi.
2. **Editor minimale.** Testo, metadata, anteprima e salvataggio; niente editor visuale complesso.
3. **Import ZIP ancora valido.** L'import resta il modo rapido per caricare materiale iniziale o rigenerato fuori da SchoolForge.
4. **SchoolForge diventa sorgente operativa corrente.** Dopo l'import iniziale, il docente può correggere contenuti direttamente dal portale.
5. **Export sempre portabile.** L'export ZIP deve continuare a produrre file Markdown leggibili fuori da SchoolForge.
6. **Nessuna AI, nessuna Cloud Function.** La fase RE resta client + Firebase Rules, salvo decisione esplicita futura.

---

## 3. Scope funzionale

### Incluso

- Creare UDA dentro un programma.
- Modificare UDA:
  - titolo;
  - descrizione;
  - competenze;
  - obiettivi;
  - altri campi front matter già supportati.
- Eliminare UDA, con blocco se esistono verifiche collegate.
- Riordinare UDA.
- Creare lezioni dentro una UDA.
- Modificare lezioni:
  - titolo;
  - sottotitolo;
  - difficoltà;
  - concetti chiave;
  - obiettivi;
  - corpo Markdown.
- Eliminare lezioni, con blocco se esistono verifiche collegate.
- Riordinare lezioni.
- Anteprima Markdown della lezione.
- Aggiornare automaticamente la consultazione docente e studente dopo il salvataggio.
- Mantenere export ZIP coerente con lo stato corrente.

### Escluso

- Editor WYSIWYG avanzato.
- Collaborazione multiutente.
- Versioning/storico completo dei contenuti.
- Suggerimenti AI o generazione automatica.
- Editing dei pool domande nella prima iterazione.
- Gestione asset avanzata nella prima iterazione.
- M3-full, consegna online, correzione, tentativi.

---

## 4. Decisioni tecniche iniziali

### 4.1 Ordinamento

Non usare la rinomina dei file come unico meccanismo di ordinamento.

Modello consigliato:

- `order` numerico su UDA e lezioni in Firestore;
- titolo visuale letto dal front matter;
- filename tecnico stabile;
- export ZIP che può rigenerare nomi ordinati o preservare quelli correnti secondo una decisione successiva.

Motivo: rinominare file per riordinare è fragile, rompe riferimenti e rende costoso aggiornare Storage, Firestore e proiezioni.

### 4.2 Fonte dati corrente

Il contenuto modificabile resta il file Markdown in Storage, ma Firestore mantiene metadata, ordine e proiezioni:

- programma/UDA/lezione tecnici per UI docente;
- `publicLessons` per UI studente;
- eventuale indice domande per verifiche.

Ogni salvataggio deve aggiornare insieme:

1. file Markdown in Storage;
2. metadata Firestore;
3. proiezione studente `publicLessons`, se applicabile.

### 4.3 Eliminazione

Una UDA o lezione non va eliminata se esistono verifiche che dipendono da domande o riferimenti di quella UDA/lezione.

Regola iniziale:

- se esiste almeno una verifica draft/active/closed che contiene riferimenti a quella lezione o ai suoi pool, bloccare l'eliminazione;
- mostrare un messaggio operativo con l'elenco verifiche bloccanti;
- il docente deve prima eliminare o modificare quelle verifiche.

### 4.4 Pool domande

Nella prima fase RE non si modifica il pool domande.

Motivo: editare pool significa toccare validazione domande, `questionIndex`, verifiche già create e casi di regressione più delicati. Va fatto come fase dedicata dopo editor UDA/lezioni.

---

## 5. Roadmap incrementale

| ID | Nome | Risultato | Note |
|---|---|---|---|
| RE-00 | Allineamento contratti | Tipi e documentazione per editor, `order`, metadata e blocchi eliminazione. | Solo docs/tipi/test di contratto se necessari. |
| RE-01 | Editor metadata UDA/lezione | Modifica front matter UDA e lezione senza toccare ancora il corpo Markdown. | Piccola PR verificabile. |
| RE-02 | Editor corpo lezione + anteprima | Modifica Markdown lezione e preview sanitizzata. | Aggiorna Storage + metadata + publicLessons. |
| RE-03 | Creazione UDA e lezioni | Crea UDA/lezioni da UI, con front matter minimo valido. | Filename tecnico generato automaticamente. |
| RE-04 | Riordino UDA/lezioni | Drag/drop o controlli su/giù, persistendo `order`. | Mobile-friendly; niente rinomina file. |
| RE-05 | Eliminazione protetta | Elimina UDA/lezioni solo se non bloccate da verifiche collegate. | Messaggi chiari sui blocchi. |
| RE-06 | Export ZIP coerente | Export del repository aggiornato dopo modifiche da editor. | Verifica portabilità fuori da SchoolForge. |
| RE-07 | Hardening editor | Test integrazione, checklist manuale DEV, documentazione operativa. | Gate di stabilità prima di nuove feature. |

---

## 6. Prompt consigliato per il primo agente

```txt
Repo: SchoolForge.
Parti da main aggiornato e working tree pulito.

Obiettivo: preparare RE-00, cioè il contratto tecnico minimo per il Repository Editor, senza implementare UI completa.

Contesto:
- M1/M2/M3-lite sono implementati e DEV è funzionante.
- Il prossimo sviluppo prodotto è RE — Repository Editor.
- Lo scopo è permettere al docente di creare/modificare/eliminare/riordinare UDA e lezioni, inclusi front matter, mantenendo Markdown-first ed export portabile.
- Non introdurre AI, Cloud Functions, consegna online, correzione o CMS complesso.

Task:
1. Leggi documentazione/repository-editor-roadmap.md, README.md, documentazione/piano-implementazione.md, documentazione/api-contract.md, documentazione/sicurezza.md.
2. Proponi e implementa solo gli aggiornamenti di contratto necessari per RE-00:
   - campi `order` per UDA e lezioni, se mancanti;
   - metadata modificabili per programma/UDA/lezione;
   - regole di blocco eliminazione se esistono verifiche collegate;
   - responsabilità di aggiornamento Storage + Firestore + publicLessons.
3. Se tocchi tipi TypeScript o contratti dati, aggiungi test minimi.
4. Non implementare ancora editor UI completo.
5. Non fare deploy.

Verifiche:
- format:check sempre;
- typecheck se tocchi TS/TSX;
- test mirati se aggiungi logica o tipi testabili;
- build solo se tocchi codice app.

Output:
- file modificati;
- decisioni tecniche prese;
- cosa resta per RE-01;
- verifiche eseguite.
Apri PR draft.
```

---

## 7. Rischi da tenere sotto controllo

- **Desincronizzazione Storage/Firestore/publicLessons.** Ogni salvataggio deve avere rollback o messaggio di errore chiaro.
- **Eliminazioni distruttive.** Bloccare quando esistono verifiche collegate.
- **Riordino fragile.** Non rinominare file solo per cambiare ordine.
- **Aumento scope.** Niente editor visuale avanzato, niente pool editor nella prima fase.
- **Costi Firebase.** L'editor aumenta scritture Storage/Firestore, ma resta compatibile con uso personale e basso volume.

