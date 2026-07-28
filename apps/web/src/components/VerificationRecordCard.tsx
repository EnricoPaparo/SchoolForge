import type { ReactNode } from 'react';
import {
  RecordCard,
  type RecordCardActionLayout,
  type RecordCardDetail,
  type RecordCardMetric,
  type RecordCardProgress,
} from './RecordCard.js';

type VerificationRecordCardProps = {
  title: string;
  /** UI-VERIFICHE-06B — data didattica mostrata prima del titolo (es. «02/02/2026»). */
  titlePrefix?: string;
  /** UI-VERIFICHE-05 — qualificatore sulla stessa riga del titolo (es. «8 domande»). */
  titleMeta?: string;
  /** UI-VERIFICHE-05 — riga unica «Classe · Anno · Programma». */
  metaLine?: string;
  openLabel?: string;
  onOpen?: () => void;
  defaultCue?: string;
  details?: RecordCardDetail[];
  metrics: RecordCardMetric[];
  progress?: RecordCardProgress;
  statusControl?: ReactNode;
  actions?: ReactNode;
  errors?: ReactNode;
  actionLayout?: RecordCardActionLayout;
};

/** Verification-specific wrapper; it intentionally owns no domain logic. */
export function VerificationRecordCard(props: VerificationRecordCardProps) {
  return <RecordCard {...props} recordLabel="Verifica" />;
}
