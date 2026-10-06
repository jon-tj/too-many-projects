import { Component, inject, input, numberAttribute, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { TaskForm, TaskFormValue } from '../../../components/task-form/task-form';
import { WorkspaceApi } from '../../../services/workspace-api';

@Component({
  selector: 'app-task-detail',
  imports: [TaskForm],
  templateUrl: './task-detail.html',
  styleUrl: './task-detail.css',
})
export class TaskDetail {
  readonly projectId = input.required({ transform: numberAttribute });
  readonly taskId = input.required({ transform: numberAttribute });
  private readonly api = inject(WorkspaceApi);
  private readonly router = inject(Router);
  protected readonly task = rxResource({
    params: () => this.taskId(),
    stream: ({ params }) => this.api.task(params),
  });
  protected readonly members = rxResource({
    params: () => this.projectId(),
    stream: ({ params }) => this.api.projectMembers(params),
    defaultValue: [],
  });
  protected readonly account = rxResource({ stream: () => this.api.currentAccount() });
  protected readonly busy = signal(false);
  protected readonly message = signal('');

  protected save(value: TaskFormValue): void {
    const task = this.task.value();
    if (!task) return;
    this.busy.set(true);
    this.api.updateTask({ ...task, ...value }).subscribe({
      next: () => this.backToBoard(),
      error: () => {
        this.busy.set(false);
        this.message.set('Could not save the task. Please try again.');
      },
    });
  }

  protected deleteTask(): void {
    const task = this.task.value();
    if (!task || !confirm(`Delete "${task.title}"? This cannot be undone.`)) return;
    this.busy.set(true);
    this.api.deleteTask(task.id).subscribe({
      next: () => this.backToBoard(),
      error: () => {
        this.busy.set(false);
        this.message.set('Could not delete the task. Please try again.');
      },
    });
  }

  protected backToBoard(): void {
    void this.router.navigate(['/projects', this.projectId(), 'board']);
  }
}
