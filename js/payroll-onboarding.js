// ── W-2 Payroll Setup Checklist ─────────────────────────────────────────
// Federal steps are the same for every business — safe to hardcode. State
// steps come from STATE_PAYROLL_SETUP, populated from real state-agency
// research (agency names, workers' comp rules, SDI, local tax flags). If a
// state isn't in the table yet, generic guidance is shown instead of a guess.
// This is a compliance checklist, not tax/legal advice.

// One-time BUSINESS setup — register once, done forever. Per-hire paperwork
// (W-4, I-9, new-hire report) deliberately does NOT live here: it repeats for
// every single hire, so it's tracked per employee in _PAYROLL_HIRE_STEPS.
const _FEDERAL_PAYROLL_SETUP=[
  {key:'ein',label:'Get an EIN (federal Employer Identification Number)',note:'Free and instant at IRS.gov. Required before you can legally pay any employee.'},
  {key:'eftps',label:'Register for EFTPS',note:'The federal system you use to deposit every federal payroll tax — FICA, FUTA, AND federal income tax withheld from paychecks.'},
  {key:'workersComp',label:'Get workers\' comp insurance',note:'Required in nearly every state once you have employees. Rules vary by state — see below.'},
  {key:'posters',label:'Post required federal labor law posters',note:'Where every employee can see them — breakroom, shop, jobsite trailer.'},
];
// Paperwork that repeats for EVERY hire — tracked per employee on the
// employee record (e.hirePaperwork), unlike the one-time business setup
// above. Hiring employee #2 restarts this list from zero for that person.
const _PAYROLL_HIRE_STEPS=[
  {key:'w4',label:'Signed federal Form W-4',note:'Sets their federal income tax withholding. Keep it on file — don\'t submit it anywhere.'},
  {key:'stateW4',label:'State withholding form',note:'Most income-tax states have their own W-4 equivalent — check your state revenue department.'},
  {key:'i9',label:'Form I-9 within 3 business days',note:'Verifies identity and work eligibility. Keep it on file — don\'t submit it anywhere.'},
  {key:'newHireReport',label:'Report the hire to your state\'s New Hire Directory',note:'Federally required within 20 days of hire — some states give you less.'},
  {key:'wcCarrier',label:'Tell your workers\' comp carrier',note:'Premiums are payroll-based — keeping headcount current avoids a surprise bill at your annual audit.'},
];
// Recurring obligations — these never "complete," so they're reference lines,
// not checkboxes. Cadences are the federal defaults for a new small employer.
const _PAYROLL_ONGOING=[
  {label:'Every payday',note:'Withhold federal income tax (per their W-4), state income tax, and the employee\'s FICA share — and set aside your matching employer FICA. The Payroll tab computes the FICA side; withholding needs payroll software or your accountant.'},
  {label:'Monthly deposits',note:'Send everything withheld plus your FICA match to the IRS through EFTPS. New employers are monthly depositors by default — due the 15th of the following month.'},
  {label:'Every quarter',note:'File federal Form 941, plus your state withholding return and state unemployment (SUTA) wage report on your state\'s schedule.'},
  {label:'Every January',note:'File Form 940 (FUTA) and get each employee their W-2 — both due January 31. W-2s also get filed with the Social Security Administration.'},
];

