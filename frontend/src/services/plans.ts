import { ChoosablePlan } from './models';

/** A plan as the plan picker and the landing page show it. */
export interface PlanOption {
  name: ChoosablePlan;
  title: string;
  /** Shown when Stripe's price cannot be read (no Stripe connected, an unknown price id, Stripe unreachable). */
  fallbackPrice: string;
  /** Active projects allowed; null for no limit. Matches the backend's Plans.Plan. */
  limit: number | null;
  /** Members per project, the owner included; null means no limit. Matches the backend's Plans.Plan. */
  memberLimit: number | null;
  perks: string[];
  featured?: boolean;
}

export const PLAN_OPTIONS: PlanOption[] = [
  {
    name: 'free',
    title: 'Free',
    fallbackPrice: '$0',
    limit: 2,
    memberLimit: 1,
    perks: ['Up to 2 projects', 'Boards and tasks', 'Just you, no team members'],
  },
  {
    name: 'plus',
    title: 'Plus',
    fallbackPrice: '$3.99',
    limit: 3,
    memberLimit: 8,
    perks: ['Up to 3 projects', 'Up to 8 members per project', 'Roadmap and critical path', 'Canvas, time tracking and billing'],
    featured: true,
  },
  {
    name: 'pro',
    title: 'Pro',
    fallbackPrice: '$8.99',
    limit: null,
    memberLimit: null,
    perks: ['Unlimited projects', 'Unlimited members', 'Everything in Plus'],
  },
];

/** A paid plan's price as set in Stripe (GET api/public/plans). */
export interface PlanPrice {
  plan: ChoosablePlan;
  /** In the currency's smallest unit, e.g. cents. */
  amount: number;
  /** Lowercase ISO code, e.g. usd. */
  currency: string;
  interval: 'day' | 'week' | 'month' | 'year';
  intervalCount: number;
}

/** What a plan costs, ready to show: "$3.99" and "/ month". */
export interface ShownPrice {
  amount: string;
  per: string;
}

/**
 * The plan's price from Stripe when it could be read, otherwise its fallback. Free costs nothing, shown in the
 * currency the paid plans are in.
 */
export function shownPrice(option: PlanOption, prices: PlanPrice[] | undefined): ShownPrice {
  const price = prices?.find((entry) => entry.plan === option.name);
  if (price) {
    const per = price.intervalCount === 1 ? price.interval : `${price.intervalCount} ${price.interval}s`;
    return { amount: formatMoney(price.amount, price.currency), per: `/ ${per}` };
  }
  if (option.name === 'free' && prices?.length) return { amount: formatMoney(0, prices[0].currency), per: '/ month' };
  return { amount: option.fallbackPrice, per: '/ month' };
}

/** Formats an amount in the currency's smallest unit; whole amounts leave out the decimals. */
function formatMoney(minorUnits: number, currency: string): string {
  const code = currency.toUpperCase();
  const digits = new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits ?? 2;
  const amount = minorUnits / 10 ** digits;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: code,
    minimumFractionDigits: Number.isInteger(amount) ? 0 : digits,
  }).format(amount);
}
