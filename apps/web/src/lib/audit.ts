import { Timestamp, addDoc, collection } from 'firebase/firestore';
import type { AuditAction, AuditEvent } from '../types/firestore.js';
import { db } from './firebase.js';

export async function createAuditEvent(
  actorUid: string,
  action: AuditAction,
  targetId: string | null = null,
  outcome: AuditEvent['outcome'] = 'success',
  reason: string | null = null,
): Promise<void> {
  const event: AuditEvent = {
    actorUid,
    action,
    targetId,
    outcome,
    reason,
    timestamp: Timestamp.now(),
  };
  await addDoc(collection(db, 'auditEvents'), event);
}
