import { Component, inject, input, numberAttribute } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterOutlet } from '@angular/router';
import { Icon } from '../../components/icon/icon';
import { ProjectIcon } from '../../components/project-icon/project-icon';
import { WorkspaceApi } from '../../services/workspace-api';

@Component({
  selector: 'app-project-page',
  imports: [RouterOutlet, Icon, ProjectIcon],
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
}
