import type { ReactNode } from 'react';
import {
  RecordCard,
  type RecordCardDetail,
  type RecordCardMetric,
  type RecordCardProgress,
} from './RecordCard.js';

export type CourseRecordMetric = RecordCardMetric;
export type CourseRecordDetail = RecordCardDetail;

type CourseRecordCardProps = {
  title: string;
  openLabel: string;
  onOpen: () => void;
  details?: CourseRecordDetail[];
  metrics: CourseRecordMetric[];
  progress?: RecordCardProgress;
  actions?: ReactNode;
  accentProgressOnInteraction?: boolean;
};

/** Compatibility wrapper for the shared SchoolForge record-card shell. */
export function CourseRecordCard(props: CourseRecordCardProps) {
  return (
    <RecordCard
      {...props}
      recordLabel="Corso"
      defaultCue="Apri programma →"
      actionLayout="corner"
    />
  );
}
