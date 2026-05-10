-- Migration: add licenses, events, checks_state columns to zj_data
-- Run once in Supabase SQL editor

alter table zj_data
  add column if not exists licenses text default '[]',
  add column if not exists events text default '[]',
  add column if not exists checks_state text default '{}';
