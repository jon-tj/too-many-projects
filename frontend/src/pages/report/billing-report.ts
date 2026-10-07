import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, numberAttribute, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { BILL_STATUSES, BillingDay } from '../../services/models';
import { WorkspaceApi } from '../../services/workspace-api';

const optionalNumber = (value: string | undefined) => (value ? Number(value) : null);

/**
 * A month's billing as a print-friendly page (outside the workspace layout). At /report/:projectId/:month it is a
 * live preview that can be finalized; at /bill/:projectId/:billId it shows the bill as it was finalized.
 */
@Component({
  selector: 'app-billing-report',
  imports: [DatePipe, DecimalPipe],
  templateUrl: './billing-report.html',
  styleUrl: './billing-report.css',
})
export class BillingReportPage {
  readonly projectId = input.required({ transform: numberAttribute });
  /** "yyyy-MM": a preview of this month. */
  readonly month = input<string>();
  /** A finalized bill. */
  readonly billId = input(null, { transform: optionalNumber });
  private readonly api = inject(WorkspaceApi);
  private readonly router = inject(Router);
  private readonly preview = rxResource({
    params: () => (this.month() ? { projectId: this.projectId(), month: this.month()! } : undefined),
    stream: ({ params }) => this.api.billingReport(params.projectId, params.month),
  });
  protected readonly bill = rxResource({
    params: () => (this.billId() !== null ? { projectId: this.projectId(), billId: this.billId()! } : undefined),
    stream: ({ params }) => this.api.bill(params.projectId, params.billId),
  });
  protected readonly report = computed(() => this.bill.value()?.report ?? this.preview.value());
  protected readonly loading = computed(() => this.preview.isLoading() || this.bill.isLoading());
  protected readonly failed = computed(() => !!this.preview.error() || !!this.bill.error());
  protected readonly isPreview = computed(() => !this.billId());
  protected readonly statusLabel = computed(
    () => BILL_STATUSES.find((status) => status.value === this.bill.value()?.bill.status)?.label ?? '',
  );
  protected readonly message = signal('');

  protected print(): void {
    window.print();
  }

  /** Saves this preview as a bill and switches to it. */
  protected finalize(): void {
    const month = this.month();
    if (!month || !confirm('Finalize this report as a bill? It will no longer change with new hours or settings.')) return;
    this.api.finalizeBill(this.projectId(), month).subscribe({
      next: (bill) => void this.router.navigate(['/bill', this.projectId(), bill.id], { replaceUrl: true }),
      error: (error: HttpErrorResponse) => this.message.set(error.error?.error ?? 'Could not finalize the bill.'),
    });
  }

  /** Days worked before the report's month that no earlier bill covered. */
  protected carriedOver(days: BillingDay[]): BillingDay[] {
    return days.filter((day) => day.carriedOver);
  }

  protected thisMonth(days: BillingDay[]): BillingDay[] {
    return days.filter((day) => !day.carriedOver);
  }

  /** The first day of the month, for showing the month's name. */
  protected monthStart(month: string): string {
    return `${month}-01T00:00:00Z`;
  }

  /** Only the daily limits that apply: no minimum at 0, no cap at 0 or 24+. Null when neither applies. */
  protected hoursPerDay(settings: { minHoursPerDay: number; maxHoursPerDay: number }): string | null {
    const limits = [];
    if (settings.minHoursPerDay > 0) limits.push(`at least ${settings.minHoursPerDay} (on days with work)`);
    if (settings.maxHoursPerDay > 0 && settings.maxHoursPerDay < 24) limits.push(`at most ${settings.maxHoursPerDay}`);
    return limits.length ? limits.join(', ') : null;
  }
}
