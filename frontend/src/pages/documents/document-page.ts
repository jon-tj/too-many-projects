import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, input, numberAttribute, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { BillingDay, BillingReport, PAYMENT_STATUSES, PaymentStatus } from '../../services/models';
import { MoneyPipe } from '../../services/money.pipe';
import { ProjectIcon } from '../../components/project-icon/project-icon';
import { findRevolutLink } from '../../services/revolut';
import { WorkspaceApi } from '../../services/workspace-api';

const optionalNumber = (value: string | undefined) => (value ? Number(value) : null);

/**
 * One document as a print-friendly page, outside the workspace layout. At /projects/:projectId/documents/:documentId
 * the project's owners finalize drafts, share finalized documents and record payments; at /d/:token (and /shared/:token
 * from before documents) the client reads a shared document without an account. Drafts show what finalizing would
 * store now; finalized documents never change.
 */
@Component({
  selector: 'app-document-page',
  imports: [DatePipe, DecimalPipe, MoneyPipe, ProjectIcon],
  templateUrl: './document-page.html',
  styleUrl: './document-page.css',
})
export class DocumentPage {
  /** 0 on a shared link, which needs no project. */
  readonly projectId = input(0, { transform: numberAttribute });
  readonly documentId = input(null, { transform: optionalNumber });
  /** A share link's secret: shows what it shares, read only. */
  readonly token = input<string>();
  private readonly api = inject(WorkspaceApi);
  private readonly router = inject(Router);

  protected readonly loaded = rxResource({
    params: () => ({ token: this.token() ?? null, projectId: this.projectId(), documentId: this.documentId() }),
    stream: ({ params }) =>
      params.token ? this.api.sharedDocument(params.token) : this.api.document(params.projectId, params.documentId!),
  });
  protected readonly isShared = computed(() => !!this.token());
  protected readonly summary = computed(() => this.loaded.value()?.document ?? null);
  protected readonly branding = computed(() => this.loaded.value()?.branding ?? null);
  protected readonly isDraft = computed(() => this.summary()?.status === 'draft');
  /** Why a draft cannot be shown, e.g. billing was turned off since it was made. */
  protected readonly contentError = computed(() => (this.loaded.value()?.content as { error?: string } | undefined)?.error ?? null);
  /** The billing report of an invoice. */
  protected readonly report = computed(() =>
    this.summary()?.type === 'invoice' && !this.contentError() ? (this.loaded.value()!.content as BillingReport) : null,
  );
  protected readonly invoice = computed(() => this.summary()?.invoice ?? null);
  protected readonly paymentStatuses = PAYMENT_STATUSES;
  protected readonly paymentLabel = computed(
    () => PAYMENT_STATUSES.find((status) => status.value === this.invoice()?.paymentStatus)?.label ?? '',
  );
  protected readonly shareUrl = computed(() => {
    const token = this.summary()?.shareToken;
    return token ? `${location.origin}/d/${token}` : '';
  });
  protected readonly copied = signal(false);
  protected readonly message = signal('');
  protected readonly busy = signal(false);

  /**
   * Every hour worked is billed as it is (no daily minimum or cap kicked in, everyone billed in full), so the invoice
   * can leave out "billable hours" and shares, which clients rarely know.
   */
  protected readonly plainHours = computed(() => {
    const report = this.report();
    return (
      !!report &&
      report.members.every((member) => member.billableHours === member.hoursWorked) &&
      report.days.every((day) => day.billableHours === day.hoursWorked)
    );
  });
  /** A revolut.me link in the payment details, shown as a QR code the client can scan to pay. */
  protected readonly revolut = computed(() => findRevolutLink(this.report()?.settings.paymentDetails));
  /** The QR code as a PNG data URL; drawn by a library that is only loaded for invoices with a Revolut link. */
  protected readonly revolutQr = signal<string | null>(null);
  /** The site's address, written out so the link still says where to go on paper. */
  protected readonly host = location.host;
  protected readonly madeWithUrl = `${location.origin}/?utm_source=bill&utm_medium=referral&utm_campaign=made-with`;
  /** When it was issued: when it was finalized; a draft counts as issued today. */
  protected readonly issuedAt = computed(() => this.summary()?.finalizedAt ?? new Date().toISOString());
  /** The payment terms after issuing; older invoices without terms count 14 days. */
  protected readonly dueAt = computed(() => {
    const issued = new Date(this.issuedAt());
    const days = this.report()?.settings.paymentTermsDays ?? 14;
    return new Date(issued.getFullYear(), issued.getMonth(), issued.getDate() + days).toISOString();
  });

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

