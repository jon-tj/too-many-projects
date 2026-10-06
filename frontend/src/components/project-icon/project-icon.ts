import { Component, input } from '@angular/core';
import { Project } from '../../services/models';
import { Icon } from '../icon/icon';

/** A project's uploaded image, chosen Material icon, or the default icon. Size it from the parent. */
@Component({
  selector: 'app-project-icon',
  imports: [Icon],
  template: `
    @if (project().iconImage; as image) {
      <img [src]="image" alt="" />
    } @else {
      <app-icon [name]="project().icon ?? 'view_kanban'" />
    }
  `,
  styles: `
    :host {
      display: grid;
      place-items: center;
      overflow: hidden;
    }
    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  `,
})
export class ProjectIcon {
  readonly project = input.required<Pick<Project, 'icon' | 'iconImage'>>();
}
