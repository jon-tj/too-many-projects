import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, input, numberAttribute, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Icon } from '../../../components/icon/icon';
import { Modal } from '../../../components/modal/modal';
import { WorkspaceApi } from '../../../services/workspace-api';

@Component({
  selector: 'app-canvas-list',
  imports: [DatePipe, ReactiveFormsModule, RouterLink, Icon, Modal],
  templateUrl: './canvas-list.html',
  styleUrl: './canvas-list.css',
})
export class CanvasList {
  readonly projectId = input.required({ transform: numberAttribute });
  private readonly api = inject(WorkspaceApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly canvases = rxResource({
    params: () => this.projectId(),
    stream: ({ params }) => this.api.canvases(params),
    defaultValue: [],
  });
  protected readonly creating = signal(false);
  protected readonly error = signal('');
  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
  });

  protected openCreate(): void {
    // sv-SE formats dates as YYYY-MM-DD in local time.
    this.form.reset({ name: `Meeting ${new Date().toLocaleDateString('sv-SE')}` });
    this.error.set('');
    this.creating.set(true);
  }

  protected create(): void {
    if (this.form.invalid) return;
    this.api.createCanvas(this.projectId(), this.form.getRawValue().name.trim()).subscribe({
      next: (canvas) => void this.router.navigate([canvas.id], { relativeTo: this.route }),
      error: (error: HttpErrorResponse) =>
        this.error.set(
          error.status === 403
            ? 'External members cannot create canvases.'
            : 'Could not create the canvas. Please try again.',
        ),
    });
  }
}
