import { HttpErrorResponse } from '@angular/common/http';
import { Component, effect, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ProjectPage } from './project-page';
import { WorkspaceApi } from './workspace-api';

@Component({
  selector: 'app-project-settings',
  imports: [ReactiveFormsModule],
  templateUrl: './project-settings.html',
  styleUrl: './project-settings.css',
})
export class ProjectSettings {
  private readonly api = inject(WorkspaceApi);
  private readonly router = inject(Router);
  protected readonly project = inject(ProjectPage).project;
  protected readonly busy = signal(false);
  protected readonly message = signal('');
  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    description: ['', Validators.maxLength(1000)],
  });

  constructor() {
    effect(() => {
      const project = this.project.value();
      if (project) this.form.reset({ name: project.name, description: project.description });
    });
  }

  protected save(): void {
    const project = this.project.value();
    if (!project || this.form.invalid) return;
    const { name, description } = this.form.getRawValue();
    this.busy.set(true);
    this.api.updateProject(project.id, name.trim(), description.trim()).subscribe({
      next: () => {
        this.busy.set(false);
        this.message.set('Project saved.');
        this.project.reload();
      },
      error: () => {
        this.busy.set(false);
        this.message.set('Could not save the project. Please try again.');
      },
    });
  }

  protected deleteProject(): void {
    const project = this.project.value();
    if (!project || !confirm(`Delete "${project.name}" and all of its tasks? This cannot be undone.`)) return;
    this.busy.set(true);
    this.api.deleteProject(project.id).subscribe({
      next: () => void this.router.navigateByUrl('/'),
      error: (error: HttpErrorResponse) => {
        this.busy.set(false);
        this.message.set(
          error.status === 403
            ? 'Only the project owner can delete this project.'
            : 'Could not delete the project. Please try again.',
        );
      },
    });
  }
}