  protected print(): void {
    window.print();
  }

  /** Freezes the draft as it is now; it can then be shared, and never changes again. */
  protected finalize(): void {
    const summary = this.summary();
    const what = summary?.type === 'invoice' ? 'invoice' : 'document';
    if (!summary || !confirm(`Finalize this ${what}? It will no longer change with new hours or settings, and can then be shared.`)) return;
    this.run(this.api.finalizeDocument(this.projectId(), summary.id), () => this.loaded.reload(), `Could not finalize the ${what}.`);
  }

  protected deleteDraft(): void {
    const summary = this.summary();
    if (!summary || !confirm('Delete this draft?')) return;
    this.run(this.api.deleteDocument(this.projectId(), summary.id), () => this.backToList(), 'Could not delete the draft.');
  }

  /** Opens a draft revising this document; this one stays as it is, and shared, until the revision replaces it. */
  protected revise(): void {
    const summary = this.summary();
    if (!summary) return;
    this.run(
      this.api.reviseDocument(this.projectId(), summary.id),
      (draft) => void this.router.navigate(['/projects', this.projectId(), 'documents', draft.id]),
      'Could not start a revision.',
    );
  }

  protected setPayment(status: PaymentStatus, select: HTMLSelectElement): void {
    const summary = this.summary();
    const invoice = this.invoice();
    if (!summary || !invoice) return;
    let amountPaid: number | undefined;
    if (status === 'partiallyPaid') {
      const answer = prompt(`How much of ${invoice.amount.toFixed(2)} was paid?`, invoice.amountPaid ? String(invoice.amountPaid) : '');
      amountPaid = Number(answer?.replace(',', '.'));
      if (!answer || !(amountPaid > 0)) {
        select.value = invoice.paymentStatus;
        return;
      }
    }
    if (status === 'canceled' && !confirm('Cancel this invoice? Its hours can then be invoiced again on a new invoice; this one is kept, marked canceled.')) {
      select.value = invoice.paymentStatus;
      return;
    }
    this.api.setPayment(this.projectId(), summary.id, status, amountPaid).subscribe({
      next: () => {
        this.message.set('');
        this.loaded.reload();
      },
      error: (error: HttpErrorResponse) => {
        select.value = invoice.paymentStatus;
        this.message.set(error.error?.error ?? 'Could not change the payment status.');
      },
    });
  }

  /** Creates the share link (or finds the existing one). */
  protected share(): void {
    const summary = this.summary();
    if (summary) this.run(this.api.shareDocument(this.projectId(), summary.id), () => this.loaded.reload(), 'Could not create the link.');
  }

  protected unshare(): void {
    const summary = this.summary();
    if (!summary || !confirm('Turn this link off? Anyone who has it will no longer be able to open it.')) return;
    this.run(this.api.unshareDocument(this.projectId(), summary.id), () => this.loaded.reload(), 'Could not turn the link off.');
  }

  protected copyShareUrl(): void {
    void navigator.clipboard.writeText(this.shareUrl()).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    });
  }

  protected backToList(): void {
    void this.router.navigate(['/projects', this.projectId(), 'documents']);
  }

  private run<T>(request: import('rxjs').Observable<T>, done: (value: T) => void, failure: string): void {
    this.busy.set(true);
    this.message.set('');
    request.subscribe({
      next: (value) => {
        this.busy.set(false);
        done(value);
      },
      error: (error: HttpErrorResponse) => {
        this.busy.set(false);
        this.message.set(error.error?.error ?? failure);
      },
    });
  }

  /** Days worked before the invoice's month that no earlier invoice covered. */
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
