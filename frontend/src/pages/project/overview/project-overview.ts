import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, input, numberAttribute, signal, viewChild } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ProjectPage } from '../project-page';
import { ProjectHours } from './project-hours/project-hours';
import { FeelingsChart } from '../../../components/overview-charts/feelings-chart';
import { OVERVIEW_RANGES } from '../../../components/overview-charts/time-axis';
import { VelocityChart } from '../../../components/overview-charts/velocity-chart';
import { WorkReflection } from '../../../components/work-reflection/work-reflection';
import { WorkReflectionValues, OverviewRange, ProjectOverview as Overview, hoursFormat } from '../../../services/models';
import { MoneyPipe } from '../../../services/money.pipe';
import { WorkspaceApi } from '../../../services/workspace-api';

@Component({
  selector: 'app-project-overview',
  imports: [DatePipe, DecimalPipe, FeelingsChart, MoneyPipe, ProjectHours, RouterLink, VelocityChart, WorkReflection],
  templateUrl: './project-overview.html',
  styleUrl: './project-overview.css',
})
export class ProjectOverview {
  readonly projectId = input.required({ transform: numberAttribute });
  private readonly api = inject(WorkspaceApi);
  private readonly router = inject(Router);
  private readonly project = inject(ProjectPage).project;
  /** "yyyy-MM" for this month and last month (UTC, like the report). */
  protected readonly months = (() => {
    const now = new Date();
    const month = (offset: number) =>
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1)).toISOString().slice(0, 7);
    return [month(0), month(1)];
  })();
  /** Billing is for owners of billing-enabled projects only. */
  protected readonly billing = rxResource({
    params: () => {
      const project = this.project.value();
      return project?.billingEnabled && project.myRole === 'Owner' ? project.id : undefined;
    },
    stream: ({ params }) => forkJoin(this.months.map((month) => this.api.billingReport(params, month))),
  });
  /** How much each month's amount just changed, shown for a few seconds after hours change; keyed by "yyyy-MM". */
  protected readonly billingChange = signal<Record<string, number>>({});
  private lastAmounts: Record<string, number> | null = null;
  private billingChangeTimer?: ReturnType<typeof setTimeout>;
  protected readonly ranges = OVERVIEW_RANGES;
  protected readonly range = signal<OverviewRange>('30d');
  protected readonly overview = rxResource({
    params: () => ({ projectId: this.projectId(), range: this.range() }),
    stream: ({ params }) => this.api.projectOverview(params.projectId, params.range),
  });
  /** The last loaded data, kept on screen (dimmed) while a new range loads instead of flashing empty. */
  protected readonly shown = signal<Overview | null>(null);
  /** Shown when switching between working and idle failed, after the switch was undone. */
  protected readonly workError = signal('');

  protected readonly points = computed(() => this.shown()?.points ?? []);
  /** The point under the crosshair, shared by both charts. */
  protected readonly hovered = signal<number | null>(null);

  constructor() {
    effect(() => {
      const value = this.overview.value();
      if (value) this.shown.set(value);
    });
    // Compares each reload with the one before; the first load has nothing to compare with.
    effect(() => {
      const reports = this.billing.value();
      if (!reports) return;
      const amounts = Object.fromEntries(reports.map((report) => [report.month, report.amountWithVat ?? report.amount]));
      const previous = this.lastAmounts;
      this.lastAmounts = amounts;
      if (!previous) return;
      const changes = Object.fromEntries(
        Object.entries(amounts)
          .map(([month, amount]) => [month, Math.round((amount - (previous[month] ?? 0)) * 100) / 100])
          .filter(([, change]) => change !== 0),
      );
      if (!Object.keys(changes).length) return;
      this.billingChange.set(changes);
      clearTimeout(this.billingChangeTimer);
      this.billingChangeTimer = setTimeout(() => this.billingChange.set({}), 5000);
    });
  }

  protected readonly invoiceError = signal('');

  /**
   * Opens the month's invoice in a new tab: its draft, made now if there is none, or the finalized invoice when the
   * month is invoiced already.
   */
  protected openInvoice(month: string): void {
    // Opened before the request, so the browser treats it as opened by the click and does not block it.
    const tab = window.open('', '_blank');
    const open = (documentId: number) => {
      const url = this.router.serializeUrl(this.router.createUrlTree(['/projects', this.projectId(), 'documents', documentId]));
      if (tab) tab.location.href = url;
      else window.location.href = url;
    };
    this.api.createDocument(this.projectId(), { type: 'invoice', month }).subscribe({
      next: (document) => open(document.id),
      error: (error) => {
        if (error.status === 409 && error.error?.documentId) {
          open(error.error.documentId);
          return;
        }
        tab?.close();
        this.invoiceError.set(error.error?.error ?? 'Could not open the invoice.');
      },
    });
  }

  private openTab(commands: unknown[]): void {
    window.open(this.router.serializeUrl(this.router.createUrlTree(commands)), '_blank');
  }

  protected readonly hoursFormat = hoursFormat;

  protected monthStart(month: string): string {
    return `${month}-01T00:00:00Z`;
  }

  private readonly hoursTable = viewChild(ProjectHours);
  /** The "How did it go?" dialog, shown when finishing work. */
  protected readonly reflecting = signal(false);

  /** Finishing work first asks how it went; starting needs no questions, and the current state is left alone. */
  protected setWorking(working: boolean): void {
    if (working === !!this.shown()?.working) return;
    if (!working) {
      this.reflecting.set(true);
      return;
    }
    this.sendWorking(working);
  }

  /** Finishes work with the answers from the dialog, or without them when skipped. */
  protected finishWork(reflection?: WorkReflectionValues): void {
    this.sendWorking(false, reflection);
  }

  /** Hours changed in the table below: the chart and the billing totals follow. */
  protected hoursChanged(): void {
    this.overview.reload();
    this.billing.reload();
  }

  protected readonly abs = Math.abs;

  /** Switches straight away, without waiting for the server, and switches back if it refuses. */
  private sendWorking(working: boolean, reflection?: WorkReflectionValues): void {
    const before = this.shown();
    this.shown.update((shown) =>
      shown ? { ...shown, working, workingSince: working ? new Date().toISOString() : null } : shown,
    );
    this.reflecting.set(false);
    this.workError.set('');
    this.api.setWorking(this.projectId(), working, reflection).subscribe({
      next: () => {
        this.overview.reload();
        this.hoursTable()?.reload();
        this.billing.reload();
      },
      error: () => {
        this.shown.set(before);
        this.workError.set(working ? 'Could not start working. Please try again.' : 'Could not stop working. Please try again.');
      },
    });
  }
}
