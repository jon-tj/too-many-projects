import { CdkDrag, CdkDragDrop, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { Component, computed, HostListener, inject, input, linkedSignal, numberAttribute, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Icon } from '../../../components/icon/icon';
import { Modal } from '../../../components/modal/modal';
import { TaskForm, TaskFormValue } from '../../../components/task-form/task-form';
import { PRIORITY_RANK, ProjectTask, TaskStatus } from '../../../services/models';
import { WorkspaceApi } from '../../../services/workspace-api';

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
  /** Which assignee's tasks to show: a member's user id, or one of the special ASSIGNEE_FILTER values. */
  /** Remembered per project in this browser. */
  private readonly storedFilter = linkedSignal(() => this.readStoredFilter(this.projectId()));
  /** Falls back to all when the stored member has left the project. */
  protected readonly assigneeFilter = computed(() => {
    const filter = this.storedFilter();
    if (filter.startsWith('*') || this.members.isLoading()) return filter;
    return this.members.value().some((member) => member.userId === filter) ? filter : ASSIGNEE_FILTER.all;
  });
  protected readonly visibleTasks = computed(() => {
    const filter = this.assigneeFilter();
    const me = this.account.value()?.id;
    return this.tasks.value().filter((task) => {
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
  protected readonly columns = computed(() =>
    COLUMNS.map((column) => ({
      ...column,
      // Highest priority first; the sort is stable, so newest first within a priority.
      tasks: this.visibleTasks()
        .filter((task) => task.status === column.status)
        .sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]),
    })),
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

  /** Drops hidden tasks from the selection, so group actions only touch what is on screen. */
  protected setAssigneeFilter(filter: string): void {
    this.storedFilter.set(filter);
    try {
      localStorage.setItem(`board-assignee-filter:${this.projectId()}`, filter);
    } catch {
      // Storage can be unavailable (e.g. private windows); the filter then lasts until reload.
    }
    const visible = new Set(this.visibleTasks().map((task) => task.id));
    this.selected.update((ids) => new Set([...ids].filter((id) => visible.has(id))));
  }

  private readStoredFilter(projectId: number): string {
    try {
      return localStorage.getItem(`board-assignee-filter:${projectId}`) || ASSIGNEE_FILTER.all;
    } catch {
      return ASSIGNEE_FILTER.all;
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
    this.changeStatus(event.item.data, event.container.data);
  }

  private changeStatus(task: ProjectTask, status: TaskStatus): void {
    if (task.status === status) return;
    if (task.status === 'todo' && this.blockedIds().has(task.id)) {
      this.taskError.set('This task is blocked until all its dependencies are done.');
      return;
    }
    const setStatus = (value: TaskStatus) =>
      this.tasks.update((tasks) =>
        tasks.map((item) => (item.id === task.id ? { ...item, status: value } : item)),
      );
    setStatus(status);
    this.taskError.set('');
    this.api.setTaskStatus(task.id, status).subscribe({
      error: () => {
        setStatus(task.status);
        this.taskError.set('Could not update task status.');
      },
    });
  }
}
