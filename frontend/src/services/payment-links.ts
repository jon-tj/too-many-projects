/** A payment link (revolut.me/name, paypal.me/name or wise.com/pay/me/name) found in free text such as an invoice's payment details. */
export interface PaymentLink {
  /** "Revolut", "PayPal" or "Wise". */
  service: string;
  url: string;
  /** The link as written on paper, e.g. "paypal.me/jontjem". */
  label: string;
}

/** Each service's link up to the name, e.g. "wise.com/pay/me/" for wise.com/pay/me/jonhenrikt. */
const SERVICES = [
  { service: 'Revolut', prefix: 'revolut.me/' },
  { service: 'PayPal', prefix: 'paypal.me/' },
  { service: 'Wise', prefix: 'wise.com/pay/me/' },
];

/**
 * The first revolut.me, paypal.me and wise.com/pay/me links in the text, with or without https:// and www., in the order the text has
 * them; empty when there are none.
 */
export function findPaymentLinks(text: string | null | undefined): PaymentLink[] {
  const links: (PaymentLink & { at: number })[] = [];
  for (const { service, prefix } of SERVICES) {
    const escaped = prefix.replaceAll('.', '\\.');
    // The name never ends in a dot, so a full stop after a link stays out of it.
    const match = new RegExp(`(?:https?://)?(?:www\\.)?${escaped}([A-Za-z0-9._-]*[A-Za-z0-9_-])`, 'i').exec(text ?? '');
    if (match) links.push({ service, url: `https://${prefix}${match[1]}`, label: `${prefix}${match[1]}`, at: match.index });
  }
  return links.sort((a, b) => a.at - b.at).map(({ at, ...link }) => link);
}
