import { Component, computed, effect, inject, input, output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ProjectMember, ProjectTask, TaskStatus } from '../../services/models';

/** The editable task fields, with the due date as an ISO timestamp or null. */
export type TaskFormValue = Pick<ProjectTask, 'title' | 'description' | 'status' | 'assigneeUserId' | 'dueAt'>;

/**
 * Task fields shared by "New task" and the task page. Status is only shown when editing an existing task.
 * Buttons are projected into the form's footer, so a projected submit button submits it:
 * `<app-task-form #taskForm (save)="..."><button class="primary" type="submit" [disabled]="taskForm.form.invalid">Save</button></app-task-form>`
 */
@Component({
  selector: 'app-task-form',
  imports: [ReactiveFormsModule],
  templateUrl: './task-form.html',
  styleUrl: './task-form.css',
})
export class TaskForm {
  /** The task being edited, or null when creating one. */
  readonly task = input<ProjectTask | null>(null);
  readonly members = input.required<ProjectMember[]>();
  readonly currentUserId = input<string | null>(null);
  readonly save = output<TaskFormValue>();

  readonly form = inject(FormBuilder).nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(180)]],
    description: ['', Validators.maxLength(2000)],
    status: ['todo' as TaskStatus],
    assigneeUserId: [null as string | null],
    dueAt: [''],
  });
  private readonly assignee = toSignal(this.form.controls.assigneeUserId.valueChanges, { initialValue: null });
  protected readonly assignedToMe = computed(() => !!this.currentUserId() && this.assignee() === this.currentUserId());

  constructor() {
    effect(() => {
      const task = this.task();
      if (!task) return;
      this.form.reset({
        title: task.title,
        description: task.description,
        status: task.status,
        assigneeUserId: task.assigneeUserId,
        dueAt: task.dueAt?.slice(0, 10) ?? '',
      });
    });
  }

  protected assignToMe(): void {
    this.form.controls.assigneeUserId.setValue(this.currentUserId());
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

  protected submit(): void {
    if (this.form.invalid) return;
    const { title, description, status, assigneeUserId, dueAt } = this.form.getRawValue();
    this.save.emit({
      title: title.trim(),
      description: description.trim(),
      status,
      assigneeUserId,
      dueAt: dueAt ? new Date(dueAt).toISOString() : null,
    });
  }
}
