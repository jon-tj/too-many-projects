import { Component, inject, input, numberAttribute, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { Icon } from '../../../components/icon/icon';
import { TaskForm, TaskFormValue } from '../../../components/task-form/task-form';
import { ProjectCanvas } from '../canvas/editor/project-canvas';
import { WorkspaceApi } from '../../../services/workspace-api';

@Component({
  selector: 'app-task-detail',
  imports: [TaskForm, Icon, RouterLink, ProjectCanvas],
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
  protected readonly pinnedCanvases = rxResource({
    params: () => ({ projectId: this.projectId(), taskId: this.taskId() }),
    stream: ({ params }) => this.api.canvasesPinnedTo(params.projectId, params.taskId),
    defaultValue: [],
  });
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

  /** Goes straight to the canvas when the project has one, otherwise to the list to pick one. */
  protected pinToCanvas(): void {
    const task = this.task.value();
    if (!task) return;
    this.api.canvases(this.projectId()).subscribe({
      next: (canvases) => {
        const path = ['/projects', this.projectId(), 'canvas'];
        if (canvases.length === 1) path.push(canvases[0].id);
        void this.router.navigate(path, { queryParams: { pinTask: task.id } });
      },
      error: () => this.message.set('Could not load the canvases. Please try again.'),
    });
  }

  protected backToBoard(): void {
    void this.router.navigate(['/projects', this.projectId(), 'board']);
  }
}
