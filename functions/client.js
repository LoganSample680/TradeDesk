// /client (and /client.html, which Pages serves as /client): the client hub,
// with the contractor's name and logo on the texted link's preview.
// lib/link-preview.mjs says why and how.
import { brandedPage, fetchJsonQuick } from '../lib/link-preview.mjs';

export async function onRequest(context) {
  return brandedPage('client', context.request, () => context.next(), fetchJsonQuick);
}
