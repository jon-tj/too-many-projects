/** A payment link (revolut.me/name or paypal.me/name) found in free text such as an invoice's payment details. */
export interface PaymentLink {
  /** "Revolut" or "PayPal". */
  service: string;
  url: string;
  /** The link as written on paper, e.g. "paypal.me/jontjem". */
  label: string;
}

const SERVICES = [
  { service: 'Revolut', host: 'revolut.me' },
  { service: 'PayPal', host: 'paypal.me' },
];

/**
 * The first revolut.me and paypal.me links in the text, with or without https:// and www., in the order the text has
 * them; empty when there are none.
 */
export function findPaymentLinks(text: string | null | undefined): PaymentLink[] {
  const links: (PaymentLink & { at: number })[] = [];
  for (const { service, host } of SERVICES) {
    const match = new RegExp(`(?:https?://)?(?:www\.)?${host.replace('.', '\.')}/([A-Za-z0-9._-]+)`, 'i').exec(text ?? '');
    if (match) links.push({ service, url: `https://${host}/${match[1]}`, label: `${host}/${match[1]}`, at: match.index });
  }
  return links.sort((a, b) => a.at - b.at).map(({ at, ...link }) => link);
}