// Filled in from real, sourced state-agency research. Missing state = generic
// guidance shown instead of an invented agency name.
const STATE_PAYROLL_SETUP={
AK:{
  suta:{agency:'Alaska Department of Labor and Workforce Development (Employment Security Tax / ESD)',note:'New employers register online for an 8-digit Employer Account Number via the Alaska DOLWD Employment Security Tax portal. Notable: Alaska is one of a small number of states that also requires an EMPLOYEE-side UI contribution withheld by the employer, in addition to the employer\'s own UI tax.'},
  workersComp:{required:true,threshold:'1 or more employees — no minimum threshold; coverage required from the first hire',system:'private insurance (competitive market)',note:'Not a monopolistic state. Employers unable to get voluntary market coverage can use Alaska\'s Assigned Risk Pool (administered via NCCI). Self-insurance possible with Board approval.'},
  sdi:{required:false},
  localTax:{present:false,note:'Alaska has no state income tax and no local city/borough income or wage taxes; municipalities may levy local sales taxes but not income/wage taxes.'}
},
AL:{
  suta:{agency:'Alabama Department of Labor',note:'New employers register via Form SR-2 (Application to Determine Liability) through the ADOL eGov portal as soon as liability is established. New-employer SUTA rate is 2.7% for 2026. New hires must also be reported within 7 days.'},
  workersComp:{required:true,threshold:'5 or more employees (regularly employed) — includes corporate officers and LLC members counted toward the 5',system:'private insurance',note:'Businesses with fewer than 5 employees are not required to carry coverage (may do so voluntarily), EXCEPT construction contractors working on single-family detached residential dwellings, who must carry coverage regardless of employee count. Domestic employees, farm laborers, casual employees exempt.'},
  sdi:{required:false},
  localTax:{present:true,note:'Several Alabama cities/counties (e.g., Birmingham — 1% Occupational Tax, withheld by employer, Ordinance 20-38) levy an occupational/wage tax on income earned within their limits — administered locally (e.g., via Avenu as third-party administrator for Birmingham), no single statewide portal.'}
},
AR:{
  suta:{agency:'Arkansas Division of Workforce Services (DWS)',note:'New employers register for a UI employer account number through the Arkansas.gov portal / DWS EZARC system as soon as liability is established.'},
  workersComp:{required:true,threshold:'3 or more employees for most industries; construction businesses at 2 employees; construction subcontractors at 1 employee',system:'private insurance',note:'Farm laborers, real estate agents, domestic workers, and employees of religious/nonprofit/charitable organizations are exempt. Employers below the general threshold should confirm status with the Arkansas Workers\' Compensation Commission since exceptions/industry rules vary.'},
  sdi:{required:false},
  localTax:{present:false,note:'Arkansas does not allow municipalities or counties to levy local income/wage taxes — no city or county payroll withholding tax exists in the state (only local sales taxes).'}
},
AZ:{
  suta:{agency:'Arizona Department of Economic Security (DES)',note:'New employers register via the Arizona Joint Tax Application (Form JT-1/UC-001) filed with the Arizona Dept of Revenue, which forwards employer info to DES. New-employer UI rate is 2.0% for a minimum of 2 calendar years. DES then issues an 8-digit UI employer account number.'},
  workersComp:{required:true,threshold:'1 or more employees — no minimum threshold',system:'private insurance, with a competitive state fund option (CopperPoint Mutual Insurance Company, formerly the state compensation fund)',note:'Independent contractors and domestic workers in private homes are exempt. Operating without required coverage is a Class 6 felony with escalating civil fines ($1,000 to $10,000).'},
  sdi:{required:false},
  localTax:{present:false,note:'Arizona law explicitly prohibits cities and counties from levying their own income/wage taxes — no local income tax anywhere in the state (cities may still require a business license).'}
},
CA:{
  suta:{agency:'California Employment Development Department (EDD)',note:'Combined registration gives employers one EDD account ID used for both income tax withholding and UI. Register online via EDD e-Services for Business. New-employer SUI rate is a flat 3.4% until an experience rating is established (roughly 1.5%–6.2% range for experienced employers in 2026).'},
  workersComp:{required:true,threshold:'1 or more employees, including part-time and seasonal workers — no minimum threshold',system:'private insurance, with a competitive state fund option (State Compensation Insurance Fund / SCIF), which also serves as insurer of last resort',note:'Not monopolistic — private carriers, SCIF, or an agent can all be used. Noncompliance is a criminal misdemeanor with fines up to $100,000 and possible stop-work order.'},
  sdi:{required:true,note:'California State Disability Insurance (SDI), administered by EDD, is employee-funded (2026 rate 1.3% of ALL gross wages — the wage cap was eliminated effective 2024) but the EMPLOYER is legally required to withhold and remit it via payroll. This is the historic CA/HI/NJ/NY/RI-style program.'},
  localTax:{present:true,note:'Not a wage/income tax, but San Francisco levies a local Gross Receipts Tax on businesses (0.1%–0.69%, applies once SF gross receipts exceed $2M) that is partly apportioned by payroll — the old SF Payroll Expense Tax was fully repealed/replaced by 2021\'s Prop F and further restructured by Prop M (2024). No other CA city currently taxes wages directly.'}
},
CO:{
  suta:{agency:'Colorado Department of Labor and Employment (CDLE)',note:'New employers register through the MyUI Employer+ system (or MyBiz Colorado) for a UI employer account.'},
  workersComp:{required:true,threshold:'1 or more employees (full-time or part-time), including family members — no minimum threshold and no exemptions based on size or revenue',system:'private insurance (competitive market); Pinnacol Assurance is the only carrier legally required to accept any Colorado employer, functioning as insurer of last resort — not a monopolistic fund',note:'Fines up to $500/day for being uninsured, plus a 25% penalty on any injured-worker claim paid while uninsured.'},
  sdi:{required:false,note:'Colorado does not have a traditional State Disability Insurance program, but it does have FAMLI (Family and Medical Leave Insurance), a payroll-tax-funded paid family/medical leave program administered by the Div. of Family and Medical Leave Insurance. Total 2026 rate is 0.88% of wages; employees always pay their 0.44% share, but the EMPLOYER only owes its matching 0.44% share if the business has 10+ employees (employers under 10 employees are exempt from the employer share but must still register and remit the employee share).'},
  localTax:{present:true,note:'Several Colorado municipalities (Denver, Aurora, Greenwood Village, Sheridan, Glendale) levy an Occupational Privilege Tax (OPT) — e.g., Denver\'s OPT is $5.75/month withheld from qualifying employees ($500+/month earned in Denver) plus a $4/month business OPT owed by the employer — administered locally by each city, no single state portal.'}
},
CT:{
  suta:{agency:'Connecticut Department of Labor (CTDOL)',note:'New employers register online via ReEmployCT once they\'ve paid $1,500+ in wages in a quarter or had an employee in 20 different weeks. 2026 new-employer SUTA rate is 1.9%.'},
  workersComp:{required:true,threshold:'1 or more employees — applies to full-time, part-time, and contract workers regardless of wage; household/domestic employees working under 26 hrs/week are excluded',system:'private insurance (larger employers may qualify to self-insure)',note:'Noncompliance can trigger a stop-work order and fines of $250+ per worker per day.'},
  sdi:{required:false,note:'No traditional SDI, but Connecticut has CT Paid Leave (CTPL), a paid family & medical leave program administered by the CT Paid Leave Authority. It is 100% EMPLOYEE-funded (0.5% of wages up to the SS wage base) — employers have no mandatory contribution, though they must register, withhold, and remit the employee contribution (and may voluntarily cover it).'},
  localTax:{present:false,note:'No Connecticut city or town levies its own local income/wage tax — only state-level withholding applies.'}
},
DE:{
  suta:{agency:'Delaware Department of Labor, Division of Unemployment Insurance',note:'New employers must file Form UC-1 (Report to Determine Liability and Application for Employer Account Number) within 20 days of starting business, once they\'ve paid $1,500+ in wages in a quarter or had an employee in 20 different weeks. Filed via the Delaware One Stop portal.'},
  workersComp:{required:true,threshold:'1 or more employees — full-time, part-time, temporary, and seasonal all count',system:'private insurance; residual/assigned-risk market available via the Delaware Compensation Rating Bureau if voluntary coverage can\'t be secured',note:'Sole proprietors, independent contractors, and partners are not required to carry coverage on themselves; farm workers are statutorily exempt (employer may still elect coverage). Noncompliance penalty is up to 3x the employer\'s annual premium.'},
  sdi:{required:false},
  localTax:{present:true,note:'The City of Wilmington levies a 1.25% local wage tax on residents (regardless of work location) and on nonresidents who work within city limits — employers with Wilmington-based or Wilmington-resident employees must register with the city and withhold separately. No other Delaware city currently levies this tax (state law caps it to cities over 50,000 residents).'}
},
FL:{
  suta:{agency:'Florida Department of Revenue (administers Reemployment Tax — Florida\'s name for its SUTA/UI program)',note:'Register online at floridarevenue.com/taxes/registration or via paper Form DR-1 once liable (1+ employee for a day in 20 different weeks, or $1,500+ in wages in a year). New-employer rate is 2.7%; a 7-digit Reemployment Tax account number is assigned.'},
  workersComp:{required:true,threshold:'Construction industry: 1 or more employees (including corporate officers/LLC members) — no exemption threshold. Non-construction industry: 4 or more employees. Agriculture: 6 or more regular employees.',system:'private insurance',note:'Directly relevant to TradeDesk\'s target trades — electrical/plumbing/HVAC/painting/GC businesses are generally classified as \'construction\' under Fla. Admin. Code 69L-6.021, so coverage is required from the FIRST employee, unlike most other industries in FL.'},
  sdi:{required:false},
  localTax:{present:false,note:'Florida law does not permit any city or county to levy a local income or wage tax — no local withholding obligation anywhere in the state.'}
},
GA:{
  suta:{agency:'Georgia Department of Labor (GDOL)',note:'New employers register via GDOL\'s Online Employer Tax Registration (needs FEIN, employee counts, first payroll date). New-employer SUTA rate is 2.7% for the first 3 years in business.'},
  workersComp:{required:true,threshold:'3 or more employees — LOWERED from 5 to 3 effective January 1, 2026 (a recent statutory change; verify no further change before relying on this). Corporate officers/LLC members count toward the threshold unless they individually file Form WC-10 to exempt themselves (max 5 exemptions per LLC), which does not reduce the employer\'s headcount for threshold purposes.',system:'private insurance',note:'Sole proprietors and partners are not required to carry coverage on themselves but may elect to. Given the Jan 2026 threshold drop to 3, this is a high-value flag for small trade contractors who previously assumed they were exempt under 5.'},
  sdi:{required:false},
  localTax:{present:false,note:'No Georgia city or county levies a local income/wage withholding tax. Many GA municipalities do charge local business occupation tax / license fees (typically gross-receipts or flat-fee based on business type), but this is a business license cost, not a payroll withholding — confirm with the local city/county if operating there.'}
},
HI:{
  suta:{agency:'Hawaii Department of Labor and Industrial Relations (DLIR), Unemployment Insurance Division',note:'Register online at uiclaims.hawaii.gov (Form UC-1) within 20 days of hiring an employee. 2026 taxable wage base is $64,500/employee.'},
  workersComp:{required:true,threshold:'1 or more employees (full-time or part-time, permanent or temporary) — no minimum employee count exemption',system:'Competitive private-insurance market (no monopolistic state fund); coverage via authorized private carriers or approved self-insurance',note:'Administered by DLIR Disability Compensation Division. Penalty for no coverage: $100/employee/day, $500 minimum. Sole proprietors, partners, and corporate officers owning 50%+ are exempt but may opt in.'},
  sdi:{required:true,note:'Hawaii Temporary Disability Insurance (TDI) is mandatory — employer must provide coverage (insured plan, approved self-insured plan, or qualifying collective bargaining sick-leave plan) via DLIR Disability Compensation Division. Cost can be shared with employees up to 0.5% of wages (capped, 2026 max weekly wage base $1,500.21, max employee deduction $7.50/week). 2026 max weekly benefit $871.'},
  localTax:{present:false,note:'No city/county income, wage, or occupational taxes in Hawaii — state-level income tax withholding only.'}
},
IA:{
  suta:{agency:'Iowa Workforce Development (IWD), UI Tax Bureau',note:'Register via www.MyIowaUI.org no later than 30 days after the employer begins business in Iowa.'},
  workersComp:{required:true,threshold:'1 or more employees — no minimum threshold (must carry insurance or register as a qualified self-insurer)',system:'Private-insurance market (no monopolistic state fund); self-insurance option available with approval',note:'Administered by Iowa Division of Workers\' Compensation (part of Dept of Inspections, Appeals & Licensing). Exemptions: domestic/casual employees earning <$1,500/yr from that employer, agricultural workers where farm cash payroll <$2,500/yr, sole proprietors/active partners, LLC members.'},
  sdi:{required:false,note:'No mandatory state disability insurance program in Iowa.'},
  localTax:{present:true,note:'Iowa school districts (about 297 of them) may levy a school district income surtax of up to 20% of a resident\'s Iowa state income tax liability (average ~0.3% weighted). This is calculated based on the employee\'s school district of residence and factored into Iowa withholding formulas/tables (employee reports school district on the IA W-4); administered by the Iowa Department of Revenue. Not a flat wage tax like KY/IN, but still a real employer withholding consideration.'}
},
ID:{
  suta:{agency:'Idaho Department of Labor (via Idaho Business Registration System / iUS Employer Portal)',note:'Register when you\'ve paid $1,500+ in wages in a calendar quarter, or had at least 1 Idaho employee working part of a week for 20+ different weeks in a year. New Hire reporting due within 20 days.'},
  workersComp:{required:true,threshold:'1 or more full-time, part-time, seasonal, or occasional employees — no minimum threshold',system:'Competitive market — Idaho State Insurance Fund (SIF, since 1917) alongside private carriers, or qualified self-insurance',note:'Administered/enforced by Idaho Industrial Commission. Penalties: $25/day or $2/employee/day (whichever greater) plus medical costs +10% penalty. Sole proprietors and some corporate officers can opt out.'},
  sdi:{required:false,note:'Idaho has no state disability insurance program.'},
  localTax:{present:false,note:'No city/county income or occupational wage taxes identified in Idaho.'}
},
IL:{
  suta:{agency:'Illinois Department of Employment Security (IDES)',note:'Register within 30 days of start-up (electronically via MyTax Illinois, Form REG-UI-1). New employer initial SUI rate 3.175%. New-hire reporting within 20 days.'},
  workersComp:{required:true,threshold:'1 or more employees, even part-time — no minimum threshold',system:'Private-insurance market only — no state fund; qualifying large employers may self-insure',note:'Administered by Illinois Workers\' Compensation Commission (IWCC) / Illinois Dept of Insurance for compliance. Knowing/willful non-compliance: fine up to $500/day, $10,000 minimum.'},
  sdi:{required:false,note:'No mandatory state disability insurance program in Illinois.'},
  localTax:{present:false,note:'Illinois is a flat state-income-tax state; the Illinois Constitution bars municipalities (including Chicago) from imposing their own local income tax without express General Assembly authorization, which has not been granted. Municipal \'head taxes\' are legally allowed but not currently used by any city. No employer local withholding obligation.'}
},
IN:{
  suta:{agency:'Indiana Department of Workforce Development (DWD)',note:'Must register during the first quarter of wage liability, via Employer Self Service (ESS) online or paper State Form 2837. Delays can trigger penalties/increased rates.'},
  workersComp:{required:true,threshold:'1 or more employees — coverage required from day one, no minimum threshold',system:'Private-insurance market (no state fund); administered/regulated by the Indiana Worker\'s Compensation Board and Indiana Compensation Rating Bureau (ICRB)',note:'Exemptions: casual laborers, household/domestic workers, farm/agricultural workers, sole proprietors, partners, LLC members (latter may opt in). Non-compliance: Class A infraction, fines up to $10,000/violation plus civil penalties up to $50/day per uncovered employee.'},
  sdi:{required:false,note:'No mandatory state disability insurance program in Indiana.'},
  localTax:{present:true,note:'MAJOR: all 92 Indiana counties levy a county income tax (LIT — Local Income Tax) on residents (and on nonresidents whose principal work/business location is in an Indiana county with no home-county tax). Employers withhold county tax based on employee\'s Indiana county of residence as of Jan 1. 2026 rates range ~0.50%–3.38% by county (on top of the 2.95% flat state rate effective 1/1/2026); administered by the Indiana Department of Revenue via annual Departmental Notice #1 withholding tables. Employers must track each employee\'s county code and update if the workforce is Indiana-based.'}
},
KS:{
  suta:{agency:'Kansas Department of Labor (KDOL)',note:'Register online at KansasLabor.gov; instant account number and tax rate on completion. Employers with 26+ employees must file online; 25 or fewer may mail Form K-CNS-100.'},
  workersComp:{required:true,threshold:'Employers with gross annual payroll exceeding $20,000 (a payroll-dollar threshold, not a headcount threshold — unusual among these 10 states)',system:'Private-insurance market (no state fund); administered by Kansas Department of Labor, Division of Workers Compensation, with the Kansas Dept of Insurance regulating carriers',note:'Agricultural employers with payroll under $20,000 generally exempt. Sole proprietors/LLC members/partners exempt; corporate officers with 10%+ ownership may elect out. Civil penalty for violation: 2x annual premium or $25,000, whichever is greater. NOTE: a brand-new small trade employer with 1-2 employees could plausibly stay under $20,000 payroll only briefly — most real hires will cross this fast, but the $20k trigger (not headcount) should be flagged distinctly in the checklist.'},
  sdi:{required:false,note:'No mandatory state disability insurance program in Kansas.'},
  localTax:{present:false,note:'No Kansas city/county wage or payroll withholding tax identified (Kansas does have a county \'intangibles tax\' on interest/dividend income in some jurisdictions, but it is not a wage/payroll withholding tax and doesn\'t affect employer payroll obligations).'}
},
KY:{
  suta:{agency:'Kentucky Office of Unemployment Insurance (part of the Education and Labor Cabinet)',note:'Register online via KEWES (Kentucky\'s Electronic Workplace for Employment Services), Employer Electronic Services > Employer Registration.'},
  workersComp:{required:true,threshold:'1 or more employees (full-time, part-time, or seasonal) — no minimum threshold; one of the lowest thresholds nationally',system:'Private-insurance market (no state fund); self-insurance possible with Commissioner authorization',note:'Administered by Kentucky Dept of Workers\' Claims (Education and Labor Cabinet). Penalty: $100–$1,000 per employee per day without coverage. Limited exemptions: domestic workers in a private home with <2 full-time employees, federal workers\'-comp-covered employers, homeowners employing residential maintenance/repair workers for ≤20 consecutive workdays.'},
  sdi:{required:false,note:'No mandatory state disability insurance program in Kentucky.'},
  localTax:{present:true,note:'MAJOR: Kentucky cities AND counties can each independently levy an Occupational License Tax (a payroll/wage tax, NOT income-based residency tax) on wages earned for work performed within that jurisdiction — based on WHERE THE WORK IS DONE, not employee residency or employer location. City and county levies STACK (e.g., an employee could owe both a city occ. tax and the county occ. tax). Employers must withhold and remit to each applicable local jurisdiction (often quarterly) — administered separately by each city/county revenue office (e.g., Louisville Metro Revenue Commission, Lexington, Madison County, Henderson, Jeffersontown, Campbell County, etc.), not centralized at the state level. Rates vary widely by jurisdiction (examples found: Madison County 1%, Henderson 1.65%). A KY-based trade contractor must identify every city + county occupational tax district where its crew actually performs work (job sites), not just where the office is — this is the single biggest local-tax compliance burden in this batch of 10 states.'}
},
LA:{
  suta:{agency:'Louisiana Workforce Commission (LWC)',note:'Must register online (no paper option) for a Louisiana UI Account Number immediately after hiring the first employee; liability triggers at $1,500+ wages in a quarter or 1+ employee for part of a day in 20+ weeks/year. Instant account number/rate upon registration.'},
  workersComp:{required:true,threshold:'1 or more employees (full-time, part-time, temporary, or seasonal) — no minimum threshold under La. R.S. 23:1168',system:'Private-insurance market (no monopolistic state fund); self-insurance possible',note:'Administered by Louisiana Workforce Commission, Office of Workers\' Compensation. Very narrow exemption: a sole individual owner with zero employees/leased/borrowed/part-time/volunteer/subcontractor workers, not incorporated. Penalties up to $250/employee (1st violation), $500/employee (subsequent), max $10,000.'},
  sdi:{required:false,note:'No mandatory state disability insurance program in Louisiana.'},
  localTax:{present:false,note:'Louisiana parishes and municipalities are NOT authorized to levy local wage/income taxes requiring payroll withholding — state income tax withholding is the only withholding obligation. (Louisiana does have local \'Occupational License Taxes,\' but these are business gross-receipts-based license fees on the BUSINESS, not a per-employee wage withholding — no payroll withholding action needed.)'}
},
MA:{
  suta:{agency:'Massachusetts Department of Unemployment Assistance (DUA)',note:'New employers (any employer who has not previously done business in MA) must file an Employer Status Report with DUA to establish an account. Note: you cannot register for the MA SUI/DUA account until AFTER you have paid your first employee — register with MassTaxConnect/DOR first, then DUA. 2026 new-employer SUTA rate: 2.13% (non-construction) / 5.45% (construction).'},
  workersComp:{required:true,threshold:'1 employee — no minimum headcount; coverage required from the first hire',system:'Private-insurance (competitive market) — not monopolistic',note:'All MA employers with even one employee must carry workers\' comp (M.G.L. c.152). Sole proprietors, and LLC/LLP members/partners are not required to cover themselves, but that exemption does not extend to non-owner employees. Fines ~$100/day for no coverage, $250/day if operating under a stop-work order.'},
  sdi:{required:false,note:'No separate state disability insurance program, but MA runs a mandatory Paid Family and Medical Leave (PFML) program administered by the Dept. of Family and Medical Leave, funded by employer+employee payroll contributions. Employers with 25+ covered individuals must contribute the employer share (0.42% medical leave employer portion as of the current rate structure); employers under 25 covered individuals only need to remit the withheld employee share, no employer contribution required (may elect to cover employee share voluntarily). Employers may apply for a private-plan exemption.'},
  localTax:{present:false,note:'Massachusetts has no city/county local income or wage tax — state income tax and DUA/PFML are administered only at the state level.'}
},
MD:{
  suta:{agency:'Maryland Department of Labor, Division of Unemployment Insurance',note:'Register for an employer account via the BEACON system (employer.beacon.labor.md.gov), select \'Register an Account.\''},
  workersComp:{required:true,threshold:'1 or more employees (full-time or part-time) — no minimum threshold',system:'Competitive market — Chesapeake Employers\' Insurance Company (formerly the state fund, now a private nonprofit competitive carrier) alongside private carriers; self-insurance available',note:'Administered by the Maryland Workers\' Compensation Commission. Penalty up to $25,000/violation (increased from $10,000), with personal liability for corporate officers possible. Exemptions: agricultural employers with <3 employees or payroll <$15,000/yr; sole proprietors, partners, independent contractors.'},
  sdi:{required:false,note:'No classic \'SDI\' program in Maryland. However, Maryland has a SEPARATE, newer Family and Medical Leave Insurance (FAMLI) payroll-contribution program that a checklist should flag distinctly from SDI. UNCONFIRMED / verify before ship: sources disagree on the current effective date because the program has been legislatively delayed multiple times — one Maryland Dept of Labor source states employer/employee contributions began July 1, 2025 with first remittance in Oct 2025 and benefits starting July 1, 2026, while another indicates employer registration itself does not open until Fall 2026. Do not hardcode a specific FAMLI start date in the product without re-checking paidleave.maryland.gov directly at build time — this program\'s timeline has moved before and may move again.'},
  localTax:{present:true,note:'MAJOR: all 23 Maryland counties plus Baltimore City levy a local \'piggyback\' income tax that employers must withhold, based on the EMPLOYEE\'S COUNTY OF RESIDENCE (not work location). 2026 rates range roughly 2.25% (Allegany County) to 3.20% (Montgomery, Prince George\'s, Howard counties, and Baltimore City); a couple of counties (Anne Arundel, Frederick) use bracketed rates. Administered centrally by the Comptroller of Maryland (combined with state withholding, using the annual Employer Withholding Guide) — unlike KY, this is a single unified state-run system, not per-jurisdiction filing.'}
},
ME:{
  suta:{agency:'Maine Department of Labor (MDOL), Bureau of Unemployment Compensation',note:'Register through the ReEmployME portal (EIN required); generates an Employer Account Number (EAN). Quarterly reports filed electronically via ReEmployME.'},
  workersComp:{required:true,threshold:'1 or more employees (including part-time, temporary, seasonal) — no minimum threshold',system:'Private-insurance market (no state fund); self-insurance option available',note:'Administered by the Maine Workers\' Compensation Board. Penalties: fines up to $10,000 or 108% of premiums owed (whichever greater); knowing violation is a Class D crime with $200/day fines. Narrow exemptions: certain agriculture/aquaculture seasonal/casual laborers if employer carries $25,000 employer\'s-liability coverage (incl. $5,000 medical), and family members of an LLC member may waive coverage in writing.'},
  sdi:{required:false,note:'No mandatory state disability insurance program in Maine.'},
  localTax:{present:false,note:'No Maine city/county/school-district income or wage withholding tax identified — state-level withholding only.'}
},
MI:{
  suta:{agency:'Michigan Unemployment Insurance Agency (UIA), part of the Dept. of Labor and Economic Opportunity (LEO)',note:'Employers with covered employees must register for a UIA Employer Account Number, obtained via registration with Michigan Dept. of Treasury (online, or Form 518 on paper, with Schedule A Liability Questionnaire). Online registration typically returns an EAN within ~3 days (up to 30 days by mail). No registration fee.'},
  workersComp:{required:true,threshold:'1 employee if employed 35+ hrs/week for 13+ weeks in the preceding 52 weeks, OR 3+ employees (incl. part-time) regularly employed at one time — construction employers face stricter scrutiny/higher premiums but the same statutory thresholds apply',system:'Private-insurance (competitive market) — not monopolistic; Bureau of Workers\' Disability Compensation administers',note:'Failure to carry coverage: fine up to $1,000 and/or imprisonment 30 days–6 months, each day a separate offense. General contractors must verify subcontractors\' coverage or obtain a properly filed exclusion (BWC 337).'},
  sdi:{required:false,note:'Michigan has no state disability insurance or state-run paid family leave payroll-tax program.'},
  localTax:{present:true,note:'24 Michigan cities levy a local income/wage tax (Detroit, Grand Rapids, Saginaw, Lansing, Flint, and 20 others). Rates vary by city (e.g., Detroit: residents 2.4%, non-residents 1.2%; Grand Rapids/Saginaw: 1.5%/0.75%; most others: 1%/0.5%). Employers physically located in, or with employees working in, a taxing city must withhold that city\'s tax; resident employees are also withheld regardless of work location. Administered by the Michigan Dept. of Treasury (e.g., Detroit Form 5323) or, for some cities, the city\'s own income tax division.'}
},
MN:{
  suta:{agency:'Minnesota Unemployment Insurance Program, administered by the Dept. of Employment and Economic Development (DEED)',note:'Every employer paying covered wages in MN must register for a UI Employer Account via the Employer Self-Service system (uimn.org) as soon as possible after first wages are paid, and before the first quarterly wage detail report is due.'},
  workersComp:{required:true,threshold:'1 employee — no minimum headcount, including part-time',system:'Private-insurance (competitive market) — not monopolistic; self-insurance possible with Dept. of Commerce approval',note:'Minn. Stat. §176.181 subd.2 requires essentially all employers to carry coverage or be an approved self-insurer. Limited exceptions include certain domestic workers earning under $1,000/quarter and some family-farm situations.'},
  sdi:{required:false,note:'No traditional state disability insurance; however Minnesota launched a mandatory Paid Leave (Paid Family & Medical Leave) payroll-tax program administered by the Dept. of Employment and Economic Development, with premium collection beginning 2026 — this is a newer program contractors should be aware of even though it\'s not a classic \'SDI\' line item. (Flagged for follow-up verification of exact 2026 employer contribution rate — the state general tax rate/PFML page should be checked directly at rollout.)'},
  localTax:{present:false,note:'No Minnesota city or county levies a local income/wage tax on employers or employees.'}
},
MO:{
  suta:{agency:'Missouri Division of Employment Security (DES), part of the Dept. of Labor and Industrial Relations',note:'Registration required if you pay $1,500+ in wages in a calendar quarter, OR have at least one employee for some portion of a day in each of 20 different weeks in a year. Register online via UInteract; the mandatory Unemployment Tax Registration form (MODES-2699-5) must be completed even if ultimately not liable.'},
  workersComp:{required:true,threshold:'General employers: 5+ employees. Construction industry: 1+ employee (construction defined as erecting/demolishing/altering/repairing improvements) — a notably stricter threshold than other industries.',system:'Private-insurance (competitive market) — not monopolistic; administered by the Division of Workers\' Compensation (DWC)',note:'LLC members and corporate officers count toward the employee threshold; sole proprietors and partnership members do not. Because TradeDesk\'s target customers are trades/construction, the 1-employee threshold (not 5) applies to most of them.'},
  sdi:{required:false,note:'Missouri has no state disability insurance or state-run paid family leave program.'},
  localTax:{present:true,note:'Kansas City and St. Louis (and only these two Missouri cities) levy a 1% local earnings tax on wages of anyone who lives or works within city limits, regardless of employer location (St. Louis additionally has a 0.5% payroll expense tax on employers for work performed in the city). Administered directly by each city (KC: Revenue Division / Quick Tax e-file system; St. Louis: Collector of Revenue). No other Missouri city or county has a local earnings/income tax.'}
},
MS:{
  suta:{agency:'Mississippi Department of Employment Security (MDES)',note:'Employers must register with MDES to establish an Employer Account Number (10 digits) and meet unemployment tax/new-hire reporting requirements. Online registration can issue an account number immediately in some cases; mailed registrations take about 1-2 weeks.'},
  workersComp:{required:true,threshold:'5 or more employees (full-time, part-time, seasonal, and temporary all count; independent contractors do not)',system:'Private-insurance (competitive market) — not monopolistic; administered/regulated by the Mississippi Workers\' Compensation Commission (MWCC)',note:'Businesses with fewer than 5 employees are exempt (may voluntarily buy coverage). Under Miss. Code §71-3-5. Non-compliance: criminal fines up to $1,000 + up to 1 year in jail, plus civil penalties up to $10,000 from MWCC.'},
  sdi:{required:false,note:'Mississippi has no state disability insurance or state-mandated paid family leave program.'},
  localTax:{present:false,note:'No Mississippi city or county levies a local income or occupational wage tax; income tax withholding is state-level only.'}
},
MT:{
  suta:{agency:'Montana Unemployment Insurance Division, part of the Dept. of Labor and Industry (DLI)',note:'New employers must register for a UI account via UI eServices for Employers (uid.dli.mt.gov) using their EIN. First-time employers are assigned an introductory tax rate based on business type/employee count.'},
  workersComp:{required:true,threshold:'1 employee — no minimum headcount for a covered employer; construction businesses specifically must carry coverage and register with DLI',system:'Private-insurance (competitive market), with the Montana State Fund (MSF) available as insurer of last resort for employers who can\'t get private coverage — Montana is NOT one of the 4 monopolistic states (those are ND, OH, WA, WY)',note:'Montana does not generally recognize other states\' workers\' comp policies for construction work (reciprocity only with WY, ID, SD, UT). Independent contractors working on-site must either carry their own coverage or hold an Independent Contractor Exemption Certificate from DLI — relevant for contractors who use 1099 subs. Fines up to $5,000 per violation for IC exemption non-compliance.'},
  sdi:{required:false,note:'Montana has no state disability insurance or state-mandated paid family leave payroll program.'},
  localTax:{present:false,note:'No Montana city or county levies a local income/wage tax; not confirmed via a dedicated Montana-specific source in this search pass, but is consistent with the well-established, short list of states that authorize any local income tax (OH, PA, MD, NY, MI, MO, KY, AL, IN, and a few others) — Montana is not among them. Treat as high-confidence, not exhaustively sourced.'}
},
NC:{
  suta:{agency:'North Carolina Division of Employment Security (DES)',note:'Registration required once gross payroll reaches $1,500+ in a calendar quarter, or 1 worker is employed in 20 different weeks in a year; register via the NCSUITS online system. 2026 new-employer SUTA rate is 1%.'},
  workersComp:{required:true,threshold:'3 or more employees (including corporate officers, counted even if they opt out of their own coverage)',system:'Private/competitive market (not monopolistic) — coverage from licensed carriers or self-insurance; administered by the NC Industrial Commission',note:'Sole proprietors, LLC members, and partners are not automatically counted toward the 3-employee threshold.'},
  sdi:{required:false,note:'No mandatory state disability insurance in North Carolina.'},
  localTax:{present:false,note:'North Carolina has no local (city/county) income or wage tax — only state income tax withholding applies.'}
},
ND:{
  suta:{agency:'Job Service North Dakota',note:'Register within 20 days of first employing workers if you have 1+ workers in 20 different weeks in a year OR pay $1,500+ in wages in a calendar quarter (Form SFN 41216).'},
  workersComp:{required:true,threshold:'Applies from the first employee — North Dakota law requires a business to obtain coverage BEFORE hiring its first worker; sole proprietors, partners, and corporate officers are exempt but nearly all other employees trigger coverage',system:'Monopolistic state fund — Workforce Safety & Insurance (WSI) is the sole legal provider; private workers\' comp insurance is illegal in ND (confirmed current as of 2026, one of only four monopolistic-fund states along with OH, WA, WY)',note:'Operating without WSI coverage triggers a stop-work order plus a $10,000 one-time penalty and $100/day for each uninsured day.'},
  sdi:{required:false,note:'No mandatory state disability insurance in North Dakota.'},
  localTax:{present:false,note:'No local income/wage tax identified in North Dakota.'}
},
NE:{
  suta:{agency:'Nebraska Department of Labor (NDOL)',note:'Employers register for a UI tax account via UIConnect (online) or paper tax application; the UI tax account number is separate from the state withholding number and FEIN. First-time employers are assigned an introductory rate.'},
  workersComp:{required:true,threshold:'1 employee — no minimum headcount for most industries. Agricultural employers are exempt unless they have 10+ unrelated full-time employees working 13+ calendar weeks in a year (coverage then mandatory 30 days after the 13th week).',system:'Private-insurance (competitive market) — not monopolistic; administered/adjudicated by the Nebraska Workers\' Compensation Court',note:'Sole proprietors, partners, and LLC members are exempt from covering themselves; corporate officers owning 25%+ of stock are also exempt. Civil fine up to $1,000 per violation, each day a separate violation.'},
  sdi:{required:false,note:'Nebraska has no state disability insurance or state-mandated paid family leave program.'},
  localTax:{present:false,note:'No Nebraska city or county levies a local income/wage tax (some Nebraska cities impose occupation taxes on specific business types/licenses, but not a payroll/wage withholding tax). Not confirmed via a dedicated Nebraska-specific local-income-tax source in this search pass; treat as high-confidence given Nebraska is not among the states that authorize local income taxes, but flagged for a follow-up check if precision matters.'}
},
NH:{
  suta:{agency:'New Hampshire Employment Security (NHES)',note:'Employing units must file an Employer Status Report within 30 days of first providing employment in NH (or acquiring an existing employer\'s assets). NHES then issues a Determination of Liability and establishes a UI account; employers file a quarterly Tax and Wage Report thereafter.'},
  workersComp:{required:true,threshold:'1 employee (full or part-time) — no minimum headcount, EXCEPT: a corporation or LLC with 3 or fewer executive officers/members and no other employees is not required to carry coverage (may elect to).',system:'Private-insurance (competitive market) — not monopolistic; administered by the NH Dept. of Labor under RSA 281-A:5',note:'Applies even to family-member employees and non-profits. Penalties: one-time $2,500 penalty plus $100/employee for every day of continued non-compliance.'},
  sdi:{required:false,note:'New Hampshire has no state disability insurance and no state-mandated paid family/medical leave payroll program (NH has a voluntary Paid Family and Medical Leave Plan employers can opt into, but it is not compulsory).'},
  localTax:{present:false,note:'New Hampshire has no state wage income tax and no local city/county income or wage tax (its historical tax on interest & dividends income was phased out effective 2025).'}
},
NJ:{
  suta:{agency:'New Jersey Department of Labor and Workforce Development (NJDOL) — Division of Employer Accounts',note:'Employers register once via Form NJ-REG (Division of Revenue and Enterprise Services), which simultaneously registers the employer for Unemployment Insurance, Disability Insurance, and Family Leave Insurance with NJDOL. Employers must also register for the online \'Employer Access\' portal for UI reporting (Forms NJ-927 and WR-30). New-employer SUTA rate was 2.8% for the 7/1/2025-6/30/2026 rate year.'},
  workersComp:{required:true,threshold:'1 employee — no minimum headcount',system:'Private-insurance (competitive market) or approved self-insurance — not monopolistic; administered by NJ Dept. of Labor\'s Division of Workers\' Compensation',note:'Nearly all NJ employers not covered by a federal program must carry coverage or be approved to self-insure by the Dept. of Banking and Insurance. Penalties up to $5,000 per every 10-day period without coverage, plus possible criminal charges/stop-work orders.'},
  sdi:{required:true,note:'New Jersey mandates Temporary Disability Insurance (TDI) with a required EMPLOYER contribution (2026: employer contributions range roughly $44.80-$336.00 per employee on the first $44,800 of wages, rate tier depends on employer\'s experience). NJ also runs a separate Family Leave Insurance (FLI) program, but FLI is 100% employee-funded via payroll deduction — no NJ employer contribution required. Both TDI and FLI are administered by NJDOL\'s Division of Temporary Disability and Family Leave Insurance, and both are enrolled automatically through the NJ-REG employer registration. Employers may apply to substitute an approved private TDI plan.'},
  localTax:{present:true,note:'Most New Jersey municipalities have no local income tax, but Newark is a notable exception: a 1% Newark payroll tax on employers for wages tied to services performed in/supervised from Newark (reduced 0.5% rate available if 50%+ of workforce are Newark residents, with documentation), PLUS a separate 1% Newark local income tax on wages of both residents and non-residents working in Newark. Administered by the City of Newark Department of Finance, not the state. Check for the specific municipality if a TradeDesk customer\'s job site or office is in Newark.'}
},
NM:{
  suta:{agency:'New Mexico Department of Workforce Solutions (NMDWS)',note:'New employers must register through the NMDWS Unemployment Insurance Tax Self-Service System to receive an Employer Account Number (EAN); processing can take up to 10 business days.'},
  workersComp:{required:true,threshold:'3 or more employees (counting part-time, seasonal, and owners who actively work); construction industry employers must carry coverage from their very first employee',system:'Private/competitive market (not monopolistic) — coverage purchased from private carriers; New Mexico Mutual is a major private carrier but not a mandated exclusive state fund',note:'Penalties up to $3,000 per violation; state can issue a temporary restraining order shutting down a noncompliant business.'},
  sdi:{required:false,note:'New Mexico has no mandatory state disability insurance program.'},
  localTax:{present:false,note:'No local income/payroll withholding tax — New Mexico\'s local-level tax is the Gross Receipts Tax (a local-option sales-style tax on the business, administered by NM Taxation & Revenue with state+local combined rates), not an employee wage-withholding tax.'}
},
NV:{
  suta:{agency:'Nevada Department of Employment, Training and Rehabilitation (DETR) — Employment Security Division',note:'Any employing unit that pays $225+ in wages in a calendar quarter must register (Employer Self Service / ESS account at ui.nv.gov/ess) using EIN and business details; registration is not permitted more than 30 days before the first anticipated payroll. DETR typically processes registration in 1-3 business days.'},
  workersComp:{required:true,threshold:'1 employee — no minimum headcount',system:'Private-insurance (competitive market), including self-insurance or a high-risk pool option — Nevada is NOT monopolistic (it opened its market to private insurers in 1999, after historically being a monopolistic state)',note:'Employers obtain coverage from a private carrier/agent, a self-insured group, become self-insured (certified by the Nevada Division of Insurance), or use the high-risk pool if they can\'t get standard coverage.'},
  sdi:{required:false,note:'Nevada has no state disability insurance or state-mandated paid family leave program, consistent with it being a no-income-tax state with a minimal state payroll-tax apparatus (it does have a general Modified Business Tax on payroll, which is a business excise tax, not an employee SDI-style withholding).'},
  localTax:{present:false,note:'Nevada has no state income tax and no local city/county income or wage tax.'}
},
NY:{
  suta:{agency:'New York State Department of Labor (NYSDOL)',note:'Register via Form NYS-100 once you pay $300+ in wages in a calendar quarter; 2026 new-employer contribution rate is 3.4%.'},
  workersComp:{required:true,threshold:'Required for virtually all employers from the first employee (day one)',system:'Competitive — private insurance carriers or NYSIF (New York State Insurance Fund, a competitive not-for-profit state fund, not monopolistic); self-insurance allowed for qualifying large employers',note:'Administered by the NY Workers\' Compensation Board (WCB).'},
  sdi:{required:true,note:'Mandatory Disability Benefits Law (DBL) coverage plus Paid Family Leave (PFL, typically a rider on the DBL policy). An employer becomes a \'covered employer\' after having 1+ employees in NY on each of 30 days in a calendar year, with coverage required 4 weeks after the 30th day. Coverage can be purchased from a licensed carrier or NYSIF; employee waiver of DBL rights is void by law.'},
  localTax:{present:true,note:'New York City and Yonkers both levy local income tax on top of state tax; employers withhold it through the same state payroll process (NYS Dept. of Taxation and Finance, using employee Form IT-2104) — NYC resident rates ~3.078%-3.876%, Yonkers resident surcharge ~16.75% of state tax liability, plus a Yonkers nonresident earnings tax for those working in Yonkers.'}
},
OH:{
  suta:{agency:'Ohio Department of Job and Family Services (ODJFS)',note:'New employers register via the SOURCE or ERIC online systems to obtain an Ohio UI account number.'},
  workersComp:{required:true,threshold:'Applies from the first employee (full- or part-time)',system:'Monopolistic state fund — Ohio Bureau of Workers\' Compensation (BWC) is the sole legal provider; private insurance is not allowed (confirmed current as of 2026)',note:'$120 minimum opening deposit required when setting up a new BWC account; coverage should be in place before or concurrent with the new employee\'s start date.'},
  sdi:{required:false,note:'No mandatory state disability insurance in Ohio.'},
  localTax:{present:true,note:'Extensive municipal income tax — over 600 Ohio municipalities levy their own income tax (roughly 0.5%-3%). Most are collected by one of two third-party regional agencies: RITA (Regional Income Tax Agency, ~400 municipalities) or CCA (Central Collection Agency, ~40 municipalities including Cleveland and Dayton); some larger cities (e.g., Columbus, Cincinnati) self-administer. Employers generally withhold based on the employee\'s work-location municipality, plus \'courtesy withholding\' for the resident municipality where applicable; a 20-day-worked exception exempts short-term work in a given municipality from withholding there.'}
},
OK:{
  suta:{agency:'Oklahoma Employment Security Commission (OESC)',note:'New employers register through the OESC EZ Tax Express employer portal to receive an OK SUTA account number.'},
  workersComp:{required:true,threshold:'1 or more employees (full- or part-time) — one of the stricter thresholds nationally',system:'Competitive market, not monopolistic — private carriers plus CompSource Mutual (a nonprofit that writes state-fund/assigned-risk coverage and also competes for standard coverage)',note:'Exemptions include certain small agricultural employers and family businesses with fewer than 5 employees all related by blood/marriage. Penalties up to $1,000 per employee plus possible misdemeanor charges for noncompliance.'},
  sdi:{required:false,note:'No mandatory state disability insurance in Oklahoma.'},
  localTax:{present:false,note:'Oklahoma does not authorize any city or county income/occupational tax — state income tax only.'}
},
OR:{
  suta:{agency:'Oregon Employment Department (OED)',note:'Employers must register once they pay $1,000+ in wages in a calendar quarter, or have at least 1 employee in each of 18 weeks in a year.'},
  workersComp:{required:true,threshold:'1 or more \'subject workers\' (workers not covered by one of ~30 statutory exemptions) — coverage required before the employee\'s first day',system:'Three-way competitive system (not monopolistic) — SAIF Corporation (Oregon\'s not-for-profit state fund), private carriers, or qualifying self-insurance',note:'Administered by the Oregon Workers\' Compensation Division (part of DCBS).'},
  sdi:{required:true,note:'No traditional SDI, but Paid Leave Oregon (PFMLI) is a mandatory payroll-contribution program for essentially all employers regardless of size: total 2026 contribution rate is 1% of wages (up to $184,500 wage cap); employees pay 60% (0.6%), employers with 25+ average employees pay the remaining 40% (0.4%), employers under 25 employees are exempt from the employer share but must still withhold/remit the employee share. Administered by Paid Leave Oregon.'},
  localTax:{present:true,note:'Yes — TriMet transit payroll tax (0.8237% of wages, employer-paid, for work performed in the TriMet Portland-area district) and a similar Lane Transit District tax (Eugene/Springfield area), both administered by the Oregon Dept. of Revenue; additionally, employers in the Metro (Clackamas/Multnomah/Washington counties) area must withhold the Metro Supportive Housing Services (SHS) income tax and Multnomah County Preschool for All (PFA) tax for high-earning employees, administered by the City of Portland Revenue Division.'}
},
PA:{
  suta:{agency:'Pennsylvania Department of Labor & Industry (L&I), Office of UC Tax Services',note:'New employers must register within 30 days of first performing UC-covered services, via the PA Business One Stop Shop / Form PA-100.'},
  workersComp:{required:true,threshold:'Applies from the first employee, full-time, part-time, or family member — coverage begins day one',system:'Competitive market, not monopolistic — private insurance carriers or the State Workers\' Insurance Fund (SWIF, a competitive state fund that is also PA\'s insurer of last resort), plus self-insurance for qualifying employers',note:'Limited exemptions: agricultural laborers earning under $1,200/year, domestic workers who haven\'t elected coverage, sole proprietors/partners with no other employees, and religious exemptions. Penalties up to $15,000 per employee plus $500/day fines.'},
  sdi:{required:false,note:'No mandatory state disability insurance in Pennsylvania.'},
  localTax:{present:true,note:'Near-universal local Earned Income Tax (EIT) under Act 32 — employers must withhold EIT at the higher of the employee\'s resident-municipality rate or work-location nonresident rate, remitted to one of 69 county-based Tax Collection Districts (each with a designated tax officer, e.g. Berkheimer, Keystone Collections) using the employee\'s PSD code (collected via the Residency Certification Form). Many municipalities also levy a Local Services Tax (LST), capped at $52/year per employee.'}
},
RI:{
  suta:{agency:'Rhode Island Department of Labor and Training (DLT)',note:'Register via the BAR (Business Application and Registration) form once you have hired at least one employee; sole proprietors/partnerships with no employees other than themselves do not need to register.'},
  workersComp:{required:true,threshold:'1 or more employees — one of the strictest thresholds nationally',system:'Competitive market, not monopolistic — private carriers or Beacon Mutual (a nonprofit, quasi-public \'carrier of last resort\' created by RI law in 1991, not an exclusive state fund), plus self-insurance for qualifying employers',note:'Sole proprietors and partners exempt. Penalties up to $1,000/day for noncompliance; failing to provide coverage can be a felony carrying up to a $10,000 fine and 2 years\' imprisonment.'},
  sdi:{required:true,note:'Mandatory Temporary Disability Insurance (TDI) plus Temporary Caregiver Insurance (TCI) — a state-run program funded via employee payroll withholding; no private or self-funded plan opt-out is allowed. Applies to any non-government employer with 1+ employees for any part of a day. Administered by RI DLT.'},
  localTax:{present:false,note:'No local (city/county) income or payroll tax in Rhode Island — state income tax only.'}
},
SC:{
  suta:{agency:'South Carolina Department of Employment and Workforce (DEW)',note:'New employers register through the SC State Unemployment Insurance Tax System (SUITS), or by paper Form UCE-151.'},
  workersComp:{required:true,threshold:'4 or more regular employees (full- and part-time combined, including family members); businesses under 4 employees or with annual payroll under $3,000 are exempt',system:'Private/competitive market, not monopolistic — coverage from licensed carriers or self-insurance; administered by the SC Workers\' Compensation Commission',note:'Exemptions also include casual employees, agricultural employees, railroads, and federal employees.'},
  sdi:{required:false,note:'South Carolina does not require any state disability insurance withholding.'},
  localTax:{present:false,note:'South Carolina has no local (city/county/school-district) income tax — state income tax only (local option taxes in SC apply to sales tax, not payroll).'}
},
SD:{
  suta:{agency:'South Dakota Department of Labor and Regulation, Division of Reemployment Assistance (formerly Unemployment Insurance)',note:'New employers must register online with DLR\'s Division of Reemployment Assistance to get a 7-digit UI account number and contribution rate. 2026 new-employer SUTA rate ~1.2% (non-construction) plus 0.55% Investment Fee; construction new-employer rate ~6.0% plus 0.55% Investment Fee.'},
  workersComp:{required:false,threshold:'no statutory employee-count threshold — SD has no general law mandating employers carry workers\' comp',system:'private-insurance-only (no state fund); voluntary but strongly recommended',note:'South Dakota is unusual: there is no law requiring most private employers to carry workers\' comp, regardless of employee count. Employers who go without coverage lose statutory immunity and can be sued directly in civil court by an injured employee (no exclusive-remedy protection), so it is de facto required for real risk management even though not legally mandated. Coverage, when purchased, is via private carriers or the NCCI assigned-risk pool; regulated by the SD Division of Insurance / DLR Workers\' Compensation program.'},
  sdi:{required:false},
  localTax:{present:false,note:'No known SD city/county local income, wage, or occupational tax found.'}
},
TN:{
  suta:{agency:'Tennessee Department of Labor and Workforce Development (Jobs4TN.gov / Unemployment Employer e-Services)',note:'Registration required for any employing unit with at least one TN employee, or that pays $1,500+ gross wages in a calendar quarter, or has an employee for 20+ weeks in a year. New employers get an 8-digit account number and rate immediately after online registration.'},
  workersComp:{required:true,threshold:'5+ employees for general/non-construction businesses; construction-services businesses must carry coverage for ALL employees (including owners) regardless of headcount — the 5-employee threshold does not apply to construction',system:'private-insurance-only (competitive market, no state fund)',note:'Construction is treated specially under Tenn. Code Ann. §50-6-901 to -921: coverage is mandatory from employee #1. Non-construction employers must carry coverage once they reach 5 employees. Construction business owners can individually opt out via the TN Workers\' Compensation Exemption Registry, but that exemption covers only the owner(s), never employees.'},
  sdi:{required:false},
  localTax:{present:false,note:'No TN city/county local income or wage tax found (TN has no wage income tax at all, state or local).'}
},
TX:{
  suta:{agency:'Texas Workforce Commission (TWC)',note:'Must register within 10 days of first paying $1,500+ wages in a calendar quarter, or employing one or more workers for 20 weeks in a year. Free online Unemployment Tax Registration (UTR) service; new-employer rate is the higher of the NAICS industry average or 2.7%.'},
  workersComp:{required:false,threshold:'no threshold — coverage is optional for essentially all private (non-construction-on-public-projects, non-government-contract) employers at any headcount',system:'private-insurance-only, and uniquely OPTIONAL (Texas is the only state where private employers can lawfully decline workers\' comp)',note:'Texas employers may become \'nonsubscribers\' and opt out entirely. If they opt out, they must: (1) post a notice of no-coverage at the workplace in English/Spanish/other needed languages, (2) give new hires written notice of no coverage on/before their first day, (3) file DWC Form-005 (Employer\'s Notice of No Coverage) annually with the Texas Dept. of Insurance, Division of Workers\' Compensation between Feb 1–Apr 30, and (4) nonsubscribers with 5+ employees must report work-related injuries/illnesses/deaths involving lost time within strict deadlines. Critically, opting out forfeits the exclusive-remedy defense — an injured employee can sue the nonsubscriber employer directly in civil court for negligence, with none of the usual workers\'-comp defenses (contributory negligence, assumption of risk, fellow-servant rule) available. Government construction contracts and some public projects can independently require coverage as a contract condition.'},
  sdi:{required:false},
  localTax:{present:false,note:'No TX city/county local income or wage tax found (TX has no wage income tax at all).'}
},
UT:{
  suta:{agency:'Utah Department of Workforce Services (DWS)',note:'Register online via a Utah ID at jobs.utah.gov; issued a 9-character Employer Registration Number (e.g. C2-345678-9) typically immediately, with new-employer tax rate confirmed after DWS review.'},
  workersComp:{required:true,threshold:'1 employee — mandatory from the first employee, no minimum headcount exemption',system:'private-insurance-only (competitive market; Utah does not operate a monopolistic state fund, though the Workers Compensation Fund of Utah exists as one private/quasi-public carrier option among many)',note:'Administered by the Utah Labor Commission. Sole proprietors, independent contractors, partnerships, and LLCs with no employees are not required to carry coverage on themselves. Corporate officers/directors can be individually excluded via filed exemption. Penalty for operating uninsured is at least $1,000 or 3x the unpaid premium, whichever is greater.'},
  sdi:{required:false},
  localTax:{present:false,note:'No UT city/county local income or wage tax found.'}
},
VA:{
  suta:{agency:'Virginia Employment Commission (VEC)',note:'Register via VEC\'s iFile/iReg online system (fastest — account number and rate issued immediately) or by mail. Liable once quarterly payroll reaches $1,500+ or an employee has worked 20+ weeks in a year.'},
  workersComp:{required:true,threshold:'3 or more employees (i.e., \'more than two employees\' triggers the requirement)',system:'private-insurance-only (no state fund)',note:'Administered by the Virginia Workers\' Compensation Commission. Employee count is broad — includes part-time, seasonal, temporary, minor, and family employees, plus executive officers. For contractors, employees of subcontractors count toward the contractor\'s total headcount for this threshold. A true sole proprietor with no employees and no subcontractors is exempt.'},
  sdi:{required:false},
  localTax:{present:true,note:'Not a wage/income tax, but many VA cities/counties levy a local BPOL (Business, Professional & Occupational License) tax — a gross-receipts-based local business license tax that applies to contractors doing business in that locality (rate and thresholds set per locality; contractors must often also submit proof of workers\' comp coverage with the BPOL application). Administered locally by each city/county Commissioner of the Revenue or Tax Administration office, not a payroll withholding.'}
},
VT:{
  suta:{agency:'Vermont Department of Labor',note:'Register online via Employer Online Services (\'Register for UI Quarterly Tax Reporting\'). Employers with 0–250 employees use the Vermont Internet Tax and Wage System (VITWS). 2026 new-employer SUTA rate is roughly 1%.'},
  workersComp:{required:true,threshold:'1 employee, full- or part-time — mandatory from the first hire',system:'private-insurance-only (no state fund)',note:'Administered by the Vermont Dept. of Labor. Exemptions: sole proprietors/partners in unincorporated businesses (may opt in voluntarily), LLC members and corporate officers (may opt out with DOL permission), casual workers not employed in the business\'s core function, and agricultural employers with aggregate payroll under $10,000/year. Civil penalty for lapses: $100/day for the first 7 days, $150/day thereafter.'},
  sdi:{required:false},
  localTax:{present:false,note:'No VT city/town local income or wage tax found.'}
},
WA:{
  suta:{agency:'Washington Employment Security Department (ESD)',note:'Register the business first with the WA Department of Revenue (Business License Application), which shares info to auto-open ESD (unemployment) and L&I (workers\' comp) accounts. ESD issues a 12-digit account number.'},
  workersComp:{required:true,threshold:'1 employee — mandatory from the first hire, no headcount exemption',system:'monopolistic state fund — confirmed current: WA is one of a small handful of monopolistic-fund states (along with WY, OH, ND). Coverage must be purchased through the WA Department of Labor & Industries (L&I); private commercial workers\'-comp insurance is not permitted for WA employees',note:'Administered by the WA Dept. of Labor & Industries. Large, financially qualified self-insurance (e.g., $25M+ in assets plus an accident-prevention program) is the only alternative to the state fund.'},
  sdi:{required:false,note:'No traditional SDI, but flag: Washington separately mandates WA Paid Family & Medical Leave (PFML) and the WA Cares Fund (long-term care payroll tax) — both are mandatory payroll-tax programs administered by ESD/WA Cares, distinct from classic state disability insurance, and should be tracked separately as their own compliance items if TradeDesk expands WA payroll coverage.'},
  localTax:{present:true,note:'Seattle\'s JumpStart payroll expense tax is a real local payroll tax, but only applies to large employers (2026 threshold: prior-year Seattle payroll over $9,074,409 AND at least one employee earning $194,452+) — effectively irrelevant for a 2-10 person trade contractor. No other WA city/county wage tax found relevant at this scale.'}
},
WI:{
  suta:{agency:'Wisconsin Department of Workforce Development (DWD), Unemployment Insurance Division',note:'Register online via DWD\'s \'New Employer Registration\' application (dwd.wisconsin.gov/uitax) using a MyWisconsin ID. 2026 new-employer SUTA rate: 3.05% (payroll under $500,000) or 3.25% (payroll over $500,000).'},
  workersComp:{required:true,threshold:'3 or more full-time or part-time employees; OR any employer (even with just 1 employee) who pays $500+ in combined gross quarterly wages for WI work must have coverage by the 10th day of the 1st month of the next quarter',system:'private-insurance-only (no state fund)',note:'Administered by WI DWD Worker\'s Compensation Division. Coverage must begin the day the 3rd employee is hired if the 3-employee trigger applies. Penalty for a coverage lapse: 2x the unpaid premium or $750, whichever is greater; DWD can order operations to cease until insured.'},
  sdi:{required:false},
  localTax:{present:false,note:'No WI city/county local income or wage tax found.'}
},
WV:{
  suta:{agency:'WorkForce West Virginia',note:'Register via the WV One Stop Business Portal (business4.wv.gov) or directly with WorkForce WV\'s Status Determination Unit. Registration also required for SIDES (State Information Data Exchange). Issued an Employer Account Number and certificate of registration.'},
  workersComp:{required:true,threshold:'1 employee, full- or part-time — mandatory from the first hire',system:'private-insurance-only — WV converted from a monopolistic state fund to a competitive private market in 2008; employers now choose among 350+ licensed private carriers or qualify to self-insure',note:'Administered/regulated by the WV Offices of the Insurance Commissioner (wvinsurance.gov). Sole proprietors and independent contractors are not required to cover themselves.'},
  sdi:{required:false},
  localTax:{present:true,note:'Several WV cities levy a flat \'municipal service fee\' / \'user fee\' per pay period on employees working within city limits (not a percentage-of-wage tax) — e.g., Charleston ~$2.50/week, Huntington ~$5.00/week, Parkersburg ~$2.50/week, Weirton has its own rate. Employers withhold and remit quarterly to the city. Many WV municipalities also levy their own local Business & Occupation (B&O) gross-receipts tax on businesses operating in the city, separate from the service fee. Applicability and exact rate depend on which city the job/office is located in — worth flagging explicitly for WV contractors as both are easy to miss.'}
},
WY:{
  suta:{agency:'Wyoming Department of Workforce Services (DWS)',note:'Register via wyui.wyo.gov (\'Register New Business with DWS\'). A single DWS registration is used to determine BOTH unemployment insurance and workers\' comp obligations. Out-of-state employers must first complete an Out-Of-State Questionnaire.'},
  workersComp:{required:true,threshold:'1 employee for businesses in an \'extra-hazardous\' industry — construction, electrical, plumbing, HVAC, and similar trades are classified extra-hazardous under Wyo. Stat. §27-14-108, so coverage is mandatory from the very first hire with no headcount exemption. Non-extra-hazardous employers may be exempt or elect coverage.',system:'monopolistic state fund — confirmed current: WY is one of a small handful of monopolistic-fund states (along with WA, OH, ND). Coverage for extra-hazardous employers must be purchased through the WY Dept. of Workforce Services Workers\' Compensation Division; exempt/non-extra-hazardous employers may buy voluntary coverage from private insurers regulated by the WY Dept. of Insurance',note:'Because trade contractors (electrical/plumbing/HVAC/painting/GC) fall squarely under \'extra-hazardous,\' this is effectively a hard requirement for TradeDesk\'s target customer in WY from employee #1.'},
  sdi:{required:false},
  localTax:{present:false,note:'No WY city/county local income or wage tax found (WY has no wage income tax at all).'}
},
};

