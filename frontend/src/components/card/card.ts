import { Component, signal } from '@angular/core';

@Component({
  selector: 'app-card',
  imports: [],
  templateUrl: './card.html',
  styleUrl: './card.css',
})
export class Card {
  protected readonly projectCount = signal<number | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  constructor() {
    void this.refresh();
  }

  protected async refresh(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const response = await fetch('/api/debug/project-count');
      const result = (await response.json()) as {
        databaseConnected?: boolean;
        projectCount?: number;
        error?: string;
      };

      if (!response.ok || result.databaseConnected !== true || typeof result.projectCount !== 'number') {
        throw new Error(result.error ?? 'The database status could not be verified.');
      }

      this.projectCount.set(result.projectCount);
    } catch (error) {
      this.projectCount.set(null);
      this.error.set(
        error instanceof TypeError
          ? 'Could not reach the API. Check that the backend is running.'
          : error instanceof Error
            ? error.message
            : 'The database status could not be verified.',
      );
    } finally {
      this.loading.set(false);
    }
  }
}
