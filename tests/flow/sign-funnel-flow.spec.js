// REAL flow — the client signing funnel (task #17): upload a real proposal
// snapshot to the proposals bucket (exactly the key sign.html resolves from
// ?t/?u/?b), then open the REAL sign.html as the client (anon, isolated auth) and
// drive the signature step — type the legal name, accept the UETA e-sign consent,
// and assert the "Continue to payment" button unlocks. This proves the
// revenue-critical signing entry point loads a live proposal and the consent gate
// works, without committing to the Stripe/cash submission branch (that writes via
// an edge function and is covered separately).
//
//   suspect chain: sign.html loadProposal (storage fetch by key) → checkReady
//   (name + UETA consent unlock the continue button).
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn, step, report, resetLedger, seedProposal } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'sign/signature-step';

test.describe('client signing funnel (UI-driven)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('a sent proposal opens in sign.html and the signature step unlocks', async ({ page }) => {
    const clientId = Date.now() * 1000 + (process.pid % 1000);
    const bidId = clientId + 1;

    // ── Upload a real proposal snapshot at the exact key sign.html reads. ──
    let ctx = {};
    await step(page, {
      label: 'send proposal → upload signing snapshot', page: 'cloud', role: 'contractor',
      suspect: 'storage proposals/<uid>/<bid>_<token>.json upload',
      ruleText: 'uploading the proposal snapshot must succeed and return the signing key',
      expected: 'upload ok + token/uid present',
      act: async (p) => {
        // Seed a REAL typed-up, sent proposal (random client/address, real
        // proposalHtml document, artifact uploaded) — sign.html opens it for real.
        ctx = await seedProposal(p, { clientId, bidId, amount: 3200, tag: 'sign' });
        return 1;
      },
      rule: async () => ({ ok: !ctx.uploadErr && !!ctx.token && !!ctx.uid, got: `err=${ctx.uploadErr} token=${!!ctx.token} uid=${!!ctx.uid}` }),
    });

    // ── Open the REAL sign.html as the client and drive the signature step. ──
    await step(page, {
      label: 'open sign.html → type name + accept UETA → continue unlocks', page: 'sign.html', role: 'client',
      suspect: 'sign.html loadProposal + checkReady (name + UETA gate)',
      ruleText: 'after typing the legal name and accepting e-sign consent, the Continue button must enable',
      expected: '#sign-btn enabled (not disabled)',
      act: async (p) => {
        const signPage = await p.context().newPage();
        const url = `/sign.html?t=${ctx.token}&u=${ctx.uid}&b=${bidId}`;
        let unlocked = false, got = '';
        for (let i = 0; i < 4 && !unlocked; i++) {
          await signPage.goto(url + '&cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
          // The proposal must load first (Step 1 "Review" shows #approve-btn). If the
          // page is stuck on the error screen the proposal didn't load — surface that.
          const loaded = await signPage.waitForSelector('#approve-btn', { state: 'visible', timeout: 12000 }).then(() => true).catch(() => false);
          if (!loaded) {
            const errVisible = await signPage.locator('#pg-err').isVisible().catch(() => false);
            got = `attempt=${i + 1} proposal did not load (approve-btn never shown, pg-err=${errVisible})`;
            await signPage.waitForTimeout(2200);
            continue;
          }
          // #sig-name lives in Step 3 (#pg-sign-action), hidden until the client drives
          // the REAL funnel: Approve & Sign → (painting+surfaces) color-pick →
          // "Continue to sign →". Click through exactly as a client would.
          await signPage.locator('#approve-btn').click({ timeout: 8000 }).catch(() => {});
          // Painting proposal with surfaces routes to the color-pick step; its
          // "Continue to sign →" button calls _goToSignPad() → reveals #sig-name.
          const onColorPick = await signPage.waitForSelector('#pg-color-pick', { state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
          if (onColorPick) {
            await signPage.locator('#pg-color-pick button.btn').click({ timeout: 8000 }).catch(() => {});
          }
          const padReady = await signPage.waitForSelector('#sig-name', { state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
          if (padReady) {
            // Type the legal name key-by-key, then tick the UETA consent checkbox.
            await signPage.locator('#sig-name').click({ timeout: 8000 }).catch(() => {});
            await signPage.locator('#sig-name').pressSequentially('Jordan E Client', { delay: 0 }).catch(() => {});
            const ck = signPage.locator('#sig-ck');
            if (await ck.count()) await ck.check({ timeout: 5000 }).catch(() => {});
            await signPage.waitForTimeout(400);
            unlocked = await signPage.locator('#sign-btn').isEnabled().catch(() => false);
            got = `attempt=${i + 1} signBtnEnabled=${unlocked}`;
          } else {
            got = `attempt=${i + 1} reached approve but sign pad (#sig-name) never revealed`;
          }
          if (!unlocked) await signPage.waitForTimeout(2200);
        }
        ctx.render = { unlocked, got };
        await signPage.close().catch(() => {});
        return 'Jordan E Client'.length + 4; // approve + continue-to-sign + name tap + name typed + consent tick
      },
      rule: async () => ({ ok: ctx.render.unlocked, got: ctx.render.got }),
    });

    // NO cleanup — the client, bid + proposal snapshot stay in the dev account on
    // purpose so the owner can inspect what this test created (CLAUDE.md §13.7).

    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });
});
