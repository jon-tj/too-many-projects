import { HttpClient } from '@angular/common/http';
import { Injectable, computed, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, finalize, map, shareReplay, tap, throwError } from 'rxjs';

interface TokenResponse { accessToken: string; expiresIn: number; refreshToken: string; tokenType: string; }

const ACCESS_TOKEN = 'workspace_access_token';
const REFRESH_TOKEN = 'workspace_refresh_token';

/**
 * Bearer tokens from the Identity API. "Remember me" keeps them in localStorage so they survive closing
 * the browser; otherwise they live in sessionStorage. Expired access tokens are renewed with the refresh token.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly tokenState = signal(localStorage.getItem(ACCESS_TOKEN) ?? sessionStorage.getItem(ACCESS_TOKEN));
  readonly token = this.tokenState.asReadonly();
  readonly isAuthenticated = computed(() => !!this.tokenState());
  private refreshing: Observable<string> | null = null;

  constructor(private readonly http: HttpClient, private readonly router: Router) {}

  login(username: string, password: string, remember: boolean): Observable<TokenResponse> {
    return this.http.post<TokenResponse>('/api/auth/login', { email: username.trim(), password }).pipe(
      tap((result) => this.store(result, remember ? localStorage : sessionStorage)),
    );
  }

  /** Swaps the refresh token for new tokens. Concurrent callers share one request. */
  refresh(): Observable<string> {
    const storage = [localStorage, sessionStorage].find((entry) => entry.getItem(REFRESH_TOKEN));
    if (!storage) return throwError(() => new Error('No refresh token.'));

    this.refreshing ??= this.http
      .post<TokenResponse>('/api/auth/refresh', { refreshToken: storage.getItem(REFRESH_TOKEN) })
      .pipe(
        tap((result) => this.store(result, storage)),
        map((result) => result.accessToken),
        finalize(() => (this.refreshing = null)),
        shareReplay(1),
      );
    return this.refreshing;
  }

  logout(): void {
    this.clear();
    this.tokenState.set(null);
    void this.router.navigateByUrl('/login');
  }

  private store(result: TokenResponse, storage: Storage): void {
    this.clear();
    storage.setItem(ACCESS_TOKEN, result.accessToken);
    storage.setItem(REFRESH_TOKEN, result.refreshToken);
    this.tokenState.set(result.accessToken);
  }

  private clear(): void {
    for (const storage of [localStorage, sessionStorage]) {
      storage.removeItem(ACCESS_TOKEN);
      storage.removeItem(REFRESH_TOKEN);
    }
  }
}
