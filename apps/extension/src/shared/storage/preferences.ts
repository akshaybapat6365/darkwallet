import { EXTENSION_STORAGE_KEYS } from '../config';

export type ApprovalMap = Record<string, { grantedAt: string }>;

export const getApprovals = async (): Promise<ApprovalMap> => {
  const raw = await chrome.storage.local.get(EXTENSION_STORAGE_KEYS.approvals);
  return (raw[EXTENSION_STORAGE_KEYS.approvals] as ApprovalMap | undefined) ?? {};
};

export const grantApproval = async (origin: string): Promise<void> => {
  const approvals = await getApprovals();
  approvals[origin] = { grantedAt: new Date().toISOString() };
  await chrome.storage.local.set({ [EXTENSION_STORAGE_KEYS.approvals]: approvals });
};
