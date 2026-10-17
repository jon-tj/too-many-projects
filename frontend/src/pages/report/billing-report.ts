import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, input, numberAttribute, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { BILL_STATUSES, BillingDay } from '../../services/models';
import { MoneyPipe } from '../../services/money.pipe';
import { findRevolutLink } from '../../services/revolut';
import { WorkspaceApi } from '../../services/workspace-api';

const optionalNumber = (value: string | undefined) => (value ? Number(value) : null);

/**
 * A month's billing as a print-friendly page (outside the workspace layout). At /report/:projectId/:month it is a
 * live preview that can be finalized; at /bill/:projectId/:billId it shows the bill as it was finalized. Both can be
 * shared with the client by secret link, which opens at /shared/:token without an account.
 */
@Component({
  selector: 'app-billing-report',
  imports: [DatePipe, DecimalPipe, MoneyPipe],
  templateUrl: './billing-report.html',
  styleUrl: './billing-report.css',
})
export class BillingReportPage {
  /** 0 on a shared link, which needs no project. */
  readonly projectId = input(0, { transform: numberAttribute });
  /** A share link's secret: shows what it shares, read only. */
  readonly token = input<string>();
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
  private readonly shared = rxResource({
    params: () => this.token(),
    stream: ({ params }) => this.api.sharedBilling(params),
  });
  /** Opened by the client through a share link: read only. */
  protected readonly isShared = computed(() => !!this.token());
  protected readonly report = computed(
    () => this.shared.value()?.report ?? this.bill.value()?.report ?? this.preview.value(),
  );
  /** The bill shown; null for a live report. */
  protected readonly billSummary = computed(() => (this.isShared() ? this.shared.value()?.bill : this.bill.value()?.bill) ?? null);
  protected readonly loading = computed(() => this.preview.isLoading() || this.bill.isLoading() || this.shared.isLoading());
  protected readonly failed = computed(() => !!this.preview.error() || !!this.bill.error() || !!this.shared.error());
  protected readonly isPreview = computed(() => !this.billSummary());
  protected readonly statusLabel = computed(
    () => BILL_STATUSES.find((status) => status.value === this.billSummary()?.status)?.label ?? '',
  );

  /** The owner's share links for this project, to find the one for what is shown. */
  private readonly shareLinks = rxResource({
    params: () => (this.isShared() ? undefined : this.projectId()),
    stream: ({ params }) => this.api.shareLinks(params),
  });
  protected readonly shareLink = computed(() => {
    const billId = this.billId();
    return (
      this.shareLinks.value()?.find((link) => (billId !== null ? link.billId === billId : link.month === this.month())) ??
      null
    );
  });
  protected readonly shareUrl = computed(() => {
    const link = this.shareLink();
    return link ? `${location.origin}/shared/${link.token}` : '';
  });
  protected readonly copied = signal(false);
  /** A revolut.me link in the payment details, shown as a QR code the client can scan to pay. */
  protected readonly revolut = computed(() => findRevolutLink(this.report()?.settings.paymentDetails));
  /** The QR code as a PNG data URL; drawn by a library that is only loaded for bills with a Revolut link. */
  protected readonly revolutQr = signal<string | null>(null);

  constructor() {
    effect(() => {
      const link = this.revolut();
      this.revolutQr.set(null);
      if (!link) return;
      void import('qrcode')
        // An old-style (CommonJS) package: its functions sit on the default export.
        .then(({ default: qr }) => qr.toDataURL(link.url, { width: 360, margin: 1, color: { dark: '#1f2722', light: '#ffffff' } }))
        .then((image) => {
          if (this.revolut()?.url === link.url) this.revolutQr.set(image);
        });
    });
  }
  protected readonly message = signal('');
  /** The site's address, written out so the link still says where to go on paper. */
  protected readonly host = location.host;
  protected readonly madeWithUrl = `${location.origin}/?utm_source=bill&utm_medium=referral&utm_campaign=made-with`;
  /** When the bill was issued; a preview counts as issued today. */
  protected readonly issuedAt = computed(() => this.billSummary()?.createdAt ?? new Date().toISOString());
  /** The payment terms after issuing; older bills without terms count 14 days. */
  protected readonly dueAt = computed(() => {
    const issued = new Date(this.issuedAt());
    const days = this.report()?.settings.paymentTermsDays ?? 14;
    return new Date(issued.getFullYear(), issued.getMonth(), issued.getDate() + days).toISOString();
  });

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

  /** Creates the share link for what is shown (or finds the existing one). */
  protected share(): void {
    const billId = this.billId();
    const target = billId !== null ? { billId } : { month: this.month()! };
    this.api.share(this.projectId(), target).subscribe({
      next: () => this.shareLinks.reload(),
      error: (error: HttpErrorResponse) => this.message.set(error.error?.error ?? 'Could not create the link.'),
    });
  }

  protected unshare(): void {
    const link = this.shareLink();
    if (!link || !confirm('Turn this link off? Anyone who has it will no longer be able to open it.')) return;
    this.api.unshare(this.projectId(), link.token).subscribe({
      next: () => this.shareLinks.reload(),
      error: () => this.message.set('Could not turn the link off.'),
    });
  }

  protected copyShareUrl(): void {
    void navigator.clipboard.writeText(this.shareUrl()).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
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
