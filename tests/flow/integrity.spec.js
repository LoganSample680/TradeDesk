// Data-integrity invariants, checked against the LIVE account.
//
// The core rule the user wants enforced: multiple bids are fine, but no two bids
// may share the same id (a true duplicate). Same for clients. This scans the
// real loaded data after sign-in and fails, listing the offending id + names,
// if any duplicate id exists. It's also the definitive check for whether e.g.
// "TEsty Test" has two bids with the SAME id (a real dup) vs two distinct bids.
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn, finding } = require('./live-helpers');

test.describe('data integrity, id uniqueness invariants', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { await signIn(page); });

  test('no two bids share the same id', async ({ page }) => {
    const r = await page.evaluate(() => {
      const seen = {}, dupes = [];
      (typeof bids !== 'undefined' ? bids : []).forEach(b => {
        const id = String(b.id);
        const who = b.client_name || b.name || '?';
        if (seen[id] !== undefined) dupes.push({ id, names: [seen[id], who] });
        else seen[id] = who;
      });
      return { total: (typeof bids !== 'undefined' ? bids.length : 0), dupes };
    });
    expect(r.dupes, finding({
      page: 'bids[]', control: 'bid id uniqueness',
      rule: 'no two bids may share the same id (true duplicate)',
      expected: 'zero duplicate ids', got: r.dupes.length + ' dup id(s): ' + JSON.stringify(r.dupes.slice(0, 8)),
      suspect: 'bid creation / cloud merge (_pickBid)',
    })).toEqual([]);
  });

  test('no two clients share the same id', async ({ page }) => {
    const r = await page.evaluate(() => {
      const seen = {}, dupes = [];
      (typeof clients !== 'undefined' ? clients : []).forEach(c => {
        const id = String(c.id);
        if (seen[id] !== undefined) dupes.push({ id, names: [seen[id], c.name || '?'] });
        else seen[id] = c.name || '?';
      });
      return { dupes };
    });
    expect(r.dupes, finding({
      page: 'clients[]', control: 'client id uniqueness',
      rule: 'no two clients may share the same id',
      expected: 'zero duplicate ids', got: r.dupes.length + ' dup id(s): ' + JSON.stringify(r.dupes.slice(0, 8)),
      suspect: 'client creation / cloud merge',
    })).toEqual([]);
  });

  test('no two payments share the same id', async ({ page }) => {
    const r = await page.evaluate(() => {
      const seen = {}, dupes = [];
      (typeof payments !== 'undefined' ? payments : []).forEach(p => {
        const id = String(p.id);
        if (seen[id] !== undefined) dupes.push({ id, bids: [seen[id], p.bid_id] });
        else seen[id] = p.bid_id;
      });
      return { dupes };
    });
    expect(r.dupes, finding({
      page: 'payments[]', control: 'payment id uniqueness',
      rule: 'no two payments may share the same id',
      expected: 'zero duplicate ids', got: r.dupes.length + ' dup id(s): ' + JSON.stringify(r.dupes.slice(0, 8)),
      suspect: 'logPayment / cloud merge',
    })).toEqual([]);
  });
});
