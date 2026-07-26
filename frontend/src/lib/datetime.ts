// Shared date helpers — see spec/frontend/rules.md rule 11. Calendar dates (start_date,
// end_date, date_of_birth, date_of_joining) are plain YYYY-MM-DD strings, never converted
// through a timezone; only timestamptz values (created_at, changed_at) need local-time
// conversion for display.

/** Today's date as YYYY-MM-DD in the browser's local time (not UTC). */
export function todayDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Date arithmetic for UI previews only — the authoritative end_date always comes from the server. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const result = new Date(Date.UTC(year, month - 1, day));
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

/** UTC datetime (timestamptz) -> local human-readable string, e.g. "27 Jun 2026, 3:04 PM". */
export function toLocalDisplay(utc: string): string {
  return new Date(utc).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** YYYY-MM-DD -> human-readable, e.g. "27 Jun 2026". No timezone conversion — calendar dates display as-is. */
export function formatDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** 1st of the current calendar month as YYYY-MM-DD, browser local time — Reports date-range default. */
export function firstOfCurrentMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

/** Every calendar month (YYYY-MM) that falls, even partially, within [start, end] inclusive, in order. */
export function monthsBetween(start: string, end: string): string[] {
  const [sy, sm] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  const months: string[] = [];
  let year = sy;
  let month = sm;
  while (year < ey || (year === ey && month <= em)) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

/** YYYY-MM -> human-readable, e.g. "Jul 2026". */
export function formatMonth(month: string): string {
  const [year, m] = month.split('-').map(Number);
  return new Date(Date.UTC(year, m - 1, 1)).toLocaleDateString(undefined, {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
