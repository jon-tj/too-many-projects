import { Component, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Project, ProjectTask } from './models';
import { WorkspaceApi } from './workspace-api';

@Component({
  selector: 'app-dashboard-page',
  imports: [RouterLink],
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.css',
})
export class DashboardPage implements OnInit {
  protected readonly projects = signal<Project[]>([]);
  protected readonly tasks = signal<ProjectTask[]>([]);
  protected readonly loading = signal(true);

  constructor(private readonly api: WorkspaceApi) {}

  ngOnInit(): void {
    this.api.projects().subscribe({ next: (projects) => this.projects.set(projects) });
    this.api.dashboardTasks().subscribe({
      next: (tasks) => { this.tasks.set(tasks); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }
}