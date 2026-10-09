/**
 * The confirmation to show before unfreezing a project with more members than the plan allows, or null when nobody
 * would be removed. Unfreezing removes the most recently added members beyond the limit (everyone but you on free).
 */
export function unfreezeWarning(memberCount: number, memberLimit: number | null): string | null {
  if (memberLimit === null || memberCount <= memberLimit) return null;
  const removed = memberCount - memberLimit;
  return memberLimit === 1
    ? `Your plan has no team members, so unfreezing removes the ${removed} other ${removed === 1 ? 'person' : 'people'} from this project. Unfreeze anyway?`
    : `Your plan allows ${memberLimit} members per project, so unfreezing removes the ${removed} most recently added ` +
        `${removed === 1 ? 'member' : 'members'} from this project. Unfreeze anyway?`;
}
