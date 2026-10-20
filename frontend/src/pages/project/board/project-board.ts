import { CdkDrag, CdkDragDrop, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { Component, computed, ElementRef, HostListener, inject, input, linkedSignal, numberAttribute, signal, viewChild } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Icon } from '../../../components/icon/icon';
import { TaskImport } from '../../../components/csv-import/task-import';
import { Modal } from '../../../components/modal/modal';
import { TaskForm, TaskFormValue } from '../../../components/task-form/task-form';
import { PRIORITY_RANK, ProjectTask, TaskStatus } from '../../../services/models';
import { celebrateDone } from '../../../services/celebrate';
import { WorkspaceApi } from '../../../services/workspace-api';

/** Done shows only this many of the most recently completed tasks until "Show older" is clicked. */
const DONE_LIMIT = 4;

/** How close (px) to the board's edge a dragged card must be held for the board to scroll that way. */
const EDGE = 48;

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

/** A star bursting from a random point on the arriving card's edge: start in % of the card, flight in px. */
interface ArrivalStar {
  x: number;
  y: number;
  dx: number;
  dy: number;
  spin: number;
  delay: number;
}

/** Picks a random point on one of the card's four edges and sends the star outwards from it, give or take 35°. */
function arrivalStar(): ArrivalStar {
  const edge = Math.floor(Math.random() * 4);
  const along = Math.random() * 100;
  const [x, y, normal] = [
    [along, 0, -Math.PI / 2],
    [100, along, 0],
    [along, 100, Math.PI / 2],
    [0, along, Math.PI],
  ][edge];
  const angle = normal + ((Math.random() - 0.5) * 70 * Math.PI) / 180;
  const distance = 26 + Math.random() * 22;
  return {
    x,
    y,
    dx: Math.round(Math.cos(angle) * distance),
    dy: Math.round(Math.sin(angle) * distance),
    spin: Math.round((Math.random() - 0.5) * 240),
    delay: Math.round(Math.random() * 90),
  };
}

