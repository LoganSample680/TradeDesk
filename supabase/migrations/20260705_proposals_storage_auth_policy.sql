-- Authenticated upload policy for the `proposals` storage bucket.
--
-- 20260609 created ANON insert/update policies on storage.objects for the proposals
-- bucket (the public signer in sign.html). But the contractor app uploads proposal
-- artifacts + client-hub snapshots as the AUTHENTICATED user, and that policy was
-- only ever added on the hosted project via the dashboard — never a migration. So a
-- fresh stack rejects authenticated uploads with "new row violates row-level security
-- policy" (storage POST 400), which fails every artifact/hub/sign upload spec.
--
-- This mirrors the hosted posture (bucket-scoped, same as the existing anon policy —
-- the real security boundary for a proposal is the unguessable token in its path).
-- Idempotent + a no-op on the cloud project.

do $$
begin
  execute 'create policy "auth_rw_proposals" on storage.objects
             for all to authenticated
             using (bucket_id = ''proposals'')
             with check (bucket_id = ''proposals'')';
exception when duplicate_object then null;
end $$;

-- Public read of proposal artifacts (sign.html / client.html open them anonymously).
-- The bucket is public=true (20260704), but assert an explicit anon SELECT too so a
-- non-public configuration still serves them.
do $$
begin
  execute 'create policy "anon_read_proposals" on storage.objects
             for select to anon
             using (bucket_id = ''proposals'')';
exception when duplicate_object then null;
end $$;
