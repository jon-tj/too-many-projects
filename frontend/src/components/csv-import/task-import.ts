import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { CsvTable, DateOrder, detectDateOrder, guessColumn, hasNumericDates, parseCsv, parseDate } from '../../services/csv';
import { TaskPriority, TaskStatus } from '../../services/models';
import { WorkspaceApi } from '../../services/workspace-api';
import { Modal } from '../modal/modal';

type Field = 'title' | 'description' | 'status' | 'priority' | 'assignee' | 'due' | 'created' | 'completed';

/** Our task fields, and the column names other tools use for them, most specific first. */
const FIELDS: { key: Field; label: string; names: string[] }[] = [
  { key: 'title', label: 'Title', names: ['name', 'title', 'task name', 'task', 'summary', 'card name', 'issue', 'subject'] },
  { key: 'description', label: 'Description', names: ['description', 'notes', 'card description', 'body', 'details', 'content'] },
  { key: 'status', label: 'Status', names: ['status', 'state', 'section/column', 'section', 'list name', 'column', 'stage'] },
  { key: 'priority', label: 'Priority', names: ['priority', 'importance', 'urgency'] },
  { key: 'assignee', label: 'Assignee', names: ['assignee email', 'assignee', 'assigned to', 'owner', 'members', 'responsible'] },
  { key: 'due', label: 'Due date', names: ['due date', 'due', 'deadline', 'due on'] },
  { key: 'created', label: 'Created', names: ['created at', 'created time', 'created', 'date created', 'creation date'] },
  { key: 'completed', label: 'Completed', names: ['completed at', 'completed', 'resolved', 'done date', 'closed at', 'completion date'] },
];

/** A best guess at what a status from another tool means here; the person can change it. */
function guessStatus(value: string): TaskStatus {
  const text = value.toLowerCase();
  // Checked first: "Not started" would otherwise read as started.
  if (/not started|to ?do|backlog|open|new|ikke/.test(text)) return 'todo';
  if (/done|complete|closed|resolved|finish|shipped|ferdig|yes|true|✓|✅/.test(text)) return 'done';
  if (/progress|doing|started|review|active|testing|qa|working|pågår/.test(text)) return 'doing';
  return 'todo';
}

function guessPriority(value: string): TaskPriority {
  const text = value.toLowerCase();
  if (/urgent|critical|highest|blocker|p0|p1/.test(text)) return 'critical';
  if (/high|p2/.test(text)) return 'high';
  return 'low';
}

/** The calendar day as the board stores due dates: midnight UTC of that day. */
function dueDay(date: Date): string {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())).toISOString();
}

/**
 * Imports tasks from a CSV file, e.g. a Notion, Asana, Jira, Linear or Trello export, or a spreadsheet: picks the
 * columns by their names, lets the person correct them and map their statuses and priorities, previews the result,
 * then creates all the tasks at once.
 */
@Component({
  selector: 'app-task-import',
  imports: [Modal],
  templateUrl: './task-import.html',
  styleUrl: './csv-import.css',
})
export class TaskImport {
  readonly projectId = input.required<number>();
  readonly open = model(false);
  readonly imported = output<void>();
  private readonly api = inject(WorkspaceApi);
  protected readonly FIELDS = FIELDS;

  protected readonly fileName = signal('');
  protected readonly table = signal<CsvTable | null>(null);
  /** The column chosen for each field; -1 for none. */
  protected readonly columns = signal<Record<Field, number>>(this.noColumns());
  /** What each status (and priority) found in the file becomes here. */
  protected readonly statusMap = signal<Record<string, TaskStatus>>({});
  protected readonly priorityMap = signal<Record<string, TaskPriority>>({});
  protected readonly dateOrder = signal<DateOrder>('dmy');
  /** The file's dates read either way, so the person picks the order. */
  protected readonly dateOrderNeeded = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly done = signal('');

