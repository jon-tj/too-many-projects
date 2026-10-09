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
  perks: string[];
  featured?: boolean;
}

const PLANS: PlanOption[] = [
  {
    name: 'free',
    title: 'Free',
    price: '$0',
    limit: 2,
    perks: ['Up to 2 projects', 'Boards and tasks'],
  },
  {
    name: 'plus',
    title: 'Plus',
    price: '$3.99',
    limit: 3,
    perks: ['Up to 3 projects', 'Roadmap and critical path', 'Canvas, time tracking and billing', 'Invite your team'],
    featured: true,
  },
  {
    name: 'pro',
    title: 'Pro',
    price: '$8.99',
    limit: null,
    perks: ['Unlimited projects', 'Everything in Plus'],
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
   * Switching to a plan that allows fewer projects than you own freezes all of them, so that is confirmed first; you
   * then unfreeze the ones you want from their pages. Renewing the plan you are on keeps your projects as they are.
   */
  protected choose(option: PlanOption): void {
    const owned = this.info.value()?.ownedProjects ?? [];
    const renewing = option.name === this.info.value()?.planType;
    this.error.set('');
    if (
      !renewing &&
      option.limit !== null &&
      owned.length > option.limit &&
      !confirm(
        `${option.title} includes ${option.limit} active projects and you own ${owned.length}. ` +
          `All of them will be frozen, and you can then unfreeze up to ${option.limit} from each project's page. ` +
          `Nothing in them is deleted.`,
      )
    ) {
      return;
    }
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
