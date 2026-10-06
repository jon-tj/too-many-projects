import { Component, OnInit, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Project, ProjectTask } from '../../services/models';
import { WorkspaceApi } from '../../services/workspace-api';

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
  protected readonly previewCount = 5;
  protected readonly showAllTasks = signal(false);
  protected readonly visibleTasks = computed(() =>
    this.showAllTasks() ? this.tasks() : this.tasks().slice(0, this.previewCount),
  );

  constructor(private readonly api: WorkspaceApi) {}

  ngOnInit(): void {
    this.api.projects().subscribe({ next: (projects) => this.projects.set(projects) });
    this.api.dashboardTasks().subscribe({
      next: (tasks) => { this.tasks.set(tasks); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }
}