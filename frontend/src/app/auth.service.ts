import { HttpClient } from '@angular/common/http';
import { Injectable, computed, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';

interface TokenResponse { accessToken: string; expiresIn: number; refreshToken: string; tokenType: string; }

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly tokenState = signal<string | null>(localStorage.getItem('workspace_access_token'));
  readonly token = this.tokenState.asReadonly();
  readonly isAuthenticated = computed(() => !!this.tokenState());

  constructor(private readonly http: HttpClient, private readonly router: Router) {}

  login(username: string, password: string): Observable<TokenResponse> {
    return this.http.post<TokenResponse>('/api/auth/login', { email: username.trim(), password }).pipe(
      tap((result) => {
        localStorage.setItem('workspace_access_token', result.accessToken);
        localStorage.setItem('workspace_refresh_token', result.refreshToken);
        this.tokenState.set(result.accessToken);
      }),
    );
  }

  logout(): void {
    localStorage.removeItem('workspace_access_token');
    localStorage.removeItem('workspace_refresh_token');
    this.tokenState.set(null);
    void this.router.navigateByUrl('/login');
  }
}