import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from './auth.service';

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith('/api/') || request.url.startsWith('/api/auth/')) return next(request);

  const auth = inject(AuthService);
  const withToken = (token: string | null): HttpRequest<unknown> =>
    token ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : request;

  return next(withToken(auth.token())).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401 || !auth.isAuthenticated()) {
        return throwError(() => error);
      }
      // The access token lasts an hour: renew it with the refresh token and retry once.
      return auth.refresh().pipe(
        catchError(() => {
          auth.logout();
          return throwError(() => error);
        }),
        switchMap((token) => next(withToken(token))),
      );
    }),
  );
};
