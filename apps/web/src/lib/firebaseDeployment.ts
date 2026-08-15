export const FIREBASE_FUNCTIONS_REGIONS = ['us-central1', 'europe-west8'] as const;

export type FirebaseFunctionsRegion = (typeof FIREBASE_FUNCTIONS_REGIONS)[number];

/**
 * Risolve la regione del client callable.
 *
 * Il default mantiene compatibili DEV, emulatori e test storici. Per il vero
 * progetto PROD la dichiarazione Milan è invece obbligatoria: una build con
 * variabili mancanti o errate deve fermarsi prima del deploy.
 */
export function resolveFirebaseFunctionsRegion(
  projectId: string | undefined,
  rawRegion: string | undefined,
): FirebaseFunctionsRegion {
  const region = rawRegion?.trim();
  if (projectId === 'schoolforge-prod') {
    if (region !== 'europe-west8') {
      throw new Error('PROD richiede VITE_FIREBASE_FUNCTIONS_REGION=europe-west8.');
    }
    return region;
  }
  if (!region) return 'us-central1';
  if (region === 'us-central1' || region === 'europe-west8') return region;
  throw new Error(`VITE_FIREBASE_FUNCTIONS_REGION non valida: ${region}`);
}
