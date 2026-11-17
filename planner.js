// When the next reminder may fire. A port of the Mac app's ReminderPlanner.swift: pure functions, no side effects.
// Weekdays use JavaScript numbering (0 = Sunday … 6 = Saturday); times are minutes from midnight.

export const CATCH_UP_MS = 5 * 60 * 1000; // after sleep or a closed app: one reminder 5 minutes later, never a burst

const minutesOfDay = d => d.getHours() * 60 + d.getMinutes();
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Handles windows that wrap past midnight (sleep 23:00 → 07:00). */
export function inWindow(m, start, end, endInclusive) {
  if (start === end) return endInclusive && m === start;
  if (start < end) return m >= start && (endInclusive ? m <= end : m < end);
  return m >= start || (endInclusive ? m <= end : m < end);
}

export function isAllowed(date, s, goalReachedToday, now) {
  const wd = date.getDay();
  if (!s.days.includes(wd)) return false;
  const m = minutesOfDay(date);
  const weekend = wd === 0 || wd === 6;
  const start = s.weekendHours && weekend ? s.weekendStart : s.start;
  const end = s.weekendHours && weekend ? s.weekendEnd : s.end;
  if (!inWindow(m, start, end, true)) return false;
  if (s.lunch && inWindow(m, s.lunchStart, s.lunchEnd, false)) return false;
  if (s.sleep && inWindow(m, s.sleepStart, s.sleepEnd, false)) return false;
  if (s.stopAtGoal && goalReachedToday && sameDay(date, now)) return false;
  return true;
}

/** The earliest moment the next reminder could fire, before quiet hours. null = paused until resumed. */
export function earliestCandidate(now, anchor, s, snoozedUntil, pausedUntil) {
  if (pausedUntil === Infinity) return null;
  let t;
  if (snoozedUntil && snoozedUntil > now) t = snoozedUntil;
  else {
    const interval = Math.max(5, s.interval) * 60000;
    t = (anchor ?? now) + interval;
    if (t <= now) t = now + Math.min(interval, CATCH_UP_MS);
  }
  if (pausedUntil && pausedUntil > t) t = pausedUntil;
  return t;
}

/** Walks forward minute by minute (at most 8 days) to the first allowed time. */
export function nextReminder(now, anchor, s, goalReachedToday, snoozedUntil, pausedUntil) {
  const earliest = earliestCandidate(now, anchor, s, snoozedUntil, pausedUntil);
  if (earliest == null) return null;
  const d = new Date(earliest);
  if (d.getSeconds() || d.getMilliseconds()) { d.setSeconds(60, 0); }
  const nowD = new Date(now);
  for (let i = 0; i < 8 * 24 * 60; i++) {
    if (isAllowed(d, s, goalReachedToday, nowD)) return d.getTime();
    d.setTime(d.getTime() + 60000);
  }
  return null;
}
