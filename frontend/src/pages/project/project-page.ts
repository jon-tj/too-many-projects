import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, numberAttribute, signal } from '@angular/core';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { Icon } from '../../components/icon/icon';
import { ProjectIcon } from '../../components/project-icon/project-icon';
import { WorkspaceShell } from '../../components/workspace-shell/workspace-shell';
import { unfreezeWarning } from '../../services/unfreeze-warning';
import { WorkspaceApi } from '../../services/workspace-api';

@Component({
  selector: 'app-project-page',
  imports: [RouterOutlet, RouterLink, NgTemplateOutlet, Icon, ProjectIcon],
  templateUrl: './project-page.html',
  styleUrl: './project-page.css',
})
export class ProjectPage {
  readonly projectId = input.required({ transform: numberAttribute });
  private readonly api = inject(WorkspaceApi);
  readonly project = rxResource({
    params: () => this.projectId(),
    stream: ({ params }) => this.api.project(params),
  });
  private readonly router = inject(Router);
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );
  /** Views beyond boards and tasks, which the free plan does not include. */
  protected readonly fullFeatureView = computed(() =>
    /^\/projects\/\d+\/(overview|roadmap|canvas|members)(\/|\?|$)/.test(this.url()),
  );
  private readonly shell = inject(WorkspaceShell);
  protected readonly unfreezing = signal(false);
  protected readonly unfreezeError = signal('');
  protected readonly requestState = signal<'idle' | 'sending' | 'sent'>('idle');
  protected readonly requestError = signal('');

  protected unfreeze(): void {
    const project = this.project.value();
    const warning = project && unfreezeWarning(project.memberCount, project.memberLimit);
    if (warning && !confirm(warning)) return;
    this.unfreezing.set(true);
    this.unfreezeError.set('');
    this.api.unfreezeProject(this.projectId()).subscribe({
      next: () => {
        this.unfreezing.set(false);
        this.project.reload();
        this.shell.refreshProjects();
      },
      error: (response: HttpErrorResponse) => {
        this.unfreezing.set(false);
        this.unfreezeError.set(response.error?.error ?? 'Could not unfreeze the project. Please try again.');
      },
    });
  }

  /** Emails the owner that you would like the project unfrozen or upgraded. */
  protected requestUpgrade(): void {
    this.requestState.set('sending');
    this.requestError.set('');
    this.api.requestUpgrade(this.projectId()).subscribe({
      next: () => this.requestState.set('sent'),
      error: (response: HttpErrorResponse) => {
        this.requestState.set('idle');
        this.requestError.set(response.error?.error ?? 'Could not send the request. Please try again.');
      },
    });
  }
}
