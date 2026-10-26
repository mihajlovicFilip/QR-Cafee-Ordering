/**
 * The working day — when a staff sign-in ends on its own.
 *
 * Every establishment sets the time its working day ends ("HH:MM", in Settings). A sign-in lasts
 * until the next time the clock reaches it, so a bar that closes after midnight picks a time after
 * closing (03:00), and a café that closes at 23:00 may pick 23:30. Device time is used: the
 * waiter's tablet is in the establishment.
 */

/** Used until the establishment picks its own. */
export const DEFAULT_WORKDAY_END = '03:00';

export const isWorkdayEnd = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

/** The first moment after `from` (epoch ms) at which the working day ends. */
export function workdayEndAfter(from: number, end: string): number {
  const [h, m] = (isWorkdayEnd(end) ? end : DEFAULT_WORKDAY_END).split(':').map(Number);
  const at = new Date(from);
  at.setHours(h, m, 0, 0);
  if (at.getTime() <= from) at.setDate(at.getDate() + 1);
  return at.getTime();
}
