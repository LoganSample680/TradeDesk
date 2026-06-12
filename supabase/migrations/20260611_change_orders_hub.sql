-- Remote change-order e-signature via the client hub.
-- The contractor sends a change order to the hub; the client reviews and signs
-- it in client.html. State lives on the bid's signed_proposals row as a jsonb
-- array of {coNum, desc, type, amount, delta, originalAmount, newAmount,
-- sentAt, signedAt, signerName, signatureData}. Anon already has select/insert/
-- update on signed_proposals (see 20260610_portfolio_cols_signed_proposals.sql),
-- so no new policies are needed — only the column.
alter table signed_proposals
  add column if not exists change_orders jsonb;
