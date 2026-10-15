import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { Avatar } from '../../components/avatar/avatar';
import { Icon } from '../../components/icon/icon';
import { ProjectIcon } from '../../components/project-icon/project-icon';
import { WorkspaceShell } from '../../components/workspace-shell/workspace-shell';
import { AdminProject, AdminUser, PLAN_TITLES } from '../../services/models';
import { WorkspaceApi } from '../../services/workspace-api';

type Tab = 'members' | 'projects';

/**
 * Every member and project in the database, for the admin: plans and activity per member, and overriding what the
 * plans decide (freezing projects, exemptions, new trials), deleting either, or joining a project.
 */
@Component({
  selector: 'app-admin-page',
  imports: [Avatar, Icon, ProjectIcon, DatePipe, RouterLink],
  templateUrl: './admin-page.html',
  styleUrl: './admin-page.css',
})
export class AdminPage {
  private readonly api = inject(WorkspaceApi);
  private readonly shell = inject(WorkspaceShell);
  protected readonly planTitles = PLAN_TITLES;
  protected readonly users = rxResource({ stream: () => this.api.adminUsers() });
  protected readonly projects = rxResource({ stream: () => this.api.adminProjects() });
  protected readonly tab = signal<Tab>('members');
  protected readonly search = signal('');
  /** The action in progress, as "<kind>:<id>", so only its button shows it. */
  protected readonly busy = signal<string | null>(null);
  protected readonly error = signal('');

  protected readonly shownUsers = computed(() =>
    (this.users.value() ?? []).filter((user) =>
      this.matches(user.displayName, user.userName, user.email, PLAN_TITLES[user.planType]),
    ),
  );
  protected readonly shownProjects = computed(() =>
    (this.projects.value() ?? []).filter((project) =>
      this.matches(project.name, project.ownerName, project.ownerUserName),
    ),
  );
  protected readonly frozenCount = computed(
    () => (this.projects.value() ?? []).filter((project) => project.frozen).length,
  );
  protected readonly lapsedCount = computed(
    () => (this.users.value() ?? []).filter((user) => user.planType === 'none').length,
  );

  private matches(...fields: string[]): boolean {
    const search = this.search().trim().toLowerCase();
    return !search || fields.some((field) => field.toLowerCase().includes(search));
  }

  /** When the plan runs out, in words; exempt plans and the free plan never do. */
  protected expiry(user: AdminUser): string {
    if (user.planExempt) return 'Never (exempt)';
    if (user.planType === 'none') return user.previousPlanType ? `${PLAN_TITLES[user.previousPlanType]} ended` : 'Ended';
    if (!user.planRenewDate) return 'Never';
    return new Date(user.planRenewDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  protected setExempt(user: AdminUser, exempt: boolean): void {
    if (!exempt && !confirm(`Remove ${user.displayName}'s exemption? Their plan runs out at its renew date again, at once if that has passed.`))
      return;
    this.run(`exempt:${user.id}`, this.api.adminSetExempt(user.id, exempt), () => this.users.reload());
  }

  protected startTrial(user: AdminUser): void {
    if (!confirm(`Give ${user.displayName} a new 30-day trial? It replaces their ${PLAN_TITLES[user.planType]} plan and unfreezes every project they own; ` +
      'projects with more than 8 members lose the most recently added.'))
      return;
    this.run(`trial:${user.id}`, this.api.adminStartTrial(user.id), () => {
      this.users.reload();
      this.projects.reload();
    });
  }

  protected deleteUser(user: AdminUser): void {
    const owned = user.projectsCreated
      ? ` Projects only they are in (up to ${user.projectsCreated}) are deleted with them.`
      : '';
    if (!confirm(`Permanently delete ${user.displayName} (@${user.userName})?${owned} This cannot be undone.`)) return;
    this.run(`delete-user:${user.id}`, this.api.adminDeleteUser(user.id), () => {
      this.users.reload();
      this.projects.reload();
    });
  }

  protected setFrozen(project: AdminProject, frozen: boolean): void {
    const action = frozen ? 'Freeze' : 'Unfreeze';
    if (!confirm(`${action} ${project.name}? This overrides ${project.ownerName}'s plan until it next changes or runs out.`)) return;
    this.run(`freeze:${project.id}`, this.api.adminSetFrozen(project.id, frozen), () => {
      this.projects.reload();
      this.shell.refreshProjects();
    });
  }

  protected join(project: AdminProject): void {
    this.run(`join:${project.id}`, this.api.adminJoinProject(project.id), () => {
      this.projects.reload();
      this.users.reload();
      this.shell.refreshProjects();
    });
  }

  protected deleteProject(project: AdminProject): void {
    if (!confirm(`Permanently delete ${project.name} and its ${project.taskCount} tasks, canvases and tracked time? This cannot be undone.`))
      return;
    this.run(`delete-project:${project.id}`, this.api.adminDeleteProject(project.id), () => {
      this.projects.reload();
      this.users.reload();
      this.shell.refreshProjects();
    });
  }

  private run(key: string, request: Observable<void>, done: () => void): void {
    this.busy.set(key);
    this.error.set('');
    request.subscribe({
      next: () => {
        this.busy.set(null);
        done();
      },
      error: (response: HttpErrorResponse) => {
        this.busy.set(null);
        this.error.set(response.error?.error ?? 'That did not work. Please try again.');
      },
    });
  }
}
