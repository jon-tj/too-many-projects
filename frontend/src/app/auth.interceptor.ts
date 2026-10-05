import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthService);
  const token = auth.token();
  const authorizedRequest = token && request.url.startsWith('/api/') && !request.url.startsWith('/api/auth/')
    ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : request;

  return next(authorizedRequest).pipe(
    catchError((error: unknown) => {
      if ((error as { status?: number }).status === 401 && auth.isAuthenticated()) auth.logout();
      return throwError(() => error);
    }),
  );
};