import { Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { WorkSession } from '../../services/models';
import { WorkspaceApi } from '../../services/workspace-api';
import { ActivityGrid, gridStart } from '../activity-grid/activity-grid';
import { Icon } from '../icon/icon';
import { dayFromKey, dayKey, formatHours, hoursByDay, overlapsDay } from '../activity-grid/work-hours';

/** Start and end as "YYYY-MM-DDTHH:mm" local values for datetime inputs; end is empty while running. */
interface Draft {
  start: string;
  end: string;
}

const WEEKS = 53;
const pad = (value: number) => String(value).padStart(2, '0');

/** The local "YYYY-MM-DDTHH:mm" a datetime-local input expects. */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  return `${dayKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Your hours as an activity grid, and the work sessions of the clicked day with editable start and end times.
 * Across all your projects with a project filter, or only one project's when `projectId` is set.
 */
@Component({
  selector: 'app-work-log',
  imports: [ActivityGrid, RouterLink, Icon],
  templateUrl: './work-log.html',
  styleUrl: './work-log.css',
})
export class WorkLog {
  /** Shows only this project's sessions and hides the project filter; null shows every project. */
  readonly projectId = input<number | null>(null);
  private readonly api = inject(WorkspaceApi);

  protected readonly filter = linkedSignal(() => this.projectId());
  protected readonly projects = rxResource({
    params: () => (this.projectId() === null ? true : undefined),
    stream: () => this.api.projects(),
    defaultValue: [],
  });
  protected readonly sessions = rxResource({
    params: () => ({ projectId: this.filter() }),
    stream: ({ params }) => this.api.workSessions(gridStart(WEEKS), params.projectId),
    defaultValue: [],
  });
  protected readonly WEEKS = WEEKS;
  protected readonly formatHours = formatHours;

  protected readonly hours = computed(() => hoursByDay(this.sessions.value()));
  protected readonly total = computed(() => [...this.hours().values()].reduce((sum, hours) => sum + hours, 0));
  /** Today's key, worked out when asked so it stays right past midnight. */
  protected today(): string {
    return dayKey(new Date());
  }
  protected readonly selected = signal<string | null>(this.today());
  protected readonly selectedDate = computed(() => {
    const key = this.selected();
    return key ? dayFromKey(key) : null;
  });
  protected readonly daySessions = computed(() => {
    const key = this.selected();
    return key ? this.sessions.value().filter((session) => overlapsDay(session, key)) : [];
  });
  /** Unsaved edits per session id. */
  private readonly drafts = signal<ReadonlyMap<number, Draft>>(new Map());
  protected readonly saving = signal<number | null>(null);
  protected readonly error = signal('');

  protected goToToday(): void {
    this.selected.set(this.today());
  }

  protected setFilter(value: string): void {
    this.filter.set(value ? Number(value) : null);
    this.drafts.set(new Map());
  }

  protected draftFor(session: WorkSession): Draft {
    return this.drafts().get(session.id) ?? this.original(session);
  }

  protected edit(session: WorkSession, field: keyof Draft, value: string): void {
    this.drafts.update((drafts) => new Map(drafts).set(session.id, { ...this.draftFor(session), [field]: value }));
  }

  protected isDirty(session: WorkSession): boolean {
    const draft = this.drafts().get(session.id);
    const original = this.original(session);
    return !!draft && (draft.start !== original.start || draft.end !== original.end);
  }

  protected reset(session: WorkSession): void {
    this.drafts.update((drafts) => {
      const next = new Map(drafts);
      next.delete(session.id);
      return next;
    });
  }

  /** Hours of the session as drafted; running sessions count up to now. */
  protected duration(session: WorkSession): number {
    const draft = this.draftFor(session);
    const start = new Date(draft.start).getTime();
    const end = draft.end ? new Date(draft.end).getTime() : Date.now();
    return Math.max(0, (end - start) / 3_600_000);
  }

  protected save(session: WorkSession): void {
    const draft = this.draftFor(session);
    const start = new Date(draft.start);
    const end = draft.end ? new Date(draft.end) : null;
    if (isNaN(start.getTime()) || (session.endedAt && (!end || isNaN(end.getTime())))) {
      this.error.set('Enter both a start and an end time.');
      return;
    }
    if (end && end <= start) {
      this.error.set('The end must be after the start.');
      return;
    }
    this.error.set('');
    this.saving.set(session.id);
    this.api.updateWorkSession(session.id, start.toISOString(), end?.toISOString() ?? null).subscribe({
      next: (updated) => {
        this.saving.set(null);
        this.sessions.update((sessions) => sessions.map((item) => (item.id === updated.id ? updated : item)));
        this.reset(session);
      },
      error: (response) => {
        this.saving.set(null);
        this.error.set(response?.error?.error ?? 'Could not save the session. Please try again.');
      },
    });
  }

  /** Stops a running session now, like switching the project to idle; the server sets the end time. */
  protected end(session: WorkSession): void {
    this.error.set('');
    this.saving.set(session.id);
    this.api.setWorking(session.projectId, false).subscribe({
      next: () => {
        this.saving.set(null);
        this.reset(session);
        this.sessions.reload();
      },
      error: () => {
        this.saving.set(null);
        this.error.set('Could not end the session. Please try again.');
      },
    });
  }

  private original(session: WorkSession): Draft {
    return { start: toLocalInput(session.startedAt), end: session.endedAt ? toLocalInput(session.endedAt) : '' };
  }
}
