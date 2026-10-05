import { Component, OnInit, computed, signal } from '@angular/core';
import { UpperCasePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideArrowUpRight, LucideCircleCheck, LucideCircleDashed } from '@lucide/angular';
import { Project, ProjectTask } from './models';
import { WorkspaceApi } from './workspace-api';

@Component({
  selector: 'app-dashboard-page',
  imports: [RouterLink, UpperCasePipe, LucideArrowUpRight, LucideCircleCheck, LucideCircleDashed],
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.css',
})
export class DashboardPage implements OnInit {
  protected readonly projects = signal<Project[]>([]);
  protected readonly tasks = signal<ProjectTask[]>([]);
  protected readonly loading = signal(true);
  protected readonly openCount = computed(() => this.tasks().filter((task) => task.status !== 'done').length);
  protected readonly doneCount = computed(() => this.tasks().filter((task) => task.status === 'done').length);
  protected readonly today = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());

  constructor(private readonly api: WorkspaceApi) {}

  ngOnInit(): void {
    this.api.projects().subscribe({ next: (projects) => this.projects.set(projects) });
    this.api.dashboardTasks().subscribe({
      next: (tasks) => { this.tasks.set(tasks); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }
}