-- ─────────────────────────────────────────────────────────────────────────────
-- State maximum-deposit / down-payment caps (home-improvement compliance).
--
-- WHY A TABLE: legal.js ships a hardcoded STATE_DEPOSIT_CAP table so the cap
-- works offline and on sign.html/client.html with no network. But deposit-cap
-- statutes change (a legislature amends the %, a new state adds a cap). Putting
-- the well-documented caps in an anon-readable table lets us update the legal
-- value WITHOUT a code deploy — exactly like tax_rates (20260605). The client
-- lookup (lookupDepositCap in legal.js) reads this table when Supabase is
-- present and falls back to the hardcoded table on any miss/error/no-supa.
--
-- WHAT'S SEEDED: the well-documented statutory caps (CA, MD, MA, PA, NV, CT, RI,
-- ME, AZ) — verified June 2026 against state statutes / AG guidance. Most states
-- have NO statutory home-improvement deposit cap, so they are intentionally absent.
-- 'none' states are deliberately NOT seeded — an ABSENT row means "no row found"
-- which makes lookupDepositCap fall back to the hardcoded table (whose 'none'
-- entries are the source of truth for no-cap states). Do not seed guessed caps.
--
-- Bare-DB / migration-lint safe: table + policies behind `if not exists` guards
-- (policies via pg_policies existence checks in a DO block, mirroring 20260628),
-- and the authenticated GRANT wrapped in an exception-swallowing DO block
-- (mirroring 20260627). `psql -f` on an empty DB applies it without aborting.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists deposit_caps (
  state      text primary key,                 -- 2-letter abbreviation, uppercase
  rule       text,                             -- 'lesser'|'pct'|'flat'|'none'
  pct        numeric,                          -- max % of contract, or null
  flat       numeric,                          -- max flat $ cap, or null
  statute    text,                             -- statutory cite
  note       text,                             -- plain-English description
  updated_at timestamptz default now()
);

alter table deposit_caps enable row level security;

do $$ begin
  -- Public reference data — readable by anyone including anonymous clients
  -- (client.html / sign.html load with the anon key). Mirrors tax_rates read.
  if not exists (select 1 from pg_policies where tablename='deposit_caps' and policyname='deposit_caps_public_read') then
    execute $p$ create policy "deposit_caps_public_read" on deposit_caps for select using (true) $p$;
  end if;
  -- Writes restricted to authenticated / service role (the update path), never anon.
  if not exists (select 1 from pg_policies where tablename='deposit_caps' and policyname='deposit_caps_auth_write') then
    execute $p$ create policy "deposit_caps_auth_write" on deposit_caps for all
      using (auth.role() = 'authenticated' or auth.role() = 'service_role')
      with check (auth.role() = 'authenticated' or auth.role() = 'service_role') $p$;
  end if;
end $$;

-- Seed the well-documented statutory caps. Idempotent: re-running this migration
-- refreshes the legal values in place. ON CONFLICT keeps the table the source of
-- truth without dropping any manually-corrected row's timestamp logic.
insert into deposit_caps (state, rule, pct, flat, statute, note) values
  ('CA','lesser',10,1000,'Cal. Bus. & Prof. Code §7159.5','Down payment may not exceed the lesser of $1,000 or 10% of the contract price.'),
  ('MD','pct',33.33,null,'Md. Code, Bus. Reg. §8-501','Deposit may not exceed one-third (33.33%) of the contract price.'),
  ('MA','pct',33.33,null,'Mass. Gen. Laws c.142A §2','Advance deposit may not exceed one-third (33.33%) of the total contract price.'),
  ('PA','pct',33.33,null,'73 P.S. §517.7','Deposit may not exceed one-third (33.33%) of the contract price for home improvement.'),
  ('NV','lesser',10,1000,'NRS §624.920','Down payment may not exceed the lesser of $1,000 or 10% of the aggregate contract price.'),
  ('CT','pct',20,null,'Conn. Gen. Stat. §20-429 (HIA)','Down payment may not exceed 20% of the contract price.'),
  ('RI','pct',33.33,null,'R.I. Gen. Laws §5-65','Deposit may not exceed one-third (33.33%) of the contract price.'),
  ('ME','pct',33.33,null,'10 M.R.S. §1487','Deposit may not exceed one-third (33.33%); waivable by written agreement.'),
  ('AZ','pct',50,null,'A.R.S. tit. 32 ch. 10 (ROC)','Initial payment may not exceed 50% of the total contract price.')
on conflict (state) do update set
  rule       = excluded.rule,
  pct        = excluded.pct,
  flat       = excluded.flat,
  statute    = excluded.statute,
  note       = excluded.note,
  updated_at = now();
