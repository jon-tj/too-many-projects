import { Component, inject, input, numberAttribute } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Icon } from './icon';
import { WorkspaceApi } from './workspace-api';

@Component({
  selector: 'app-project-page',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, Icon],
  templateUrl: './project-page.html',
  styleUrl: './project-page.css',
})
export class ProjectPage {
  readonly projectId = input.required({ transform: numberAttribute });
  private readonly api = inject(WorkspaceApi);
  protected readonly project = rxResource({
    params: () => this.projectId(),
    stream: ({ params }) => this.api.project(params),
  });
}