  protected readonly statusValues = computed(() => Object.keys(this.statusMap()));
  protected readonly priorityValues = computed(() => Object.keys(this.priorityMap()));

  /** Every row as it will be imported; rows without a title are left out. */
  protected readonly tasks = computed(() => {
    const table = this.table();
    if (!table) return [];
    const columns = this.columns();
    const cell = (row: string[], field: Field) => (columns[field] >= 0 ? (row[columns[field]] ?? '').trim() : '');
    const date = (value: string) => (value ? parseDate(value, this.dateOrder()) : null);
    return table.rows
      .map((row) => {
        const status = cell(row, 'status');
        const priority = cell(row, 'priority');
        const due = date(cell(row, 'due'));
        const created = date(cell(row, 'created'));
        const completed = date(cell(row, 'completed'));
        return {
          title: cell(row, 'title'),
          description: cell(row, 'description') || null,
          status: status ? (this.statusMap()[status] ?? 'todo') : completed ? ('done' as TaskStatus) : ('todo' as TaskStatus),
          priority: priority ? (this.priorityMap()[priority] ?? 'low') : ('low' as TaskPriority),
          // Several people in one cell (Notion, Trello): the first one gets the task.
          assignee: cell(row, 'assignee').split(',')[0].trim() || null,
          dueAt: due ? dueDay(due) : null,
          createdAt: created?.toISOString() ?? null,
          completedAt: completed?.toISOString() ?? null,
        };
      })
      .filter((task) => task.title);
  });
  protected readonly preview = computed(() => this.tasks().slice(0, 8));

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
      this.error.set('That file is over 5 MB. Export fewer rows and try again.');
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
    // Notion puts the title first, whatever it is called.
    if (columns.title === -1) columns.title = 0;
    this.columns.set(columns);
    this.mapValues();
  }

  protected setColumn(field: Field, index: number): void {
    this.columns.update((columns) => ({ ...columns, [field]: index }));
    this.mapValues();
  }

  protected setStatus(value: string, status: TaskStatus): void {
    this.statusMap.update((map) => ({ ...map, [value]: status }));
  }

  protected setPriority(value: string, priority: TaskPriority): void {
    this.priorityMap.update((map) => ({ ...map, [value]: priority }));
  }

  protected run(): void {
    const tasks = this.tasks();
    if (!tasks.length) return;
    this.busy.set(true);
    this.error.set('');
    this.api.importTasks(this.projectId(), tasks).subscribe({
      next: ({ imported, unmatched }) => {
        this.busy.set(false);
        this.table.set(null);
        this.done.set(
          `Imported ${imported} ${imported === 1 ? 'task' : 'tasks'}.` +
            (unmatched ? ` ${unmatched} had an assignee who is not in this project, so they are unassigned.` : ''),
        );
        this.imported.emit();
      },
      error: (response: HttpErrorResponse) => {
        this.busy.set(false);
        this.error.set(response.error?.error ?? 'Could not import the tasks. Please try again.');
      },
    });
  }

  /** Guesses what each status and priority in the file means, and whether the dates need an order chosen. */
  private mapValues(): void {
    const table = this.table()!;
    const columns = this.columns();
    const values = (field: Field) =>
      columns[field] >= 0 ? [...new Set(table.rows.map((row) => (row[columns[field]] ?? '').trim()).filter(Boolean))] : [];
    this.statusMap.set(Object.fromEntries(values('status').map((value) => [value, guessStatus(value)])));
    this.priorityMap.set(Object.fromEntries(values('priority').map((value) => [value, guessPriority(value)])));
    const dates = [...values('due'), ...values('created'), ...values('completed')];
    const order = detectDateOrder(dates);
    this.dateOrder.set(order ?? 'dmy');
    this.dateOrderNeeded.set(order === null && hasNumericDates(dates));
  }

  private noColumns(): Record<Field, number> {
    return { title: -1, description: -1, status: -1, priority: -1, assignee: -1, due: -1, created: -1, completed: -1 };
  }
}
