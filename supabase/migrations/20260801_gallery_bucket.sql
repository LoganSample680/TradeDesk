-- The `gallery` storage bucket backs every job/before-after/standalone photo upload
-- (js/jobs.js addJobPhoto/_drainPhotoQueue/_uploadPhotoThumb, js/proposals.js
-- processGalleryUpload/_ensureLogoUrl) — but, like `proposals` before it (see
-- 20260704_local_grants_and_storage.sql / 20260705_proposals_storage_auth_policy.sql),
-- it was never created by a migration. Root-caused via a live flow test
-- (egress-guard-flow.spec.js) actually exercising a real upload for the first time:
-- every _supa.storage.from('gallery').upload(...) 400s "Bucket not found" against the
-- Dev project. The app's own error handling hides this from users — addJobPhoto marks
-- the photo pendingUpload and keeps it as base64 for _drainPhotoQueue to retry forever
-- — so photos have been silently staying base64-only (never reaching real storage,
-- never getting a thumbnail) instead of throwing a visible error. That base64-forever
-- retry loop is itself an egress contributor, on top of the intended fix (compressed
-- main + thumbnail instead of raw bytes) never taking effect.
--
-- Idempotent + a no-op on any project where the bucket + policies already exist
-- (e.g. if the hosted project already has this via the dashboard).

insert into storage.buckets (id, name, public)
values ('gallery', 'gallery', true)
on conflict (id) do nothing;

-- Authenticated read/write/delete — the contractor app uploads, downloads (thumb
-- verification), and removes (proposals.js:84 photo delete) as the authenticated user.
do $$
begin
  execute 'create policy "auth_rw_gallery" on storage.objects
             for all to authenticated
             using (bucket_id = ''gallery'')
             with check (bucket_id = ''gallery'')';
exception when duplicate_object then null;
end $$;

-- Public read — client hub (client.html) and the sign portal display job/before-after
-- photos anonymously. The bucket is public=true above, but assert an explicit anon
-- SELECT too so a non-public configuration still serves them (mirrors the proposals
-- bucket's belt-and-suspenders anon_read policy).
do $$
begin
  execute 'create policy "anon_read_gallery" on storage.objects
             for select to anon
             using (bucket_id = ''gallery'')';
exception when duplicate_object then null;
end $$;
