/** A Revolut payment link (revolut.me/name) found in free text such as a bill's payment details. */
export interface RevolutLink {
  url: string;
  /** The Revolut username, e.g. "jonht". */
  handle: string;
}

/** The first revolut.me link in the text, with or without https:// and www.; null when there is none. */
export function findRevolutLink(text: string | null | undefined): RevolutLink | null {
  const match = /(?:https?:\/\/)?(?:www\.)?revolut\.me\/([A-Za-z0-9._-]+)/i.exec(text ?? '');
  return match ? { url: `https://revolut.me/${match[1]}`, handle: match[1] } : null;
}
