export type PdfModuleLoadErrorCategory = 'stale_chunk' | 'generic';

const STALE_CHUNK_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /failed to load module script/i,
  /loading chunk [\w-]+ failed/i,
  /chunkloaderror/i,
];

export class PdfModuleLoadError extends Error {
  readonly category: PdfModuleLoadErrorCategory;

  constructor(category: PdfModuleLoadErrorCategory, cause?: unknown) {
    super(category === 'stale_chunk' ? 'PDF module stale chunk' : 'PDF module load failed', {
      cause,
    });
    this.name = 'PdfModuleLoadError';
    this.category = category;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : '';
}

export function classifyPdfModuleLoadError(error: unknown): PdfModuleLoadErrorCategory {
  const message = errorMessage(error);
  return STALE_CHUNK_PATTERNS.some((pattern) => pattern.test(message)) ? 'stale_chunk' : 'generic';
}

/** Loads a lazily-split PDF module without retrying or hiding generic failures. */
export async function loadPdfModule<T>(factory: () => Promise<T>): Promise<T> {
  try {
    return await factory();
  } catch (error) {
    throw new PdfModuleLoadError(classifyPdfModuleLoadError(error), error);
  }
}

/** Kept behind a tiny seam so UI tests never need to mutate Location. */
export function reloadCurrentPage(): void {
  window.location.reload();
}
