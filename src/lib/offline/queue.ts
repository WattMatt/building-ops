/**
 * The per-user offline write queue. One IndexedDB key per operation so a write never rewrites
 * the whole queue; photo Files are stored inside the record (structured clone keeps them).
 * Separate from the read cache in src/lib/persist.ts, but keyed per user for the same reason:
 * one phone shared between two caretakers must never replay one user's writes as the other.
 */
import { createStore, get, set, del, keys, entries, clear, type UseStore } from 'idb-keyval';
import type { OpPayload, QueuedOp, QueuedPhoto } from './types';

export const queueStoreName = (uid: string) => `bo-queue-${uid}`;
const stores = new Map<string, UseStore>();
function storeFor(uid: string): UseStore {
  let s = stores.get(uid);
  if (!s) { s = createStore(queueStoreName(uid), 'ops'); stores.set(uid, s); }
  return s;
}

type Listener = () => void;
const listeners = new Set<Listener>();
/** Anything that renders queue state subscribes here; every mutation below notifies. */
export function subscribeQueue(fn: Listener): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
function emit() { for (const fn of listeners) fn(); }

export async function enqueue(uid: string, payload: OpPayload, photos: QueuedPhoto[]): Promise<QueuedOp> {
  const op: QueuedOp = { id: crypto.randomUUID(), uid, createdAt: Date.now(), attempts: 0, status: 'pending', lastError: null, payload, photos };
  await set(op.id, op, storeFor(uid));
  emit();
  return op;
}

export async function listOps(uid: string): Promise<QueuedOp[]> {
  const rows = (await entries<string, QueuedOp>(storeFor(uid))).map(([, v]) => v);
  return rows.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

export async function getOp(uid: string, id: string): Promise<QueuedOp | undefined> {
  return get<QueuedOp>(id, storeFor(uid));
}

export async function updateOp(uid: string, id: string, patch: Partial<Pick<QueuedOp, 'status' | 'lastError' | 'attempts'>>): Promise<void> {
  const cur = await get<QueuedOp>(id, storeFor(uid));
  if (!cur) return;
  await set(id, { ...cur, ...patch }, storeFor(uid));
  emit();
}

export async function removeOp(uid: string, id: string): Promise<void> {
  await del(id, storeFor(uid));
  emit();
}

export async function clearQueue(uid: string): Promise<void> {
  try { await clear(storeFor(uid)); } catch { /* store never created */ }
  emit();
}

export async function countOps(uid: string): Promise<number> {
  return (await keys(storeFor(uid))).length;
}
