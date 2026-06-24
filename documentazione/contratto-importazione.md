# SchoolForge — Contratto di importazione del repository didattico

**Versione:** 3.2
**Autorità:** `brief.md`, `analisi-requisiti.md`, `architettura.md`
**Destinatari:** implementazione di F-03, M1-A e M1-B

## 1. Scopo

Questo contratto definisce l'unico formato sorgente supportato dalla V1 per Programmi, UDA, Lezioni, pool e asset. La struttura mantiene Markdown e asset leggibili fuori da SchoolForge; gli identificatori impediscono che un rinominamento trasformi un contenuto esistente in un nuovo contenuto.

Il contratto non introduce un editor, versioni consultabili del repository o un formato proprietario.

## 2. Struttura richiesta

Ogni importazione contiene una sola radice di Programma.

```text
programma/
├── programma.yaml
└── udas/
    └── reti-protocolli/
        ├── uda-01-reti.md
        ├── lezione-001-tcp-ip.md
        ├── lezione-001-tcp-ip.pool.md
        ├── lezione-002-http.md
        └── assets/
            └── schema-tcp-ip.png
```

Ogni UDA dichiara esplicitamente l'elenco ordinato delle proprie lezioni nel manifesto. Per evitare inferenze dai titoli, `programma.yaml` contiene l'ordine esplicito delle UDA e delle lezioni.

```yaml
schema: schoolforge-program/v1
id: tpsit-terzo-2025
titolo: TPSIT — Terzo anno
anno_scolastico: "2025/2026"
udas:
  - id: reti-protocolli
    file: udas/reti-protocolli/uda-01-reti.md
    lessons:
      - id: tcp-ip
        file: udas/reti-protocolli/lezione-001-tcp-ip.md
      - id: http
        file: udas/reti-protocolli/lezione-002-http.md
```

Il file UDA usa front matter YAML:

```yaml
---
id: reti-protocolli
titolo: Reti e protocolli
competenze:
  - Comprendere i protocolli di rete.
obiettivi:
  - Distinguere TCP e UDP.
---
```

La lezione usa almeno un front matter con il medesimo `id` dichiarato nel manifesto; il corpo Markdown resta libero.

```yaml
---
id: tcp-ip
---
```

## 3. Identificatori e percorsi

- `program.id`, `uda.id`, `lesson.id` e `question.id` sono minuscoli, composti da lettere, cifre e trattini, e rispettano `^[a-z0-9]+(?:-[a-z0-9]+)*$`.
- `program.id` è univoco per il docente; `uda.id` è univoco nel Programma; `lesson.id` è univoco nel Programma; `question.id` è univoco nel pool associato.
- Il rinominamento di un file o titolo è consentito solo mantenendo il medesimo `id`; la sostituzione con un `id` diverso è un nuovo contenuto e la UI deve renderne evidente l'effetto sulle verifiche future.
- Il pool si chiama esattamente come la lezione associata con suffisso `.pool.md`, per esempio `lezione-001-tcp-ip.pool.md`.
- Gli asset sono referenziati con percorsi relativi sotto la cartella `assets/` dell'UDA; sono vietati percorsi assoluti, `..`, symlink e URL remoti nel materiale importato.

## 4. Input, limiti e validazione

La V1 accetta selezione di cartella, file singoli che compongono una radice completa o archivio `.zip`. I limiti server-side sono: massimo 2.000 file, 100 MiB compressi/caricati, 1 MiB per file Markdown/YAML e 10 MiB per asset. Sono accettati Markdown, YAML del contratto e asset `png`, `jpg`, `jpeg`, `webp` e `gif`; SVG, HTML, script, file eseguibili e archivi annidati sono rifiutati.

Per gli archivi ZIP il backend rifiuta path traversal, file duplicati dopo normalizzazione, symlink, rapporto di decompressione anomalo e file oltre i limiti. Ogni errore riporta percorso, fase e causa; un pool invalido esclude soltanto quel pool, mentre manifest, UDA o lezione invalidi bloccano il commit del Programma.

## 5. Commit e recupero

1. Il client ottiene URL di upload temporanei e carica nello staging `staging/{importId}`.
2. Il backend esegue il preflight completo, costruisce l'indice e mostra l'anteprima.
3. Dopo `confirmation: true`, il backend copia il contenuto validato in uno snapshot tecnico immutabile `repository/content/{programId}/{contentSnapshotId}`.
4. Solo dopo la copia completa, una transazione Firestore aggiorna `programs/{programId}.activeContentSnapshotId`, indici e audit.
5. L'applicazione legge esclusivamente lo snapshot indicato dal puntatore Firestore. Un errore prima del puntatore non rende visibile alcun contenuto parziale; cleanup asincrono elimina staging e snapshot non attivati.

`contentSnapshotId` è un meccanismo di commit e rollback tecnico, non una cronologia esposta al docente. Il sistema conserva un solo snapshot attivo; gli oggetti precedenti seguono cleanup e backup C-01.

## 6. Output obbligatori

L'import restituisce `importId`, anteprima, errori strutturati, conteggi di UDA/lezioni/pool/domande e il nuovo `activeContentSnapshotId` dopo il commit. Il dashboard di prontezza mostra per ogni lezione: validità, presenza del pool, numero di domande eleggibili e motivi di esclusione, senza generare o modificare contenuti.
