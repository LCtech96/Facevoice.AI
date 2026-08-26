export const APP_TIMEZONE = 'Europe/Rome'

export interface CurrentDateTimeSnapshot {
  timezone: string
  isoDate: string
  dateItalian: string
  timeItalian: string
  dateEnglish: string
  timeEnglish: string
}

function formatInTimezone(
  now: Date,
  locale: string,
  options: Intl.DateTimeFormatOptions
): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: APP_TIMEZONE,
    ...options,
  }).format(now)
}

/** Snapshot of current date/time in Europe/Rome, computed on each request. */
export function getCurrentDateTimeSnapshot(now = new Date()): CurrentDateTimeSnapshot {
  return {
    timezone: APP_TIMEZONE,
    isoDate: formatInTimezone(now, 'en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }),
    dateItalian: formatInTimezone(now, 'it-IT', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
    timeItalian: formatInTimezone(now, 'it-IT', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }),
    dateEnglish: formatInTimezone(now, 'en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }),
    timeEnglish: formatInTimezone(now, 'en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }),
  }
}

/** System prompt block: always inject fresh date/time on every AI request. */
export function buildRealtimeDateTimeInstructions(now = new Date()): string {
  const snapshot = getCurrentDateTimeSnapshot(now)

  return (
    `REAL-TIME DATETIME (computed at request time, timezone ${snapshot.timezone}): ` +
    `Today is ${snapshot.dateEnglish}, ${snapshot.timeEnglish} (${snapshot.isoDate}). ` +
    `In Italian: oggi è ${snapshot.dateItalian}, ore ${snapshot.timeItalian}. ` +
    `When the user asks for today's date, current time, or day of the week, answer using ONLY this realtime value. ` +
    `Never guess, never use outdated or training-data dates.`
  )
}

/** Italian-first variant for the site widget. */
export function buildRealtimeDateTimeInstructionsItalian(now = new Date()): string {
  const snapshot = getCurrentDateTimeSnapshot(now)

  return (
    `DATA E ORA ATTUALI (calcolate in tempo reale ad ogni richiesta, fuso ${snapshot.timezone}): ` +
    `Oggi è ${snapshot.dateItalian}, ore ${snapshot.timeItalian}. ` +
    `Quando l'utente chiede data, ora o giorno della settimana, rispondi SEMPRE con questi valori aggiornati. ` +
    `Non indovinare mai e non usare date memorizzate nel modello.`
  )
}
