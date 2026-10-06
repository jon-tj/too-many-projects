import { Routes } from '@angular/router';
import { authGuard, passwordChangeGuard } from '../services/auth.guard';
import { LoginPage } from '../pages/login/login-page';
import { SignInForm } from '../pages/login/sign-in/sign-in-form';
import { ChangePasswordForm } from '../pages/login/change-password/change-password-form';
import { WorkspaceShell } from '../components/workspace-shell/workspace-shell';
import { DashboardPage } from '../pages/dashboard/dashboard-page';
import { ProjectPage } from '../pages/project/project-page';
import { ProjectBoard } from '../pages/project/board/project-board';
import { ProjectOverview } from '../pages/project/overview/project-overview';
import { CanvasList } from '../pages/project/canvas/canvas-list';
import { ProjectCanvas } from '../pages/project/canvas/editor/project-canvas';
import { CanvasSettings } from '../pages/project/canvas/settings/canvas-settings';
import { ProjectMembers } from '../pages/project/members/project-members';
import { ProjectSettings } from '../pages/project/settings/project-settings';
import { TaskDetail } from '../pages/project/task/task-detail';
import { SettingsPage } from '../pages/settings/settings-page';

export const routes: Routes = [
	{
		path: 'login', component: LoginPage,
		children: [
			{ path: '', component: SignInForm },
			{ path: 'change-password', component: ChangePasswordForm, canActivate: [authGuard] },
		],
	},
	{
		path: '', component: WorkspaceShell, canActivate: [authGuard, passwordChangeGuard],
		children: [
			{ path: '', component: DashboardPage },
			{
				path: 'projects/:projectId', component: ProjectPage,
				children: [
					{ path: '', pathMatch: 'full', redirectTo: 'board' },
					{ path: 'overview', component: ProjectOverview },
					{ path: 'board', component: ProjectBoard },
					{ path: 'canvas', component: CanvasList },
					{ path: 'canvas/:canvasId', component: ProjectCanvas },
					{ path: 'canvas/:canvasId/settings', component: CanvasSettings },
					{ path: 'members', component: ProjectMembers },
					{ path: 'settings', component: ProjectSettings },
					{ path: 'tasks/:taskId', component: TaskDetail },
				],
			},
			{ path: 'settings', component: SettingsPage },
		],
	},
	{ path: '**', redirectTo: '' },
];
