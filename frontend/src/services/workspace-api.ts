import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { Account, CanvasDocument, Project, ProjectMember, ProjectTask } from './models';

@Injectable({ providedIn: 'root' })
export class WorkspaceApi {
  constructor(private readonly http: HttpClient) {}

  currentAccount(): Observable<Account> {
    return this.http.get<Account>('/api/account/me');
  }

  projects(): Observable<Project[]> {
    return this.http.get<Project[]>('/api/projects');
  }

  createProject(name: string, description: string): Observable<Project> {
    return this.http.post<Project>('/api/projects', { name, description });
  }

  project(id: number): Observable<Project> {
    return this.http.get<Project>(`/api/projects/${id}`);
  }

  updateProject(id: number, name: string, description: string): Observable<void> {
    return this.http.put<void>(`/api/projects/${id}`, { name, description });
  }

  deleteProject(id: number): Observable<void> {
    return this.http.delete<void>(`/api/projects/${id}`);
  }

  projectMembers(id: number): Observable<ProjectMember[]> {
    return this.http.get<ProjectMember[]>(`/api/projects/${id}/members`);
  }

  dashboardTasks(): Observable<ProjectTask[]> {
    return this.http.get<ProjectTask[]>('/api/tasks');
  }

  projectTasks(projectId: number): Observable<ProjectTask[]> {
    return this.http.get<ProjectTask[]>(`/api/tasks/by-project/${projectId}`);
  }

  createTask(projectId: number, title: string, description: string): Observable<ProjectTask> {
    return this.http.post<ProjectTask>(`/api/tasks/by-project/${projectId}`, { title, description });
  }

  task(id: number): Observable<ProjectTask> {
    return this.http.get<ProjectTask>(`/api/tasks/${id}`);
  }

  updateTask(task: ProjectTask): Observable<void> {
    const { title, description, status, assigneeUserId, dueAt } = task;
    return this.http.put<void>(`/api/tasks/${task.id}`, { title, description, status, assigneeUserId, dueAt });
  }

  setTaskStatus(taskId: number, status: string): Observable<void> {
    return this.http.patch<void>(`/api/tasks/${taskId}/status`, { status });
  }

  canvas(projectId: number): Observable<{ canvas: CanvasDocument }> {
    return this.http.get<{ canvas: CanvasDocument }>(`/api/projects/${projectId}/canvas`);
  }

  saveCanvas(projectId: number, canvas: CanvasDocument): Observable<void> {
    return this.http.put<void>(`/api/projects/${projectId}/canvas`, { canvas });
  }
}