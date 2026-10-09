import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, output, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { ChoosablePlan } from '../../services/models';
import { WorkspaceApi } from '../../services/workspace-api';
import { Icon } from '../icon/icon';


interface PlanOption {
  name: ChoosablePlan;
  title: string;
  price: string;
  /** Active projects allowed; null for no limit. Matches the backend's Plans.Plan. */
  limit: number | null;
  /** Members per project, the owner included; null means no limit. Matches the backend's Plans.Plan. */
  memberLimit: number | null;
  perks: string[];
  featured?: boolean;
}

const PLANS: PlanOption[] = [
  {
    name: 'free',
    title: 'Free',
    price: '$0',
    limit: 2,
    memberLimit: 1,
    perks: ['Up to 2 projects', 'Boards and tasks', 'Just you, no team members'],
  },
  {
    name: 'plus',
    title: 'Plus',
    price: '$3.99',
    limit: 3,
    memberLimit: 8,
    perks: ['Up to 3 projects', 'Up to 8 members per project', 'Roadmap and critical path', 'Canvas, time tracking and billing'],
    featured: true,
  },
  {
    name: 'pro',
    title: 'Pro',
    price: '$8.99',
    limit: null,
    memberLimit: null,
    perks: ['Unlimited projects', 'Unlimited members', 'Everything in Plus'],
  },
];

/**
 * The three plans side by side. Choosing one that allows fewer projects than you own freezes all of them (after
 * confirming); Pro unfreezes everything. Emits `changed` after switching. Payment is not wired up yet (Stripe later).
 */
@Component({
  selector: 'app-plan-picker',
  imports: [Icon],
  templateUrl: './plan-picker.html',
  styleUrl: './plan-picker.css',
})
export class PlanPicker {
  readonly changed = output<void>();
  private readonly api = inject(WorkspaceApi);
  protected readonly info = rxResource({ stream: () => this.api.plan() });
  protected readonly PLANS = PLANS;
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  /**
   * The plan you are on, if it is one you can choose and it is still running. A lapsed plan is not current, so
   * choosing it again renews it.
   */
  protected readonly current = computed(() => {
    const info = this.info.value();
    return info && info.planType !== 'trial' && !info.planLapsed ? info.planType : null;
  });

  /** While you have no plan, the one you had before it ran out, to offer it again. */
  protected readonly previousPlan = computed(() => {
    const info = this.info.value();
    return info?.planLapsed ? info.previousPlanType : null;
  });

  /** Loads the plan again, e.g. after the page around the picker changed something. */
  reload(): void {
    this.info.reload();
  }

  /**
   * Switching to a plan that allows fewer projects than you own freezes all of them, and one that allows fewer members
   * removes the most recently added (free keeps only you), so both are confirmed first. You then unfreeze the projects
   * you want from their pages. Renewing the plan you are on keeps everything as it is.
   */
  protected choose(option: PlanOption): void {
    const owned = this.info.value()?.ownedProjects ?? [];
    const renewing = option.name === this.info.value()?.planType;
    this.error.set('');
    // What switching would take away, confirmed before anything changes.
    const warnings: string[] = [];
    const freezesAll = !renewing && option.limit !== null && owned.length > option.limit;
    if (freezesAll) {
      warnings.push(
        `${option.title} includes ${option.limit} active projects and you own ${owned.length}. ` +
          `All of them will be frozen, and you can then unfreeze up to ${option.limit} from each project's page. ` +
          `Nothing in them is deleted.`,
      );
    }
    // Only projects that stay active are trimmed now; frozen ones keep their members until they are unfrozen.
    const memberLimit = option.memberLimit;
    const overLimit = (project: { memberCount: number }) =>
      memberLimit === null ? 0 : Math.max(0, project.memberCount - memberLimit);
    const removed = renewing || freezesAll ? 0 : owned.reduce((sum, project) => sum + overLimit(project), 0);
    if (freezesAll && owned.some((project) => overLimit(project) > 0)) {
      warnings.push(
        memberLimit === 1
          ? `Frozen projects keep their members, but when you unfreeze one on ${option.title}, everyone but you is removed from it.`
          : `Frozen projects keep their members, but when you unfreeze one, the most recently added members beyond ` +
              `${memberLimit} are removed from it.`,
      );
    }
    if (removed > 0) {
      warnings.push(
        memberLimit === 1
          ? `${option.title} has no team members, so ${removed} ${removed === 1 ? 'person' : 'people'} will be ` +
              `removed from your projects. Only you stay.`
          : `${option.title} allows ${memberLimit} members per project, so the ${removed} most recently added ` +
              `${removed === 1 ? 'member' : 'members'} will be removed from your projects.`,
      );
    }
    if (warnings.length && !confirm(warnings.join('\n\n'))) return;
    this.busy.set(true);
    this.api.choosePlan(option.name).subscribe({
      next: () => {
        this.busy.set(false);
        this.info.reload();
        this.changed.emit();
      },
      error: (response: HttpErrorResponse) => {
        this.busy.set(false);
        this.error.set(response.error?.error ?? 'Could not change your plan. Please try again.');
      },
    });
  }
}