function _payrollSetupState(){return S.payrollSetup||(S.payrollSetup={});}
function _payrollSetupToggle(key){
  if(!key)return;
  const st=_payrollSetupState();
  st[key]=!st[key];
  saveAll();
  if(typeof supaSaveToCloud==='function')supaSaveToCloud();
  _payrollSetupRefreshAll();
}
function _payrollSetupDone(){
  const st=_payrollSetupState();
  return _FEDERAL_PAYROLL_SETUP.filter(i=>st[i.key]).length;
}
// Per-hire paperwork state lives ON the employee record so it travels with
// the employee (persists via S.employees like everything else) and dies with
// them if they're removed — no orphaned side-table to keep in sync.
function _payrollHireState(empId){
  const e=(S.employees||[]).find(x=>String(x.id)===String(empId));
  if(!e)return null;
  return e.hirePaperwork||(e.hirePaperwork={});
}
function _payrollHireToggle(empId,key){
  const st=_payrollHireState(empId);
  if(!st||!key)return;
  st[key]=!st[key];
  saveAll();
  if(typeof supaSaveToCloud==='function')supaSaveToCloud();
  _payrollSetupRefreshAll();
}
function _payrollHireDone(empId){
  const st=_payrollHireState(empId)||{};
  return _PAYROLL_HIRE_STEPS.filter(i=>st[i.key]).length;
}
function _payrollStateInfo(){
  const code=(S.state||'').toUpperCase();
  const tax=(typeof STATE_TAX!=='undefined'&&STATE_TAX[code])||null;
  const extra=STATE_PAYROLL_SETUP[code]||null;
  return {code,tax,extra};
}
function _payrollStateSectionHTML(code,tax,extra){
  const noTax=!!(tax&&tax.noTax);
  const stateName=(tax&&tax.name)||code;
  const rows=[
    {label:'State income tax withholding',val:noTax?'Not required — '+stateName+' has no state income tax on wages':'Register with your state\'s revenue/tax department to withhold state income tax'}
  ];
  if(extra){
    rows.push({label:'State unemployment insurance (SUTA)',val:(extra.suta&&extra.suta.agency?'Register with '+extra.suta.agency:'Register with your state workforce/unemployment agency')+(extra.suta&&extra.suta.note?' — '+extra.suta.note:'')});
    if(extra.workersComp)rows.push({label:'Workers\' comp',val:(extra.workersComp.required===false?'Not required':'Required')+(extra.workersComp.threshold?' ('+extra.workersComp.threshold+')':'')+(extra.workersComp.system?' — '+extra.workersComp.system:'')+(extra.workersComp.note?'. '+extra.workersComp.note:'')});
    if(extra.sdi&&extra.sdi.required)rows.push({label:'State disability insurance',val:extra.sdi.note||'Required — check your state\'s program'});
    if(extra.localTax&&extra.localTax.present)rows.push({label:'Local/municipal tax',val:extra.localTax.note||'Some local jurisdictions in this state levy their own tax on wages — check with your city/county.'});
  }else{
    rows.push({label:'State unemployment insurance (SUTA)',val:'Register with your state workforce/unemployment agency'});
    rows.push({label:'Workers\' comp',val:'Check your state\'s requirement and threshold — most states require it once you have employees'});
    rows.push({label:'Local/municipal tax',val:'Some cities/counties levy their own wage tax — check with your city/county'});
  }
  return '<div style="border-top:1px solid var(--border);padding-top:10px">'+
    '<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:8px">'+escHtml(stateName)+' state &amp; local</div>'+
    '<div style="display:grid;gap:8px">'+
      rows.map((r,i)=>_payrollStateRowHTML(r,i)).join('')+
    '</div>'+
  '</div>';
}
// Splits a long researched note into a scannable summary + tap-to-expand full
// text, so the card stays readable while keeping the full sourced detail
// available (never rewritten/shortened in a way that could lose accuracy).
function _payrollShorten(text,max){
  if(!text||text.length<=max)return{short:text,full:null};
  let cut=text.slice(0,max);
  const brk=Math.max(cut.lastIndexOf('. '),cut.lastIndexOf(' — '),cut.lastIndexOf('; '));
  cut=brk>40?cut.slice(0,brk+1):cut.trim()+'…';
  return{short:cut.trim(),full:text};
}
function _payrollStateRowHTML(r,i){
  const{short,full}=_payrollShorten(r.val,130);
  if(!full)return '<div style="font-size:12px"><strong>'+escHtml(r.label)+':</strong> <span style="color:var(--text2)">'+escHtml(short)+'</span></div>';
  const sId='_ps-s-'+i,fId='_ps-f-'+i;
  return '<div style="font-size:12px"><strong>'+escHtml(r.label)+':</strong> '+
    '<span id="'+sId+'" style="color:var(--text2)">'+escHtml(short)+' <button type="button" onclick="document.getElementById(\''+sId+'\').style.display=\'none\';document.getElementById(\''+fId+'\').style.display=\'inline\'" style="font-size:11px;font-weight:700;color:var(--blue);background:none;border:none;padding:0;cursor:pointer;font-family:inherit">more</button></span>'+
    '<span id="'+fId+'" style="display:none;color:var(--text2)">'+escHtml(full)+'</span>'+
  '</div>';
}
// One employee's hire-paperwork mini checklist. The stateW4 note adapts to
// no-income-tax states so a Texas contractor isn't told to chase a form that
// doesn't exist.
function _payrollHireSectionHTML(emp){
  const st=emp.hirePaperwork||{};
  const {tax}=_payrollStateInfo();
  const noTax=!!(tax&&tax.noTax);
  const done=_PAYROLL_HIRE_STEPS.filter(i=>st[i.key]).length;
  return '<div style="border:1px solid var(--border);border-radius:var(--r);padding:10px;margin-bottom:8px;background:var(--bg2)">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">'+
      '<div style="font-size:12px;font-weight:700">'+escHtml(emp.name||'')+'</div>'+
      '<div style="font-size:10px;font-weight:700;color:'+(done===_PAYROLL_HIRE_STEPS.length?'var(--green-mid)':'var(--text3)')+'">'+done+'/'+_PAYROLL_HIRE_STEPS.length+'</div>'+
    '</div>'+
    _PAYROLL_HIRE_STEPS.map(i=>{
      const note=(i.key==='stateW4'&&noTax)?('Not needed — '+((tax&&tax.name)||'your state')+' has no income tax on wages.'):i.note;
      return '<label style="display:flex;align-items:flex-start;gap:8px;font-size:12px;cursor:pointer;padding:5px 0">'+
        '<input type="checkbox" onchange="_payrollHireToggle(\''+String(emp.id)+'\',\''+i.key+'\')" '+(st[i.key]?'checked':'')+' style="width:15px;height:15px;margin-top:1px;cursor:pointer;flex-shrink:0;accent-color:var(--blue)">'+
        '<span><span style="'+(st[i.key]?'text-decoration:line-through;color:var(--text3)':'')+'">'+escHtml(i.label)+'</span>'+
        '<div style="font-size:10px;color:var(--text3);margin-top:1px">'+escHtml(note)+'</div></span>'+
      '</label>';
    }).join('')+
  '</div>';
}
// The full lifecycle in one body: one-time business setup (+state specifics),
// per-hire paperwork for every W-2 employee, and the recurring obligations
// that never finish. The amber callout stays because the one thing this page
// still can't do for them is the per-paycheck income-tax withholding math.
// focusEmpId (optional): render only that employee's hire section, first —
// used by the new-hire modal so the paperwork for the person just added is
// the thing on screen, not buried under registrations they finished months ago.
function _payrollSetupBodyHTML(focusEmpId){
  const done=_payrollSetupDone(),total=_FEDERAL_PAYROLL_SETUP.length;
  const st=_payrollSetupState();
  const {code,tax,extra}=_payrollStateInfo();
  const focusEmp=(focusEmpId!=null)?(S.employees||[]).find(x=>String(x.id)===String(focusEmpId)):null;
  const hireEmps=focusEmp?[focusEmp]:(S.employees||[]).filter(e=>e.role!=='owner');
  const hireHTML=hireEmps.length?
    '<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:8px">Every new hire — repeats per person</div>'+
    hireEmps.map(_payrollHireSectionHTML).join('')
    :'';
  const businessHTML=
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">'+
      '<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3)">One-time business setup</div>'+
      '<div style="font-size:11px;font-weight:700;color:'+(total&&done===total?'var(--green-mid)':'var(--text3)')+'">'+done+'/'+total+'</div>'+
    '</div>'+
    '<div style="display:grid;gap:6px;margin-bottom:'+(code?'12px':'0')+'">'+
      _FEDERAL_PAYROLL_SETUP.map(i=>
        '<label style="display:flex;align-items:flex-start;gap:10px;font-size:13px;cursor:pointer;padding:8px 10px;background:var(--bg2);border-radius:var(--r)">'+
          '<input type="checkbox" onchange="_payrollSetupToggle(\''+i.key+'\')" '+(st[i.key]?'checked':'')+' style="width:16px;height:16px;margin-top:1px;cursor:pointer;flex-shrink:0;accent-color:var(--blue)">'+
          '<span><span style="'+(st[i.key]?'text-decoration:line-through;color:var(--text3)':'')+'">'+escHtml(i.label)+'</span>'+
          '<div style="font-size:11px;color:var(--text3);margin-top:2px">'+escHtml(i.note)+'</div></span>'+
        '</label>'
      ).join('')+
    '</div>'+
    (code?_payrollStateSectionHTML(code,tax,extra):'');
  const _hr='<div style="border-top:1px solid var(--border);margin:12px 0 10px"></div>';
  const ongoingHTML=
    '<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:8px">Ongoing — every payday, quarter &amp; January</div>'+
    '<div style="display:grid;gap:7px">'+
      _PAYROLL_ONGOING.map(o=>'<div style="font-size:12px"><strong>'+escHtml(o.label)+':</strong> <span style="color:var(--text2)">'+escHtml(o.note)+'</span></div>').join('')+
    '</div>';
  return '<div style="font-size:11px;color:var(--text3);margin-bottom:10px">Everything it takes to pay a W-2 employee — one-time setup, paperwork for each hire, and what recurs every payday. State-specific steps are for '+(code?escHtml((tax&&tax.name)||code):'your state — set it in Settings')+'.</div>'+
    (focusEmp?hireHTML+_hr+businessHTML:businessHTML+(hireHTML?_hr+hireHTML:''))+
    _hr+ongoingHTML+
    '<div style="background:#FFF8F0;border:1px solid var(--amber);border-radius:var(--r);padding:10px 12px;margin-top:10px;font-size:11px;color:#7A4A00;line-height:1.5">'+
      '<strong>This checklist gets you set up to pay someone — it does not calculate what to withhold from each paycheck.</strong> Every pay period you still need to withhold federal income tax (from their W-4) and state income tax (if your state has one), on top of the FICA/FUTA math on the Payroll tab. Use real payroll software or your accountant for that — TradeDesk doesn\'t do withholding calculations.'+
    '</div>'+
    '<div style="font-size:9px;color:var(--text3);margin-top:10px">Not tax or legal advice — requirements vary by business and locality. Verify with your accountant or state labor department.</div>';
}
function _payrollSetupRefreshAll(){
  document.querySelectorAll('.payroll-setup-body').forEach(el=>{
    const f=el.dataset.focusEmp;
    el.innerHTML=_payrollSetupBodyHTML((f!=null&&f!=='')?f:null);
  });
}
function renderPayrollSetupCard(){
  const el=document.getElementById('payroll-setup-card');
  if(!el)return;
  el.innerHTML='<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:10px">Payroll setup</div>'+
    '<div class="payroll-setup-body">'+_payrollSetupBodyHTML(null)+'</div>';
}
// Fires on EVERY new non-owner W-2 hire (see the trigger in _saveEmployee,
// js/cloud.js). First-ever hire gets the full "set up your business" framing;
// every hire after that leads with the new person's paperwork, since W-4/I-9/
// new-hire reporting restart from zero for each employee — this is the
// "so they don't forget" moment. The card on the Team page keeps all of it
// permanently either way.
function _showPayrollSetupPrompt(empId,isFirst){
  document.getElementById('_payroll-setup-modal-ov')?.remove();
  const emp=(empId!=null)?(S.employees||[]).find(x=>String(x.id)===String(empId)):null;
  const first=isFirst!==false;
  const ov=document.createElement('div');ov.id='_payroll-setup-modal-ov';ov.className='zmodal-overlay';
  const box=document.createElement('div');box.className='zmodal';
  // This checklist runs longer than the other ~57 .zmodal call sites — cap
  // the box's own height and let IT scroll, rather than the shared overlay's
  // align-items:center (which, combined with overflow, centers past the top
  // of tall content and clips it — a real layout bug, scoped here rather
  // than touched globally since every other modal fits and relies on it).
  box.style.maxHeight='85vh';box.style.overflowY='auto';
  const title=first?'First W-2 hire — here\'s what to set up':'New W-2 hire — paperwork for '+escHtml((emp&&emp.name)||'your new hire');
  const sub=first?'Work through this before their first paycheck. It stays on your Team page too, so you can pick it back up anytime.'
    :'Hiring paperwork restarts from zero for every new employee — knock theirs out now. The full checklist stays on your Team page.';
  box.innerHTML='<div style="font-size:17px;font-weight:800;margin-bottom:4px">'+title+'</div>'+
    '<div style="font-size:12px;color:var(--text2);margin-bottom:14px;line-height:1.4">'+sub+'</div>'+
    '<div class="payroll-setup-body"'+(emp?' data-focus-emp="'+String(emp.id)+'"':'')+'>'+_payrollSetupBodyHTML(emp?emp.id:null)+'</div>'+
    '<button onclick="document.getElementById(\'_payroll-setup-modal-ov\').remove()" style="width:100%;padding:10px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;margin-top:14px">Got it</button>';
  ov.appendChild(box);document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
}
