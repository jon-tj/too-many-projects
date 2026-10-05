import { Component, OnInit, inject, signal } from '@angular/core';
import { NavigationEnd } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { LucideFolderKanban, LucideLayoutDashboard, LucideLogOut, LucidePlus } from '@lucide/angular';
import { AuthService } from './auth.service';
import { Account, Project } from './models';
import { WorkspaceApi } from './workspace-api';

@Component({
  selector: 'app-workspace-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ReactiveFormsModule, LucideFolderKanban, LucideLayoutDashboard, LucideLogOut, LucidePlus],
  templateUrl: './workspace-shell.html',
  styleUrl: './workspace-shell.css',
})
export class WorkspaceShell implements OnInit {
  protected readonly projects = signal<Project[]>([]);
  protected readonly account = signal<Account | null>(null);
  protected readonly creating = signal(false);
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
    this.api.currentAccount().subscribe({ next: (account) => this.account.set(account) });
    this.refreshProjects();
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe(() => this.refreshProjects());
  }

  protected refreshProjects(): void {
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

  protected logout(): void { this.auth.logout(); }
}