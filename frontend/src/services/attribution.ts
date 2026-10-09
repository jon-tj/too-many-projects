import { Params } from '@angular/router';

/** Where a visitor came from: the utm_* parameters on the link that brought them, and the referring page. */
export interface Attribution {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  referrer?: string;
}

const KEY = 'signup_attribution';
const UTM_PARAMS = {
  utm_source: 'utmSource',
  utm_medium: 'utmMedium',
  utm_campaign: 'utmCampaign',
  utm_term: 'utmTerm',
  utm_content: 'utmContent',
} as const;

/** The utm_* query parameters, to pass along on links to the sign-up page. */
export function utmParams(params: Params): Params {
  return Object.fromEntries(Object.keys(UTM_PARAMS).filter((name) => params[name]).map((name) => [name, params[name]]));
}

/**
 * Remembers where the visitor came from for the rest of the browser session, so it survives detours such as
 * the login page on the way to signing up. Links with utm_* parameters replace what was remembered; the referrer
 * is kept from the first page, since later ones only refer to this site.
 */
export function rememberAttribution(params: Params): void {
  const stored = readAttribution();
  const fromLink = Object.fromEntries(
    Object.entries(UTM_PARAMS)
      .filter(([name]) => typeof params[name] === 'string' && params[name])
      .map(([name, field]) => [field, params[name] as string]),
  ) as Attribution;
  const external = document.referrer && !document.referrer.startsWith(location.origin) ? document.referrer : undefined;
  const next: Attribution = Object.keys(fromLink).length
    ? { ...fromLink, referrer: stored.referrer ?? external }
    : { ...stored, referrer: stored.referrer ?? external };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage can be unavailable (e.g. private windows); the parameters on the sign-up link still count.
  }
}

export function readAttribution(): Attribution {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? '{}') as Attribution;
  } catch {
    return {};
  }
}
