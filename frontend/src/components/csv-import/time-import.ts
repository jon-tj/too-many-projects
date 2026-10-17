import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { formatHours } from '../activity-grid/work-hours';
import { CsvTable, DateOrder, detectDateOrder, guessColumn, hasNumericDates, parseCsv, parseDate } from '../../services/csv';
import { WorkspaceApi } from '../../services/workspace-api';
import { Modal } from '../modal/modal';

type Field = 'person' | 'lastName' | 'startDate' | 'startTime' | 'endDate' | 'endTime' | 'duration' | 'message' | 'project';

/** Our fields, and the column names Toggl, Clockify and Harvest use for them, most specific first. */
const FIELDS: { key: Field; label: string; names: string[] }[] = [
  { key: 'person', label: 'Person', names: ['email', 'user email', 'user', 'member', 'person', 'first name', 'name'] },
  { key: 'lastName', label: 'Last name (if separate)', names: ['last name', 'surname'] },
  { key: 'startDate', label: 'Start date', names: ['start date', 'date', 'start', 'started at', 'spent date'] },
  { key: 'startTime', label: 'Start time', names: ['start time'] },
  { key: 'endDate', label: 'End date', names: ['end date', 'end', 'ended at', 'stop'] },
  { key: 'endTime', label: 'End time', names: ['end time', 'stop time'] },
  { key: 'duration', label: 'Duration', names: ['duration (decimal)', 'duration (h)', 'duration', 'hours', 'time (h)'] },
  { key: 'message', label: 'Description', names: ['description', 'notes', 'note', 'task', 'comment'] },
  { key: 'project', label: 'Project', names: ['project', 'project name'] },
];

/** Hours from "1:30:00", "01:30", "1.5" or "1,5" (Excel in Norway); null when unreadable. */
function parseDuration(value: string): number | null {
  value = value.trim();
  const clock = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (clock) return +clock[1] + +clock[2] / 60 + +(clock[3] ?? 0) / 3600;
  const hours = Number(value.replace(',', '.'));
  return value && !isNaN(hours) ? hours : null;
}

/**
 * Imports time entries from a time tracker's CSV export (Toggl, Clockify, Harvest) into this project: picks the
 * columns by name, lets the person correct them and choose which of the file's projects to take, previews, then sends
 * them all. Entries with only a date and a duration (Harvest) start at 09:00.
 */
@Component({
  selector: 'app-time-import',
  imports: [Modal, DatePipe],
  templateUrl: './time-import.html',
  styleUrl: './csv-import.css',
})
export class TimeImport {
  readonly projectId = input.required<number>();
  /** This project's name, to preselect its rows when the file has several projects. */
  readonly projectName = input('');
  readonly open = model(false);
  readonly imported = output<void>();
  private readonly api = inject(WorkspaceApi);
  protected readonly FIELDS = FIELDS;
  protected readonly formatHours = formatHours;

  protected readonly fileName = signal('');
  protected readonly table = signal<CsvTable | null>(null);
  protected readonly columns = signal<Record<Field, number>>(this.noColumns());
  /** The file's project whose rows are imported; empty for all rows. */
  protected readonly projectFilter = signal('');
  protected readonly dateOrder = signal<DateOrder>('dmy');
  protected readonly dateOrderNeeded = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly done = signal('');

  protected readonly projects = computed(() => this.values('project'));

