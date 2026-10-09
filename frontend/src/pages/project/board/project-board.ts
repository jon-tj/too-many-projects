import { CdkDrag, CdkDragDrop, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { Component, computed, HostListener, inject, input, linkedSignal, numberAttribute, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Icon } from '../../../components/icon/icon';
import { Modal } from '../../../components/modal/modal';
import { TaskForm, TaskFormValue } from '../../../components/task-form/task-form';
import { PRIORITY_RANK, ProjectTask, TaskStatus } from '../../../services/models';
import { celebrateDone } from '../../../services/celebrate';
import { WorkspaceApi } from '../../../services/workspace-api';

/** Done shows only this many of the most recently completed tasks until "Show older" is clicked. */
const DONE_LIMIT = 4;

const COLUMNS = [
  { status: 'todo', title: 'To do', empty: 'Nothing queued yet' },
  { status: 'doing', title: 'Doing', empty: 'A clear runway' },
  { status: 'done', title: 'Done', empty: 'Wins show up here' },
] as const;

/** A task as plain text: the title, then the description when there is one. */
function taskText(task: ProjectTask): string {
  return task.description ? `${task.title}\n\n${task.description}` : task.title;
}

/** Special assignee filter values; the '*' prefix keeps them apart from user ids. */
const ASSIGNEE_FILTER = {
  all: '*all',
  meOrUnassigned: '*me-or-unassigned',
  unassigned: '*unassigned',
} as const;

/** The board's filters, remembered per project in this browser. */
interface BoardFilters {
  /** A member's user id, or one of the special ASSIGNEE_FILTER values. */
  assignee: string;
  /** Leaves out tasks waiting on a dependency that is not done. */
  hideBlocked: boolean;
}

const DEFAULT_FILTERS: BoardFilters = { assignee: ASSIGNEE_FILTER.all, hideBlocked: true };

@Component({
  selector: 'app-project-board',
  imports: [TaskForm, RouterLink, Icon, Modal, CdkDrag, CdkDropList, CdkDropListGroup, CdkScrollable],
  templateUrl: './project-board.html',
  styleUrl: './project-board.css',
})
export class ProjectBoard {
  readonly projectId = input.required({ transform: numberAttribute });
  private readonly api = inject(WorkspaceApi);
  protected readonly tasks = rxResource({
    params: () => this.projectId(),
    stream: ({ params }) => this.api.projectTasks(params),
    defaultValue: [],
  });
  protected readonly members = rxResource({
    params: () => this.projectId(),
    stream: ({ params }) => this.api.projectMembers(params),
    defaultValue: [],
  });
  protected readonly account = rxResource({ stream: () => this.api.currentAccount() });
  private readonly filters = linkedSignal(() => this.readStoredFilters(this.projectId()));
  protected readonly hideBlocked = computed(() => this.filters().hideBlocked);
  /** Which assignee's tasks to show; falls back to all when the stored member has left the project. */
  protected readonly assigneeFilter = computed(() => {
    const filter = this.filters().assignee;
    if (filter.startsWith('*') || this.members.isLoading()) return filter;
    return this.members.value().some((member) => member.userId === filter) ? filter : ASSIGNEE_FILTER.all;
  });
  protected readonly visibleTasks = computed(() => {
    const filter = this.assigneeFilter();
    const me = this.account.value()?.id;
    const blocked = this.hideBlocked() ? this.blockedIds() : new Set<number>();
    return this.tasks.value().filter((task) => {
      if (blocked.has(task.id)) return false;
      switch (filter) {
        case ASSIGNEE_FILTER.all:
          return true;
        case ASSIGNEE_FILTER.meOrUnassigned:
          return !task.assigneeUserId || task.assigneeUserId === me;
        case ASSIGNEE_FILTER.unassigned:
          return !task.assigneeUserId;
        default:
          return task.assigneeUserId === filter;
      }
    });
  });
  /** Whether the done column shows all its tasks rather than only the latest. */
  protected readonly showAllDone = signal(false);
  /** `tasks` are the cards shown; `total` counts the column's tasks, including done ones left out. */
  protected readonly columns = computed(() =>
    COLUMNS.map((column) => {
      const all = this.visibleTasks().filter((task) => task.status === column.status);
      if (column.status !== 'done') {
        // Highest priority first; the sort is stable, so newest first within a priority.
        const tasks = all.sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]);
        return { ...column, tasks, total: tasks.length };
      }
      // Most recently completed first; ISO timestamps sort as text.
      all.sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '') || b.id - a.id);
      return { ...column, tasks: this.showAllDone() ? all : all.slice(0, DONE_LIMIT), total: all.length };
    }),
  );
  /**
   * Tasks waiting on a dependency that is not done. Worked out from the loaded tasks rather than the server's flag,
   * so moving a dependency to done unblocks its dependents straight away.
   */
  protected readonly blockedIds = computed(() => {
    const tasks = this.tasks.value();
    const done = new Set(tasks.filter((task) => task.status === 'done').map((task) => task.id));
    return new Set(tasks.filter((task) => task.dependsOn.some((id) => !done.has(id))).map((task) => task.id));
  });
  /** A blocked task cannot be dragged out of to do. */
  protected readonly canEnter = (drag: CdkDrag<ProjectTask>, drop: CdkDropList<TaskStatus>): boolean =>
    drop.data === 'todo' || drag.data.status !== 'todo' || !this.blockedIds().has(drag.data.id);
  protected readonly ASSIGNEE_FILTER = ASSIGNEE_FILTER;
  protected readonly DONE_LIMIT = DONE_LIMIT;
  protected readonly addingTask = signal(false);
  protected readonly taskError = signal('');
  protected readonly copiedId = signal<number | null>(null);
  protected readonly copiedSelection = signal(false);
  /** Ids of the tasks checked on the board, for group actions like assigning. */
  protected readonly selected = signal<ReadonlySet<number>>(new Set());

  protected toggleSelected(task: ProjectTask): void {
    this.selected.update((ids) => {
      const next = new Set(ids);
      if (!next.delete(task.id)) next.add(task.id);
      return next;
    });
  }

  /** Saves the change for this project and drops hidden tasks from the selection, so group actions only touch what is on screen. */
  protected setFilters(changes: Partial<BoardFilters>): void {
    this.filters.update((filters) => ({ ...filters, ...changes }));
    try {
      localStorage.setItem(`board-filters:${this.projectId()}`, JSON.stringify(this.filters()));
      localStorage.removeItem(`board-assignee-filter:${this.projectId()}`);
    } catch {
      // Storage can be unavailable (e.g. private windows); the filters then last until reload.
    }
    const visible = new Set(this.visibleTasks().map((task) => task.id));
    this.selected.update((ids) => new Set([...ids].filter((id) => visible.has(id))));
  }

  /** Reads this project's filters, falling back to the assignee filter saved on its own before. */
  private readStoredFilters(projectId: number): BoardFilters {
    try {
      const stored = JSON.parse(localStorage.getItem(`board-filters:${projectId}`) ?? 'null') as Partial<BoardFilters> | null;
      const legacyAssignee = localStorage.getItem(`board-assignee-filter:${projectId}`);
      return {
        assignee: typeof stored?.assignee === 'string' ? stored.assignee : legacyAssignee || DEFAULT_FILTERS.assignee,
        hideBlocked: typeof stored?.hideBlocked === 'boolean' ? stored.hideBlocked : DEFAULT_FILTERS.hideBlocked,
      };
    } catch {
      return DEFAULT_FILTERS;
    }
  }

  /** Shift-click on a card selects it instead of opening the task. */
  protected cardClick(event: MouseEvent, task: ProjectTask): void {
    if (!event.shiftKey) return;
    event.preventDefault();
    this.toggleSelected(task);
  }

  protected selectedInColumn(tasks: ProjectTask[]): number {
    const ids = this.selected();
    return tasks.filter((task) => ids.has(task.id)).length;
  }

  /** Selects every task in the column, or clears them when all are already selected. */
  protected toggleColumn(tasks: ProjectTask[]): void {
    const selectAll = this.selectedInColumn(tasks) < tasks.length;
    this.selected.update((ids) => {
      const next = new Set(ids);
      for (const task of tasks) {
        if (selectAll) next.add(task.id);
        else next.delete(task.id);
      }
      return next;
    });
  }

  @HostListener('document:keydown.escape')
  protected clearSelection(): void {
    this.selected.set(new Set());
  }

  /** Saves straight away like moving a card; rolls back if the server refuses. */
  protected assignSelected(assigneeUserId: string | null): void {
    const ids = this.selected();
    if (!ids.size) return;
    const previous = this.tasks.value();
    this.tasks.update((tasks) => tasks.map((task) => (ids.has(task.id) ? { ...task, assigneeUserId } : task)));
    this.clearSelection();
    this.api.assignTasks(this.projectId(), [...ids], assigneeUserId).subscribe({
      error: () => {
        this.tasks.set(previous);
        this.selected.set(ids);
        this.taskError.set('Could not assign the selected tasks.');
      },
    });
  }

  protected createTask(value: TaskFormValue): void {
    this.api.createTask(this.projectId(), value).subscribe({
      next: (task) => {
        this.tasks.update((tasks) => [task, ...tasks]);
        this.addingTask.set(false);
        this.taskError.set('');
      },
      error: () => this.taskError.set('Could not create the task. Please try again.'),
    });
  }

  /** Copies the task as plain text, e.g. to paste into an AI assistant. */
  protected copyTask(task: ProjectTask): void {
    this.copyText(taskText(task), 'Could not copy the task to the clipboard.', () => {
      this.copiedId.set(task.id);
      setTimeout(() => this.copiedId.update((id) => (id === task.id ? null : id)), 1500);
    });
  }

  /** Copies the selected tasks in board order, each under its own heading. */
  protected copySelected(): void {
    const ids = this.selected();
    const tasks = this.columns().flatMap((column) => column.tasks.filter((task) => ids.has(task.id)));
    if (!tasks.length) return;
    const text = tasks.map((task) => `## ${taskText(task)}`).join('\n\n');
    this.copyText(text, 'Could not copy the selected tasks to the clipboard.', () => {
      this.copiedSelection.set(true);
      setTimeout(() => this.copiedSelection.set(false), 1500);
    });
  }

  private copyText(text: string, error: string, copied: () => void): void {
    navigator.clipboard.writeText(text).then(copied, () => this.taskError.set(error));
  }

  /** Saves straight away like moving a card; rolls back if the server refuses. */
  protected stepUnits(task: ProjectTask, step: number): void {
    const done = Math.max(0, Math.min(task.units ?? 0, task.unitsDone + step));
    if (done === task.unitsDone) return;
    const setDone = (value: number) =>
      this.tasks.update((tasks) => tasks.map((item) => (item.id === task.id ? { ...item, unitsDone: value } : item)));
    setDone(done);
    this.api.setTaskUnitsDone(task.id, done).subscribe({
      error: () => {
        setDone(task.unitsDone);
        this.taskError.set('Could not update the task progress.');
      },
    });
  }

  protected assigneeName(task: ProjectTask): string {
    if (!task.assigneeUserId) return 'Unassigned';
    if (task.assigneeUserId === this.account.value()?.id) return 'You';
    const member = this.members.value().find((entry) => entry.userId === task.assigneeUserId);
    return member ? member.displayName || member.userName : 'Assigned';
  }

  /** Dropping a card on another column changes its status. Touch drags start after a short hold, so swiping still scrolls. */
  protected drop(event: CdkDragDrop<TaskStatus, TaskStatus, ProjectTask>): void {
    this.changeStatus(event.item.data, event.container.data, event.dropPoint);
  }

  /**
   * Moving an unassigned task to doing assigns it to you, as the server does too.
   * Confetti bursts from where the card was dropped when a high or critical task is done.
   */
  private changeStatus(task: ProjectTask, status: TaskStatus, dropPoint?: { x: number; y: number }): void {
    if (task.status === status) return;
    if (task.status === 'todo' && this.blockedIds().has(task.id)) {
      this.taskError.set('This task is blocked until all its dependencies are done.');
      return;
    }
    const assigneeUserId =
      status === 'doing' && !task.assigneeUserId ? (this.account.value()?.id ?? null) : task.assigneeUserId;
    const setTask = (value: Pick<ProjectTask, 'status' | 'assigneeUserId' | 'completedAt'>) =>
      this.tasks.update((tasks) => tasks.map((item) => (item.id === task.id ? { ...item, ...value } : item)));
    // Completed now, like the server records it, so the card lands at the top of done.
    setTask({ status, assigneeUserId, completedAt: status === 'done' ? new Date().toISOString() : null });
    this.taskError.set('');
    this.api.setTaskStatus(task.id, status).subscribe({
      next: () => {
        if (status === 'done') void celebrateDone(task.priority, dropPoint);
      },
      error: () => {
        setTask({ status: task.status, assigneeUserId: task.assigneeUserId, completedAt: task.completedAt });
        this.taskError.set('Could not update task status.');
      },
    });
  }
}
