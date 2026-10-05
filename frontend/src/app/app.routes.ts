import { Routes } from '@angular/router';
import { authGuard } from './auth.guard';
import { LoginPage } from './login-page';
import { WorkspaceShell } from './workspace-shell';
import { DashboardPage } from './dashboard-page';
import { ProjectPage } from './project-page';

export const routes: Routes = [
	{ path: 'login', component: LoginPage },
	{
		path: '', component: WorkspaceShell, canActivate: [authGuard],
		children: [
			{ path: '', component: DashboardPage },
			{ path: 'projects/:id', component: ProjectPage },
		],
	},
	{ path: '**', redirectTo: '' },
];
