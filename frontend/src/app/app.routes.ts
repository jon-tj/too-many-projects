import { Routes } from '@angular/router';
import { authGuard, landingGuard, passwordChangeGuard } from '../services/auth.guard';
import { LoginPage } from '../pages/login/login-page';
import { SignInForm } from '../pages/login/sign-in/sign-in-form';
import { RegisterForm } from '../pages/login/register/register-form';
import { LandingPage } from '../pages/landing/landing-page';
import { ChangePasswordForm } from '../pages/login/change-password/change-password-form';
import { WorkspaceShell } from '../components/workspace-shell/workspace-shell';
import { DashboardPage } from '../pages/dashboard/dashboard-page';
import { ProjectPage } from '../pages/project/project-page';
import { ProjectBoard } from '../pages/project/board/project-board';
import { ProjectOverview } from '../pages/project/overview/project-overview';
import { CanvasList } from '../pages/project/canvas/canvas-list';
import { ProjectCanvas } from '../pages/project/canvas/editor/project-canvas';
import { CanvasSettings } from '../pages/project/canvas/settings/canvas-settings';
import { ProjectRoadmap } from '../pages/project/roadmap/project-roadmap';
import { ProjectMembers } from '../pages/project/members/project-members';
import { ProjectSettings } from '../pages/project/settings/project-settings';
import { TaskDetail } from '../pages/project/task/task-detail';
import { SettingsPage } from '../pages/settings/settings-page';
import { PlansPage } from '../pages/plans/plans-page';
import { BillingReportPage } from '../pages/report/billing-report';

export const routes: Routes = [
	{ path: 'report/:projectId/:month', component: BillingReportPage, canActivate: [authGuard, passwordChangeGuard] },
	{ path: 'bill/:projectId/:billId', component: BillingReportPage, canActivate: [authGuard, passwordChangeGuard] },
	// Signed-in visitors skip the landing page and go straight to the dashboard.
	{ path: '', pathMatch: 'full', component: LandingPage, canActivate: [landingGuard] },
	{ path: 'register', component: LoginPage, children: [{ path: '', component: RegisterForm }] },
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
			{ path: 'dashboard', component: DashboardPage },
			{
				path: 'projects/:projectId', component: ProjectPage,
				children: [
					{ path: '', pathMatch: 'full', redirectTo: 'board' },
					{ path: 'overview', component: ProjectOverview },
					{ path: 'board', component: ProjectBoard },
					{ path: 'roadmap', component: ProjectRoadmap },
					{ path: 'canvas', component: CanvasList },
					{ path: 'canvas/:canvasId', component: ProjectCanvas },
					{ path: 'canvas/:canvasId/settings', component: CanvasSettings },
					{ path: 'members', component: ProjectMembers },
					{ path: 'settings', component: ProjectSettings },
					{ path: 'tasks/:taskId', component: TaskDetail },
				],
			},
			{ path: 'settings', component: SettingsPage },
			{ path: 'plans', component: PlansPage },
		],
	},
	{ path: '**', redirectTo: '' },
];
