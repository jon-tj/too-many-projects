import { Component, computed, effect, inject, input, numberAttribute, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TaskStatus } from '../../../services/models';
import { WorkspaceApi } from '../../../services/workspace-api';

@Component({
  selector: 'app-task-detail',
  imports: [ReactiveFormsModule],
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
  private readonly account = rxResource({ stream: () => this.api.currentAccount() });
  protected readonly busy = signal(false);
  protected readonly message = signal('');
  protected readonly form = inject(FormBuilder).nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(180)]],
    description: ['', Validators.maxLength(2000)],
    status: ['todo' as TaskStatus],
    assigneeUserId: [null as string | null],
    dueAt: [''],
  });
  private readonly assignee = signal<string | null>(null);
  protected readonly assignedToMe = computed(() => this.assignee() === this.account.value()?.id);

  constructor() {
    effect(() => {
      const task = this.task.value();
      if (!task) return;
      this.form.reset({
        title: task.title,
        description: task.description,
        status: task.status,
        assigneeUserId: task.assigneeUserId,
        dueAt: task.dueAt?.slice(0, 10) ?? '',
      });
      this.assignee.set(task.assigneeUserId);
    });
    this.form.controls.assigneeUserId.valueChanges.subscribe((id) => this.assignee.set(id));
  }

  protected assignToMe(): void {
    this.form.controls.assigneeUserId.setValue(this.account.value()?.id ?? null);
    this.form.markAsDirty();
  }

  /** Sets the due date to today plus the given number of days. */
  protected dueIn(days: number): void {
    const date = new Date();
    date.setDate(date.getDate() + days);
    // sv-SE formats dates as YYYY-MM-DD in local time, which is what the date input expects.
    this.form.controls.dueAt.setValue(date.toLocaleDateString('sv-SE'));
    this.form.markAsDirty();
  }

  protected save(): void {
    const task = this.task.value();
    if (!task || this.form.invalid) return;
    const { title, description, status, assigneeUserId, dueAt } = this.form.getRawValue();
    this.busy.set(true);
    this.api
      .updateTask({
        ...task,
        title: title.trim(),
        description: description.trim(),
        status,
        assigneeUserId,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      })
      .subscribe({
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
