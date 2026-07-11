-- Payroll liability calc (_calcPayrollLiability, js/tax.js) must never run FICA/FUTA
-- against a 1099 subcontractor — they're self-employed and cover their own SE tax
-- (the existing _calcSeTax path), not W-2 payroll tax. team_members had no field to
-- tell the two apart. Defaults to 'w2' since that's the crew-employee majority case;
-- existing rows are unaffected until explicitly marked '1099'.
alter table team_members add column if not exists employment_type text default 'w2';
