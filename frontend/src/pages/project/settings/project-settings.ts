import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Icon } from '../../../components/icon/icon';
import { ProjectIcon } from '../../../components/project-icon/project-icon';
import { WorkspaceShell } from '../../../components/workspace-shell/workspace-shell';
import { ProjectPage } from '../project-page';
import { squareImageDataUrl } from '../../../services/square-image';
import { WorkspaceApi } from '../../../services/workspace-api';

const PROJECT_ICONS = [
  'view_kanban', 'rocket_launch', 'code', 'bug_report', 'build', 'science',
  'palette', 'brush', 'photo_camera', 'movie', 'music_note', 'campaign',
  'storefront', 'savings', 'work', 'school', 'groups', 'favorite',
  'lightbulb', 'eco', 'pets', 'home', 'flight', 'sports_esports',
];

@Component({
  selector: 'app-project-settings',
  imports: [ReactiveFormsModule, Icon, ProjectIcon],
  templateUrl: './project-settings.html',
  styleUrl: './project-settings.css',
})
export class ProjectSettings {
  private readonly api = inject(WorkspaceApi);
  private readonly router = inject(Router);
  private readonly shell = inject(WorkspaceShell);
  protected readonly project = inject(ProjectPage).project;
  protected readonly isOwner = computed(() => this.project.value()?.myRole === 'Owner');
  /** Billing settings are owner-only, so they are only loaded for owners. */
  private readonly billing = rxResource({
    params: () => (this.isOwner() ? this.project.value()!.id : undefined),
    stream: ({ params }) => this.api.billing(params),
  });
  protected readonly billingMessage = signal('');
  protected readonly billingForm = inject(FormBuilder).nonNullable.group({
    enabled: [false],
    clientName: ['', Validators.maxLength(200)],
    contactName: ['', Validators.maxLength(200)],
    costPerHour: [0, [Validators.required, Validators.min(0)]],
    minHoursPerDay: [0, [Validators.required, Validators.min(0), Validators.max(24)]],
    /** 0 or 24+ means no cap. */
    maxHoursPerDay: [8, [Validators.required, Validators.min(0)]],
  });
  protected readonly icons = PROJECT_ICONS;
  protected readonly busy = signal(false);
  protected readonly message = signal('');
  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    description: ['', Validators.maxLength(1000)],
    icon: [null as string | null],
    iconImage: [null as string | null],
  });

  constructor() {
    effect(() => {
      const billing = this.billing.value();
      if (billing) this.billingForm.reset(billing);
    });
    effect(() => {
      const project = this.project.value();
      if (project) {
        const { name, description, icon, iconImage } = project;
        this.form.reset({ name, description, icon, iconImage });
      }
    });
  }

  protected save(): void {
    const project = this.project.value();
    if (!project || this.form.invalid) return;
    const { name, description, icon, iconImage } = this.form.getRawValue();
    this.busy.set(true);
    this.api.updateProject(project.id, { name: name.trim(), description: description.trim(), icon, iconImage }).subscribe({
      next: () => {
        this.shell.refreshProjects();
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

  protected saveBilling(): void {
    const project = this.project.value();
    if (!project || this.billingForm.invalid) return;
    const settings = this.billingForm.getRawValue();
    const capped = settings.maxHoursPerDay > 0 && settings.maxHoursPerDay < 24;
    if (capped && settings.maxHoursPerDay < settings.minHoursPerDay) {
      this.billingMessage.set('The maximum hours per day cannot be below the minimum.');
      return;
    }
    this.api.saveBilling(project.id, settings).subscribe({
      next: () => {
        this.billingForm.reset(settings);
        this.billingMessage.set('Billing settings saved.');
        // The overview and members tab show billing once it is enabled.
        this.project.reload();
      },
      error: () => this.billingMessage.set('Could not save the billing settings. Please try again.'),
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

  /** Only changes the form; nothing is saved until "Save changes". */
  protected setIcon(icon: string | null, iconImage: string | null): void {
    this.form.patchValue({ icon, iconImage });
    this.form.markAsDirty();
  }

  protected async upload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      this.setIcon(null, await squareImageDataUrl(file, 128));
    } catch {
      this.message.set('That file could not be read as an image.');
    }
  }
}
