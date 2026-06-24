# Privacy — Base giuridica, titolarità e retention dei dati degli studenti

**Stato:** aperta
**Owner:** Committente / Istituto scolastico
**Scadenza:** prima del go-live del Modulo 2 in produzione (primo trattamento di dati reali di studenti)
**Ultima revisione:** 24 giugno 2026

---

## Contesto

Dal Modulo 2 SchoolForge tratta dati personali di **minori** (nome, cognome, email scolastica, classe, risposte alle verifiche). Anche se l'autenticazione passa da Google Workspace for Education e i dati restano in un progetto Firebase del docente/istituto, vanno chiariti gli aspetti giuridici prima del primo trattamento reale. Questa decisione non è puramente tecnica: richiede il coordinamento con l'istituto scolastico, che è di norma il titolare del trattamento in ambito didattico.

## Punti da fissare

| Punto | Domanda | Nota |
|---|---|---|
| Titolarità | L'istituto è titolare e il docente responsabile/incaricato? | Tipico assetto scolastico italiano |
| Base giuridica | Su quale base si trattano i dati (compito di interesse pubblico / esecuzione di un servizio scolastico)? | Da concordare con l'istituto |
| Informativa | Studenti e famiglie ricevono un'informativa che cita SchoolForge? | Richiede testo dedicato |
| Residenza dati | Regione di trattamento (collegata a C-01) | Preferibile UE |
| Retention | Per quanto tempo si conservano consegne, correzioni e dati anagrafici? | Definire criterio e procedura di cancellazione |
| Invio all'AI | Le risposte possono essere inviate a un provider AI? Con quale consenso? | Collegato a C-02 e NFR-AI-02 |
| Diritti degli interessati | Come si gestiscono accesso, rettifica e cancellazione? | Procedura backend auditata (sicurezza §9.4) |

## Decisione

(Da compilare con l'istituto. Deve fissare titolarità, base giuridica, contenuto dell'informativa, regione, periodo di retention e procedura di cancellazione.)

## Conseguenze

Sblocca il go-live `prod` del Modulo 2. Alimenta i tempi di retention citati in sicurezza §9 e i vincoli su invio AI (C-02).

## Revisioni

| Data | Modifica | Motivazione |
|---|---|---|
| 2026-06-24 | Creazione verbale (stato aperta) | Introduzione presidio privacy |
