import type { TimelineEvent } from './timeline';

const ACTIVITY_LABELS: Record<string, string> = {
  BROWSER_START: 'Opening browser…',
  NAVIGATION: 'Opening page…',
  PAGE_READY: 'Reading page…',
  MODEL_REQUEST: 'Thinking…',
  ACTION: 'Performing action…',
  SCREENSHOT: 'Taking screenshot…',
};

function pageLabel(value: string) {
  try {
    const url = new URL(value);
    const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
    return `${url.hostname}${path}`;
  } catch {
    return value;
  }
}

export function formatElapsed(milliseconds: number | null | undefined) {
  if (milliseconds == null || milliseconds < 0) return '—';
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  const seconds = Math.round(milliseconds / 1_000);
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes} min ${remainder} sec` : `${minutes} min`;
}

export function meaningfulTimelineEvents(events: TimelineEvent[]) {
  return events.filter((event) =>
    ['STEP_COMPLETED', 'STEP_FAILED'].includes(event.type)
  );
}

export function currentRunActivity(events: TimelineEvent[]) {
  const latestOperation = [...events]
    .reverse()
    .find((event) => event.structuredData.operation);
  if (
    latestOperation?.structuredData.operation &&
    latestOperation.structuredData.operationStatus === 'BEGIN'
  ) {
    return (
      ACTIVITY_LABELS[latestOperation.structuredData.operation] ?? 'Working…'
    );
  }
  const lastStep = [...events]
    .reverse()
    .find((event) => event.type.startsWith('STEP_'));
  return lastStep ? 'Preparing next step…' : 'Starting Run…';
}

export function describeMeaningfulStep(event: TimelineEvent) {
  const action = event.structuredData.actionType?.toLowerCase();
  const url = event.structuredData.url;
  if (url && action?.includes('navigate')) return `Opened ${pageLabel(url)}.`;
  if (url && action?.includes('click'))
    return `Opened content on ${pageLabel(url)}.`;
  if (url && action?.includes('extract'))
    return `Read information from ${pageLabel(url)}.`;
  if (event.message && !/^step (executed|completed)\.?$/i.test(event.message))
    return event.message;
  if (url) return `Worked on ${pageLabel(url)}.`;
  if (action) {
    const readable = action
      .replaceAll('_', ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
    return `${readable} completed.`;
  }
  return event.type === 'STEP_FAILED'
    ? 'This step could not be completed.'
    : 'Step completed.';
}

export function failurePresentation(message: string, status: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes('ai provider did not respond'))
    return {
      title: 'AI response timed out',
      description:
        'The AI provider did not respond within the allowed time. Try the Run again.',
    };
  if (
    normalized.includes('temporarily unavailable') &&
    normalized.includes('model')
  )
    return {
      title: 'AI model temporarily unavailable',
      description: 'The selected AI model is unavailable. Try again shortly.',
    };
  if (
    normalized.includes('navigation blocked') ||
    normalized.includes('safety policy')
  )
    return {
      title: 'Navigation blocked for safety',
      description:
        'The website or action is outside this Agent’s safety settings. Review those settings before retrying.',
    };
  if (status === 'TIMED_OUT' || normalized.includes('time limit'))
    return {
      title: 'Run timed out',
      description:
        'The Run reached its configured time limit. Increase the timeout if your plan allows it, or simplify the goal.',
    };
  if (normalized.includes('hostname') || normalized.includes('target page'))
    return {
      title: 'Website could not be accessed',
      description:
        'The target website did not respond as expected. Check the address and try again.',
    };
  return {
    title: 'Run could not be completed',
    description: message,
  };
}
