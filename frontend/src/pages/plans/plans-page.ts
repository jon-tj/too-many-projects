import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { rxResource } from '@angular/core/rxjs-interop';
import { Icon } from '../../components/icon/icon';
import { PlanPicker } from '../../components/plan-picker/plan-picker';
import { WorkspaceShell } from '../../components/workspace-shell/workspace-shell';
import { PLAN_TITLES } from '../../services/models';
import { PLAN_OPTIONS, perPersonPrice } from '../../services/plans';
import { unfreezeWarning } from '../../services/unfreeze-warning';
import { WorkspaceApi } from '../../services/workspace-api';

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
export class PlansPage implements OnInit {
  private readonly api = inject(WorkspaceApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly shell = inject(WorkspaceShell);
  private readonly picker = viewChild(PlanPicker);
  protected readonly info = rxResource({ stream: () => this.api.plan() });
  private readonly prices = rxResource({ stream: () => this.api.planPrices() });
  /** The team the note works the cost out for, as on the landing page: Plus split between five people. */
  protected readonly TEAM_SIZE = 5;
  protected readonly teamShare = computed(() =>
    perPersonPrice(
      PLAN_OPTIONS.find((option) => option.name === 'plus')!,
      this.prices.error() ? [] : this.prices.value(),
      this.TEAM_SIZE,
    ),
  );
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
  /** What happened at Stripe Checkout, shown after coming back from it. */
  protected readonly checkoutMessage = signal('');
  protected readonly openingPortal = signal(false);

  /**
   * Coming back from Stripe Checkout, the URL has ?checkout= with the session id (paid) or "cancelled". A paid session
   * is applied at once, then the parameter is dropped so reloading does not repeat it.
   */
  ngOnInit(): void {
    const checkout = this.route.snapshot.queryParamMap.get('checkout');
    if (!checkout) return;
    void this.router.navigate([], { queryParams: { checkout: null }, queryParamsHandling: 'merge', replaceUrl: true });
    if (checkout === 'cancelled') {
      this.checkoutMessage.set('Checkout was cancelled, so nothing was charged and your plan is unchanged.');
      return;
    }
    this.checkoutMessage.set('Payment received. Updating your plan…');
    this.api.confirmCheckout(checkout).subscribe({
      next: () => {
        this.checkoutMessage.set('Payment received. Thank you, your new plan is active.');
        this.refresh();
      },
      error: () => {
        this.checkoutMessage.set('Payment received. Your plan updates in a moment; reload the page if it has not.');
      },
    });
  }

  /** Opens Stripe's billing portal, for the payment method, invoices and cancelling. */
  protected openBillingPortal(): void {
    this.openingPortal.set(true);
    this.error.set('');
    this.api.billingPortal().subscribe({
      next: ({ url }) => (window.location.href = url),
      error: (response: HttpErrorResponse) => {
        this.openingPortal.set(false);
        this.error.set(response.error?.error ?? 'Could not open billing. Please try again.');
      },
    });
  }
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
    if (info.cancelsAtRenewal) return `Ends on ${date}, then moves to Free`;
    return `Renews on ${date}`;
  });

  /** A new plan can freeze or unfreeze projects: shown here, in the plan cards and in the sidebar. */
  protected refresh(): void {
    this.info.reload();
    this.picker()?.reload();
    this.shell.refreshProjects();
  }
}
