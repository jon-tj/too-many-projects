import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, input, linkedSignal, numberAttribute, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import {
  BillingDay,
  BillingReport,
  PAYMENT_STATUSES,
  PaymentStatus,
  ROUNDING_OPTIONS,
  billableHoursFormat,
  ProgressReportContent,
  ProgressReportInput,
} from '../../services/models';
import { MoneyPipe } from '../../services/money.pipe';
import { ProjectIcon } from '../../components/project-icon/project-icon';
import { PaymentLink, findPaymentLinks } from '../../services/payment-links';
import { WorkspaceApi } from '../../services/workspace-api';

const optionalNumber = (value: string | undefined) => (value ? Number(value) : null);

/** The pace chart's drawing area, in SVG units; it scales to the sheet's width. */
const PACE_WIDTH = 640;
const PACE_HEIGHT = 140;

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
  /** A progress report's figures and text. */
  protected readonly progress = computed(() =>
    this.summary()?.type === 'progressReport' ? (this.loaded.value()!.content as ProgressReportContent) : null,
  );
  /** The draft's title and text being edited; reset from what was saved whenever it loads. */
  protected readonly draftTitle = linkedSignal(() => this.summary()?.title ?? '');
  protected readonly draftInput = linkedSignal<ProgressReportInput | null>(() => {
    const progress = this.progress();
    return progress ? { ...progress.input } : null;
  });
  protected readonly draftChanged = computed(() => {
    const input = this.draftInput();
    const saved = this.progress()?.input;
    return (
      this.draftTitle() !== this.summary()?.title ||
      (!!input && !!saved && (Object.keys(input) as (keyof ProgressReportInput)[]).some((key) => input[key] !== saved[key]))
    );
  });
  /** Both measures of the pace on one plot, each scaled to its own total, as in the project's overview chart. */
  protected readonly paceChart = computed(() => {
    const points = this.progress()?.pace ?? [];
    if (!points.length) return null;
    const x = (index: number) => (points.length < 2 ? PACE_WIDTH : (index / (points.length - 1)) * PACE_WIDTH);
    const line = (values: number[]) => {
      const total = values.at(-1) || 0;
      const y = (value: number) => PACE_HEIGHT - (total > 0 ? value / total : 0) * (PACE_HEIGHT - 8);
      return values.map((value, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
    };
    return {
      width: PACE_WIDTH,
      height: PACE_HEIGHT,
      tasks: line(points.map((point) => point.tasksCompleted)),
      hours: line(points.map((point) => point.hours)),
      first: points[0].date,
      last: points.at(-1)!.date,
    };
  });
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
  /** Billable hours are written with as many decimals as the rounding step needs. */
  protected readonly hoursFormat = computed(() => billableHoursFormat(this.report()?.settings.roundingMinutes));
  /** The rounding step, e.g. "15 minutes"; null without rounding. */
  protected readonly rounding = computed(() => {
    const minutes = this.report()?.settings.roundingMinutes;
    return minutes ? (ROUNDING_OPTIONS.find((option) => option.value === minutes)?.label ?? `${minutes} minutes`) : null;
  });
  /** revolut.me and paypal.me links in the payment details, each shown as a QR code the client can scan to pay. */
  protected readonly paymentLinks = computed(() => findPaymentLinks(this.report()?.settings.paymentDetails));
  /**
   * The QR codes as PNG data URLs, by link; drawn by a library that is only loaded for invoices with a payment link.
   */
  protected readonly paymentQrs = signal<Record<string, string>>({});
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
      const links = this.paymentLinks();
      this.paymentQrs.set({});
      if (!links.length) return;
      void import('qrcode').then(({ default: qr }) =>
        // An old-style (CommonJS) package: its functions sit on the default export.
        Promise.all(
          links.map((link: PaymentLink) =>
            qr.toDataURL(link.url, { width: 360, margin: 1, color: { dark: '#1f2722', light: '#ffffff' } }).then(
              (image) => [link.url, image] as const,
            ),
          ),
        ).then((images) => {
          if (this.paymentLinks() === links) this.paymentQrs.set(Object.fromEntries(images));
        }),
      );
    });
  }

  protected print(): void {
    window.print();
  }

  /** Freezes the draft as it is now; it can then be shared, and never changes again. */
  protected finalize(): void {
    if (this.draftChanged()) {
      this.message.set('Save your changes to the draft first.');
      return;
    }
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
      (draft) => this.openDocument(draft.id),
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

  protected editInput<K extends keyof ProgressReportInput>(key: K, value: ProgressReportInput[K]): void {
    this.draftInput.update((input) => (input ? { ...input, [key]: value } : input));
  }

  /** Saves the draft's title and text; the figures are worked out again for the period. */
  protected saveDraft(): void {
    const summary = this.summary();
    const input = this.draftInput();
    if (!summary || !this.draftTitle().trim()) return;
    if (input && input.to < input.from) {
      this.message.set('The period must end on or after its first day.');
      return;
    }
    this.run(
      this.api.updateDocument(this.projectId(), summary.id, { title: this.draftTitle().trim(), progressReport: input ?? undefined }),
      () => this.loaded.reload(),
      'Could not save the draft.',
    );
  }

  /** A date-only "yyyy-MM-dd" as a moment the date pipe shows as that same day. */
  protected day(date: string): string {
    return `${date}T00:00:00Z`;
  }

  protected openDocument(documentId: number): void {
    void this.router.navigate(['/projects', this.projectId(), 'documents', documentId]);
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
