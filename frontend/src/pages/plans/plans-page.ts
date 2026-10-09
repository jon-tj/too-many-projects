import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Icon } from '../../components/icon/icon';
import { PlanPicker } from '../../components/plan-picker/plan-picker';
import { WorkspaceShell } from '../../components/workspace-shell/workspace-shell';
import { PlanName } from '../../services/models';
import { unfreezeWarning } from '../../services/unfreeze-warning';
import { WorkspaceApi } from '../../services/workspace-api';

const PLAN_TITLES: Record<PlanName, string> = {
  trial: 'Free trial',
  free: 'Free',
  plus: 'Plus',
  pro: 'Pro',
  none: 'No plan',
};

/**
 * Your plan in one place: what you are on and until when, which of your projects are active or frozen (unfreezing
 * them into free slots), and switching plan.
 */
@Component({
  selector: 'app-plans-page',
  imports: [PlanPicker, Icon],
  templateUrl: './plans-page.html',
  styleUrl: './plans-page.css',
})
export class PlansPage {
  private readonly api = inject(WorkspaceApi);
  private readonly shell = inject(WorkspaceShell);
  private readonly picker = viewChild(PlanPicker);
  protected readonly info = rxResource({ stream: () => this.api.plan() });
  protected readonly title = computed(() => {
    const plan = this.info.value()?.planType;
    return plan ? PLAN_TITLES[plan] : '';
  });
  protected readonly activeCount = computed(
    () => (this.info.value()?.ownedProjects ?? []).filter((project) => !project.frozen).length,
  );

  /** Your plan is running and has room for another active project. */
  protected readonly hasFreeSlot = computed(() => {
    const info = this.info.value();
    return !!info && !info.planLapsed && (info.projectLimit === null || this.activeCount() < info.projectLimit);
  });
  protected readonly unfreezing = signal<number | null>(null);
  protected readonly error = signal('');

  protected unfreeze(projectId: number): void {
    const info = this.info.value();
    const project = info?.ownedProjects.find((owned) => owned.id === projectId);
    const warning = project && unfreezeWarning(project.memberCount, info!.memberLimit);
    if (warning && !confirm(warning)) return;
    this.unfreezing.set(projectId);
    this.error.set('');
    this.api.unfreezeProject(projectId).subscribe({
      next: () => {
        this.unfreezing.set(null);
        this.refresh();
      },
      error: (response: HttpErrorResponse) => {
        this.unfreezing.set(null);
        this.error.set(response.error?.error ?? 'Could not unfreeze the project. Please try again.');
      },
    });
  }

  /** The plan's state in a few words: when it runs out or renews. */
  protected readonly status = computed(() => {
    const info = this.info.value();
    if (!info) return '';
    const date = info.planRenewDate
      ? new Date(info.planRenewDate).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
      : '';
    if (info.planExempt) return 'Never runs out';
    if (info.planLapsed) {
      const previous = info.previousPlanType;
      if (previous === 'trial') return 'Free trial ended';
      return previous ? `${PLAN_TITLES[previous]} plan ended` : 'Has run out';
    }
    if (info.planType === 'free') return 'Free, with no end date';
    if (info.planType === 'trial') return `Ends on ${date}`;
    return `Renews on ${date}`;
  });

  /** A new plan can freeze or unfreeze projects: shown here, in the plan cards and in the sidebar. */
  protected refresh(): void {
    this.info.reload();
    this.picker()?.reload();
    this.shell.refreshProjects();
  }
}
