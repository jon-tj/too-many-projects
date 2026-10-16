import { ChoosablePlan } from './models';

/** A plan as the plan picker and the landing page show it. */
export interface PlanOption {
  name: ChoosablePlan;
  title: string;
  /**
   * The monthly price in US cents, used when Stripe's price cannot be read (no Stripe connected, an unknown price id,
   * Stripe unreachable).
   */
  fallbackAmount: number;
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
    fallbackAmount: 0,
    limit: 2,
    memberLimit: 1,
    perks: ['Up to 2 projects', 'Boards and tasks', 'Just you, no team members'],
  },
  {
    name: 'plus',
    title: 'Plus',
    fallbackAmount: 399,
    limit: 3,
    memberLimit: 8,
    perks: ['Up to 3 projects', 'Up to 8 members per project', 'Roadmap and critical path', 'Canvas, time tracking and billing'],
    featured: true,
  },
  {
    name: 'pro',
    title: 'Pro',
    fallbackAmount: 899,
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
 * currency the paid plans are in. Null while the prices are loading, so a fallback never flashes up before the real
 * price; pass an empty list when loading them failed.
 */
export function shownPrice(option: PlanOption, prices: PlanPrice[] | undefined): ShownPrice | null {
  const price = effectivePrice(option, prices);
  if (!price) return null;
  const per = price.intervalCount === 1 ? price.interval : `${price.intervalCount} ${price.interval}s`;
  return { amount: formatMoney(price.amount, price.currency), per: `/ ${per}` };
}

/**
 * What each person pays a month when a team of `people` shares one owner's plan, e.g. "$0.80", and
 * whether that is under one unit of the currency. Null while the prices are loading, or when the plan is not billed
 * monthly.
 */
export function perPersonPrice(
  option: PlanOption,
  prices: PlanPrice[] | undefined,
  people: number,
): { amount: string; underOne: boolean } | null {
  const price = effectivePrice(option, prices);
  if (!price || price.interval !== 'month' || price.intervalCount !== 1) return null;
  const share = Math.ceil(price.amount / people);
  return { amount: formatMoney(share, price.currency), underOne: share < 10 ** fractionDigits(price.currency) };
}

/** Stripe's price for the plan, or its fallback; null while the prices are loading. */
function effectivePrice(option: PlanOption, prices: PlanPrice[] | undefined): Omit<PlanPrice, 'plan'> | null {
  if (!prices) return null;
  const price = prices.find((entry) => entry.plan === option.name);
  if (price) return price;
  // Free costs nothing, in the currency the paid plans are in.
  const currency = option.name === 'free' && prices.length ? prices[0].currency : 'usd';
  return { amount: option.fallbackAmount, currency, interval: 'month', intervalCount: 1 };
}

function fractionDigits(currency: string): number {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).resolvedOptions()
    .maximumFractionDigits ?? 2;
}

/** Formats an amount in the currency's smallest unit; whole amounts leave out the decimals. */
function formatMoney(minorUnits: number, currency: string): string {
  const code = currency.toUpperCase();
  const digits = fractionDigits(currency);
  const amount = minorUnits / 10 ** digits;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: code,
    minimumFractionDigits: Number.isInteger(amount) ? 0 : digits,
  }).format(amount);
}
