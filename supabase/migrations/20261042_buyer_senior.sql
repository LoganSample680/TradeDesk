-- California Civ. Code §1689.6: a buyer 65 or older has five business days
-- (not three) to cancel a home improvement contract signed at home. The app
-- cannot know age, so the buyer says so at signing; this records it so the
-- hub and the contractor both count the right deadline.
alter table signed_proposals add column if not exists buyer_senior boolean default false;
