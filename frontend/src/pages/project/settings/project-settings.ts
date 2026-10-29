import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { FormArray, FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Icon } from '../../../components/icon/icon';
import { ProjectIcon } from '../../../components/project-icon/project-icon';
import { WorkspaceShell } from '../../../components/workspace-shell/workspace-shell';
import { ProjectPage } from '../project-page';
import { BILLING_CURRENCIES, BillingSplitShare, ROUNDING_OPTIONS } from '../../../services/models';
import { findPaymentLinks } from '../../../services/payment-links';
import { squareImageDataUrl } from '../../../services/square-image';
import { WorkspaceApi } from '../../../services/workspace-api';

const PROJECT_ICONS = [
  'view_kanban', 'rocket_launch', 'code', 'bug_report', 'build', 'science',
  'palette', 'brush', 'photo_camera', 'movie', 'music_note', 'campaign',
  'storefront', 'savings', 'work', 'school', 'groups', 'favorite',
  'lightbulb', 'eco', 'pets', 'home', 'flight', 'sports_esports',
];

@Component({
  selector: 'app-project-settings',
  imports: [ReactiveFormsModule, Icon, ProjectIcon],
  templateUrl: './project-settings.html',
  styleUrl: './project-settings.css',
})
export class ProjectSettings {
  private readonly api = inject(WorkspaceApi);
  private readonly router = inject(Router);
  private readonly shell = inject(WorkspaceShell);
  protected readonly project = inject(ProjectPage).project;
  protected readonly isOwner = computed(() => this.project.value()?.myRole === 'Owner');
  /** Billing is not in the free plan. */
  protected readonly canBill = computed(() => this.isOwner() && !!this.project.value()?.fullFeatures);
  /** Billing settings are owner-only, so they are only loaded for owners. */
  private readonly billing = rxResource({
    params: () => (this.canBill() ? this.project.value()!.id : undefined),
    stream: ({ params }) => this.api.billing(params),
  });
  protected readonly billingMessage = signal('');
  protected readonly billingForm = inject(FormBuilder).nonNullable.group({
    enabled: [false],
    clientName: ['', Validators.maxLength(200)],
    costPerHour: [0, [Validators.required, Validators.min(0)]],
    minHoursPerDay: [0, [Validators.required, Validators.min(0), Validators.max(24)]],
    /** 0 or 24+ means no cap. */
    maxHoursPerDay: [8, [Validators.required, Validators.min(0)]],
    roundingMinutes: [0],
    timeZone: ['', Validators.maxLength(64)],
    currency: ['USD', Validators.required],
    vatRate: [0, [Validators.required, Validators.min(0), Validators.max(100)]],
    paymentDetails: ['', Validators.maxLength(500)],
    paymentTermsDays: [14, [Validators.required, Validators.min(0), Validators.max(365)]],
    /** Payers and their shares; empty when one client pays it all. */
    split: new FormArray<FormGroup<{ name: FormControl<string>; percent: FormControl<number> }>>([]),
  });
  /** Who documents are from, printed on each when it is finalized; owner-only, like billing. */
  private readonly branding = rxResource({
    params: () => (this.canBill() ? this.project.value()!.id : undefined),
    stream: ({ params }) => this.api.branding(params),
  });
  protected readonly brandingForm = inject(FormBuilder).nonNullable.group({
    senderName: ['', Validators.maxLength(200)],
    senderAddress: ['', Validators.maxLength(500)],
    orgNumber: ['', Validators.maxLength(64)],
    /** "#rrggbb"; empty uses the default green. */
    color: [''],
  });
  protected readonly brandingValues = toSignal(
    this.brandingForm.valueChanges.pipe(map(() => this.brandingForm.getRawValue())),
    { initialValue: this.brandingForm.getRawValue() },
  );
  protected readonly brandingMessage = signal('');
  /** The documents' accent when no colour is chosen. */
  protected readonly defaultBrandColor = '#334931';
  /** The offered currencies, plus the project's own if it is not among them. */
  protected readonly currencies = computed(() => {
    const current = this.billing.value()?.currency;
    return current && !BILLING_CURRENCIES.includes(current) ? [current, ...BILLING_CURRENCIES] : BILLING_CURRENCIES;
  });
  /** Your browser's time zone, offered for billing. */
  protected readonly browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  /** Every time zone the browser knows, for picking another. */
  protected readonly timeZones: string[] = Intl.supportedValuesOf?.('timeZone') ?? [];
  protected readonly icons = PROJECT_ICONS;
  protected readonly roundingOptions = ROUNDING_OPTIONS;
  protected readonly busy = signal(false);
  protected readonly message = signal('');
  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    description: ['', Validators.maxLength(1000)],
    gitHubUrl: ['', [Validators.maxLength(300), Validators.pattern(/^\s*https:\/\/github\.com\/\S*\s*$/)]],
    websiteUrl: ['', [Validators.maxLength(300), Validators.pattern(/^\s*https?:\/\/\S+\s*$/)]],
    icon: [null as string | null],
    iconImage: [null as string | null],
  });

  /**
   * The forms' values as signals, for the template. Reading control values directly would not update the page when
   * the forms are reset from loaded data, because only signals and events trigger change detection.
   */
  protected readonly values = toSignal(this.form.valueChanges.pipe(map(() => this.form.getRawValue())), {
    initialValue: this.form.getRawValue(),
  });
  protected readonly billingEnabled = toSignal(this.billingForm.controls.enabled.valueChanges, { initialValue: false });
  /** revolut.me and paypal.me links in the payment details, which invoices turn into QR codes. */
  protected readonly paymentLinks = toSignal(
    this.billingForm.controls.paymentDetails.valueChanges.pipe(map((details) => findPaymentLinks(details))),
    { initialValue: [] },
  );

  /** The payers as a signal, for the template: whether splitting is on, and what the shares add up to. */
  protected readonly splitRows = toSignal(
    this.billingForm.controls.split.valueChanges.pipe(map(() => this.billingForm.controls.split.getRawValue())),
    { initialValue: [] as BillingSplitShare[] },
  );
  protected readonly splitTotal = computed(() =>
    Math.round(this.splitRows().reduce((sum, share) => sum + (Number(share.percent) || 0), 0) * 100) / 100,
  );
  /** Splitting is on but cannot be saved: the shares must add up to 100% and every payer needs a name. */
  protected readonly splitInvalid = computed(
    () => this.splitRows().length > 0 && (this.splitTotal() !== 100 || this.splitRows().some((share) => !share.name.trim())),
  );

  private splitRow(share: BillingSplitShare): FormGroup<{ name: FormControl<string>; percent: FormControl<number> }> {
    return new FormGroup({
      name: new FormControl(share.name, { nonNullable: true, validators: [Validators.required, Validators.maxLength(200)] }),
      percent: new FormControl(share.percent, { nonNullable: true, validators: [Validators.required, Validators.min(0.01), Validators.max(100)] }),
    });
  }

  /** The form's payer rows, rebuilt to match the shares (a form reset does not add or remove rows). */
  private setSplit(shares: BillingSplitShare[]): void {
    const rows = this.billingForm.controls.split;
    rows.clear({ emitEvent: false });
    for (const share of shares) rows.push(this.splitRow(share), { emitEvent: false });
    rows.updateValueAndValidity();
  }

  /** Turning splitting on starts with two payers at 50% each, the first being the client. */
  protected toggleSplit(on: boolean): void {
    this.setSplit(on ? [{ name: this.billingForm.controls.clientName.value, percent: 50 }, { name: '', percent: 50 }] : []);
    this.billingForm.markAsDirty();
  }

  protected addPayer(): void {
    this.billingForm.controls.split.push(this.splitRow({ name: '', percent: 0 }));
    this.billingForm.markAsDirty();
  }

  protected removePayer(index: number): void {
    this.billingForm.controls.split.removeAt(index);
    this.billingForm.markAsDirty();
  }

  constructor() {
    effect(() => {
      const billing = this.billing.value();
      if (!billing) return;
      this.setSplit(billing.split ?? []);
      this.billingForm.reset(billing);
      // Projects from before billing had a time zone count in UTC: suggest yours, saved with the next save.
      if (!billing.timeZone && this.browserTimeZone) {
        this.billingForm.controls.timeZone.setValue(this.browserTimeZone);
        this.billingForm.controls.timeZone.markAsDirty();
      }
    });
    effect(() => {
      const branding = this.branding.value();
      if (branding) this.brandingForm.reset(branding);
    });
    effect(() => {
      const project = this.project.value();
      if (project) {
        const { name, description, icon, iconImage } = project;
        this.form.reset({ name, description, icon, iconImage, gitHubUrl: project.gitHubUrl ?? '', websiteUrl: project.websiteUrl ?? '' });
      }
    });
  }

  protected save(): void {
    const project = this.project.value();
    if (!project || this.form.invalid) return;
    const { name, description, icon, iconImage } = this.form.getRawValue();
    this.busy.set(true);
    const gitHubUrl = this.form.getRawValue().gitHubUrl.trim() || null;
    const websiteUrl = this.form.getRawValue().websiteUrl.trim() || null;
    this.api.updateProject(project.id, { name: name.trim(), description: description.trim(), icon, iconImage, gitHubUrl, websiteUrl }).subscribe({
      next: () => {
        this.shell.refreshProjects();
        this.busy.set(false);
        this.message.set('Project saved.');
        this.project.reload();
      },
      error: () => {
        this.busy.set(false);
        this.message.set('Could not save the project. Please try again.');
      },
    });
  }

  protected saveBilling(): void {
    const project = this.project.value();
    if (!project || this.billingForm.invalid || this.splitInvalid()) return;
    const settings = this.billingForm.getRawValue();
    const capped = settings.maxHoursPerDay > 0 && settings.maxHoursPerDay < 24;
    if (capped && settings.maxHoursPerDay < settings.minHoursPerDay) {
      this.billingMessage.set('The maximum hours per day cannot be below the minimum.');
      return;
    }
    this.api.saveBilling(project.id, settings).subscribe({
      next: () => {
        this.billingForm.reset(settings);
        this.billingMessage.set('Billing settings saved.');
        // The overview and members tab show billing once it is enabled.
        this.project.reload();
      },
      error: (error: HttpErrorResponse) =>
        this.billingMessage.set(error.error?.error ?? 'Could not save the billing settings. Please try again.'),
    });
  }

  protected saveBranding(): void {
    const project = this.project.value();
    if (!project || this.brandingForm.invalid) return;
    const settings = this.brandingForm.getRawValue();
    this.api.saveBranding(project.id, settings).subscribe({
      next: () => {
        this.brandingForm.reset(settings);
        this.brandingMessage.set('Branding saved. Documents finalized from now on use it; finalized ones keep theirs.');
      },
      error: () => this.brandingMessage.set('Could not save the branding. Please try again.'),
    });
  }

  protected setBrandColor(color: string): void {
    this.brandingForm.patchValue({ color });
    this.brandingForm.markAsDirty();
  }

  protected deleteProject(): void {
    const project = this.project.value();
    if (!project || !confirm(`Delete "${project.name}" and all of its tasks? This cannot be undone.`)) return;
    this.busy.set(true);
    this.api.deleteProject(project.id).subscribe({
      next: () => void this.router.navigateByUrl('/dashboard'),
      error: (error: HttpErrorResponse) => {
        this.busy.set(false);
        this.message.set(
          error.status === 403
            ? 'Only the project owner can delete this project.'
            : 'Could not delete the project. Please try again.',
        );
      },
    });
  }

  /** Only changes the form; nothing is saved until "Save changes". */
  protected setIcon(icon: string | null, iconImage: string | null): void {
    this.form.patchValue({ icon, iconImage });
    this.form.markAsDirty();
  }

  protected async upload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      this.setIcon(null, await squareImageDataUrl(file, 128));
    } catch {
      this.message.set('That file could not be read as an image.');
    }
  }
}
