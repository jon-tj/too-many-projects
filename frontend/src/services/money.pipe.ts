import { Pipe, PipeTransform } from '@angular/core';

/**
 * An amount in a currency, e.g. "$1,250.00" or "NOK 1,250.00". Unlike Angular's currency pipe, a currency shown by its
 * code gets a space after it.
 */
@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  transform(value: number | null | undefined, currency = 'USD'): string {
    if (value === null || value === undefined) return '';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
  }
}
