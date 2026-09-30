// The texted link wears the contractor's brand (owner 2026-09-30: "I want
// this to really be branded to them ... shows their logo proud and large so
// it's unmistakable as to what it is").
//
// client.html and sign.html are static and carry no preview tags, so iMessage
// showed "Your Project Hub" beside a blank box. functions/client.js and
// functions/sign.js run this on the way out: read the contractor's name and
// logo from the JSON the link already opens (public, and only what the link
// itself exposes), and add og:title, og:image and a large card. Anything that
// fails serves the page exactly as before, so a preview can never break a link.

export const SUPABASE = 'https://mwtsmctajhrrybblgorf.supabase.co';
const GALLERY = SUPABASE + '/storage/v1/object/public/gallery/';

const HEX = /^[a-f0-9]{8,64}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUM = /^\d{1,20}$/;

// Which JSON the page will read, from its own query string. Null when the
// link is not one we can vouch for.
export function previewKey(page, params) {
  const t = params.get('t') || '', u = params.get('u') || '';
  if (!HEX.test(t) || !UUID.test(u)) return null;
  if (page === 'client') {
    const c = params.get('c') || '';
    return NUM.test(c) ? `client-hub/${u}/${c}_${t}.json` : null;
  }
  if (page === 'sign') {
    const b = params.get('b') || '';
    return NUM.test(b) ? `proposals/${u}/${b}_${t}.json` : null;
  }
  return null;
}

// The name and logo out of either JSON shape (hub: contractorName, proposal:
// businessName). The logo only when it is his stored gallery file, served
// through our own edge-cached image route so the preview loads fast.
export function previewBrand(json, origin) {
  if (!json || typeof json !== 'object') return null;
  const name = String(json.businessName || json.contractorName || json.bname || '').trim().slice(0, 80);
  const raw = String(json.logoUrl || '');
  let image = '';
  if (raw.startsWith(GALLERY) && !/["'<>\s]/.test(raw)) image = origin + '/img/gallery/' + raw.slice(GALLERY.length);
  if (!name && !image) return null;
  return { name, image };
}

export function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// The tags, in the words a customer reads on a text thread.
export function previewTags(brand, page) {
  const title = brand.name ? (page === 'sign' ? brand.name + ': your proposal' : brand.name + ': your project') : '';
  const desc = page === 'sign' ? 'Review and sign your proposal.' : 'Your proposal, schedule, invoices and payments in one place.';
  const t = [];
  if (title) t.push(`<meta property="og:title" content="${escAttr(title)}">`, `<meta name="twitter:title" content="${escAttr(title)}">`);
  t.push(`<meta property="og:description" content="${escAttr(desc)}">`);
  if (brand.name) t.push(`<meta property="og:site_name" content="${escAttr(brand.name)}">`);
  if (brand.image) {
    t.push(`<meta property="og:image" content="${escAttr(brand.image)}">`,
      `<meta name="twitter:image" content="${escAttr(brand.image)}">`,
      `<meta name="twitter:card" content="summary_large_image">`,
      `<link rel="apple-touch-icon" href="${escAttr(brand.image)}">`);
  }
  return { title, html: t.join('') };
}

// The whole step, for a Pages Function. fetchJson and nextPage are handed in
// so this stays testable offline.
export async function brandedPage(page, request, nextPage, fetchJson) {
  const res = await nextPage();
  try {
    if (request.method !== 'GET') return res;
    if (!(res.headers.get('content-type') || '').includes('text/html')) return res;
    const url = new URL(request.url);
    const key = previewKey(page, url.searchParams);
    if (!key) return res;
    const json = await fetchJson(`${SUPABASE}/storage/v1/object/public/proposals/${key}`);
    const brand = previewBrand(json, url.origin);
    if (!brand) return res;
    const tags = previewTags(brand, page);
    let rw = new HTMLRewriter().on('head', { element(el) { el.append(tags.html, { html: true }); } });
    if (tags.title) rw = rw.on('title', { element(el) { el.setInnerContent(tags.title); } });
    return rw.transform(res);
  } catch (_e) {
    return res;
  }
}

export async function fetchJsonQuick(url, ms = 1500) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, cf: { cacheTtl: 60 } });
    if (!r.ok) return null;
    return await r.json();
  } catch (_e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
