import { DatePipe } from '@angular/common';
import { Component, effect, inject, input, numberAttribute, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { CanvasPermission } from '../../../../services/models';
import { WorkspaceApi } from '../../../../services/workspace-api';

@Component({
  selector: 'app-canvas-settings',
  imports: [DatePipe, ReactiveFormsModule],
  templateUrl: './canvas-settings.html',
  styleUrl: './canvas-settings.css',
})
export class CanvasSettings {
  readonly projectId = input.required({ transform: numberAttribute });
  readonly canvasId = input.required({ transform: numberAttribute });
  private readonly api = inject(WorkspaceApi);
  private readonly router = inject(Router);
  protected readonly canvas = rxResource({
    params: () => ({ projectId: this.projectId(), canvasId: this.canvasId() }),
    stream: ({ params }) => this.api.canvas(params.projectId, params.canvasId),
  });
  protected readonly permissions = rxResource({
    params: () => ({ projectId: this.projectId(), canvasId: this.canvasId() }),
    stream: ({ params }) => this.api.canvasPermissions(params.projectId, params.canvasId),
    defaultValue: [],
  });
  protected readonly message = signal('');
  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
  });

  constructor() {
    effect(() => {
      const canvas = this.canvas.value();
      if (canvas) this.form.reset({ name: canvas.name });
    });
  }

  protected rename(): void {
    if (this.form.invalid) return;
    this.api.renameCanvas(this.projectId(), this.canvasId(), this.form.getRawValue().name.trim()).subscribe({
      next: () => {
        this.message.set('Name saved.');
        this.canvas.reload();
      },
      error: () => this.message.set('Could not save the name. Please try again.'),
    });
  }

  protected deleteCanvas(name: string): void {
    if (!confirm(`Delete "${name}" and everything on it? This cannot be undone.`)) return;
    this.api.deleteCanvas(this.projectId(), this.canvasId()).subscribe({
      next: () => void this.router.navigate(['/projects', this.projectId(), 'canvas']),
      error: () => this.message.set('Could not delete the canvas. Please try again.'),
    });
  }

  /** Removing read access also removes write access. */
  protected setRead(member: CanvasPermission, canRead: boolean): void {
    this.setAccess(member, canRead, canRead && member.canWrite);
  }

  /** Granting write access also grants read access. */
  protected setWrite(member: CanvasPermission, canWrite: boolean): void {
    this.setAccess(member, canWrite || member.canRead, canWrite);
  }

  private setAccess(member: CanvasPermission, canRead: boolean, canWrite: boolean): void {
    this.permissions.update((members) =>
      members.map((entry) => (entry.userId === member.userId ? { ...entry, canRead, canWrite } : entry)),
    );
    this.api.setCanvasPermission(this.projectId(), this.canvasId(), member.userId, canRead, canWrite).subscribe({
      error: () => {
        this.message.set('Could not update access. Please try again.');
        this.permissions.reload();
      },
    });
  }
}
