import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthService } from './auth.service';
import { WorkspaceApi } from './workspace-api';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isAuthenticated() || inject(Router).createUrlTree(['/login']);
};

/** The landing page is for visitors; signed-in users go to their dashboard, keeping any query parameters. */
export const landingGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  return !auth.isAuthenticated() || inject(Router).createUrlTree(['/dashboard'], { queryParams: route.queryParams });
};

/** Users created with a temporary password must choose their own before using the workspace. */
export const passwordChangeGuard: CanActivateFn = () => {
  const router = inject(Router);
  return inject(WorkspaceApi)
    .currentAccount()
    .pipe(
      map((account) => (account.mustChangePassword ? router.createUrlTree(['/login', 'change-password']) : true)),
      catchError(() => of(true)),
    );
};