  /** Every row as it will be imported; rows whose times cannot be read are counted apart. */
  private readonly parsed = computed(() => {
    const table = this.table();
    if (!table) return { sessions: [], unreadable: 0 };
    const columns = this.columns();
    const cell = (row: string[], field: Field) => (columns[field] >= 0 ? (row[columns[field]] ?? '').trim() : '');
    const at = (date: string, time: string) => (date ? parseDate(time ? `${date} ${time}` : date, this.dateOrder()) : null);
    let unreadable = 0;
    const sessions = [];
    for (const row of table.rows) {
      if (this.projectFilter() && cell(row, 'project') !== this.projectFilter()) continue;
      let start = at(cell(row, 'startDate'), cell(row, 'startTime'));
      const hours = parseDuration(cell(row, 'duration'));
      // A date alone (Harvest): the work starts at 09:00 that day. Dates never hold a colon, times always do.
      if (start && !cell(row, 'startTime') && !cell(row, 'startDate').includes(':')) start.setHours(9, 0, 0, 0);
      let end = at(cell(row, 'endDate') || (columns.endTime >= 0 ? cell(row, 'startDate') : ''), cell(row, 'endTime'));
      if (start && (!end || end <= start) && hours) end = new Date(start.getTime() + hours * 3_600_000);
      if (!start || !end || end <= start) {
        unreadable++;
        continue;
      }
      const person = [cell(row, 'person'), cell(row, 'lastName')].filter(Boolean).join(' ') || null;
      sessions.push({ person, startedAt: start.toISOString(), endedAt: end.toISOString(), message: cell(row, 'message') || null });
    }
    return { sessions, unreadable };
  });
  protected readonly sessions = computed(() => this.parsed().sessions);
  protected readonly unreadable = computed(() => this.parsed().unreadable);
  protected readonly preview = computed(() => this.sessions().slice(0, 8));
  protected readonly totalHours = computed(() =>
    this.sessions().reduce((sum, session) => sum + (Date.parse(session.endedAt) - Date.parse(session.startedAt)) / 3_600_000, 0),
  );

  protected hours(session: { startedAt: string; endedAt: string }): string {
    return formatHours((Date.parse(session.endedAt) - Date.parse(session.startedAt)) / 3_600_000);
  }

  constructor() {
    // Starts over each time the dialog opens, however it was opened.
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        this.table.set(null);
        this.fileName.set('');
        this.error.set('');
        this.done.set('');
      });
    });
  }

  protected async choose(file: File | undefined): Promise<void> {
    this.error.set('');
    this.done.set('');
    if (!file) return;
    if (file.size > 5_000_000) {
      this.error.set('That file is over 5 MB. Export a shorter period and try again.');
      return;
    }
    const table = parseCsv(await file.text());
    if (!table.headers.length || !table.rows.length) {
      this.error.set('No rows found. Choose a CSV file with a header line.');
      return;
    }
    this.fileName.set(file.name);
    this.table.set(table);
    const columns = this.noColumns();
    const taken = new Set<number>();
    for (const field of FIELDS) {
      const index = guessColumn(table.headers, field.names);
      if (index !== -1 && !taken.has(index)) {
        columns[field.key] = index;
        taken.add(index);
      }
    }
    this.columns.set(columns);
    this.afterColumns();
  }

  protected setColumn(field: Field, index: number): void {
    this.columns.update((columns) => ({ ...columns, [field]: index }));
    this.afterColumns();
  }

  protected run(): void {
    const sessions = this.sessions();
    if (!sessions.length) return;
    this.busy.set(true);
    this.error.set('');
    this.api.importWorkSessions(this.projectId(), sessions).subscribe({
      next: ({ imported, unmatched, overlapping }) => {
        this.busy.set(false);
        this.table.set(null);
        const skipped = [
          unmatched ? `${unmatched} for people not in this project` : '',
          overlapping ? `${overlapping} that overlapped hours already logged` : '',
        ].filter(Boolean);
        this.done.set(
          `Imported ${imported} ${imported === 1 ? 'entry' : 'entries'}.` + (skipped.length ? ` Skipped ${skipped.join(' and ')}.` : ''),
        );
        this.imported.emit();
      },
      error: (response: HttpErrorResponse) => {
        this.busy.set(false);
        this.error.set(response.error?.error ?? 'Could not import the hours. Please try again.');
      },
    });
  }

  /** Picks this project's rows if the file names it, and whether the dates need an order chosen. */
  private afterColumns(): void {
    const projects = this.values('project');
    const ours = projects.find((name) => name.toLowerCase() === this.projectName().toLowerCase());
    this.projectFilter.set(ours ?? '');
    const dates = [...this.values('startDate'), ...this.values('endDate')];
    const order = detectDateOrder(dates);
    this.dateOrder.set(order ?? 'dmy');
    this.dateOrderNeeded.set(order === null && hasNumericDates(dates));
  }

  private values(field: Field): string[] {
    const table = this.table();
    const index = this.columns()[field];
    if (!table || index < 0) return [];
    return [...new Set(table.rows.map((row) => (row[index] ?? '').trim()).filter(Boolean))];
  }

  private noColumns(): Record<Field, number> {
    return { person: -1, lastName: -1, startDate: -1, startTime: -1, endDate: -1, endTime: -1, duration: -1, message: -1, project: -1 };
  }
}
