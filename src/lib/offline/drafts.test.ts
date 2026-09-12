import { describe, it, expect, beforeEach } from 'vitest';
import { File as NodeFile } from 'node:buffer';
import { saveIssueDraft, readIssueDraft, clearIssueDraft, clearDraftStore, draftStoreName, type IssueDraft } from './drafts';

// Same guard as queue.test.ts: fake-indexeddb clones with Node's structuredClone, which flattens
// jsdom's pure-JS File to {} and, on Node 20/22, drops a node:buffer File's name. Browsers always
// carry File through IndexedDB; this protects the test double only.
const fileSurvivesClone = (() => {
  try {
    const f = new NodeFile(['x'], 'p.jpg', { type: 'image/jpeg' });
    return structuredClone(f)?.name === 'p.jpg';
  } catch {
    return false;
  }
})();

const draft: IssueDraft = {
  title: 'Lift out of service',
  description: 'Lift 2 stuck on ground floor.',
  buildingId: 'b1',
  priority: 'high',
  photos: [],
  savedAt: 1_757_000_000_000,
};

describe('issue draft store', () => {
  beforeEach(async () => { await clearDraftStore('u1'); await clearDraftStore('u2'); });

  it('reads null before anything is saved', async () => {
    expect(await readIssueDraft('u1')).toBeNull();
  });

  it('round-trips one draft per user and clears it', async () => {
    await saveIssueDraft('u1', draft);
    expect(await readIssueDraft('u1')).toEqual(draft);
    expect(await readIssueDraft('u2')).toBeNull();
    await clearIssueDraft('u1');
    expect(await readIssueDraft('u1')).toBeNull();
  });

  it('overwrites rather than accumulates', async () => {
    await saveIssueDraft('u1', draft);
    await saveIssueDraft('u1', { ...draft, title: 'Lift back in service', savedAt: draft.savedAt + 1 });
    expect((await readIssueDraft('u1'))?.title).toBe('Lift back in service');
  });

  it.skipIf(!fileSurvivesClone)('keeps the photo files with their name, type and size', async () => {
    const file = new NodeFile(['abc'], 'fault.jpg', { type: 'image/jpeg' }) as unknown as File;
    await saveIssueDraft('u1', { ...draft, photos: [file] });
    const back = await readIssueDraft('u1');
    expect(back?.photos).toHaveLength(1);
    expect(back!.photos[0]).toMatchObject({ name: 'fault.jpg', type: 'image/jpeg', size: 3 });
    expect(await back!.photos[0].text()).toBe('abc');
  });

  it('clearDraftStore empties that user only, and tolerates a store that was never created', async () => {
    await saveIssueDraft('u1', draft);
    await saveIssueDraft('u2', draft);
    await clearDraftStore('u1');
    await expect(clearDraftStore('never-seen')).resolves.toBeUndefined();
    expect(await readIssueDraft('u1')).toBeNull();
    expect(await readIssueDraft('u2')).toEqual(draft);
  });

  it('names the store per user', () => {
    expect(draftStoreName('u1')).toBe('bo-drafts-u1');
  });
});
