-- Per-individual-user KPI tile order for the dashboard metric grid.
-- Mirrors dash_widget_order / nav_tab_order on the same user_prefs table.
-- RLS already covers the table (own-row select/insert/update) — no new policy needed.
alter table user_prefs add column if not exists kpi_order jsonb;
