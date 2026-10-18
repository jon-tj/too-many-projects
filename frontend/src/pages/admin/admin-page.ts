import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { Avatar } from '../../components/avatar/avatar';
import { Icon } from '../../components/icon/icon';
import { ProjectIcon } from '../../components/project-icon/project-icon';
import { Stars } from '../../components/stars/stars';
import { WorkspaceShell } from '../../components/workspace-shell/workspace-shell';
import {
  AdminFeatureRequest,
  AdminProject,
  AdminReview,
  AdminUser,
  FeatureRequestStatus,
  PLAN_TITLES,
} from '../../services/models';
import { MoneyPipe } from '../../services/money.pipe';
import { WorkspaceApi } from '../../services/workspace-api';

type Tab = 'members' | 'projects' | 'reviews' | 'requests' | 'campaigns';

const REQUEST_STATUSES: { value: FeatureRequestStatus; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'planned', label: 'Planned' },
  { value: 'done', label: 'Done' },
  { value: 'declined', label: 'Declined' },
];

/**
 * Every member and project in the database, for the admin: plans and activity per member, and overriding what the
 * plans decide (freezing projects, exemptions, new trials), deleting either, or joining a project.
 */
@Component({
  selector: 'app-admin-page',
  imports: [Avatar, Icon, ProjectIcon, Stars, DatePipe, DecimalPipe, MoneyPipe, RouterLink],
  templateUrl: './admin-page.html',
  styleUrl: './admin-page.css',
})
export class AdminPage {
  private readonly api = inject(WorkspaceApi);
  private readonly shell = inject(WorkspaceShell);
  protected readonly planTitles = PLAN_TITLES;
  protected readonly stats = rxResource({ stream: () => this.api.adminStats() });
  protected readonly users = rxResource({ stream: () => this.api.adminUsers() });
  protected readonly projects = rxResource({ stream: () => this.api.adminProjects() });
  protected readonly reviews = rxResource({ stream: () => this.api.adminReviews() });
  protected readonly requests = rxResource({ stream: () => this.api.adminFeatureRequests() });
  protected readonly campaigns = rxResource({ stream: () => this.api.adminCampaigns() });
  protected readonly shownCampaigns = computed(() =>
    (this.campaigns.value() ?? []).filter((row) => this.matches(row.source, row.campaign)),
  );
  protected readonly REQUEST_STATUSES = REQUEST_STATUSES;
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
  protected readonly shownReviews = computed(() =>
    (this.reviews.value() ?? []).filter((review) =>
      this.matches(review.displayName, review.userName, review.body, review.projectName ?? ''),
    ),
  );
  protected readonly shownRequests = computed(() =>
    (this.requests.value() ?? []).filter((request) =>
      this.matches(request.title, request.description, request.displayName, request.userName, request.status),
    ),
  );
  /** Requests nobody has looked at yet, shown on the tab. */
  protected readonly newRequestCount = computed(
    () => (this.requests.value() ?? []).filter((request) => request.status === 'new').length,
  );
  protected readonly featuredCount = computed(
    () => (this.reviews.value() ?? []).filter((review) => review.featured).length,
  );
  protected readonly frozenCount = computed(
    () => (this.projects.value() ?? []).filter((project) => project.frozen).length,
  );
  /**
   * The average paid spell, readable at a glance: in months from a month on, else in whole days rounded up, since a
   * plan is paid for at least a day. Null before anyone has paid.
   */
  protected readonly averagePaid = computed(() => {
    const days = this.stats.value()?.averagePaidDays;
    if (days == null) return null;
    if (days >= 30.4) return { value: (days / 30.4).toFixed(1), unit: 'months' };
    const whole = Math.max(1, Math.ceil(days));
    return { value: String(whole), unit: whole === 1 ? 'day' : 'days' };
  });

  private matches(...fields: string[]): boolean {
    const search = this.search().trim().toLowerCase();
    return !search || fields.some((field) => field.toLowerCase().includes(search));
  }

  /** How long ago the user last opened the app, in words. */
  protected lastSeen(user: AdminUser): string {
    if (!user.lastSeenAt) return 'Never';
    const minutes = (Date.now() - new Date(user.lastSeenAt).getTime()) / 60_000;
    if (minutes < 60) return 'Within the hour';
    if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`;
    const days = Math.floor(minutes / (24 * 60));
    if (days < 30) return days === 1 ? 'Yesterday' : `${days} days ago`;
    return new Date(user.lastSeenAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
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
      this.stats.reload();
      this.reviews.reload();
      this.requests.reload();
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

  protected setFeatured(review: AdminReview, featured: boolean): void {
    this.run(`feature:${review.id}`, this.api.adminSetFeatured(review.id, featured), () => this.reviews.reload());
  }

  protected deleteReview(review: AdminReview): void {
    if (!confirm(`Delete ${review.displayName}'s review? This cannot be undone.`)) return;
    this.run(`delete-review:${review.id}`, this.api.adminDeleteReview(review.id), () => this.reviews.reload());
  }

  protected setRequestStatus(request: AdminFeatureRequest, status: FeatureRequestStatus): void {
    this.run(`request-status:${request.id}`, this.api.adminSetFeatureRequestStatus(request.id, status), () =>
      this.requests.reload(),
    );
  }

  protected deleteRequest(request: AdminFeatureRequest): void {
    if (!confirm(`Delete the request "${request.title}"? This cannot be undone.`)) return;
    this.run(`delete-request:${request.id}`, this.api.adminDeleteFeatureRequest(request.id), () => this.requests.reload());
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
