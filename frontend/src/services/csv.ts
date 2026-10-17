/** Rows of cells, header first, as exported by Notion, Asana, Jira, Toggl, Excel and the like. */
export type CsvTable = { headers: string[]; rows: string[][] };

/**
 * Reads CSV text: comma, semicolon (Excel in Norway and much of Europe) or tab separated, picked from the header line;
 * quoted cells may hold separators, line breaks and doubled quotes. A leading byte-order mark is dropped, and empty
 * lines are skipped.
 */
export function parseCsv(text: string): CsvTable {
  text = text.replace(/^﻿/, '');
  const firstLine = text.slice(0, text.search(/\r?\n/) === -1 ? text.length : text.search(/\r?\n/));
  const separator = [',', ';', '\t'].reduce((best, candidate) =>
    count(firstLine, candidate) > count(firstLine, best) ? candidate : best,
  );

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === separator) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  row.push(cell);
  rows.push(row);

  const filled = rows.filter((cells) => cells.some((value) => value.trim() !== ''));
  const [headers = [], ...data] = filled;
  return { headers: headers.map((header) => header.trim()), rows: data };
}

/** Counts a separator outside quotes. */
function count(line: string, separator: string): number {
  let total = 0;
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (char === separator && !quoted) total++;
  }
  return total;
}

/**
 * The column whose header best matches one of the names, in order of preference: exact (ignoring case and spaces)
 * first, then containing it. -1 when none does.
 */
export function guessColumn(headers: string[], names: string[]): number {
  const normalized = headers.map((header) => header.toLowerCase().replace(/\s+/g, ' ').trim());
  for (const name of names) {
    const exact = normalized.indexOf(name);
    if (exact !== -1) return exact;
  }
  for (const name of names) {
    const partial = normalized.findIndex((header) => header.includes(name));
    if (partial !== -1) return partial;
  }
  return -1;
}

/** Day before month (10.04.2026 is 10 April) or month before day (04/10/2026 is 10 April). */
export type DateOrder = 'dmy' | 'mdy';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const NUMERIC_DATE = /^(\d{1,2})([./-])(\d{1,2})\2(\d{2,4})(?:[ ,T]+(.+))?$/;

/**
 * The date order the values use: day first if any first part is over 12 (or they use dots, as in Norway and Germany),
 * month first if any second part is. Null when every value would read either way, so the person has to choose.
 */
export function detectDateOrder(values: string[]): DateOrder | null {
  let dayFirst = false;
  let monthFirst = false;
  for (const value of values) {
    const match = NUMERIC_DATE.exec(value.trim());
    if (!match) continue;
    if (match[2] === '.' || Number(match[1]) > 12) dayFirst = true;
    if (Number(match[3]) > 12) monthFirst = true;
  }
  if (dayFirst !== monthFirst) return dayFirst ? 'dmy' : 'mdy';
  return null;
}

/** Whether any value is a date like 04/10/2026 whose order matters. */
export function hasNumericDates(values: string[]): boolean {
  return values.some((value) => NUMERIC_DATE.test(value.trim()));
}

/**
 * Reads a date, with an optional time, as written by common exports: ISO ("2026-10-16", "2026-10-16T15:00:00Z"),
 * Notion ("October 16, 2026 3:00 PM"), and numeric dates in the given order ("16.10.2026 15:00"). Times without a
 * zone are local. Null when it cannot be read.
 */
export function parseDate(value: string, order: DateOrder): Date | null {
  value = value.trim();
  if (!value) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(value);
  if (iso) {
    const [, year, month, day, hour = '0', minute = '0', second = '0', zone] = iso;
    if (zone) return valid(new Date(value.replace(' ', 'T')));
    return valid(new Date(+year, +month - 1, +day, +hour, +minute, +second));
  }

  const numeric = NUMERIC_DATE.exec(value);
  if (numeric) {
    const [, first, , second, yearText, time] = numeric;
    const [day, month] = order === 'dmy' ? [+first, +second] : [+second, +first];
    const year = yearText.length === 2 ? 2000 + +yearText : +yearText;
    return withTime(year, month, day, time);
  }

  // "October 16, 2026", "Oct 16 2026 3:00 PM", "16 October 2026".
  const named =
    /^([a-z]+)\.? (\d{1,2}),? (\d{4})(?:,? (.+))?$/i.exec(value) ?? swap(/^(\d{1,2}) ([a-z]+)\.?,? (\d{4})(?:,? (.+))?$/i.exec(value));
  if (named) {
    const month = MONTHS.indexOf(named[1].slice(0, 3).toLowerCase()) + 1;
    if (month > 0) return withTime(+named[3], month, +named[2], named[4]);
  }
  return null;
}

/** Puts a "16 October 2026" match in the same shape as "October 16, 2026". */
function swap(match: RegExpExecArray | null): RegExpExecArray | null {
  if (match) [match[1], match[2]] = [match[2], match[1]];
  return match;
}

/** The local date with an optional "15:00", "3:00 PM" or "15:00:30" time. */
function withTime(year: number, month: number, day: number, time?: string): Date | null {
  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  if (time) {
    const match = /^(\d{1,2})[:.](\d{2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(time.trim());
    if (!match) return null;
    hours = +match[1] % (match[4] ? 12 : 24) + (match[4]?.toLowerCase() === 'pm' ? 12 : 0);
    minutes = +match[2];
    seconds = +(match[3] ?? 0);
  }
  const date = new Date(year, month - 1, day, hours, minutes, seconds);
  // Rejects dates that rolled over, like 31 April.
  return date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function valid(date: Date): Date | null {
  return isNaN(date.getTime()) ? null : date;
}
