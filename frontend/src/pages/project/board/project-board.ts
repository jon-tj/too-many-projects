import { Component, computed, inject, input, numberAttribute, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Icon } from '../../../components/icon/icon';
import { ProjectTask, TaskStatus } from '../../../services/models';
import { WorkspaceApi } from '../../../services/workspace-api';

const COLUMNS = [
  { status: 'todo', title: 'To do', label: 'UP NEXT', empty: 'Nothing queued yet' },
  { status: 'doing', title: 'Doing', label: 'IN MOTION', empty: 'A clear runway' },
  { status: 'done', title: 'Done', label: 'LANDED', empty: 'Wins show up here' },
] as const;

@Component({
  selector: 'app-project-board',
  imports: [ReactiveFormsModule, RouterLink, Icon],
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
  private readonly members = rxResource({
    params: () => this.projectId(),
    stream: ({ params }) => this.api.projectMembers(params),
    defaultValue: [],
  });
  private readonly account = rxResource({ stream: () => this.api.currentAccount() });
  private dragged: ProjectTask | null = null;
  protected readonly columns = computed(() =>
    COLUMNS.map((column) => ({
      ...column,
      tasks: this.tasks.value().filter((task) => task.status === column.status),
    })),
  );
  protected readonly addingTask = signal(false);
  protected readonly taskError = signal('');
  protected readonly form = inject(FormBuilder).nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(180)]],
    description: [''],
  });

  protected createTask(): void {
    if (this.form.invalid) return;
    const { title, description } = this.form.getRawValue();
    this.api.createTask(this.projectId(), title.trim(), description.trim()).subscribe({
      next: (task) => {
        this.tasks.update((tasks) => [task, ...tasks]);
        this.form.reset();
        this.addingTask.set(false);
        this.taskError.set('');
      },
      error: () => this.taskError.set('Could not create the task. Please try again.'),
    });
  }

  protected assigneeName(task: ProjectTask): string {
    if (!task.assigneeUserId) return 'Unassigned';
    if (task.assigneeUserId === this.account.value()?.id) return 'You';
    const member = this.members.value().find((entry) => entry.userId === task.assigneeUserId);
    return member ? member.displayName || member.userName : 'Assigned';
  }

  protected dragStart(event: DragEvent, task: ProjectTask): void {
    this.dragged = task;
    event.dataTransfer?.setData('text/plain', String(task.id));
  }

  protected drop(status: TaskStatus): void {
    if (this.dragged) this.changeStatus(this.dragged, status);
    this.dragged = null;
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
