import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, inject, input, numberAttribute } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { WorkspaceApi } from '../../services/workspace-api';

/** A month's billing as a print-friendly page (outside the workspace layout); print or save it as PDF. */
@Component({
  selector: 'app-billing-report',
  imports: [DatePipe, DecimalPipe],
  templateUrl: './billing-report.html',
  styleUrl: './billing-report.css',
})
export class BillingReportPage {
  readonly projectId = input.required({ transform: numberAttribute });
  /** "yyyy-MM" */
  readonly month = input.required<string>();
  private readonly api = inject(WorkspaceApi);
  protected readonly report = rxResource({
    params: () => ({ projectId: this.projectId(), month: this.month() }),
    stream: ({ params }) => this.api.billingReport(params.projectId, params.month),
  });

  protected print(): void {
    window.print();
  }

  /** Only the daily limits that apply: no minimum at 0, no cap at 0 or 24+. Null when neither applies. */
  protected hoursPerDay(settings: { minHoursPerDay: number; maxHoursPerDay: number }): string | null {
    const limits = [];
    if (settings.minHoursPerDay > 0) limits.push(`at least ${settings.minHoursPerDay} (on days with work)`);
    if (settings.maxHoursPerDay > 0 && settings.maxHoursPerDay < 24) limits.push(`at most ${settings.maxHoursPerDay}`);
    return limits.length ? limits.join(', ') : null;
  }

  /** The first day of the month, for showing the month's name. */
  protected monthStart(month: string): string {
    return `${month}-01T00:00:00Z`;
  }
}
