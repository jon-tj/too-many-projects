import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { Icon } from '../../components/icon/icon';
import { DOCUMENT_TYPES, DocumentSummary, DocumentType, PAYMENT_STATUSES } from '../../services/models';
import { MoneyPipe } from '../../services/money.pipe';
import { WorkspaceApi } from '../../services/workspace-api';
import { ProjectPage } from '../project/project-page';

/** "yyyy-MM" of the month before this one, the usual month to invoice. */
function lastMonth(): string {
  const now = new Date();
  const month = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
}

/** The project's documents for its client, newest first, and starting new ones. For the project's owners. */
@Component({
  selector: 'app-document-list',
  imports: [DatePipe, Icon, MoneyPipe, RouterLink],
  templateUrl: './document-list.html',
  styleUrl: './document-list.css',
})
export class DocumentList {
  private readonly api = inject(WorkspaceApi);
  private readonly router = inject(Router);
  protected readonly project = inject(ProjectPage).project;
  protected readonly isOwner = computed(() => this.project.value()?.myRole === 'Owner');
  protected readonly documents = rxResource({
    params: () => (this.isOwner() ? this.project.value()!.id : undefined),
    stream: ({ params }) => this.api.documents(params),
    defaultValue: [],
  });
  /** The billing settings, for the invoices' currency. */
  private readonly billing = rxResource({
    params: () => (this.isOwner() && this.project.value()?.billingEnabled ? this.project.value()!.id : undefined),
    stream: ({ params }) => this.api.billing(params),
  });
  protected readonly currency = computed(() => this.billing.value()?.currency || 'USD');
  protected readonly types = DOCUMENT_TYPES;
  protected readonly newType = signal<DocumentType>('invoice');
  protected readonly newMonth = signal(lastMonth());
  protected readonly message = signal('');
  protected readonly busy = signal(false);

  protected typeLabel(type: DocumentType): string {
    return DOCUMENT_TYPES.find((option) => option.value === type)?.label ?? type;
  }

  protected typeIcon(type: DocumentType): string {
    return DOCUMENT_TYPES.find((option) => option.value === type)?.icon ?? 'description';
  }

  protected paymentLabel(document: DocumentSummary): string {
    return PAYMENT_STATUSES.find((status) => status.value === document.invoice?.paymentStatus)?.label ?? '';
  }

  /** Starts the chosen document as a draft and opens it; an invoice draft that exists for the month is opened instead. */
  protected create(): void {
    const projectId = this.project.value()?.id;
    if (!projectId) return;
    this.busy.set(true);
    this.message.set('');
    const type = this.newType();
    this.api.createDocument(projectId, { type, month: type === 'invoice' ? this.newMonth() : undefined }).subscribe({
      next: (document) => void this.router.navigate(['/projects', projectId, 'documents', document.id]),
      error: (error: HttpErrorResponse) => {
        this.busy.set(false);
        // The month is invoiced already: open that invoice.
        if (error.status === 409 && error.error?.documentId) {
          void this.router.navigate(['/projects', projectId, 'documents', error.error.documentId]);
          return;
        }
        this.message.set(error.error?.error ?? 'Could not start the document.');
      },
    });
  }
}
