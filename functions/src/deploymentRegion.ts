/**
 * Regione di deploy delle Cloud Functions SchoolForge.
 *
 * DEV conserva il default storico `us-central1`. PROD deve dichiarare
 * esplicitamente `europe-west8`, così un ambiente mal configurato fallisce in
 * fase di build/deploy invece di pubblicare Functions nella regione sbagliata.
 */
export const SCHOOLFORGE_FUNCTION_REGIONS = ['us-central1', 'europe-west8'] as const;

export type SchoolForgeFunctionRegion = (typeof SCHOOLFORGE_FUNCTION_REGIONS)[number];

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
