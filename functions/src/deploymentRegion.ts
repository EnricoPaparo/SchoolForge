/**
 * Regione di deploy delle Cloud Functions SchoolForge.
 *
 * DEV conserva il default storico `us-central1`. PROD deve dichiarare
 * esplicitamente `europe-west8`, così un ambiente mal configurato fallisce in
 * fase di build/deploy invece di pubblicare Functions nella regione sbagliata.
 */
export const SCHOOLFORGE_FUNCTION_REGIONS = ['us-central1', 'europe-west8'] as const;
export const SCHOOLFORGE_TASK_REGIONS = ['us-central1', 'europe-west3'] as const;

export type SchoolForgeFunctionRegion = (typeof SCHOOLFORGE_FUNCTION_REGIONS)[number];
export type SchoolForgeTaskRegion = (typeof SCHOOLFORGE_TASK_REGIONS)[number];

export function resolveSchoolForgeFunctionRegion(
  raw: string | undefined,
  projectId: string | undefined = undefined,
): SchoolForgeFunctionRegion {
  const value = raw?.trim();
  if (projectId === 'schoolforge-prod') {
    if (value && value !== 'europe-west8') {
      throw new Error('schoolforge-prod richiede SCHOOLFORGE_FUNCTION_REGION=europe-west8.');
    }
    return 'europe-west8';
  }
  if (!value) return 'us-central1';
  if (value === 'us-central1' || value === 'europe-west8') return value;
  throw new Error(`SCHOOLFORGE_FUNCTION_REGION non valida: ${value}`);
}

export const SCHOOLFORGE_FUNCTION_REGION = resolveSchoolForgeFunctionRegion(
  process.env.SCHOOLFORGE_FUNCTION_REGION,
  process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT,
);

/**
 * Regione della sola task queue di chiusura consegne.
 *
 * Cloud Tasks non è disponibile a Milano (`europe-west8`). PROD usa quindi
 * Francoforte (`europe-west3`), la regione europea supportata più vicina fra
 * quelle condivise da Cloud Tasks e Cloud Functions. DEV conserva la regione
 * storica `us-central1`.
 */
export function resolveSchoolForgeTaskRegion(
  raw: string | undefined,
  projectId: string | undefined = undefined,
): SchoolForgeTaskRegion {
  const value = raw?.trim();
  if (projectId === 'schoolforge-prod') {
    if (value && value !== 'europe-west3') {
      throw new Error('schoolforge-prod richiede SCHOOLFORGE_TASK_REGION=europe-west3.');
    }
    return 'europe-west3';
  }
  if (!value) return 'us-central1';
  if (value === 'us-central1' || value === 'europe-west3') return value;
  throw new Error(`SCHOOLFORGE_TASK_REGION non valida: ${value}`);
}

export const SCHOOLFORGE_TASK_REGION = resolveSchoolForgeTaskRegion(
  process.env.SCHOOLFORGE_TASK_REGION,
  process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT,
);
