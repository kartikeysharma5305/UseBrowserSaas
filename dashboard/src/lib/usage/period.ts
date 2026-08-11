export interface UsagePeriod {
  start: Date;
  end: Date;
}

export function getUtcCalendarMonthPeriod(date = new Date()): UsagePeriod {
  return {
    start: new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0)
    ),
    end: new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 0, 0, 0, 0)
    ),
  };
}

export function getPreviousUtcCalendarMonthPeriod(
  period: UsagePeriod
): UsagePeriod {
  return getUtcCalendarMonthPeriod(
    new Date(period.start.getTime() - 24 * 60 * 60 * 1000)
  );
}
