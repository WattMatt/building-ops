/**
 * A New Issue form half-filled on a phone must survive the camera: iOS evicts a background tab
 * freely, and the user comes back to a reloaded page with an empty form and no photo. This is
 * one record per user in its own idb-keyval store — `bo-drafts-<uid>`, built the same way as
 * the write queue's `bo-queue-<uid>` — holding the fields and the already-processed JPEG Files
 * (structured clone keeps them, exactly as the queue relies on).
 *
 * Keyed per user and cleared with the queue on user change (PersistedQueryProvider): a phone
 * shared between two caretakers must never show one person's half-written report to the next.
 * Reads never throw — an unreadable store just means the form starts empty.
 */
import { createStore, get, set, del, clear, type UseStore } from 'idb-keyval';
import type { IssuePriority } from '@/lib/constants';

export interface IssueDraft {
  title: string;
  description: string;
  buildingId: string;
  priority: IssuePriority;
  /** Compressed JPEGs as PhotoCapture produced them; previews are recreated on restore. */
  photos: File[];
  savedAt: number;
}

export const draftStoreName = (uid: string) => `bo-drafts-${uid}`;
/** One draft per user today; the key leaves room for other forms later without a new store. */
const ISSUE_KEY = 'issue';

const stores = new Map<string, UseStore>();
function storeFor(uid: string): UseStore {
  let s = stores.get(uid);
  if (!s) { s = createStore(draftStoreName(uid), 'drafts'); stores.set(uid, s); }
  return s;
}

export async function saveIssueDraft(uid: string, draft: IssueDraft): Promise<void> {
  await set(ISSUE_KEY, draft, storeFor(uid));
}

export async function readIssueDraft(uid: string): Promise<IssueDraft | null> {
  try {
    return (await get<IssueDraft>(ISSUE_KEY, storeFor(uid))) ?? null;
  } catch {
    return null;
  }
}

export async function clearIssueDraft(uid: string): Promise<void> {
  try { await del(ISSUE_KEY, storeFor(uid)); } catch { /* store never created */ }
}

/** Every draft this user left on the device. Called next to clearQueue on user change. */
export async function clearDraftStore(uid: string): Promise<void> {
  try { await clear(storeFor(uid)); } catch { /* store never created */ }
}
