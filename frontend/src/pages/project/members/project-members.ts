import { Component, inject, input, numberAttribute } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { WorkspaceApi } from '../../../services/workspace-api';

@Component({
  selector: 'app-project-members',
  templateUrl: './project-members.html',
  styleUrl: './project-members.css',
})
export class ProjectMembers {
  readonly projectId = input.required({ transform: numberAttribute });
  private readonly api = inject(WorkspaceApi);
  protected readonly members = rxResource({
    params: () => this.projectId(),
    stream: ({ params }) => this.api.projectMembers(params),
    defaultValue: [],
  });
}