@Component({
  selector: 'app-project-board',
  imports: [TaskForm, TaskImport, RouterLink, Icon, Modal, CdkDrag, CdkDropList, CdkDropListGroup, CdkScrollable],
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
  /** The CSV import dialog. */
  protected readonly importing = signal(false);
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

  /** Deletes the selected tasks after confirming; they disappear at once and come back if the server refuses. */
  protected deleteSelected(): void {
    const ids = this.selected();
    if (!ids.size) return;
    const count = ids.size === 1 ? 'this task' : `these ${ids.size} tasks`;
    if (!confirm(`Delete ${count}? This cannot be undone.`)) return;
    const previous = this.tasks.value();
    this.tasks.update((tasks) => tasks.filter((task) => !ids.has(task.id)));
    this.clearSelection();
    this.api.deleteTasks(this.projectId(), [...ids]).subscribe({
      error: () => {
        this.tasks.set(previous);
        this.selected.set(ids);
        this.taskError.set('Could not delete the selected tasks.');
      },
    });
  }

  /** The card that just arrived in to do, playing its drop-in animation. */
  protected readonly arrived = signal<number | null>(null);
  /** Where the arriving card's stars start on its edges and how far they fly. */
  protected readonly arrivedStars = signal<ArrivalStar[]>([]);
  private arrivedTimer?: ReturnType<typeof setTimeout>;

  /** Closes the dialog straight away; the card drops into to do when the server has saved it. */
  protected createTask(value: TaskFormValue): void {
    this.addingTask.set(false);
    this.taskError.set('');
    this.api.createTask(this.projectId(), value).subscribe({
      next: (task) => {
        this.tasks.update((tasks) => [task, ...tasks]);
        clearTimeout(this.arrivedTimer);
        this.arrivedStars.set(Array.from({ length: 5 }, arrivalStar));
        this.arrived.set(task.id);
        this.arrivedTimer = setTimeout(() => this.arrived.set(null), 1200);
      },
      error: () => this.taskError.set(`Could not create "${value.title}". Please try again.`),
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

  /** The assignee's profile picture, or null when unassigned or they have none. */
  protected assigneeAvatar(task: ProjectTask): string | null {
    if (!task.assigneeUserId) return null;
    return this.members.value().find((entry) => entry.userId === task.assigneeUserId)?.avatarImage ?? null;
  }

  protected assigneeName(task: ProjectTask): string {
    if (!task.assigneeUserId) return 'Unassigned';
    if (task.assigneeUserId === this.account.value()?.id) return 'You';
    const member = this.members.value().find((entry) => entry.userId === task.assigneeUserId);
    return member ? member.displayName || member.userName : 'Assigned';
  }

  /** The card shaking because it was dropped where it cannot go. */
  protected readonly shaking = signal<number | null>(null);
  private shakeTimer?: ReturnType<typeof setTimeout>;

  private readonly board = viewChild<ElementRef<HTMLElement>>('board');
  /** A card is being dragged: the board's snap scrolling pauses so it can scroll freely under it (see the CSS). */
  protected readonly dragging = signal(false);
  /** -1 or 1 while a dragged card is held near the board's left or right edge; 0 otherwise. */
  private edgeDirection = 0;
  private edgeFrame = 0;

  /**
   * On phones each column fills the board's width, so a card is dragged to another column by holding it near the
   * edge: the board then keeps scrolling that way. The drag library's own edge scrolling only starts within a few
   * pixels of a narrow screen's edge, too fiddly to hit with a thumb.
   */
  protected dragMoved(pointerX: number): void {
    const board = this.board()?.nativeElement;
    if (!board || board.scrollWidth <= board.clientWidth) return;
    const rect = board.getBoundingClientRect();
    this.edgeDirection = pointerX > rect.right - EDGE ? 1 : pointerX < rect.left + EDGE ? -1 : 0;
    if (this.edgeDirection && !this.edgeFrame) this.edgeFrame = requestAnimationFrame(this.scrollAtEdge);
  }

  private readonly scrollAtEdge = (): void => {
    const board = this.board()?.nativeElement;
    if (!board || !this.edgeDirection) {
      this.edgeFrame = 0;
      return;
    }
    board.scrollLeft += this.edgeDirection * 12;
    this.edgeFrame = requestAnimationFrame(this.scrollAtEdge);
  };

  /** Stops edge scrolling and lets the board snap to the nearest column again. */
  protected dragEnded(): void {
    this.edgeDirection = 0;
    this.dragging.set(false);
  }

  /** The "Move to" picker on phones: like dropping the card on that column, blocked tasks included. */
  protected moveTo(task: ProjectTask, select: HTMLSelectElement): void {
    const status = select.value as TaskStatus;
    select.value = '';
    if (task.status === 'todo' && status !== 'todo' && this.blockedIds().has(task.id)) {
      this.shake(task.id);
      return;
    }
    this.changeStatus(task, status);
  }

  /** Dropping a card on another column changes its status. Touch drags start after a short hold, so swiping still scrolls. */
  protected drop(event: CdkDragDrop<TaskStatus, TaskStatus, ProjectTask>): void {
    const task = event.item.data;
    // A blocked card cannot enter doing or done (see canEnter), so it lands back in to do. When it was let go over one
    // of those columns, it shakes to say no.
    const target = this.columnAt(event.dropPoint);
    if (event.container.data === task.status && target && target !== task.status && this.blockedIds().has(task.id)) {
      this.shake(task.id);
      return;
    }
    this.changeStatus(task, event.container.data, event.dropPoint);
  }

  /** The status of the column under the point, if any. The drag preview lets the pointer through to it. */
  private columnAt(point: { x: number; y: number }): TaskStatus | null {
    const column = document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>('.kanban-column');
    return (column?.dataset['status'] as TaskStatus | undefined) ?? null;
  }

  private shake(taskId: number): void {
    clearTimeout(this.shakeTimer);
    // Cleared first, so shaking the same card twice in a row restarts the animation.
    this.shaking.set(null);
    requestAnimationFrame(() => {
      this.shaking.set(taskId);
      this.shakeTimer = setTimeout(() => this.shaking.set(null), 500);
    });
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
    // Straight away, like the card move itself, rather than after the server answers.
    if (status === 'done') void celebrateDone(task.priority, dropPoint);
    this.api.setTaskStatus(task.id, status).subscribe({
      error: () => {
        setTask({ status: task.status, assigneeUserId: task.assigneeUserId, completedAt: task.completedAt });
        this.taskError.set('Could not update task status.');
      },
    });
  }
}
