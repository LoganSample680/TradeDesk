-- The Photos page (js/photo-gallery.js, owner 2026-09-24) gets its chart name.
-- Every screen the app can show has a row here, or it renders as its code
-- name on the usage chart (tests/e2e-telemetry.spec.js). Additive only.
insert into analytics_screen_names (screen, label, sort) values
  ('pg-photos', 'Photos', 93)
on conflict (screen) do update set label = excluded.label, sort = excluded.sort;
