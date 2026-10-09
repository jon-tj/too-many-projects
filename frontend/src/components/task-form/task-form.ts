import { Component, computed, effect, inject, input, output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Icon } from '../icon/icon';
import { ProjectMember, ProjectTask, TaskPriority, TaskStatus } from '../../services/models';

/** The editable task fields, with the due date as an ISO timestamp or null. */
export type TaskFormValue = Pick<
  ProjectTask,
  'title' | 'description' | 'status' | 'priority' | 'assigneeUserId' | 'dueAt' | 'units' | 'dependsOn'
>;

/** Ids of the tasks the given task waits for, directly or through others. */
function upstreamOf(taskId: number, tasks: ProjectTask[]): Set<number> {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const found = new Set<number>();
  const pending = [...(byId.get(taskId)?.dependsOn ?? [])];
  while (pending.length) {
    const current = pending.pop()!;
    if (found.has(current)) continue;
    found.add(current);
    pending.push(...(byId.get(current)?.dependsOn ?? []));
  }
  return found;
}

/** Ids of the tasks that wait on the given task, directly or through others. */
function dependentsOf(taskId: number, tasks: ProjectTask[]): Set<number> {
  const found = new Set<number>();
  const pending = [taskId];
  while (pending.length) {
    const current = pending.pop()!;
    for (const task of tasks) {
      if (task.dependsOn.includes(current) && !found.has(task.id)) {
        found.add(task.id);
        pending.push(task.id);
      }
    }
  }
  return found;
}

/**
 * Task fields shared by "New task" and the task page. Status is only shown when editing an existing task.
 * Buttons are projected into the form's footer, so a projected submit button submits it:
 * `<app-task-form #taskForm (save)="..."><button class="primary" type="submit" [disabled]="taskForm.form.invalid">Save</button></app-task-form>`
 */
@Component({
  selector: 'app-task-form',
  imports: [ReactiveFormsModule, Icon],
  templateUrl: './task-form.html',
  styleUrl: './task-form.css',
})
export class TaskForm {
  /** The task being edited, or null when creating one. */
  readonly task = input<ProjectTask | null>(null);
  readonly members = input.required<ProjectMember[]>();
  readonly currentUserId = input<string | null>(null);
  /** The project's tasks, to pick dependencies from. */
  readonly tasks = input<ProjectTask[]>([]);
  readonly save = output<TaskFormValue>();

  readonly form = inject(FormBuilder).nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(180)]],
    description: ['', Validators.maxLength(2000)],
    status: ['todo' as TaskStatus],
    priority: ['low' as TaskPriority],
    assigneeUserId: [null as string | null],
    dueAt: [''],
    /** Empty = the task is not split into units. */
    units: [null as number | null, [Validators.min(1), Validators.max(1000)]],
    dependsOn: [[] as number[]],
  });
  private readonly assignee = toSignal(this.form.controls.assigneeUserId.valueChanges, { initialValue: null });
  protected readonly assignedToMe = computed(() => !!this.currentUserId() && this.assignee() === this.currentUserId());
  private readonly dependsOn = toSignal(this.form.controls.dependsOn.valueChanges, { initialValue: [] as number[] });
  protected readonly dependencies = computed(() =>
    this.dependsOn()
      .map((id) => this.tasks().find((task) => task.id === id))
      .filter((task) => !!task),
  );
  /**
   * Tasks that can be added: not this one, not already chosen, not one that waits on this one (that would loop),
   * and not one a chosen dependency already waits for (it is implied).
   */
  protected readonly dependencyOptions = computed(() => {
    const self = this.task()?.id;
    const tasks = this.tasks();
    const chosen = new Set(this.dependsOn());
    const waiting = self === undefined ? new Set<number>() : dependentsOf(self, tasks);
    const implied = new Set([...chosen].flatMap((id) => [...upstreamOf(id, tasks)]));
    return tasks.filter(
      (task) => task.id !== self && !chosen.has(task.id) && !waiting.has(task.id) && !implied.has(task.id),
    );
  });
  /** A task with unfinished dependencies cannot leave to do. */
  protected readonly blocked = computed(
    () => this.task()?.status === 'todo' && this.dependencies().some((task) => task.status !== 'done'),
  );

  constructor() {
    effect(() => {
      const task = this.task();
      if (!task) return;
      this.form.reset({
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        assigneeUserId: task.assigneeUserId,
        dueAt: task.dueAt?.slice(0, 10) ?? '',
        units: task.units,
        dependsOn: task.dependsOn,
      });
    });
  }

  protected assignToMe(): void {
    this.form.controls.assigneeUserId.setValue(this.currentUserId());
    this.form.markAsDirty();
  }

  protected addDependency(select: HTMLSelectElement): void {
    const id = Number(select.value);
    select.value = '';
    if (!id) return;
    // Chosen dependencies the new one already waits for become implied, so it takes their place.
    const upstream = upstreamOf(id, this.tasks());
    const kept = this.form.controls.dependsOn.value.filter((other) => !upstream.has(other));
    this.form.controls.dependsOn.setValue([...kept, id]);
    this.form.markAsDirty();
  }

  protected removeDependency(id: number): void {
    this.form.controls.dependsOn.setValue(this.form.controls.dependsOn.value.filter((other) => other !== id));
    this.form.markAsDirty();
  }

  protected dueToday(): void {
    this.setDueDate(new Date());
  }

  /** Adds days to the due date in the field, or to today when it is empty, so repeated clicks keep adding. */
  protected addDays(days: number): void {
    const current = this.form.controls.dueAt.value;
    let date = new Date();
    if (current) {
      // Parse "YYYY-MM-DD" by parts so it is local midnight; new Date("YYYY-MM-DD") would be UTC.
      const [year, month, day] = current.split('-').map(Number);
      date = new Date(year, month - 1, day);
    }
    date.setDate(date.getDate() + days);
    this.setDueDate(date);
  }

  private setDueDate(date: Date): void {
    // sv-SE formats dates as YYYY-MM-DD in local time, which is what the date input expects.
    this.form.controls.dueAt.setValue(date.toLocaleDateString('sv-SE'));
    this.form.markAsDirty();
  }

  protected submit(): void {
    if (this.form.invalid) return;
    const { title, description, status, priority, assigneeUserId, dueAt, units, dependsOn } = this.form.getRawValue();
    this.save.emit({
      title: title.trim(),
      description: description.trim(),
      status,
      priority,
      assigneeUserId,
      dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      units: units || null,
      dependsOn,
    });
  }
}
