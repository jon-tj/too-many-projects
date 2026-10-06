import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { NavigationEnd } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { Icon } from '../icon/icon';
import { Avatar } from '../avatar/avatar';
import { Modal } from '../modal/modal';
import { ProjectIcon } from '../project-icon/project-icon';
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
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ReactiveFormsModule, Icon, Modal, ProjectIcon, Avatar],
  templateUrl: './workspace-shell.html',
  styleUrl: './workspace-shell.css',
})
export class WorkspaceShell implements OnInit {
  protected readonly projects = signal<Project[]>([]);
  protected readonly account = signal<Account | null>(null);
  protected readonly creating = signal(false);
  protected readonly accountMenuOpen = signal(false);
  protected readonly createError = signal('');
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
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe(() => this.refreshProjects());
  }

  /** Reloads the signed-in account, e.g. after the profile picture changed in settings. */
  refreshAccount(): void {
    this.api.currentAccount().subscribe({ next: (account) => this.account.set(account) });
  }

  refreshProjects(): void {
    this.api.projects().subscribe({ next: (projects) => this.projects.set(projects) });
  }

  protected openCreate(): void {
    this.form.reset({ name: '', description: '' });
    this.createError.set('');
    this.creating.set(true);
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
      error: () => this.createError.set('Could not create this project. Please try again.'),
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