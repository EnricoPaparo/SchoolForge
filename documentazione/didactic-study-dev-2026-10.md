# Didattica e studio — contratto DEV, ottobre 2026

Base: `113f757`. Scope approvato: allineamento lezione/pool, pratica progressiva,
legame pratica/verifica, struttura comune, lezioni autonome, pool equilibrati.

## Architettura e incrementi

1. Rafforzare generazione e revisione pool con verifica del procedimento rispetto
   al testo. Audit esplicito dei pool esistenti, proposta senza salvataggio automatico.
2. Contratto didattico additivo ancorato al corpo finale; riferimenti testuali
   verificabili, invalidazione al cambiamento. Criteri disciplinari nelle lezioni.
3. Esercitazioni generate dal gateway contenuti esistente, preparate dal docente,
   modificabili e pubblicabili. Esempio svolto, guidato, autonomo; trasferimento
   solo quando supportato. Aiuti progressivi e risposte locali alla sessione.
4. Pratica approvata come riferimento subordinato alla lezione per il pool;
   riepilogo docente della copertura e dei controlli.

## Invarianti

- Nessuna modifica a punti=difficoltà, correzione IA, mappe, ripasso o fonti esterne.
- Nessun provider reale durante lo sviluppo; stima e accounting del gateway invariati.
- Pool sempre privato. Pratica studente subordinata ad accesso lezione, pubblicazione,
  corpo corrente e blocco verifica. Nessuna persistenza delle risposte personali.
- Legacy senza pratica continua a funzionare. Nessuna migrazione.
- Unico writer; review indipendente e CI prima di merge e DEV dell'orchestratore.

## Gate e copertura

- [ ] Allineamento cognitivo anche generazione normale e audit esplicito.
- [ ] Contratto didattico e invalidazione.
- [ ] Generazione, modifica, pubblicazione e ritiro pratica docente.
- [ ] Pratica studente con aiuti, confronto aperte e controllo chiuse.
- [ ] Legame pratica/pool e riepilogo docente.
- [ ] Prompt disciplinari e regressioni.
- [ ] Format, lint, typecheck, test, build, rules, diff check.
- [ ] Review indipendente, CI e deploy DEV mirato con smoke (orchestratore).
