#!/usr/bin/env node
// Wait until Cloudflare has actually published this commit, then let the
// caller get on with whatever needed the new build to be live.
//
// WHY IT DOES NOT ASK THE SITE. The first version of this polled
// https://tradedeskpro.app/version.json in a loop and compared it to the
// repo's. It never once got an answer: run 2 of indexnow.yml (2026-09-12)
// printed "serving '?'" forty times over ten minutes and then warned and gave
// up, on a deploy that had in fact gone out nine minutes earlier. Cloudflare
// answers a plain curl with a bot challenge rather than the file, which is the
// same reason the preview smoke has to carry an x-e2e-bypass header. Leaning
// on that header here would make a recrawl depend on a WAF rule nobody would
// think to check.
//
// So ask the thing that did the deploy instead. The Cloudflare Pages GitHub
// integration posts a deployment_status for every build, and a SUCCESS status
// on this exact SHA is the deploy, stated at the source, with no network path
// to the public site involved. GITHUB_TOKEN already reaches it.
//
// It NEVER fails. Waiting is a best effort; the caller's job (asking search
// engines to recrawl) is worth doing a couple of minutes early, and is not
// worth abandoning because a status never showed up.
const TRIES = 40;
const SLEEP_MS = 15000;          // 40 * 15s = 10 minutes, the ceiling
// GitHub Pages publishes a stale mirror of this repo from the same commits.
// Its deployment succeeds too and means nothing here, exactly as it meant
// nothing to the preview smoke (which learned this the same way, 2026-07-02).
const IGNORE_ENV = 'github-pages';

const repo = process.env.GITHUB_REPOSITORY;
const sha = process.env.GITHUB_SHA;
const token = process.env.GITHUB_TOKEN;

const api = async (path) => {
  const r = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${path}`);
  return r.json();
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (!repo || !sha || !token) {
    console.log('::warning::wait-for-deploy: no GitHub context, not waiting');
    return;
  }
  console.log(`waiting for a successful deployment of ${sha.slice(0, 7)}`);
  for (let i = 0; i < TRIES; i++) {
    try {
      const deps = await api(`/deployments?sha=${sha}&per_page=30`);
      for (const d of deps) {
        if (d.environment === IGNORE_ENV) continue;
        const sts = await api(`/deployments/${d.id}/statuses?per_page=30`);
        const hit = sts.find((s) => s.state === 'success');
        if (hit) {
          console.log(`deployed: ${d.environment} → ${hit.environment_url || '(no url)'}`);
          return;
        }
      }
      const seen = deps.map((d) => d.environment).join(', ') || 'nothing yet';
      console.log(`  ${seen} …`);
    } catch (e) {
      // A blip in the API is not a reason to stop waiting.
      console.log(`  (${e.message})`);
    }
    await sleep(SLEEP_MS);
  }
  console.log(`::warning::no successful deployment of ${sha.slice(0, 7)} within ${(TRIES * SLEEP_MS) / 60000} minutes; continuing anyway`);
})();
