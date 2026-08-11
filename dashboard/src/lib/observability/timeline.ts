import type { AgentEventRecord, RunArtifactRecord } from '@/lib/types';

import { sanitizeEventData, type RunEventData } from './event-data';

export interface TimelineEvent extends AgentEventRecord {
  displaySequence: number;
  structuredData: RunEventData;
  artifacts: RunArtifactRecord[];
}

export function buildTimeline(
  events: AgentEventRecord[],
  artifacts: RunArtifactRecord[]
): TimelineEvent[] {
  return events
    .map((event, index) => ({
      ...event,
      displaySequence:
        typeof event.sequence === 'number' ? event.sequence : index + 1,
      structuredData: sanitizeEventData(event.data),
    }))
    .sort(
      (left, right) =>
        left.displaySequence - right.displaySequence ||
        new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
    )
    .map((event) => ({
      ...event,
      artifacts: artifacts.filter(
        (artifact) =>
          event.structuredData.artifactIds?.includes(artifact.id) ||
          artifact.eventSequence === event.displaySequence
      ),
    }));
}

export function timelineTone(type: string, success?: boolean) {
  if (success === false || type.includes('FAILED')) return 'failed';
  if (type === 'RUN_STARTED' || type === 'STEP_STARTED') return 'started';
  if (type === 'RUN_COMPLETED' || type === 'STEP_COMPLETED') return 'completed';
  return 'system';
}
