import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import { Avatar } from '../../../../components/avatar/avatar';
import { formatHours } from '../../../../components/activity-grid/work-hours';
import { Icon } from '../../../../components/icon/icon';
import { OverviewRange, ProjectWorkSession } from '../../../../services/models';
import { WorkspaceApi } from '../../../../services/workspace-api';

/** The id of the draft for a new session, which has none yet. */
const NEW = -1;

/** The row being edited or added: start and end as datetime-local values (end empty while running), and how it went. */
interface Draft {
  id: number;
  start: string;
  end: string;
  mood: number | null;
  resistance: number | null;
  message: string;
}

const RANGE_DAYS: Record<OverviewRange, number> = { '7d': 7, '30d': 30, '1y': 365 };
/** Rows shown until the table is expanded. */
const COLLAPSED_ROWS = 3;
const pad = (value: number) => String(value).padStart(2, '0');

/** The local "YYYY-MM-DDTHH:mm" a datetime-local input expects. */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Everyone's work sessions in the project over the overview's range, newest first, with how each went. Your own rows
 * can be edited (times, mood, resistance, message) or deleted, and you can add sessions you did not track live.
 */
@Component({
  selector: 'app-project-hours',
  imports: [Avatar, Icon, DatePipe, NgTemplateOutlet],
  templateUrl: './project-hours.html',
  styleUrl: './project-hours.css',
})
export class ProjectHours {
  readonly projectId = input.required<number>();
  readonly range = input.required<OverviewRange>();
  private readonly api = inject(WorkspaceApi);
  protected readonly formatHours = formatHours;
  protected readonly NEW = NEW;

  protected readonly sessions = rxResource({
    params: () => ({ projectId: this.projectId(), range: this.range() }),
    stream: ({ params }) =>
      this.api.projectWorkSessions(params.projectId, new Date(Date.now() - RANGE_DAYS[params.range] * 86_400_000)),
    defaultValue: [],
  });
  protected readonly onlyMine = signal(false);
  protected readonly shown = computed(() =>
    this.sessions.value().filter((session) => !this.onlyMine() || session.mine),
  );
  /** Showing every row, scrolling inside the table, instead of only the newest few. */
  protected readonly expanded = signal(false);
  protected readonly COLLAPSED_ROWS = COLLAPSED_ROWS;
  protected readonly visible = computed(() =>
    this.expanded() ? this.shown() : this.shown().slice(0, COLLAPSED_ROWS),
  );
  /** Covers every row in the period, not only the visible ones. */
  protected readonly total = computed(() => this.shown().reduce((sum, session) => sum + this.hours(session), 0));
  protected readonly draft = signal<Draft | null>(null);
  protected readonly busy = signal<number | null>(null);
  protected readonly error = signal('');

  /** Loads the sessions again, e.g. after work was started or finished elsewhere on the page. */
  reload(): void {
    this.sessions.reload();
  }

  /** Hours of the session; running sessions count up to now. */
  protected hours(session: ProjectWorkSession): number {
    const end = session.endedAt ? new Date(session.endedAt).getTime() : Date.now();
    return Math.max(0, (end - new Date(session.startedAt).getTime()) / 3_600_000);
  }

  /**
   * Hours between the draft's start and end as typed; a running session (no end) counts up to now. Null while the
   * times are incomplete or the end is not after the start.
   */
  protected draftHours(draft: Draft): number | null {
    const start = new Date(draft.start).getTime();
    const end = draft.end ? new Date(draft.end).getTime() : Date.now();
    return isNaN(start) || isNaN(end) || end <= start ? null : (end - start) / 3_600_000;
  }

  /** Collapsing hides an older row being edited, so its unsaved edit is dropped rather than left out of sight. */
  protected toggleExpanded(): void {
    const draft = this.draft();
    if (this.expanded() && draft && !this.visibleWhenCollapsed(draft.id)) this.draft.set(null);
    this.expanded.update((expanded) => !expanded);
  }

  private visibleWhenCollapsed(id: number): boolean {
    return id === NEW || this.shown().slice(0, COLLAPSED_ROWS).some((session) => session.id === id);
  }

  protected edit(session: ProjectWorkSession): void {
    this.error.set('');
    this.draft.set({
      id: session.id,
      start: toLocalInput(session.startedAt),
      end: session.endedAt ? toLocalInput(session.endedAt) : '',
      mood: session.mood,
      resistance: session.resistance,
      message: session.message ?? '',
    });
  }

  /** Opens an empty row at the top for a session you did not track live: the last hour, up to now. */
  protected add(): void {
    const end = new Date();
    end.setSeconds(0, 0);
    const start = new Date(end.getTime() - 3_600_000);
    this.error.set('');
    this.draft.set({
      id: NEW,
      start: toLocalInput(start.toISOString()),
      end: toLocalInput(end.toISOString()),
      mood: null,
      resistance: null,
      message: '',
    });
  }

  protected change<K extends keyof Draft>(field: K, value: Draft[K]): void {
    this.draft.update((draft) => (draft ? { ...draft, [field]: value } : draft));
  }

  /** Saves the draft: as a new session, or as changes to `session`. */
  protected save(session: ProjectWorkSession | null): void {
    const draft = this.draft();
    if (!draft) return;
    const start = new Date(draft.start);
    const end = draft.end ? new Date(draft.end) : null;
    // A new or finished session needs an end; only a running one may go without.
    if (isNaN(start.getTime()) || ((!session || session.endedAt) && (!end || isNaN(end.getTime())))) {
      this.error.set('Enter both a start and an end time.');
      return;
    }
    if (end && end <= start) {
      this.error.set('The end must be after the start.');
      return;
    }
    this.busy.set(draft.id);
    this.error.set('');
    const values = { mood: draft.mood, resistance: draft.resistance, message: draft.message.trim() || null };
    // The new or updated row is not used: the table reloads instead.
    const request: Observable<unknown> = session
      ? this.api.updateWorkSession(session.id, {
          startedAt: start.toISOString(),
          endedAt: end?.toISOString() ?? null,
          ...values,
        })
      : this.api.createWorkSession(this.projectId(), {
          startedAt: start.toISOString(),
          endedAt: end!.toISOString(),
          ...values,
        });
    request.subscribe({
        next: () => {
          this.busy.set(null);
          this.draft.set(null);
          this.sessions.reload();
        },
        error: (response: HttpErrorResponse) => {
          this.busy.set(null);
          this.error.set(response.error?.error ?? 'Could not save the session. Please try again.');
        },
      });
  }

  protected remove(session: ProjectWorkSession): void {
    const when = new Date(session.startedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    if (!confirm(`Delete your session from ${when} (${formatHours(this.hours(session))})? Its hours will no longer count.`)) return;
    this.busy.set(session.id);
    this.error.set('');
    this.api.deleteWorkSession(session.id).subscribe({
      next: () => {
        this.busy.set(null);
        this.sessions.update((sessions) => sessions.filter((item) => item.id !== session.id));
      },
      error: (response: HttpErrorResponse) => {
        this.busy.set(null);
        this.error.set(response.error?.error ?? 'Could not delete the session. Please try again.');
      },
    });
  }
}
