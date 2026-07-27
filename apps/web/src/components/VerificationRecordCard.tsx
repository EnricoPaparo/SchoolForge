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
