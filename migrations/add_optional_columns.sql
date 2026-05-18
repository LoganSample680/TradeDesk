-- Migration: add all optional columns that the app writes via best-effort Parts 2-5.
-- Safe to run multiple times (uses IF NOT EXISTS / idempotent).
-- Run in Supabase → SQL Editor → New query.

alter table zj_data
  -- Part 2 columns (critical history — added here for schema completeness)
  add column if not exists income          text default '[]',
  add column if not exists expenses        text default '[]',
  add column if not exists mileage         text default '[]',
  add column if not exists time_entries    text default '[]',
  add column if not exists receipt_images  text default '{}',

  -- Part 3 columns (best-effort optional)
  add column if not exists licenses        text default '[]',
  add column if not exists events          text default '[]',
  add column if not exists checks_state    text default '{}',

  -- Part 4 — maintenance contracts
  add column if not exists contracts       text default '[]',

  -- Part 5 — gallery photo metadata (public URLs + storagePaths; no base64 blobs)
  add column if not exists gallery_photos  text default '[]';
