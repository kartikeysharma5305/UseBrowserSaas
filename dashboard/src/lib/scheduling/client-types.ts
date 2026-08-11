export type ScheduleKindValue = 'ONCE' | 'DAILY' | 'WEEKLY';
export type ScheduleStateValue = 'ENABLED' | 'PAUSED' | 'COMPLETED';

export type OccurrenceStatusValue =
  | 'DISCOVERED'
  | 'ADMITTED'
  | 'SKIPPED'
  | 'QUOTA_BLOCKED'
  | 'ACTIVE_LIMIT_BLOCKED'
  | 'PLAN_BLOCKED'
  | 'ACCOUNT_BLOCKED'
  | 'AGENT_BLOCKED'
  | 'MISSED'
  | 'CANCELED'
  | 'FAILED';

export interface ScheduleOccurrenceView {
  id: string;
  scheduledFor: string;
  status: OccurrenceStatusValue;
  runId: string | null;
  discoveredAt: string | null;
  resolvedAt: string | null;
  errorCode: string | null;
}

export interface ScheduleView {
  id: string;
  agentId: string;
  kind: ScheduleKindValue;
  timezone: string;
  localTime: string | null;
  weekdays: number[];
  oneTimeAt: string | null;
  state: ScheduleStateValue;
  nextRunAt: string | null;
  lastTriggeredOccurrenceAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  variableValues: Record<string, string | number | boolean>;
  variableVersion: number | null;
  configurationErrorCode: string | null;
  agent?: { id: string; name: string };
  occurrences?: ScheduleOccurrenceView[];
}

export interface ScheduleAgentOption {
  id: string;
  name: string;
  variables?: import('@/lib/variables/client-types').AgentVariableView[];
}

export interface SchedulingPlanView {
  code: 'FREE' | 'PRO' | 'INTERNAL';
  name: string;
  limits: {
    schedulingEnabled: boolean;
    maxActiveSchedules: number;
  };
}
