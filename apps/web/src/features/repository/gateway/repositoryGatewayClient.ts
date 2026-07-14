import { auth } from '../../../lib/firebase.js';

/**
 * SGW-01 — unico client adapter del Repository Storage Gateway same-origin.
 *
 * I service applicativi non conoscono `fetch`, token o dettagli HTTP: usano
 * solo `readText` / `writeText` / `deleteFile` / `deleteImportPrefix`. L'adapter recupera il Firebase
 * ID token corrente, chiama gli endpoint same-origin `/api/repository/*` e
 * traduce gli errori del gateway in `GatewayError` leggibili.
 *
 * Regole (SGW-00): timeout ragionevole, **nessun retry infinito**, **nessun
 * fallback automatico** a Firebase Storage dopo un errore del gateway (su Brave
 * riproporrebbe attese di ~120 s). Il fallback diretto resta disponibile solo
 * come rollback esplicito e controllato altrove, mai qui.
 */

const BASE_PATH = '/api/repository';
/** Timeout per richiesta: interrompe l'attesa senza ritentare all'infinito. */
export const GATEWAY_TIMEOUT_MS = 30_000;

/** Errore normalizzato del gateway: `code` applicativo + `status` HTTP. */
export class GatewayError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'GatewayError';
    this.code = code;
    this.status = status;
  }
}

/** True quando l'errore indica un file assente (per loadPool/consultazioni). */
export function isFileNotFound(err: unknown): boolean {
  return err instanceof GatewayError && err.code === 'file_not_found';
}

async function currentIdToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    throw new GatewayError(
      'unauthenticated',
      'Sessione scaduta. Effettua di nuovo l’accesso.',
      401,
    );
  }
  return user.getIdToken();
}

async function callGateway(subpath: string, body: Record<string, unknown>): Promise<Response> {
  const token = await currentIdToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);
  try {
    return await fetch(`${BASE_PATH}${subpath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) {
      throw new GatewayError('timeout', 'Il gateway non ha risposto in tempo. Riprova.', 0);
    }
    throw new GatewayError('network_error', 'Impossibile contattare il gateway. Riprova.', 0);
  } finally {
    clearTimeout(timer);
  }
}

async function throwGatewayError(res: Response): Promise<never> {
  let code = 'gateway_error';
  let message = 'Errore del gateway repository.';
  try {
    const data = (await res.json()) as { error?: { code?: string; message?: string } };
    if (typeof data?.error?.code === 'string') code = data.error.code;
    if (typeof data?.error?.message === 'string') message = data.error.message;
  } catch {
    // Risposta non-JSON: mantieni i default.
  }
  throw new GatewayError(code, message, res.status);
}

/** Legge un singolo file testuale. `file_not_found` su 404. */
export async function readText(path: string): Promise<string> {
  const res = await callGateway('/read', { path });
  if (!res.ok) return throwGatewayError(res);
  const data = (await res.json()) as { content?: string };
  return data.content ?? '';
}

/** Scrive (upsert) un singolo file testuale UTF-8. */
export async function writeText(path: string, content: string): Promise<void> {
  const res = await callGateway('/write', { path, content });
  if (!res.ok) await throwGatewayError(res);
}

/** Elimina un singolo file (idempotente: un file assente non è un errore). */
export async function deleteFile(path: string): Promise<void> {
  const res = await callGateway('/delete', { path });
  if (!res.ok) await throwGatewayError(res);
}

/** Elimina tutti i file sotto la root esatta di un import (owner-only). */
export async function deleteImportPrefix(path: string): Promise<void> {
  const res = await callGateway('/delete-prefix', { path });
  if (!res.ok) await throwGatewayError(res);
}
