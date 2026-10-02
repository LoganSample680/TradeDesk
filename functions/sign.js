// /sign (and /sign.html): Review and sign, with the contractor's name and
// logo on the link preview. lib/link-preview.mjs says why and how.
import { brandedPage, fetchJsonQuick } from '../lib/link-preview.mjs';

export async function onRequest(context) {
  return brandedPage('sign', context.request, () => context.next(), fetchJsonQuick);
}
