import type { AssetApprovalStatus } from '../images/types.js';

export type ImageRequestAccess =
  | { role: 'admin' }
  | { role: 'contributor'; profile: { id: string } };

/** Approved images are public; pending/revoked images are private to their owner and admins. */
export function canReadImageAsset(
  approvalStatus: AssetApprovalStatus,
  contributorId: string | undefined,
  access: ImageRequestAccess | undefined
): boolean {
  if (approvalStatus === 'approved') return true;
  if (access?.role === 'admin') return true;
  return access?.role === 'contributor' && Boolean(contributorId) && access.profile.id === contributorId;
}
