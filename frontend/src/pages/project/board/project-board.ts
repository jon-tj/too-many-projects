import { CdkDrag, CdkDragDrop, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { Component, computed, inject, input, numberAttribute, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Icon } from '../../../components/icon/icon';
import { Modal } from '../../../components/modal/modal';
import { TaskForm, TaskFormValue } from '../../../components/task-form/task-form';
import { ProjectTask, TaskStatus } from '../../../services/models';
import { WorkspaceApi } from '../../../services/workspace-api';

const COLUMNS = [
  { status: 'todo', title: 'To do', empty: 'Nothing queued yet' },
  { status: 'doing', title: 'Doing', empty: 'A clear runway' },
  { status: 'done', title: 'Done', empty: 'Wins show up here' },
] as const;

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
  protected readonly columns = computed(() =>
    COLUMNS.map((column) => ({
      ...column,
      tasks: this.tasks.value().filter((task) => task.status === column.status),
    })),
  );
  protected readonly addingTask = signal(false);
  protected readonly taskError = signal('');
  protected readonly copiedId = signal<number | null>(null);

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
    const text = task.description ? `${task.title}

${task.description}` : task.title;
    navigator.clipboard.writeText(text).then(
      () => {
        this.copiedId.set(task.id);
        setTimeout(() => this.copiedId.update((id) => (id === task.id ? null : id)), 1500);
      },
      () => this.taskError.set('Could not copy the task to the clipboard.'),
    );
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
    const setStatus = (value: TaskStatus) =>
      this.tasks.update((tasks) =>
        tasks.map((item) => (item.id === task.id ? { ...item, status: value } : item)),
      );
    setStatus(status);
    this.api.setTaskStatus(task.id, status).subscribe({
      error: () => {
        setStatus(task.status);
        this.taskError.set('Could not update task status.');
      },
    });
  }
}
