/** User-facing labels shared by the teacher editor and student player. */
export function practiceStageLabel(stage: string): string {
  return (
    (
      {
        esempio: 'Esempio svolto',
        guidato: 'Esercizio guidato',
        autonomo: 'Prova autonoma',
        trasferimento: 'Applica in un nuovo contesto',
      } as Record<string, string>
    )[stage] ?? 'Attività'
  );
}
export function practiceCoverageLabel(status: string): string {
  return (
    (
      {
        preparato: 'Spiegato nella lezione',
        parziale: 'Preparazione parziale',
        non_sviluppato: 'Da sviluppare nella lezione',
      } as Record<string, string>
    )[status] ?? 'Da verificare'
  );
}
