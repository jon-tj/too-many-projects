import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { NavigationEnd } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { Icon } from '../icon/icon';
import { Avatar } from '../avatar/avatar';
import { Modal } from '../modal/modal';
import { ProjectIcon } from '../project-icon/project-icon';
import { Tour, TourStep } from '../tour/tour';
import { AuthService } from '../../services/auth.service';
import { Account, Project } from '../../services/models';
import { WorkspaceApi } from '../../services/workspace-api';

const THEMES = [
  { name: 'light', label: 'day', icon: 'light_mode' },
  { name: 'dark', label: 'night', icon: 'dark_mode' },
  { name: 'coffee', label: 'coffee', icon: 'coffee' },
] as const;
type Theme = (typeof THEMES)[number]['name'];

@Component({
  selector: 'app-workspace-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ReactiveFormsModule, Icon, Modal, ProjectIcon, Avatar, Tour],
  templateUrl: './workspace-shell.html',
  styleUrl: './workspace-shell.css',
})
export class WorkspaceShell implements OnInit {
  protected readonly projects = signal<Project[]>([]);
  protected readonly account = signal<Account | null>(null);
  protected readonly creating = signal(false);
  protected readonly accountMenuOpen = signal(false);
  /** The project in the URL, whose views are listed under it in the sidebar. */
  protected readonly currentProjectId = signal<number | null>(null);
  protected readonly createError = signal('');
  /** Shown when the URL has ?onboard=true, as it does right after signing up. */
  protected readonly onboarding = signal(false);
  private readonly createButton = viewChild.required<ElementRef<HTMLElement>>('createButton');
  private readonly themeButton = viewChild.required<ElementRef<HTMLElement>>('themeButton');
  protected readonly tourSteps = computed((): TourStep[] => [
    {
      target: this.createButton().nativeElement,
      title: 'Start with a project',
      text: 'Everything lives in a project: tasks, the roadmap, canvases and the hours you track. Use this button to create your first one.',
    },
    {
      target: this.themeButton().nativeElement,
      title: 'Make it yours',
      text: 'Switch between the day, night and coffee themes whenever you like.',
    },
  ]);
  private readonly formBuilder = inject(FormBuilder);
  protected readonly form = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    description: [''],
  });

  constructor(
    private readonly api: WorkspaceApi,
    private readonly auth: AuthService,
    private readonly router: Router,
  ) {}

  ngOnInit(): void {
    this.refreshAccount();
    this.refreshProjects();
    this.updateCurrentProject();
    this.updateOnboarding();
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe(() => {
      this.refreshProjects();
      this.updateCurrentProject();
      this.updateOnboarding();
    });
  }

  private updateOnboarding(): void {
    this.onboarding.set(this.router.parseUrl(this.router.url).queryParams['onboard'] === 'true');
  }

  /** Ends the tour and drops ?onboard from the address, so reloading does not start it again. */
  protected finishOnboarding(): void {
    this.onboarding.set(false);
    void this.router.navigate([], { queryParams: { onboard: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  private updateCurrentProject(): void {
    const match = /^\/projects\/(\d+)/.exec(this.router.url);
    this.currentProjectId.set(match ? Number(match[1]) : null);
  }

  /** Reloads the signed-in account, e.g. after the profile picture changed in settings. */
  refreshAccount(): void {
    this.api.currentAccount().subscribe({ next: (account) => this.account.set(account) });
  }

  refreshProjects(): void {
    this.api.projects().subscribe({ next: (projects) => this.projects.set(projects) });
  }

  /** Why a new project cannot be created on your plan right now; empty while it can. */
  protected readonly createBlocked = signal('');

  /** Checks the plan first: with no free project slot the dialog explains that instead of showing the form. */
  protected openCreate(): void {
    this.form.reset({ name: '', description: '' });
    this.createError.set('');
    this.createBlocked.set('');
    this.creating.set(true);
    this.api.plan().subscribe({
      next: (plan) => {
        const active = plan.ownedProjects.filter((project) => !project.frozen).length;
        if (plan.planLapsed) {
          this.createBlocked.set('You have no plan right now, so you cannot create projects. Choose a plan to continue.');
        } else if (plan.projectLimit !== null && active >= plan.projectLimit) {
          this.createBlocked.set(
            `Your plan includes ${plan.projectLimit} active projects and they are all in use, so you cannot create another. ` +
              'Change your plan to get more.',
          );
        }
      },
    });
  }

  protected changePlan(): void {
    this.creating.set(false);
    void this.router.navigateByUrl('/plans');
  }

  protected createProject(): void {
    if (this.form.invalid) return;
    const { name, description } = this.form.getRawValue();
    this.api.createProject(name, description).subscribe({
      next: (project) => {
        this.projects.update((projects) => [project, ...projects]);
        this.creating.set(false);
        void this.router.navigate(['/projects', project.id]);
      },
      error: (response: HttpErrorResponse) => {
        // The plan may have changed since the dialog opened: show the same explanation as on opening.
        if (response.status === 403 && response.error?.error) this.createBlocked.set(response.error.error);
        else this.createError.set('Could not create this project. Please try again.');
      },
    });
  }

  /** Follows the system setting until a theme is chosen; the choice is applied early in index.html. */
  protected readonly theme = signal<Theme>(
    THEMES.find((theme) => theme.name === document.documentElement.dataset['theme'])?.name ??
      (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  );
  /** The theme the toggle switches to: day → night → coffee → day. */
  protected readonly nextTheme = computed(
    () => THEMES[(THEMES.findIndex((theme) => theme.name === this.theme()) + 1) % THEMES.length],
  );

  protected toggleTheme(): void {
    const theme = this.nextTheme().name;
    this.theme.set(theme);
    document.documentElement.dataset['theme'] = theme;
    try {
      localStorage.setItem('theme', theme);
    } catch {
      // Storage can be unavailable (e.g. private windows); the theme then lasts until reload.
    }
  }

  protected logout(): void { this.auth.logout(); }

  protected toggleAccountMenu(): void { this.accountMenuOpen.update((open) => !open); }

  protected closeAccountMenu(): void { this.accountMenuOpen.set(false); }
}