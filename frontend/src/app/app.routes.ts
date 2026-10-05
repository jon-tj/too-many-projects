import { Routes } from '@angular/router';
import { authGuard } from './auth.guard';
import { LoginPage } from './login-page';
import { WorkspaceShell } from './workspace-shell';
import { DashboardPage } from './dashboard-page';
import { ProjectPage } from './project-page';
import { ProjectBoard } from './project-board';
import { ProjectCanvas } from './project-canvas';
import { ProjectMembers } from './project-members';
import { ProjectSettings } from './project-settings';
import { SettingsPage } from './settings-page';

export const routes: Routes = [
	{ path: 'login', component: LoginPage },
	{
		path: '', component: WorkspaceShell, canActivate: [authGuard],
		children: [
			{ path: '', component: DashboardPage },
			{
				path: 'projects/:projectId', component: ProjectPage,
				children: [
					{ path: '', pathMatch: 'full', redirectTo: 'board' },
					{ path: 'board', component: ProjectBoard },
					{ path: 'canvas', component: ProjectCanvas },
					{ path: 'members', component: ProjectMembers },
					{ path: 'settings', component: ProjectSettings },
				],
			},
			{ path: 'settings', component: SettingsPage },
		],
	},
	{ path: '**', redirectTo: '' },
];
