const MILE_PURPOSES=['Estimate','Job site','Client Consult','Supply run','Home Office','Payment Collection','Other'];
const MILE_PURPOSE_COLORS={
  'Estimate':          {bg:'#eff6ff',text:'#1d4ed8',dot:'#1d4ed8'},
  'Job site':          {bg:'#f0fdf4',text:'#15803d',dot:'#15803d'},
  'Client Consult':    {bg:'#f5f3ff',text:'#7c3aed',dot:'#7c3aed'},
  'Supply run':        {bg:'#fffbeb',text:'#b45309',dot:'#b45309'},
  'Home Office':       {bg:'#f0f9ff',text:'#0369a1',dot:'#0369a1'},
  'Payment Collection':{bg:'#f0fdf4',text:'#15803d',dot:'#15803d'},
  'Other':             {bg:'#f9fafb',text:'#6b7280',dot:'#6b7280'},
};
// Collision-resistant bid ID: milliseconds * 1000 + random 0-998 = 13-16 digit unique number
const JOB_COLORS=['#185FA5','#1D9E75','#D85A30','#D4537E','#7F77DD','#BA7517','#E24B4A','#444441'];
// ── Scope item auto-pricing ──────────────────────────────────────────────────
// Kansas/Midwest solo painter industry averages (2024-2025).
// ratePerSqFt: added per sq ft of room surfaces (walls + ceiling)
// flatRate: flat add per room regardless of size
// Zach does NOT enter hours — these auto-calculate into the bid price.
// He just checks what applies. Rates are calibrated from PCA benchmarks,
// regional labor surveys, and Topeka/Wichita contractor forum data.
const SCOPE_ITEMS=[
  {id:'movefurn',label:'Move furniture',   icon:'🪑',
   hint:'Move and cover furniture before, replace after. ~30 min per furnished room.',
   ratePerSqFt:0, flatRate:35,
   clientDesc:'Furniture moved from walls before painting, replaced after.'},
  {id:'protect', label:'Protect floors & furniture', icon:'🛡️',
   hint:'Lay drop cloths, plastic sheeting on floors and remaining furniture. ~20 min per room.',
   ratePerSqFt:0, flatRate:20,
   clientDesc:'Floors and furniture protected with drop cloths and plastic sheeting.'},
  {id:'sand',    label:'Sanding',          icon:'🪚',
   hint:'Light scuff-sand walls/trim to help paint grab. About 100 sf/hr.',
   ratePerSqFt:0.10, flatRate:0,
   clientDesc:'Sanded for proper adhesion and a smooth finish.'},
  {id:'spackle', label:'Spackle & patch',  icon:'🔧',
   hint:'Fill nail holes, cracks, and dents. About 80 sf/hr — adds up fast on older homes.',
   ratePerSqFt:0.07, flatRate:35,
   clientDesc:'Nail holes, cracks, and imperfections filled, spackled, and sanded smooth.'},
  {id:'tape',    label:'Tape & masking',   icon:'🎭',
   hint:'Tape trim, mask floors, hang plastic. About 200 sf/hr of wall area.',
   ratePerSqFt:0.08, flatRate:0,
   clientDesc:'Trim, windows, doors, and floors masked and protected with drop cloths.'},
  {id:'caulk',   label:'Caulking',         icon:'💧',
   hint:'Seal gaps at trim, corners, windows. ~45 min per average room.',
   ratePerSqFt:0, flatRate:38,
   clientDesc:'Gaps, seams, and cracked corners caulked for a clean finish.'},
  {id:'prime',   label:'Primer coat',      icon:'🪣',
   hint:'Required on new drywall, dark colors, or stained surfaces. About 150 sf/hr.',
   ratePerSqFt:0.32, flatRate:0,
   clientDesc:'Full primer coat applied for adhesion, stain coverage, and true color.'},
  {id:'twocoat', label:'Two coats',        icon:'🎨',
   hint:'Standard on color changes and bare surfaces. Already in base rate — use when specifically calling it out on the proposal.',
   ratePerSqFt:0.15, flatRate:0,
   clientDesc:'Two full coats applied for maximum coverage and durability.'},
  {id:'cleanup', label:'Final cleanup',    icon:'🧹',
   hint:'Remove all tape, drop cloths, and debris. ~30 min per room.',
   ratePerSqFt:0, flatRate:28,
   clientDesc:'All drop cloths removed, work area cleaned.'},
  {id:'popcorn', label:'Popcorn removal',  icon:'⚡',
   hint:'Spray, scrape, and clean popcorn ceiling. ~40 sf/hr — slow and messy.',
   ratePerSqFt:0.55, flatRate:0,
   clientDesc:'Popcorn texture removed, surface skim-coated, and prepped for paint.'},
  {id:'wallpaper',label:'Wallpaper removal',icon:'📜',
   hint:'Score, soak, scrape, and clean. ~50 sf/hr — doubles job time on bad installs.',
   ratePerSqFt:0.65, flatRate:50,
   clientDesc:'Wallpaper stripped, walls repaired and primed.'},
  {id:'scaffold', label:'Scaffolding',     icon:'🏗️',
   hint:'For stairwells, 2-story foyers, or high exterior. Setup/tear-down ~2 hrs.',
   ratePerSqFt:0, flatRate:125,
   clientDesc:'Scaffolding erected and safely managed for high-reach areas.'},
  {id:'pwash',   label:'Pressure washing', icon:'💦',
   hint:'Exterior only — wash before painting. ~250 sf/hr. Must dry 48 hrs before paint.',
   ratePerSqFt:0.26, flatRate:0,
   clientDesc:'Exterior surfaces pressure washed. Minimum 48-hr dry time before paint.'},
  {id:'supply_run',label:'Supply run',      icon:'🏪',
   hint:'Time driving to and from the store for paint, supplies, or materials.',
   ratePerSqFt:0, flatRate:0, clientDesc:''},
  {id:'collect_cash',label:'Collect payment',icon:'💵',
   hint:'Time collecting cash deposit or payment from client.',
   ratePerSqFt:0, flatRate:0, clientDesc:''},
];
const SURF_TYPES=[
  {v:'walls',l:'Walls',unit:'sq ft',rate:1.25,mf:1},
  {v:'ceiling',l:'Ceiling',unit:'sq ft',rate:1.00,mf:1},
  {v:'trim',l:'Trim/baseboard',unit:'lin ft',rate:1.50,mf:.4},
  {v:'doors',l:'Doors',unit:'doors',rate:75,mf:20},
  {v:'windows',l:'Windows',unit:'windows',rate:40,mf:8},
  {v:'cabinets',l:'Cabinets',unit:'lin ft',rate:35,mf:4},
  {v:'ext_walls',l:'Exterior walls',unit:'sq ft',rate:1.35,mf:1},
  {v:'ext_trim',l:'Exterior trim',unit:'lin ft',rate:1.75,mf:.4},
  {v:'deck',l:'Deck/fence',unit:'sq ft',rate:1.10,mf:1},
  {v:'fence',l:'Fence staining',unit:'sq ft',rate:1.25,mf:1},
  {v:'epoxy',l:'Epoxy/garage floor',unit:'sq ft',rate:1.75,mf:1},
];
const CHECKS=[
  {cat:'urgent',title:'Notify Montana Dept of Revenue of address change',desc:'File a final MT state tax return for the year you move. Close any MT business accounts.'},
  {cat:'urgent',title:'Secure a Kansas physical address',desc:'You need a physical KS address (not a PO box) for most registrations. Family address works temporarily.'},
  {cat:'biz',title:'Register with Kansas Secretary of State',desc:'sos.ks.gov — LLC filing ~$165. Foreign LLC registration also ~$165 if keeping MT entity.'},
  {cat:'biz',title:'Get or update your federal EIN',desc:'Update address via Form 8822-B at irs.gov. Get one free if you don\'t have one yet.'},
  {cat:'biz',title:'Open a Kansas business bank account',desc:'Bring EIN, business registration docs, and ID. Keep business money completely separate from personal.'},
  {cat:'biz',title:'Get a Kansas city contractor license',desc:'No statewide license — Wichita requires one for jobs over $2,500. Contact wichita.gov for current requirements.'},
  {cat:'biz',title:'Get Kansas general liability insurance',desc:'Minimum $1M per occurrence. Required by most commercial clients. Get at least 3 quotes.'},
  {cat:'biz',title:'Check Kansas sales tax requirements',desc:'If you charge separately for materials, register at ksrevenue.gov. Labor-only typically doesn\'t collect sales tax.'},
  {cat:'biz',title:'Update vehicle registrations to Kansas',desc:'60 days after establishing KS residency. Update commercial auto insurance too.'},
  {cat:'biz',title:'Update Google Business profile to Wichita',desc:'Change location and service area. Most painting leads come from Google — a stale MT listing loses jobs.'},
  {cat:'tax',title:'Set up federal quarterly estimated payments',desc:'Form 1040-ES at irs.gov/payments. Due Apr 15, Jun 16, Sep 15, Jan 15.'},
  {cat:'tax',title:'Set up Kansas quarterly estimated payments',desc:'Form K-40ES at ksrevenue.gov. Same quarterly schedule as federal.'},
  {cat:'tax',title:'Deduct your moving expenses (business portion)',desc:'Moving tools, equipment, supplies MT to KS is deductible. Keep all receipts and log mileage.'},
  {cat:'tax',title:'Plan for part-year resident filing',desc:'File part-year resident in both MT and KS for the year you move. Hire a multi-state CPA.'},
  {cat:'tax',title:'Find a Wichita CPA who specializes in contractors',desc:'Worth $300-600/yr. They\'ll find deductions you\'d miss and keep you out of trouble.'},
  {cat:'ks',title:'Research Wichita market and target neighborhoods',desc:'Andover, Derby, Maize, Goddard growing fast. Overland Park/Olathe (KC side) higher income.'},
  {cat:'ks',title:'Join local contractor and business networks',desc:'Wichita Area Builders Association, Chamber of Commerce, BNI. Know realtors and property managers.'},
  {cat:'ks',title:'Update all business materials with KS contact info',desc:'Cards, invoices, contracts, door hangers, yard signs, truck magnets — all need updating before first KS job.'},
];
const CAT_CFG={urgent:{label:'Do right away',color:'#A32D2D'},biz:{label:'Business setup in Kansas',color:'#185FA5'},tax:{label:'Tax & accounting',color:'#854F0B'},ks:{label:'Kansas market & marketing',color:'#27500A'}};
const _ZJ_LOGO_SVG='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 198 78"><defs><linearGradient id="zjg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#888" stop-opacity=".8"/></linearGradient></defs><text x="5" y="54" font-family="Impact,Arial Black,sans-serif" font-size="56" font-style="italic" fill="#fff" opacity=".97">Z</text><text x="75" y="54" font-family="Impact,Arial Black,sans-serif" font-size="56" font-style="italic" fill="url(#zjg)">J</text><line x1="57" y1="2" x2="104" y2="62" stroke="#fff" stroke-width="3.5" stroke-linecap="round"/><line x1="62" y1="2" x2="109" y2="62" stroke="#fff" stroke-width="1.5" stroke-linecap="round" opacity=".25"/><line x1="5" y1="63" x2="53" y2="63" stroke="rgba(255,255,255,.5)" stroke-width=".75"/><text x="75" y="68" font-family="Impact,Arial,sans-serif" font-size="9.5" fill="#fff" text-anchor="middle" letter-spacing="3">ZJ\'S</text><line x1="100" y1="63" x2="148" y2="63" stroke="rgba(255,255,255,.5)" stroke-width=".75"/><text x="5" y="77" font-family="Arial,Helvetica,sans-serif" font-size="7.5" fill="rgba(190,210,240,.9)" letter-spacing="1.2" font-weight="600">PAINTING &amp; SPECIAL COATINGS</text></svg>';
const BUSINESS_CONFIGS={
  painting:{default_job_type:'estimate',require_estimate:true,require_deposit:true,allow_full_payment:false,show_schedule:true},
  plumbing:{default_job_type:'service',require_estimate:false,require_deposit:false,allow_full_payment:true,show_schedule:false},
  general:{default_job_type:'estimate',require_estimate:true,require_deposit:true,allow_full_payment:true,show_schedule:true},
  roofing:{default_job_type:'estimate',require_estimate:true,require_deposit:true,allow_full_payment:false,show_schedule:true},
  electrical:{default_job_type:'service',require_estimate:false,require_deposit:false,allow_full_payment:true,show_schedule:false},
  hvac:{default_job_type:'service',require_estimate:false,require_deposit:false,allow_full_payment:true,show_schedule:false},
  landscaping:{default_job_type:'estimate',require_estimate:true,require_deposit:true,allow_full_payment:false,show_schedule:true},
  other:{default_job_type:'estimate',require_estimate:true,require_deposit:false,allow_full_payment:true,show_schedule:true},
};

const TAX_HISTORY={
  2019:{fedSingle:12200,fedMFJ:24400,fedMFS:12200,fedHOH:18350,b10:9700,b12:39475,b22:84200,b24:160725,b32:204100,b35:510300,irsRate:.580},
  2020:{fedSingle:12400,fedMFJ:24800,fedMFS:12400,fedHOH:18650,b10:9875,b12:40125,b22:85525,b24:163300,b32:207350,b35:518400,irsRate:.575},
  2021:{fedSingle:12550,fedMFJ:25100,fedMFS:12550,fedHOH:18800,b10:9950,b12:40525,b22:86375,b24:164925,b32:209425,b35:523600,irsRate:.560},
  2022:{fedSingle:12950,fedMFJ:25900,fedMFS:12950,fedHOH:19400,b10:10275,b12:41775,b22:89075,b24:170050,b32:215950,b35:539900,irsRate:.585},
  2023:{fedSingle:13850,fedMFJ:27700,fedMFS:13850,fedHOH:20800,b10:11000,b12:44725,b22:95375,b24:182050,b32:231250,b35:578125,irsRate:.655},
  2024:{fedSingle:14600,fedMFJ:29200,fedMFS:14600,fedHOH:21900,b10:11600,b12:47150,b22:100525,b24:191950,b32:243725,b35:609350,irsRate:.670},
  2025:{fedSingle:15000,fedMFJ:30000,fedMFS:15000,fedHOH:22500,b10:11925,b12:48475,b22:103350,b24:197300,b32:250525,b35:626350,irsRate:.700},
  2026:{fedSingle:15000,fedMFJ:30000,fedMFS:15000,fedHOH:22500,b10:11925,b12:48475,b22:103350,b24:197300,b32:250525,b35:626350,irsRate:.725},
};
const LIC_TYPES=[
  // Business
  {id:'llc_report',     cat:'business',    label:'LLC Annual Report',                    trade:'all', holder:'company', noNum:true},
  {id:'biz_license',    cat:'business',    label:'Business License',                     trade:'all', holder:'company'},
  {id:'contractor_reg', cat:'business',    label:'Contractor Registration',              trade:'all', holder:'company'},
  {id:'dba_reg',        cat:'business',    label:'DBA / Fictitious Name Registration',   trade:'all', holder:'company'},
  {id:'sales_tax',      cat:'business',    label:'Sales Tax Permit',                     trade:'all', holder:'company'},
  {id:'osha10',         cat:'business',    label:'OSHA 10-Hour Card',                    trade:'all', holder:'employee'},
  {id:'osha30',         cat:'business',    label:'OSHA 30-Hour Card',                    trade:'all', holder:'employee'},
  {id:'first_aid',      cat:'business',    label:'First Aid / CPR Certification',        trade:'all', holder:'employee'},
  // Insurance
  {id:'gl_ins',         cat:'insurance',   label:'General Liability Insurance',          trade:'all', holder:'company'},
  {id:'wc_ins',         cat:'insurance',   label:'Workers Comp Insurance',               trade:'all', holder:'company'},
  {id:'auto_ins',       cat:'insurance',   label:'Commercial Auto Insurance',            trade:'all', holder:'company'},
  {id:'bond',           cat:'insurance',   label:'Contractor Bond',                      trade:'all', holder:'company'},
  {id:'eo_ins',         cat:'insurance',   label:'Professional Liability (E&O)',         trade:'all', holder:'company'},
  {id:'umbrella_ins',   cat:'insurance',   label:'Umbrella / Excess Liability',          trade:'all', holder:'company'},
  {id:'tools_ins',      cat:'insurance',   label:'Tools & Equipment Insurance',          trade:'all', holder:'company'},
  // EPA / Lead / Hazmat
  {id:'epa_firm',       cat:'epa',         label:'EPA Certified Renovation Firm (RRP)',  trade:'painting', holder:'company'},
  {id:'epa_renovator',  cat:'epa',         label:'EPA Certified Renovator',              trade:'painting', holder:'employee'},
  {id:'epa_inspector',  cat:'epa',         label:'EPA Lead Inspector / Risk Assessor',   trade:'painting', holder:'employee'},
  {id:'epa_abate_con',  cat:'epa',         label:'EPA Lead Abatement Contractor',        trade:'painting', holder:'company'},
  {id:'epa_abate_sup',  cat:'epa',         label:'EPA Lead Abatement Supervisor',        trade:'painting', holder:'employee'},
  {id:'epa_abate_wkr',  cat:'epa',         label:'EPA Lead Abatement Worker',            trade:'painting', holder:'employee'},
  {id:'hepa_vacuum',    cat:'epa',         label:'HEPA Vacuum',                          trade:'all',      holder:'equipment', isEquip:true},
  {id:'asbestos_con',   cat:'epa',         label:'Asbestos Abatement Contractor',        trade:'asbestos', holder:'company'},
  {id:'asbestos_sup',   cat:'epa',         label:'AHERA Asbestos Abatement Supervisor',  trade:'asbestos', holder:'employee'},
  {id:'asbestos_wkr',   cat:'epa',         label:'AHERA Asbestos Abatement Worker',      trade:'asbestos', holder:'employee'},
  {id:'asbestos_insp',  cat:'epa',         label:'AHERA Building Inspector',             trade:'asbestos', holder:'employee'},
  {id:'asbestos_mgmt',  cat:'epa',         label:'Asbestos Management Planner',          trade:'asbestos', holder:'employee'},
  {id:'asbestos_design',cat:'epa',         label:'Asbestos Project Designer',            trade:'asbestos', holder:'employee'},
  {id:'hazmat_40hr',    cat:'epa',         label:'HAZWOPER 40-Hour Training',            trade:'all',      holder:'employee'},
  {id:'hazmat_8hr',     cat:'epa',         label:'HAZWOPER 8-Hour Annual Refresher',     trade:'all',      holder:'employee'},
  // Electrical
  {id:'master_elec',    cat:'electrical',  label:'Master Electrician License',           trade:'electrical', holder:'employee'},
  {id:'journeyman_elec',cat:'electrical',  label:'Journeyman Electrician License',       trade:'electrical', holder:'employee'},
  {id:'elec_apprentice',cat:'electrical',  label:'Electrical Apprentice Registration',   trade:'electrical', holder:'employee'},
  {id:'elec_contractor',cat:'electrical',  label:'Electrical Contractor License',        trade:'electrical', holder:'company'},
  {id:'elec_inspector', cat:'electrical',  label:'Electrical Inspector License',         trade:'electrical', holder:'employee'},
  {id:'low_voltage',    cat:'electrical',  label:'Low Voltage Technician License',       trade:'electrical', holder:'employee'},
  {id:'solar_elec',     cat:'electrical',  label:'Solar PV Installer Certification (NABCEP)', trade:'electrical', holder:'employee'},
  // General Contractor
  {id:'gc_license',     cat:'gc',          label:'General Contractor License',           trade:'gc', holder:'company'},
  {id:'home_imp',       cat:'gc',          label:'Home Improvement Registration',        trade:'gc', holder:'company'},
  {id:'gc_inspector',   cat:'gc',          label:'Building Inspector License',           trade:'gc', holder:'employee'},
  {id:'project_mgr',    cat:'gc',          label:'Project Manager Certification (PMP)',  trade:'gc', holder:'employee'},
  // HVAC
  {id:'hvac_contractor',cat:'hvac',        label:'HVAC Contractor License',              trade:'hvac', holder:'company'},
  {id:'hvac_tech',      cat:'hvac',        label:'HVAC Technician License',              trade:'hvac', holder:'employee'},
  {id:'epa608_univ',    cat:'hvac',        label:'EPA Section 608 — Universal',          trade:'hvac', holder:'employee'},
  {id:'epa608_t1',      cat:'hvac',        label:'EPA Section 608 — Type I (small appliances)', trade:'hvac', holder:'employee'},
  {id:'epa608_t2',      cat:'hvac',        label:'EPA Section 608 — Type II (high-pressure)',   trade:'hvac', holder:'employee'},
  {id:'epa608_t3',      cat:'hvac',        label:'EPA Section 608 — Type III (low-pressure)',   trade:'hvac', holder:'employee'},
  {id:'nate_cert',      cat:'hvac',        label:'NATE Certification',                   trade:'hvac', holder:'employee'},
  {id:'gas_fitter',     cat:'hvac',        label:'Gas Fitter License',                   trade:'hvac', holder:'employee'},
  {id:'sheet_metal',    cat:'hvac',        label:'Sheet Metal Worker License',           trade:'hvac', holder:'employee'},
  // Plumbing
  {id:'master_plumber', cat:'plumbing',    label:'Master Plumber License',               trade:'plumbing', holder:'employee'},
  {id:'journeyman_plmb',cat:'plumbing',    label:'Journeyman Plumber License',           trade:'plumbing', holder:'employee'},
  {id:'plmb_apprentice',cat:'plumbing',    label:'Plumbing Apprentice Registration',     trade:'plumbing', holder:'employee'},
  {id:'plmb_contractor',cat:'plumbing',    label:'Plumbing Contractor License',          trade:'plumbing', holder:'company'},
  {id:'backflow_cert',  cat:'plumbing',    label:'Backflow Prevention Certification',    trade:'plumbing', holder:'employee'},
  {id:'med_gas',        cat:'plumbing',    label:'Medical Gas Installer Certification',  trade:'plumbing', holder:'employee'},
  {id:'plmb_inspector', cat:'plumbing',    label:'Plumbing Inspector License',           trade:'plumbing', holder:'employee'},
  // Roofing
  {id:'roofing_con',    cat:'roofing',     label:'Roofing Contractor License',           trade:'roofing', holder:'company'},
  {id:'gaf_elite',      cat:'roofing',     label:'GAF Master Elite Contractor',          trade:'roofing', holder:'company'},
  {id:'certainteed_sm', cat:'roofing',     label:'CertainTeed SELECT ShingleMaster',     trade:'roofing', holder:'company'},
  {id:'owens_preferred',cat:'roofing',     label:'Owens Corning Preferred Contractor',   trade:'roofing', holder:'company'},
  {id:'icc_roofing',    cat:'roofing',     label:'ICC Roofing Inspector Certification',  trade:'roofing', holder:'employee'},
  {id:'nrca_member',    cat:'roofing',     label:'NRCA Membership',                      trade:'roofing', holder:'company', noNum:true},
  // Concrete & Masonry
  {id:'concrete_con',   cat:'concrete',    label:'Concrete Contractor License',          trade:'concrete', holder:'company'},
  {id:'mason_con',      cat:'concrete',    label:'Masonry Contractor License',           trade:'concrete', holder:'company'},
  {id:'aci_field',      cat:'concrete',    label:'ACI Concrete Field Testing Technician',trade:'concrete', holder:'employee'},
  {id:'aci_strength',   cat:'concrete',    label:'ACI Strength Testing Technician',      trade:'concrete', holder:'employee'},
  {id:'aci_flatwork',   cat:'concrete',    label:'ACI Flatwork Finisher Certification',  trade:'concrete', holder:'employee'},
  // Flooring & Tile
  {id:'floor_con',      cat:'flooring',    label:'Flooring Contractor License',          trade:'flooring', holder:'company'},
  {id:'ctef_installer', cat:'flooring',    label:'Certified Tile Installer (CTEF)',      trade:'flooring', holder:'employee'},
  {id:'nwfa_installer', cat:'flooring',    label:'NWFA Certified Wood Floor Installer',  trade:'flooring', holder:'employee'},
  {id:'nwfa_inspector', cat:'flooring',    label:'NWFA Certified Wood Floor Inspector',  trade:'flooring', holder:'employee'},
  {id:'carpet_cert',    cat:'flooring',    label:'Carpet & Rug Institute Certification', trade:'flooring', holder:'employee'},
  // Drywall & Plastering
  {id:'drywall_con',    cat:'drywall',     label:'Drywall Contractor License',           trade:'drywall', holder:'company'},
  {id:'plasterer_lic',  cat:'drywall',     label:'Plasterer License',                    trade:'drywall', holder:'employee'},
  {id:'awci_cert',      cat:'drywall',     label:'AWCI Certified Inspector',             trade:'drywall', holder:'employee'},
  // Landscaping & Irrigation
  {id:'landscape_con',  cat:'landscaping', label:'Landscape Contractor License',         trade:'landscaping', holder:'company'},
  {id:'irrigation_con', cat:'landscaping', label:'Irrigation Contractor License',        trade:'landscaping', holder:'company'},
  {id:'irrigation_cert',cat:'landscaping', label:'Certified Irrigation Contractor (CIC)',trade:'landscaping', holder:'employee'},
  {id:'pesticide_app',  cat:'landscaping', label:'Pesticide Applicator License',         trade:'landscaping', holder:'employee'},
  {id:'arborist_cert',  cat:'landscaping', label:'ISA Certified Arborist',               trade:'landscaping', holder:'employee'},
  {id:'landscape_arch', cat:'landscaping', label:'Landscape Architect License',          trade:'landscaping', holder:'employee'},
  // Demolition
  {id:'demo_con',       cat:'demolition',  label:'Demolition Contractor License',        trade:'demolition', holder:'company'},
  {id:'demo_permit',    cat:'demolition',  label:'Demolition Permit (project-based)',     trade:'demolition', holder:'company', noNum:true},
  {id:'blasting_cert',  cat:'demolition',  label:'Blasting / Explosives License',        trade:'demolition', holder:'employee'},
];

const LIC_CAT_LABELS={
  business:'Business',insurance:'Insurance',epa:'EPA / Lead / Hazmat',
  electrical:'Electrical',gc:'General Contractor',hvac:'HVAC',
  plumbing:'Plumbing',roofing:'Roofing',concrete:'Concrete & Masonry',
  flooring:'Flooring & Tile',drywall:'Drywall & Plastering',
  landscaping:'Landscaping & Irrigation',demolition:'Demolition'
};
const LIC_CAT_ORDER=['business','insurance','epa','electrical','gc','hvac','plumbing','roofing','concrete','flooring','drywall','landscaping','demolition'];
const COLL_STAGES={
  none:       {label:'',           color:'var(--text3)'},
  reminder:   {label:'Reminder sent',   color:'var(--text3)'},
  second:     {label:'2nd notice sent', color:'var(--amber)'},
  intent:     {label:'Intent to lien',  color:'#A32D2D'},
  lien_ready: {label:'🚨 Lien eligible', color:'#A32D2D'},
  lien_filed: {label:'⚖️ Lien filed',    color:'#A32D2D'},
  resolved:   {label:'✓ Resolved',      color:'var(--green)'},
};

const COLL_SMS={
  reminder: (name,bal,addr,biz)=>`Hi ${name}, this is ${biz}. Just a friendly reminder that a balance of ${fmt(bal)} is outstanding for the painting work at ${addr}. Please let us know when you're ready to take care of this. Thank you!`,
  second:   (name,bal,addr,biz)=>`Hi ${name}, this is a second notice from ${biz}. A balance of ${fmt(bal)} remains outstanding for work completed at ${addr}. Please respond within 5 business days to arrange payment and avoid further collection steps.`,
  intent:   (name,bal,addr,biz)=>`${name}, this is formal written notice from ${biz} of our intent to file a Mechanic's Lien against the property at ${addr} for unpaid services totaling ${fmt(bal)}. Under Kansas law (K.S.A. 60-1105), you have 7 days to remit full payment before we proceed with filing. Please contact us immediately.`,
};

// Collection, risk, lien, and county helpers moved to bids.js (load-order fix)


// ── State-based lien timing rules ─────────────────────────────────────────
// notice_days: days after last work to send demand/notice (statutory where req'd, else 10)
// filing_deadline_days: days from last day of work to file lien
const LIEN_RULES={
  AL:{notice_days:10,filing_deadline_days:120},  // Ala. Code §35-11-215
  AK:{notice_days:10,filing_deadline_days:120},  // AS §34.35.070
  AZ:{notice_days:20,filing_deadline_days:120},  // A.R.S. §33-993 (20d prelim notice subs)
  AR:{notice_days:10,filing_deadline_days:120},  // Ark. Code §18-44-117
  CA:{notice_days:20,filing_deadline_days:90},   // Civ. Code §8412 (20d prelim notice req'd)
  CO:{notice_days:10,filing_deadline_days:120},  // C.R.S. §38-22-109
  CT:{notice_days:10,filing_deadline_days:90},   // Conn. Gen. Stat. §49-34
  DC:{notice_days:10,filing_deadline_days:90},   // D.C. Code §40-303.13
  DE:{notice_days:10,filing_deadline_days:180},  // Del. Code §27-2712
  FL:{notice_days:45,filing_deadline_days:90},   // Fla. Stat. §713.08 (45d notice to owner)
  GA:{notice_days:10,filing_deadline_days:90},   // Ga. Code §44-14-361
  HI:{notice_days:10,filing_deadline_days:45},   // H.R.S. §507-42
  ID:{notice_days:10,filing_deadline_days:90},   // Idaho Code §45-507
  IL:{notice_days:10,filing_deadline_days:120},  // 770 ILCS 60/7
  IN:{notice_days:10,filing_deadline_days:90},   // Ind. Code §32-28-3-3
  IA:{notice_days:10,filing_deadline_days:90},   // Iowa Code §572.8
  KS:{notice_days:10,filing_deadline_days:120},  // K.S.A. 60-1105
  KY:{notice_days:10,filing_deadline_days:180},  // KRS §376.080
  LA:{notice_days:10,filing_deadline_days:60},   // La. R.S. §9:4822
  ME:{notice_days:10,filing_deadline_days:90},   // Me. Rev. Stat. §38-3251
  MD:{notice_days:10,filing_deadline_days:180},  // Md. Code §9-102
  MA:{notice_days:10,filing_deadline_days:90},   // Mass. Gen. Laws §254-2
  MI:{notice_days:10,filing_deadline_days:90},   // MCL §570.1111
  MN:{notice_days:10,filing_deadline_days:120},  // Minn. Stat. §514.08
  MS:{notice_days:10,filing_deadline_days:365},  // Miss. Code §85-7-131
  MO:{notice_days:10,filing_deadline_days:180},  // §429.080 RSMo
  MT:{notice_days:10,filing_deadline_days:90},   // Mont. Code §71-3-535
  NE:{notice_days:10,filing_deadline_days:120},  // Neb. Rev. Stat. §52-137
  NV:{notice_days:10,filing_deadline_days:90},   // NRS §108.226
  NH:{notice_days:10,filing_deadline_days:120},  // RSA §447:9
  NJ:{notice_days:10,filing_deadline_days:90},   // N.J.S.A. §2A:44A-6
  NM:{notice_days:10,filing_deadline_days:120},  // NMSA §48-2-7
  NY:{notice_days:10,filing_deadline_days:240},  // NY Lien Law §10 (8 months)
  NC:{notice_days:10,filing_deadline_days:120},  // N.C.G.S. §44A-12
  ND:{notice_days:10,filing_deadline_days:90},   // N.D.C.C. §35-27-02
  OH:{notice_days:10,filing_deadline_days:75},   // ORC §1311.06
  OK:{notice_days:10,filing_deadline_days:90},   // Okla. Stat. §42-142
  OR:{notice_days:10,filing_deadline_days:75},   // ORS §87.035
  PA:{notice_days:10,filing_deadline_days:180},  // 49 Pa. Stat. §1501
  RI:{notice_days:10,filing_deadline_days:200},  // R.I. Gen. Laws §34-28-4 (from FIRST furnishing)
  SC:{notice_days:10,filing_deadline_days:90},   // S.C. Code §29-5-90
  SD:{notice_days:10,filing_deadline_days:120},  // SDCL §44-9-14
  TN:{notice_days:10,filing_deadline_days:90},   // Tenn. Code §66-11-112
  TX:{notice_days:15,filing_deadline_days:100},  // Tex. Prop. Code §53.052 (15th of 4th month)
  UT:{notice_days:20,filing_deadline_days:90},   // Utah Code §38-1a-501 (20d prelim notice)
  VT:{notice_days:10,filing_deadline_days:180},  // 12 V.S.A. §9-3253
  VA:{notice_days:10,filing_deadline_days:90},   // Va. Code §43-4
  WA:{notice_days:60,filing_deadline_days:90},   // RCW §60.04.091 (60d prelim notice req'd)
  WV:{notice_days:10,filing_deadline_days:100},  // W. Va. Code §38-2-7
  WI:{notice_days:10,filing_deadline_days:180},  // Wis. Stat. §779.06
  WY:{notice_days:10,filing_deadline_days:150},  // Wyo. Stat. §29-1-202
  default:{notice_days:10,filing_deadline_days:90}
};

// ── State-level filing info (county recorder name varies; use Maps link to find exact office) ──
const STATE_FILING_INFO={
  AL:{office:'Probate Judge\'s Office',cite:'Ala. Code §35-11-215',notes:['File verified statement with Probate Judge','Deadline: 4 months (120 days) from last day of work','Have document notarized before filing']},
  AK:{office:'District Recorder\'s Office',cite:'AS §34.35.070',notes:['File with District Recorder in the district where work was performed','Deadline: 120 days from last day of work']},
  AZ:{office:'County Recorder',cite:'A.R.S. §33-993',notes:['Subcontractors must serve 20-Day Preliminary Notice before filing','File with County Recorder','Deadline: 120 days from last day of work']},
  AR:{office:'Circuit Clerk\'s Office',cite:'Ark. Code §18-44-117',notes:['File with Circuit Clerk in county where work was performed','Deadline: 120 days from last day of work']},
  CA:{office:'County Recorder',cite:'Civ. Code §8412',notes:['20-Day Preliminary Notice required for all contractors & subs','File Mechanic\'s Lien with County Recorder','Deadline: 90 days from Notice of Completion (or 90 days from project completion if no notice filed)']},
  CO:{office:'County Clerk & Recorder',cite:'C.R.S. §38-22-109',notes:['File with County Clerk & Recorder','Deadline: 4 months (120 days) from last day of work','Have document notarized before filing']},
  CT:{office:'Town Clerk',cite:'Conn. Gen. Stat. §49-34',notes:['File Certificate of Lien with Town Clerk where property is located','Deadline: 90 days from last day of work','Notarization required']},
  DC:{office:'Recorder of Deeds',cite:'D.C. Code §40-303.13',notes:['File with D.C. Recorder of Deeds','Deadline: 90 days from last day of work']},
  DE:{office:'Prothonotary of Superior Court',cite:'Del. Code §27-2712',notes:['File Statement of Claim with Prothonotary','Deadline: 180 days from last day of work']},
  FL:{office:'Clerk of Circuit Court',cite:'Fla. Stat. §713.08',notes:['45-Day Notice to Owner required before filing','File Claim of Lien with Clerk of Circuit Court','Deadline: 90 days from last day of work','Have document notarized before filing']},
  GA:{office:'Superior Court Clerk',cite:'Ga. Code §44-14-361',notes:['File with Clerk of Superior Court in county where property is located','Deadline: 90 days from last day of work','Notarization required']},
  HI:{office:'Land Court / Bureau of Conveyances',cite:'H.R.S. §507-42',notes:['File with Land Court or Bureau of Conveyances','Deadline: 45 days from completion of contract — one of the shortest deadlines','Notarization required']},
  ID:{office:'County Recorder',cite:'Idaho Code §45-507',notes:['File with County Recorder','Deadline: 90 days from last day of work','Notarization required']},
  IL:{office:'Circuit Court Clerk',cite:'770 ILCS 60/7',notes:['File with Circuit Court Clerk in county where property is located','Deadline: 4 months (120 days) from last day of work','Serve copy on owner within 90 days of filing']},
  IN:{office:'Circuit / Superior Court Clerk',cite:'Ind. Code §32-28-3-3',notes:['File with Clerk of Circuit or Superior Court','Deadline: 90 days from last day of work']},
  IA:{office:'District Court Clerk',cite:'Iowa Code §572.8',notes:['File with Clerk of District Court','Deadline: 90 days from last day of work']},
  KS:{office:'Register of Deeds',cite:'K.S.A. 60-1105',notes:['Serve notice on property owner','File with County Register of Deeds','Deadline: 120 days from last day of work','Bring 2 notarized copies — retain stamped copy']},
  KY:{office:'Circuit Court Clerk',cite:'KRS §376.080',notes:['File with Clerk of Circuit Court','Deadline: 6 months (180 days) from last day of work','Notarization required']},
  LA:{office:'Parish Clerk of Court',cite:'La. R.S. §9:4822',notes:['File with Parish Clerk of Court','Deadline: 60 days from last day of work — one of the shortest in the US','Notarization required — act quickly']},
  ME:{office:'Registry of Deeds',cite:'Me. Rev. Stat. §38-3251',notes:['File True Statement with Registry of Deeds in county where property is located','Deadline: 90 days from last day of work','Notarization required']},
  MD:{office:'Circuit Court Clerk',cite:'Md. Code §9-102',notes:['File with Clerk of Circuit Court','Deadline: 180 days from last day of work','Notarization required']},
  MA:{office:'Registry of Deeds',cite:'Mass. Gen. Laws §254-2',notes:['File with Registry of Deeds in county where property is located','Deadline: 90 days from last day of work','Notarization required']},
  MI:{office:'Register of Deeds',cite:'MCL §570.1111',notes:['File with County Register of Deeds','Deadline: 90 days from last day of work','Sworn/notarized statement required']},
  MN:{office:'County Recorder / Registrar of Titles',cite:'Minn. Stat. §514.08',notes:['File with County Recorder or Registrar of Titles','Deadline: 120 days from last day of work']},
  MS:{office:'Circuit Court Clerk',cite:'Miss. Code §85-7-131',notes:['File with Clerk of Circuit Court','Deadline: 12 months from last day of work']},
  MO:{office:'Recorder of Deeds',cite:'§429.080 RSMo',notes:['Serve notice on property owner','File with County Recorder of Deeds','Deadline: 6 months (180 days) from last day of work','Bring 2 notarized copies — retain stamped copy']},
  MT:{office:'County Clerk',cite:'Mont. Code §71-3-535',notes:['File with County Clerk in county where work was performed','Deadline: 90 days from completion of contract']},
  NE:{office:'Register of Deeds',cite:'Neb. Rev. Stat. §52-137',notes:['Serve notice on property owner','File with County Register of Deeds','Deadline: 120 days from last day of work']},
  NV:{office:'County Recorder',cite:'NRS §108.226',notes:['File Notice of Lien with County Recorder','Deadline: 90 days from last day of work','Notarization required']},
  NH:{office:'Register of Deeds',cite:'RSA §447:9',notes:['File with County Register of Deeds','Deadline: 120 days from last day of work']},
  NJ:{office:'County Clerk',cite:'N.J.S.A. §2A:44A-6',notes:['File with County Clerk in county where property is located','Deadline: 90 days from last day of work','Notarization required']},
  NM:{office:'County Clerk',cite:'NMSA §48-2-7',notes:['File with County Clerk','Deadline: 120 days from last day of work','Notarization required']},
  NY:{office:'County Clerk',cite:'NY Lien Law §10',notes:['File with County Clerk in county where property is located','Deadline: 8 months (240 days) from last day of work','Notice of Pendency must be filed within 30 days of lien']},
  NC:{office:'Clerk of Superior Court',cite:'N.C.G.S. §44A-12',notes:['File with Clerk of Superior Court in county where property is located','Deadline: 120 days from last day of work']},
  ND:{office:'County Recorder',cite:'N.D.C.C. §35-27-02',notes:['File with County Recorder','Deadline: 90 days from last day of work']},
  OH:{office:'County Recorder',cite:'ORC §1311.06',notes:['File with County Recorder','Deadline: 75 days from last day of work — act fast, short deadline','Sworn/notarized affidavit required']},
  OK:{office:'County Clerk',cite:'Okla. Stat. §42-142',notes:['Serve notice on property owner','File Statement of Lien with County Clerk','Deadline: 90 days from last day of work']},
  OR:{office:'County Clerk',cite:'ORS §87.035',notes:['File with County Clerk','Deadline: 75 days from last day of work — act fast, short deadline','Claim must be verified/notarized']},
  PA:{office:'Prothonotary of Court of Common Pleas',cite:'49 Pa. Stat. §1501',notes:['File with Prothonotary of Court of Common Pleas in county where property is located','Deadline: 6 months (180 days) from last day of work','Serve copy of claim on owner within 1 month of filing']},
  RI:{office:'Town/City Clerk — Land Evidence Records',cite:'R.I. Gen. Laws §34-28-4',notes:['File with Town/City Land Evidence Records','Deadline: 200 days from FIRST day of furnishing (not last day) — verify carefully','Notarization required']},
  SC:{office:'Clerk of Court',cite:'S.C. Code §29-5-90',notes:['File with Clerk of Court in county where property is located','Deadline: 90 days from last day of work','Notarization required']},
  SD:{office:'Register of Deeds',cite:'SDCL §44-9-14',notes:['File with County Register of Deeds','Deadline: 120 days from last day of work']},
  TN:{office:'Register of Deeds',cite:'Tenn. Code §66-11-112',notes:['File with County Register of Deeds','Deadline: 90 days from last day of work']},
  TX:{office:'County Clerk — Real Property',cite:'Tex. Prop. Code §53.052',notes:['Monthly notices required — send to owner & GC by 15th of 2nd month after unpaid work','File Affidavit with County Clerk by 15th of 4th month after last work (~100 days)','TX has strict notice requirements — consult an attorney for first-time TX liens']},
  UT:{office:'County Recorder',cite:'Utah Code §38-1a-501',notes:['20-Day Preliminary Notice required for subs & material suppliers','File with County Recorder','Deadline: 90 days from last day of work']},
  VT:{office:'Town Clerk',cite:'12 V.S.A. §9-3253',notes:['File with Town Clerk where property is located','Deadline: 180 days from last day of work','Notarization required']},
  VA:{office:'Circuit Court Clerk',cite:'Va. Code §43-4',notes:['File with Clerk of Circuit Court in county/city where property is located','Deadline: 90 days from last day of work']},
  WA:{office:'County Auditor',cite:'RCW §60.04.091',notes:['60-Day Preliminary Notice of Right to Lien required before filing','File with County Auditor','Deadline: 90 days from last day of work']},
  WV:{office:'Circuit Court Clerk',cite:'W. Va. Code §38-2-7',notes:['File with Clerk of Circuit Court in county where property is located','Deadline: 100 days from last day of work']},
  WI:{office:'Register of Deeds',cite:'Wis. Stat. §779.06',notes:['File with County Register of Deeds','Deadline: 6 months (180 days) from last day of work']},
  WY:{office:'County Clerk',cite:'Wyo. Stat. §29-1-202',notes:['File with County Clerk','Deadline: 150 days from last day of work']},
  default:{office:'County Clerk / Recorder of Deeds',cite:'',notes:['Verify filing requirements with your county office before filing','Deadline and notice requirements vary by state — consult a local attorney']}
};

// City → county map for KS cities
const KS_CITY_COUNTY={
  'WICHITA':'Sedgwick County','DERBY':'Sedgwick County','ANDOVER':'Butler County',
  'HAYSVILLE':'Sedgwick County','MAIZE':'Sedgwick County','BEL AIRE':'Sedgwick County',
  'VALLEY CENTER':'Sedgwick County','CHENEY':'Sedgwick County','MULVANE':'Sedgwick County',
  'TOPEKA':'Shawnee County','AUBURN':'Shawnee County','SILVER LAKE':'Shawnee County',
  'LAWRENCE':'Douglas County','LEAWOOD':'Johnson County','OVERLAND PARK':'Johnson County',
  'OLATHE':'Johnson County','SHAWNEE':'Johnson County','LENEXA':'Johnson County',
  'PRAIRIE VILLAGE':'Johnson County','MERRIAM':'Johnson County','MISSION':'Johnson County',
  'KANSAS CITY':'Wyandotte County','SALINA':'Saline County','MANHATTAN':'Riley County',
  'HUTCHINSON':'Reno County','DODGE CITY':'Ford County','GARDEN CITY':'Finney County',
  'EMPORIA':'Lyon County','PARSONS':'Labette County','PITTSBURG':'Crawford County',
};

const _CLOCK_DEFAULT_SCOPES=['movefurn','protect','tape','sand','spackle','caulk','prime','twocoat','cleanup','supply_run','collect_cash'];
const SW_FAMILIES=[
  {id:'white',  label:'White',      bg:'#F2EFE4',tc:'#555'},
  {id:'gray',   label:'Gray',       bg:'#B0ACA4',tc:'#fff'},
  {id:'beige',  label:'Beige',      bg:'#C8BA9E',tc:'#555'},
  {id:'blue',   label:'Blue',       bg:'#4A7FA5',tc:'#fff'},
  {id:'green',  label:'Green',      bg:'#5A7A50',tc:'#fff'},
  {id:'teal',   label:'Teal',       bg:'#4A8F8A',tc:'#fff'},
  {id:'yellow', label:'Yellow',     bg:'#D4A830',tc:'#555'},
  {id:'orange', label:'Orange',     bg:'#C47840',tc:'#fff'},
  {id:'red',    label:'Red',        bg:'#A03535',tc:'#fff'},
  {id:'pink',   label:'Pink',       bg:'#C87878',tc:'#fff'},
  {id:'purple', label:'Purple',     bg:'#6A5080',tc:'#fff'},
  {id:'brown',  label:'Brown',      bg:'#6A4E35',tc:'#fff'},
  {id:'black',  label:'Black',      bg:'#2A2A2A',tc:'#fff'},
  {id:'stain',  label:'Deck Stain', bg:'#7B4E2A',tc:'#fff'},
];

const _FINISH_TIPS={'Flat':'Ceilings and low traffic areas, hides imperfections.','Matte':'Similar to flat with slightly more durability.','Eggshell':'Most popular for living rooms and bedrooms, easy to clean.','Satin':'Kitchens, bathrooms and trim, moisture resistant and washable.','Semi-Gloss':'Doors, trim and cabinets, very durable and easy to wipe down.','Gloss':'Highest durability for doors and trim, very shiny.','Semi-Trans Stain':'Decks and fences, lets wood grain show through.','Solid Stain':'Decks and siding, full coverage like paint but breathes better.'};
const SW_PRODUCTS={
  interior:[
    {id:'pm700',  name:'ProMar 700',        sub:'Budget · rentals, basic repaint',           price:'$',   retail:55,  contractor:20, cov:350},
    {id:'pm400',  name:'ProMar 400',         sub:'Economy · fast flips, new construction',    price:'$',   retail:75,  contractor:25, cov:350},
    {id:'pm200',  name:'ProMar 200',         sub:'Standard · everyday residential',           price:'$$',  retail:83,  contractor:32, cov:350},
    {id:'pm200hp',name:'ProMar 200 HP',      sub:'Commercial grade · more durable than 200',  price:'$$',  retail:86,  contractor:34, cov:350},
    {id:'sp',     name:'SuperPaint',         sub:'Mid-grade · paint+primer, great coverage',  price:'$$',  retail:65,  contractor:37, cov:400},
    {id:'harm',   name:'Harmony',            sub:'Zero VOC · odor reducing, nurseries',       price:'$$',  retail:65,  contractor:37, cov:400},
    {id:'cash',   name:'Cashmere',           sub:'Smooth · luxury feel, flawless walls',      price:'$$$'},
    {id:'dur',    name:'Duration Home',      sub:'Durable · kids, pets, high traffic',        price:'$$$'},
    {id:'em',     name:'Emerald',            sub:'Top tier · best hide, washable',            price:'$$$$'},
    {id:'emde',   name:'Emerald Designer',   sub:'Best of best · flawless, burnish resistant',price:'$$$$'},
  ],
  ceiling:[
    {id:'pm200c', name:'ProMar Ceiling',     sub:'Flat white only · cannot be tinted',        price:'$',   retail:55,  contractor:22, cov:350},
    {id:'emin',   name:'Eminence Ceiling',   sub:'Bright white only · self-priming, one-coat',price:'$$',  retail:37,  contractor:28, cov:400},
    {id:'emceil', name:'Emerald (flat)',      sub:'Tintable any color · premium ceiling',      price:'$$$$',retail:74,  contractor:52, cov:400},
  ],
  exterior:[
    {id:'a100',   name:'A-100 Exterior',     sub:'Budget exterior · good value',              price:'$',   retail:49,  contractor:30, cov:350},
    {id:'flx',    name:'FlexTemp',           sub:'Wide temp range · 35-120°F application',    price:'$$',  retail:75,  contractor:42, cov:350},
    {id:'spe',    name:'SuperPaint Ext.',    sub:'Standard · workhorse siding & trim',        price:'$$',  retail:63,  contractor:38, cov:350},
    {id:'dure',   name:'Duration Exterior',  sub:'Premium · 25yr warranty, self-priming',     price:'$$$', retail:81,  contractor:48, cov:400},
    {id:'eme',    name:'Emerald Exterior',   sub:'Best · self-cleaning, color retention',     price:'$$$$',retail:86,  contractor:54, cov:400},
    {id:'loxon',  name:'Loxon Masonry',      sub:'Masonry/concrete/stucco exterior',          price:'$$$', retail:70,  contractor:44, cov:300},
  ],
  deck:[
    {id:'sd_semi', name:'SuperDeck Semi-Trans',sub:'Semi-transparent stain · shows wood grain',  price:'$$',  retail:58,  contractor:38, cov:250},
    {id:'sd_solid',name:'SuperDeck Solid',     sub:'Solid stain · full hide, longest lasting',   price:'$$',  retail:65,  contractor:42, cov:300},
    {id:'arv_semi',name:'Deckscapes Semi-Trans',sub:'Semi-transparent · natural wood look',       price:'$$',  retail:52,  contractor:34, cov:250},
    {id:'arv_solid',name:'Deckscapes Solid',   sub:'Solid stain · great for weathered wood',     price:'$$',  retail:60,  contractor:38, cov:300},
    {id:'dec_paint',name:'Porch & Floor Paint',sub:'Solid paint · porches, concrete, wood floors',price:'$$', retail:68,  contractor:44, cov:350},
  ],
  trim:[
    {id:'pm200t', name:'ProMar 200',         sub:'Standard trim & doors',                     price:'$$',  retail:83,  contractor:32, cov:400},
    {id:'ase',    name:'All Surface Enamel', sub:'Versatile enamel · doors, metal, wood',     price:'$$$', retail:50,  contractor:38, cov:400},
    {id:'pclassw',name:'ProClassic WB',      sub:'Smooth trim & cabinetry · waterborne',      price:'$$$', retail:80,  contractor:48, cov:400},
    {id:'pclassa',name:'ProClassic Alkyd',   sub:'Oil-based trim · ultra hard finish',        price:'$$$', retail:80,  contractor:48, cov:400},
    {id:'emure',  name:'Emerald Urethane',   sub:'Best · doors, cabinets, furniture',         price:'$$$$',retail:95,  contractor:58, cov:400},
    {id:'gallery',name:'Gallery Series',     sub:'Cabinet spray finish · factory-like',       price:'$$$$',retail:90,  contractor:55, cov:400},
    {id:'wc_semi',name:'WoodClassics Semi-Trans',sub:'Semi-transparent wood stain · shows grain',price:'$$',retail:52,contractor:34,cov:250},
    {id:'wc_solid',name:'WoodClassics Solid',sub:'Solid stain · full hide on wood trim/doors', price:'$$',retail:58, contractor:38, cov:300},
  ],
};
const SW_PRODUCT_INFO={
  pm700:{name:'ProMar 700',when:'Bare-bones budget jobs — apartment turnovers, storage units, basic new construction where the owner plans to repaint soon.',good:'Cheap, fast, acceptable coverage on fresh drywall.',notFor:'Anywhere a client expects to keep the paint long-term. Won\'t hold up to cleaning or scuffs.',jobs:'Rental flips, storage units, builder-grade new construction.'},
  pm400:{name:'ProMar 400',when:'Slightly better than 700, still budget. Being phased out — hard to find in sheens other than flat.',good:'Fast application, economical on large commercial repaint.',notFor:'Any residential job where durability matters. Avoid on trim or high-touch surfaces.',jobs:'Large commercial spaces on tight budget, basic wall repaints.'},
  pm200:{name:'ProMar 200 Zero VOC',when:'Your go-to standard residential repaint. Solid contractor workhorse — covers well, touches up cleanly, holds up to normal residential use.',good:'Zero VOC, antimicrobial, great contractor pricing, easy to work with. Good coverage and washability for the price.',notFor:'High-end homes where the client wants the absolute best. Not ideal for kitchens/baths where walls get scrubbed frequently.',jobs:'Standard bedroom, living room, hallway repaints. Most everyday residential.'},
  pm200hp:{name:'ProMar 200 HP',when:'Commercial step-up from standard ProMar 200. More abrasion resistant — handles scrubbing and high traffic better.',good:'LEED certified, Greenguard Gold, harder finish than standard 200. Good for commercial clients who need durability specs.',notFor:'Overkill for standard residential — use regular ProMar 200 instead.',jobs:'Light commercial, offices, schools, multi-family common areas.'},
  sp:{name:'SuperPaint Interior',when:'Mid-grade residential upgrade from ProMar 200. Paint-and-primer combo means better coverage in one coat on most repaints.',good:'Self-priming, excellent hide, very forgiving on color changes. Popular for its ease of use and consistent results.',notFor:'Not as durable as Duration or Emerald for scrubbing-heavy areas.',jobs:'Mid-range residential repaints, living rooms, bedrooms. Good choice when client wants better than standard but not premium pricing.'},
  harm:{name:'Harmony',when:'Client has sensitivities, allergies, or is concerned about air quality. Nurseries, healthcare settings, anyone who reacts to paint fumes.',good:'Zero VOC, actively reduces household odors, Greenguard certified. Makes a great sales talking point on premium jobs.',notFor:'Not a durability upgrade — use Duration or Emerald if they need both air quality and toughness.',jobs:'Nurseries, bedrooms for sensitive clients, assisted living, any job where the client mentions smell concerns.'},
  cash:{name:'Cashmere Interior',when:'Client wants that smooth, luxurious wall feel. Cashmere lays incredibly flat with almost no roller texture.',good:'Silky finish, excellent hide, minimal brush/roller marks. Looks stunning in living rooms and master bedrooms.',notFor:'Not as washable as Duration or Emerald — keep away from kitchens and kids rooms.',jobs:'Upscale living rooms, dining rooms, master suites. When the client says "I want it to look really smooth."'},
  dur:{name:'Duration Home',when:'Family with kids, pets, or anyone who cleans their walls. Moisture resistant tech makes it the go-to for bathrooms.',good:'Lifetime warranty, cross-linking technology creates a tough washable film, excellent stain resistance. One of the best values at this price tier.',notFor:'Not necessary on low-traffic rooms like formal dining — save the client money and use SuperPaint there.',jobs:'Kitchens, bathrooms, kids rooms, hallways, any high-traffic area.'},
  em:{name:'Emerald Interior',when:'Premium residential — when the client is investing in their home and wants the best hide, most washable, longest lasting finish.',good:'Best in class hide, self-priming, excellent washability, scrubbable. Makes color changes easier. Paint looks richer and deeper.',notFor:'Overkill for rental properties or budget-conscious clients.',jobs:'High-end residential repaints, accent walls, any room where color accuracy matters most.'},
  emde:{name:'Emerald Designer Edition',when:'Governor\'s mansion level. Client has an interior designer involved, wants magazine-quality results.',good:'Best hide of any SW product, burnish resistant, superior color accuracy. The top of the line.',notFor:'Any job where budget is a concern.',jobs:'Luxury residential, high-end staging, designer-specified projects.'},
  pm200c:{name:'ProMar Ceiling Paint',when:'Standard ceiling repaint where you just need a clean flat white fast.',good:'Contractor pricing, fast application, flat finish hides ceiling imperfections.',notFor:'If client wants a colored ceiling — use a wall paint in flat instead.',jobs:'Standard white ceiling on everyday residential repaint.'},
  emin:{name:'Eminence Ceiling',when:'Upgrade from ProMar ceiling — self-priming, claimed one-coat coverage, higher LRV white.',good:'Very bright white (LRV 92), mold resistant, fast dry, doesn\'t splatter much. Makes ceilings look crisp.',notFor:'Colored ceilings — only comes in white.',jobs:'Any job where the client wants a noticeably bright clean ceiling.'},
  emceil:{name:'Emerald (Flat)',when:'Colored ceiling, or when the client wants the absolute best ceiling finish. Tintable to any color.',good:'All the Emerald benefits — hide, washability — in flat sheen for ceilings.',notFor:'Budget jobs — expensive for a ceiling.',jobs:'Accent ceilings, colored ceilings, high-end master bedrooms.'},
  a100:{name:'A-100 Exterior',when:'Budget exterior job. Rental property, cost-conscious client, or a surface that will be painted again in a few years.',good:'Economical, decent coverage, gets the job done.',notFor:'Anything the client wants to last 10+ years without repainting.',jobs:'Rental property exteriors, sheds, budget-constrained jobs.'},
  flx:{name:'FlexTemp Exterior',when:'Painting in early spring or late fall when temperatures swing. Can apply in 35-120F — huge in Kansas weather.',good:'Wide application temperature range, resists fading and flaking, can go on vinyl.',notFor:'Summer peak season jobs where temperature isn\'t a concern — SuperPaint or Duration performs better.',jobs:'Spring/fall exterior work, any job where weather is unpredictable.'},
  spe:{name:'SuperPaint Exterior',when:'Standard exterior repaint workhorse. Go-to product for most exterior siding and trim jobs.',good:'Paint and primer in one, excellent coverage, holds up to weather well. Easy to work with.',notFor:'If client is in a severe weather area or wants a long warranty — step up to Duration.',jobs:'Standard exterior house repaints — siding, fascia, exterior trim.'},
  dure:{name:'Duration Exterior',when:'Client wants the job to last. 25-year limited warranty, self-priming, flexible film handles temperature cycling well.',good:'Excellent for Kansas freeze-thaw cycles. Resists cracking, peeling, blistering. One-coat on most repaints.',notFor:'Budget jobs — the price jump from SuperPaint may be hard to sell on a tight budget.',jobs:'Premium exterior repaints, cedar/wood siding, any job where durability is the selling point.'},
  eme:{name:'Emerald Exterior',when:'Top of the line exterior. Self-cleaning formula means rain actually rinses the surface. Best color retention available.',good:'Advanced resin technology, excellent fade resistance, dirt-shedding surface stays looking fresh longer.',notFor:'Average jobs — reserve for high-end homes where the investment makes sense.',jobs:'High-end residential exteriors, historic homes, any job where the client wants the absolute best.'},
  loxon:{name:'Loxon Masonry',when:'Painting concrete, brick, stucco, CMU block, or any masonry surface. Purpose-built for porous surfaces.',good:'Penetrates masonry, excellent adhesion, alkali resistant, waterproofing properties.',notFor:'Wood, vinyl, or standard drywall — wrong product for non-masonry.',jobs:'Foundation walls, brick exteriors, stucco homes, concrete block.'},
  pm200t:{name:'ProMar 200 (Trim)',when:'Standard trim on everyday residential jobs.',good:'Cost effective, solid adhesion, good block resistance.',notFor:'High-end trim or cabinetry where you want a furniture-like finish.',jobs:'Standard interior doors, window trim, base/crown molding.'},
  ase:{name:'All Surface Enamel',when:'Versatile hard enamel that works on wood, metal, masonry, and previously painted surfaces.',good:'Multi-surface, hard durable film, good for doors that get slammed and banged.',notFor:'Cabinetry or furniture where leveling and smoothness matter most.',jobs:'Exterior doors, metal railings, radiators, any mixed-surface trim situation.'},
  pclassw:{name:'ProClassic Waterborne',when:'Smooth trim and cabinetry where you want a hard enamel finish without oil-based cleanup.',good:'Excellent flow and leveling — minimal brush marks. Cleans up with water. Great for painted cabinets.',notFor:'Exterior use — it\'s an interior product.',jobs:'Kitchen cabinets, bathroom vanities, built-ins, high-end trim work.'},
  pclassa:{name:'ProClassic Alkyd (Oil)',when:'Old-school painters swear by it for trim. Oil-based means it self-levels beautifully and cures rock hard.',good:'Superior hardness when cured, outstanding flow and leveling. Some painters get a better finish than waterborne.',notFor:'DIY clients or anyone sensitive to VOCs. Longer dry time, solvent cleanup required.',jobs:'High-end trim, doors, cabinetry when a glass-smooth finish is the goal.'},
  emure:{name:'Emerald Urethane Trim Enamel',when:'When the client wants the absolute best on their trim, doors, or cabinets. Urethane hardener makes it incredibly durable.',good:'Chip resistant, extremely hard finish, excellent flow and leveling, looks almost factory-sprayed when brushed carefully.',notFor:'Budget trim jobs — significant price premium.',jobs:'Custom cabinetry, front doors, built-ins, any trim where the client is paying for premium.'},
  gallery:{name:'Gallery Series (Spray)',when:'Cabinet refinishing or millwork when you\'re spraying, not brushing. Factory-like finish in 30 minutes.',good:'Designed for spray application, dries in 30 min, recoat in 45 min. Outstanding hardness and flow.',notFor:'Brush or roller application — this is a spray product.',jobs:'Cabinet spray jobs, millwork, built-ins where you\'re set up with a sprayer.'},
};
const SURF_PRODUCT_TYPE={
  walls:'interior',ceiling:'ceiling',
  ext_walls:'exterior',ext_trim:'exterior',deck:'deck',
  trim:'trim',doors:'trim',windows:'trim',cabinets:'trim',
};
// Trade job templates — scope:'resi'|'commercial'|'both', gasLic=requires gas license
const TRADE_JOBS={
  plumbing:[
    // ── Residential ────────────────────────────────────────────────────────────
    {id:'faucet',      name:'Faucet replacement',          scope:'resi', labor:125, mat:80,  matDesc:'Faucet',              hrs:1.5,unit:'ea'},
    {id:'toilet',      name:'Toilet replacement',          scope:'resi', labor:175, mat:220, matDesc:'Toilet',              hrs:2,  unit:'ea'},
    {id:'wh40',        name:'Water heater (40gal gas)',     scope:'resi', labor:350, mat:500, matDesc:'WH 40gal gas',        hrs:3,  unit:'ea'},
    {id:'wh50',        name:'Water heater (50gal gas)',     scope:'resi', labor:350, mat:600, matDesc:'WH 50gal gas',        hrs:3.5,unit:'ea'},
    {id:'wh_elec',     name:'Water heater (electric)',      scope:'resi', labor:300, mat:550, matDesc:'WH electric',         hrs:3,  unit:'ea'},
    {id:'tankless_g',  name:'Tankless WH (gas)',            scope:'resi', labor:450, mat:900, matDesc:'Tankless WH',        hrs:5,  unit:'ea',gasLic:true,freeForm:true,freeFormLabel:'Brand/model (e.g. Navien NPE-240S)'},
    {id:'tankless_e',  name:'Tankless WH (electric)',       scope:'resi', labor:350, mat:650, matDesc:'Tankless WH',        hrs:4,  unit:'ea',           freeForm:true,freeFormLabel:'Brand/model (e.g. Stiebel Eltron DHC-E)'},
    {id:'boiler',      name:'Boiler replacement',           scope:'resi', labor:800, mat:2500,matDesc:'Boiler',             hrs:8,  unit:'ea',gasLic:true,freeForm:true,freeFormLabel:'Brand/model (e.g. Weil-McLain, Burnham)'},
    {id:'drain',       name:'Drain cleaning',               scope:'both', labor:150, mat:0,                                  hrs:1,  unit:'ea'},
    {id:'hydro_jet',   name:'Hydro-jetting',                scope:'both', labor:350, mat:0,                                  hrs:2,  unit:'ea'},
    {id:'leak',        name:'Leak repair — supply line',    scope:'both', labor:100, mat:25,  matDesc:'Fittings',            hrs:1,  unit:'ea'},
    {id:'valve',       name:'Shut-off valve',               scope:'both', labor:125, mat:35,  matDesc:'Ball valve',          hrs:1.5,unit:'ea'},
    {id:'disp',        name:'Garbage disposal',             scope:'resi', labor:175, mat:150, matDesc:'Disposal unit',       hrs:2,  unit:'ea'},
    {id:'sump',        name:'Sump pump replace',            scope:'resi', labor:200, mat:180, matDesc:'Sump pump',           hrs:2,  unit:'ea'},
    {id:'hose',        name:'Hose bib replace',             scope:'both', labor:95,  mat:25,  matDesc:'Hose bib',            hrs:1,  unit:'ea'},
    {id:'pipe_cu',     name:'Pipe repair — copper',         scope:'both', labor:150, mat:45,  matDesc:'Copper fittings',     hrs:2,  unit:'ea'},
    {id:'pipe_pvc',    name:'Pipe repair — PVC',            scope:'both', labor:120, mat:30,  matDesc:'PVC fittings',        hrs:1.5,unit:'ea'},
    {id:'gas_repair',  name:'Gas line repair',              scope:'both', labor:200, mat:50,  matDesc:'Gas fittings',        hrs:2,  unit:'ea',gasLic:true},
    {id:'gas_run',     name:'Gas line new run',             scope:'both', labor:25,  mat:8,   matDesc:'Gas pipe',            hrs:0,  unit:'lin ft',custom:true,gasLic:true},
    {id:'gas_conn',    name:'Gas appliance hookup',         scope:'both', labor:150, mat:30,  matDesc:'Gas connector',       hrs:1.5,unit:'ea',gasLic:true},
    // ── Commercial ─────────────────────────────────────────────────────────────
    {id:'c_wh_comm',   name:'Commercial water heater',      scope:'commercial',labor:600, mat:1500,matDesc:'Commercial WH',hrs:6,  unit:'ea',freeForm:true,freeFormLabel:'Brand/model'},
    {id:'c_tankless',  name:'Commercial tankless system',   scope:'commercial',labor:800, mat:1800,matDesc:'Comm tankless',hrs:8,  unit:'ea',gasLic:true,freeForm:true,freeFormLabel:'Brand/model'},
    {id:'c_backflow',  name:'Backflow preventer',           scope:'commercial',labor:350, mat:280, matDesc:'RPZ backflow',   hrs:3,  unit:'ea'},
    {id:'c_grease',    name:'Grease trap service',          scope:'commercial',labor:200, mat:0,                             hrs:2,  unit:'ea'},
    {id:'c_booster',   name:'Booster pump system',         scope:'commercial',labor:800, mat:1200,matDesc:'Booster pump',   hrs:8,  unit:'ea'},
    {id:'c_drain_comm',name:'Floor drain install',          scope:'commercial',labor:250, mat:120, matDesc:'Floor drain',    hrs:3,  unit:'ea'},
    {id:'c_gas_main',  name:'Gas main service line',        scope:'commercial',labor:600, mat:200, matDesc:'Gas pipe + reg', hrs:6,  unit:'ea',gasLic:true},
  ],
  electrical:[
    // ── Residential ────────────────────────────────────────────────────────────
    {id:'outlet',      name:'Outlet addition',              scope:'resi', labor:150, mat:45,  matDesc:'Outlet + box + wire', hrs:2,  unit:'ea', nw:0.20},
    {id:'breaker',     name:'Breaker replacement',          scope:'both', labor:125, mat:35,  matDesc:'Breaker',             hrs:1,  unit:'ea', nw:1.0},
    {id:'light',       name:'Light fixture install',        scope:'both', labor:95,  mat:0,                                  hrs:1,  unit:'ea', nw:0.28},
    {id:'fan',         name:'Ceiling fan install',          scope:'resi', labor:150, mat:0,                                  hrs:1.5,unit:'ea', nw:0.30},
    {id:'gfci',        name:'GFCI outlet',                  scope:'both', labor:85,  mat:18,  matDesc:'GFCI outlet',         hrs:.75,unit:'ea', nw:0.20},
    {id:'switch',      name:'Switch replace/add',           scope:'both', labor:75,  mat:15,  matDesc:'Switch + cover',      hrs:.75,unit:'ea', nw:0.20},
    {id:'smoke',       name:'Smoke/CO detector',            scope:'both', labor:45,  mat:25,  matDesc:'Smoke/CO detector',   hrs:.5, unit:'ea', nw:0.22},
    {id:'ev_resi',     name:'EV charger — NEMA 14-50',      scope:'resi', labor:450, mat:120, matDesc:'NEMA 14-50 outlet',   hrs:4,  unit:'ea', nw:0.60},
    {id:'panel_100',   name:'Panel upgrade (100A)',         scope:'resi', labor:800, mat:400, matDesc:'Panel + breakers',    hrs:8,  unit:'ea', nw:0.85},
    {id:'panel_200',   name:'Panel upgrade (200A)',         scope:'resi', labor:1200,mat:600, matDesc:'200A panel + breakers',hrs:10,unit:'ea', nw:0.85},
    {id:'exhaust',     name:'Bath exhaust fan',             scope:'resi', labor:175, mat:55,  matDesc:'Exhaust fan',         hrs:2,  unit:'ea', nw:0.28},
    {id:'exterior',    name:'Exterior outlet (WP)',         scope:'both', labor:175, mat:45,  matDesc:'Weatherproof outlet', hrs:2,  unit:'ea', nw:0.28},
    {id:'xfer_man',    name:'Transfer switch (manual)',     scope:'both', labor:250, mat:180, matDesc:'Manual transfer sw',  hrs:3,  unit:'ea', nw:1.0},
    {id:'xfer_auto',   name:'Transfer switch (auto)',       scope:'both', labor:450, mat:650, matDesc:'Auto transfer sw',   hrs:5,  unit:'ea', nw:1.0},
    {id:'gen_hookup',  name:'Generator hookup',             scope:'both', labor:350, mat:120, matDesc:'Inlet + interlock',   hrs:4,  unit:'ea', nw:1.0},
    // ── Solar & Off-Grid ───────────────────────────────────────────────────────
    {id:'solar_kw',    name:'Solar install (per kW)',        scope:'both', labor:400, mat:900, matDesc:'Solar panels',        hrs:0,  unit:'kW', custom:true, freeForm:true,freeFormLabel:'Panel brand (e.g. REC, Silfab, Hanwha)',nw:1.0},
    {id:'inverter',    name:'Inverter install',             scope:'both', labor:900, mat:3800,matDesc:'Inverter',            hrs:10, unit:'ea', freeForm:true,freeFormLabel:'Inverter model (e.g. Sol-Ark 15k, EG4 18kPV)',nw:1.0},
    {id:'battery',     name:'Battery install',              scope:'both', labor:200, mat:1100,matDesc:'Battery',             hrs:2,  unit:'ea', freeForm:true,freeFormLabel:'Battery model (e.g. EG4 LifePower4, Fortress eVault)',nw:1.0},
    {id:'bat_kwh',     name:'Battery bank (per kWh)',       scope:'both', labor:150, mat:450, matDesc:'Battery bank',        hrs:0,  unit:'kWh',custom:true, freeForm:true,freeFormLabel:'Battery brand/chemistry',nw:1.0},
    {id:'offgrid_design',name:'Off-grid system design',    scope:'both', labor:500, mat:0,                                  hrs:6,  unit:'ea', nw:1.0},
    {id:'c_solar_comm',name:'Commercial solar (per kW)',   scope:'commercial',labor:500,mat:1100,matDesc:'Comm solar panels',hrs:0,  unit:'kW', custom:true,freeForm:true,freeFormLabel:'Panel brand',nw:1.0},
    // ── Circuits & Sub-panels ──────────────────────────────────────────────────
    {id:'ded_120',     name:'Dedicated 120V circuit',      scope:'resi', labor:225, mat:55,  matDesc:'Wire + breaker',        hrs:2.5,unit:'ea', nw:0.45},
    {id:'ded_240',     name:'Dedicated 240V circuit',      scope:'resi', labor:375, mat:90,  matDesc:'Wire + 2-pole breaker',  hrs:4,  unit:'ea', nw:0.45},
    {id:'sub_panel',   name:'Sub-panel install',            scope:'both', labor:650, mat:450, matDesc:'Subpanel + breakers',    hrs:6,  unit:'ea', nw:0.80},
    {id:'afci',        name:'AFCI breaker',                 scope:'both', labor:85,  mat:45,  matDesc:'AFCI breaker',           hrs:.75,unit:'ea', nw:1.0},
    // ── Lighting extras ───────────────────────────────────────────────────────
    {id:'recessed',    name:'Recessed light (per can)',     scope:'both', labor:75,  mat:35,  matDesc:'LED can + trim',         hrs:.75,unit:'ea', nw:0.28},
    {id:'dimmer',      name:'Dimmer switch',                scope:'both', labor:65,  mat:20,  matDesc:'Dimmer switch',          hrs:.75,unit:'ea', nw:0.20},
    {id:'under_cab',   name:'Under-cabinet LED',            scope:'resi', labor:120, mat:45,  matDesc:'LED strip + driver',     hrs:1.5,unit:'ea', nw:0.35},
    // ── Specialty residential ─────────────────────────────────────────────────
    {id:'surge',       name:'Whole-house surge protector', scope:'both', labor:125, mat:80,  matDesc:'Whole-house SPD',        hrs:1,  unit:'ea', nw:1.0},
    {id:'hot_tub',     name:'Hot tub / spa wiring',        scope:'resi', labor:550, mat:180, matDesc:'240V disconnect + wire',  hrs:5,  unit:'ea', nw:0.65},
    {id:'rewire_room', name:'Rewire — per room',            scope:'resi', labor:650, mat:200, matDesc:'Wire + boxes + covers',   hrs:8,  unit:'room',freeForm:true,freeFormLabel:'Notes (e.g. knob-and-tube, aluminum wiring)',nw:1.0},
    {id:'conduit_lf',  name:'Conduit run (per lin ft)',     scope:'both', labor:8,   mat:4,   matDesc:'EMT + fittings',         hrs:0,  unit:'lin ft',custom:true,nw:0.55},
    {id:'low_volt',    name:'Low-voltage / Cat6 / coax',   scope:'both', labor:85,  mat:30,  matDesc:'Cable + keystone',       hrs:1,  unit:'drop', nw:0.40},
    // ── Appliance circuits ────────────────────────────────────────────────────
    {id:'dryer_30a',   name:'Dryer outlet (30A NEMA 14-30)',scope:'resi', labor:175, mat:50,  matDesc:'30A outlet + wire',      hrs:2,  unit:'ea', nw:0.40},
    {id:'dryer_50a',   name:'Dryer outlet (50A NEMA 14-50)',scope:'resi', labor:195, mat:55,  matDesc:'50A outlet + wire',      hrs:2,  unit:'ea', nw:0.40},
    {id:'range_50a',   name:'Range/stove outlet (50A)',     scope:'resi', labor:195, mat:55,  matDesc:'50A outlet + wire',      hrs:2,  unit:'ea', nw:0.40},
    {id:'dishwasher_ckt',name:'Dishwasher circuit',         scope:'resi', labor:185, mat:45,  matDesc:'Wire + breaker',         hrs:2,  unit:'ea', nw:0.40},
    {id:'disposal_ckt',name:'Garbage disposal circuit',     scope:'resi', labor:145, mat:35,  matDesc:'Wire + breaker',         hrs:1.5,unit:'ea', nw:0.40},
    {id:'microwave_ckt',name:'Microwave dedicated circuit', scope:'resi', labor:165, mat:40,  matDesc:'Wire + breaker',         hrs:1.5,unit:'ea', nw:0.40},
    {id:'fridge_ckt',  name:'Refrigerator dedicated circuit',scope:'resi',labor:155, mat:40,  matDesc:'Wire + breaker',         hrs:1.5,unit:'ea', nw:0.40},
    {id:'wh_elec_ckt', name:'Electric water heater circuit',scope:'resi', labor:225, mat:65,  matDesc:'Wire + 2-pole breaker',  hrs:2.5,unit:'ea', nw:0.45},
    {id:'range_hood_ckt',name:'Range hood circuit',         scope:'resi', labor:155, mat:40,  matDesc:'Wire + breaker',         hrs:1.5,unit:'ea', nw:0.40},
    {id:'ev_hw40',     name:'EV charger — hardwired (40A)', scope:'resi', labor:525, mat:140, matDesc:'40A EVSE + wire',        hrs:5,  unit:'ea', nw:0.65},
    // ── Service upgrades & grounding ──────────────────────────────────────────
    {id:'svc_150',     name:'Service upgrade (150A)',        scope:'resi', labor:950, mat:500, matDesc:'150A service entrance',  hrs:8,  unit:'ea', nw:0.90},
    {id:'svc_400',     name:'Service entrance (400A)',       scope:'resi', labor:1800,mat:900, matDesc:'400A service + meter',   hrs:14, unit:'ea', nw:0.90},
    {id:'meter_base',  name:'Meter base replacement',        scope:'both', labor:250, mat:180, matDesc:'Meter base',             hrs:2.5,unit:'ea', nw:1.0},
    {id:'ug_svc',      name:'Overhead to underground service',scope:'both',labor:1200,mat:600, matDesc:'Underground conduit+wire',hrs:10,unit:'ea', nw:1.0},
    {id:'grounding_rod',name:'Ground rod install (NEC 250)',  scope:'both',labor:150, mat:60,  matDesc:'Ground rod + clamp',     hrs:1.5,unit:'ea', nw:0.60},
    {id:'bond_verify', name:'Grounding/bonding verification', scope:'both',labor:125, mat:0,                                    hrs:1.5,unit:'ea', nw:1.0},
    {id:'alum_wire',   name:'Aluminum wiring remediation',   scope:'resi', labor:45,  mat:12,  matDesc:'COPALUM pigtail kit',   hrs:.5, unit:'outlet',nw:1.0},
    {id:'afci_bkr',    name:'AFCI/GFCI breaker upgrade',     scope:'both', labor:85,  mat:55,  matDesc:'Dual AFCI/GFCI breaker', hrs:.75,unit:'ea', nw:1.0},
    // ── Fixtures & lighting upgrades ──────────────────────────────────────────
    {id:'chandelier',  name:'Chandelier install (up to 50 lb)',scope:'resi',labor:195, mat:0,                                   hrs:2.5,unit:'ea', nw:0.28},
    {id:'track_light', name:'Track lighting system',          scope:'both',labor:175, mat:55,  matDesc:'Track + heads',         hrs:2,  unit:'ea', nw:0.30},
    {id:'vanity_bar',  name:'Vanity / bath bar lighting',     scope:'resi',labor:110, mat:0,                                   hrs:1.5,unit:'ea', nw:0.28},
    {id:'pendant',     name:'Pendant light install',          scope:'resi',labor:110, mat:0,                                   hrs:1.5,unit:'ea', nw:0.28},
    {id:'ballast_swap',name:'Ballast replacement',            scope:'both',labor:95,  mat:35,  matDesc:'Electronic ballast',    hrs:1,  unit:'ea', nw:1.0},
    {id:'led_retrofit',name:'Fluorescent to LED retrofit',    scope:'both',labor:75,  mat:30,  matDesc:'LED tube + bypass kit', hrs:.75,unit:'fixture',nw:0.35},
    // ── Outdoor & pool ────────────────────────────────────────────────────────
    {id:'pool_bond',   name:'Pool/spa bonding & GFCI',       scope:'resi', labor:350, mat:85,  matDesc:'Bonding wire + GFCI',   hrs:4,  unit:'ea', nw:0.70},
    {id:'pool_pump',   name:'Pool pump wiring (240V)',        scope:'resi', labor:275, mat:75,  matDesc:'Wire + disconnect',     hrs:3,  unit:'ea', nw:0.65},
    {id:'pool_light',  name:'Underwater pool light (GFCI)',   scope:'resi', labor:250, mat:120, matDesc:'Pool light + GFCI box', hrs:3,  unit:'ea', nw:0.70},
    {id:'pool_auto',   name:'Pool automation system wiring',  scope:'resi', labor:400, mat:0,                                   hrs:5,  unit:'ea', nw:0.80},
    {id:'landscape_xfmr',name:'Landscape lighting transformer',scope:'resi',labor:175,mat:80,  matDesc:'Low-volt transformer',  hrs:2,  unit:'ea', nw:0.55},
    {id:'path_light',  name:'Path / step light (per fixture)',scope:'resi', labor:55,  mat:35,  matDesc:'Fixture + wire',        hrs:.5, unit:'ea', nw:0.40},
    {id:'deck_light',  name:'Deck / soffit lighting',         scope:'resi', labor:95,  mat:45,  matDesc:'Fixture + box',         hrs:1,  unit:'ea', nw:0.35},
    {id:'pond_light',  name:'Fountain / pond lighting',       scope:'resi', labor:145, mat:65,  matDesc:'Waterproof fixture',    hrs:1.5,unit:'ea', nw:0.55},
    {id:'deice_cable', name:'Roof de-icing cable install',    scope:'resi', labor:250, mat:120, matDesc:'Heat cable + thermostat',hrs:3,  unit:'ea', nw:1.0},
    {id:'xmas_outlet', name:'Roofline weatherproof outlet',   scope:'resi', labor:175, mat:45,  matDesc:'WP outlet + box + wire',hrs:2,  unit:'ea', nw:0.28},
    // ── Smart home & security ─────────────────────────────────────────────────
    {id:'doorbell',    name:'Doorbell / smart doorbell wiring',scope:'both',labor:85,  mat:0,                                   hrs:1,  unit:'ea', nw:0.25},
    {id:'cam_rough',   name:'Security camera rough-in',        scope:'both',labor:75,  mat:20,  matDesc:'Conduit + wire',        hrs:.75,unit:'ea', nw:0.30},
    {id:'motion_sw',   name:'Motion sensor switch',            scope:'both',labor:75,  mat:25,  matDesc:'Motion switch',         hrs:.75,unit:'ea', nw:0.22},
    {id:'smart_panel', name:'Smart panel install (Span/Leviton)',scope:'resi',labor:350,mat:0,                                  hrs:4,  unit:'ea', nw:1.0,freeForm:true,freeFormLabel:'Panel model (e.g. Span Panel 200A)'},
    {id:'home_auto',   name:'Smart home wiring (Lutron/Leviton)',scope:'resi',labor:125,mat:45, matDesc:'Smart switch + hub',    hrs:1.5,unit:'ea', nw:0.30},
    {id:'intercom',    name:'Intercom / video doorbell system', scope:'both',labor:175, mat:0,                                   hrs:2,  unit:'ea', nw:0.35},
    {id:'access_ctrl', name:'Access control / door strike',    scope:'both',labor:225, mat:85,  matDesc:'Strike + controller',   hrs:2.5,unit:'ea', nw:0.40},
    // ── Diagnostics & inspections ─────────────────────────────────────────────
    {id:'elec_trouble',name:'Electrical troubleshooting (hr)', scope:'both',labor:125, mat:0,                                   hrs:1,  unit:'hr', nw:1.0},
    {id:'elec_insp',   name:'Home electrical safety inspection',scope:'resi',labor:175, mat:0,                                  hrs:2,  unit:'ea', nw:1.0},
    {id:'load_analysis',name:'Panel load analysis',            scope:'both',labor:150, mat:0,                                   hrs:1.5,unit:'ea', nw:1.0},
    {id:'permit_pull', name:'Permit coordination',             scope:'both',labor:125, mat:0,                                   hrs:1,  unit:'ea', nw:1.0},
    // ── Ag / rural / specialty ────────────────────────────────────────────────
    {id:'well_pump',   name:'Well pump wiring',                scope:'resi', labor:375, mat:110, matDesc:'Wire + disconnect',    hrs:4,  unit:'ea', nw:0.50},
    {id:'sump_pump_ckt',name:'Sump pump dedicated circuit',   scope:'resi', labor:165, mat:40,  matDesc:'Wire + breaker',       hrs:1.5,unit:'ea', nw:0.40},
    {id:'sauna',       name:'Sauna / steam room wiring (240V)',scope:'resi', labor:395, mat:95,  matDesc:'Wire + GFCI breaker',  hrs:4,  unit:'ea', nw:0.55},
    {id:'attic_fan',   name:'Attic fan wiring',                scope:'resi', labor:175, mat:35,  matDesc:'Wire + switch',        hrs:2,  unit:'ea', nw:0.40},
    {id:'barn_panel',  name:'Ag / barn sub-panel',             scope:'resi', labor:700, mat:500, matDesc:'100A panel + wire',    hrs:7,  unit:'ea', nw:0.85},
    {id:'workshop_panel',name:'Workshop / garage sub-panel',   scope:'resi', labor:600, mat:450, matDesc:'60A panel + wire',     hrs:6,  unit:'ea', nw:0.80},
    {id:'tr_outlet',   name:'Tamper-resistant outlet (per ea)',scope:'resi', labor:55,  mat:12,  matDesc:'TR outlet',            hrs:.5, unit:'ea', nw:0.18},
    // ── Commercial ────────────────────────────────────────────────────────────
    {id:'c_3phase',    name:'3-phase panel install',           scope:'commercial',labor:1200,mat:800, matDesc:'3-phase panel',  hrs:10, unit:'ea', nw:0.85},
    {id:'c_lighting',  name:'Commercial lighting (per fixture)',scope:'commercial',labor:150,mat:80,  matDesc:'LED fixture',    hrs:0,  unit:'fixture',custom:true,nw:0.30},
    {id:'c_ev_comm',   name:'EV charging station Level 2',     scope:'commercial',labor:800,mat:1200, matDesc:'Level 2 EVSE',  hrs:8,  unit:'ea', nw:0.65},
    {id:'c_panel_comm',name:'Commercial panel (400A)',          scope:'commercial',labor:2000,mat:1400,matDesc:'400A panel',   hrs:16, unit:'ea', nw:0.85},
    {id:'c_emerg_light',name:'Emergency / exit lighting',      scope:'commercial',labor:95, mat:65,  matDesc:'Exit/emerg light',hrs:1,  unit:'ea', nw:0.30},
    {id:'c_sub',       name:'Commercial sub-panel',            scope:'commercial',labor:900,mat:650, matDesc:'Subpanel + breakers',hrs:8,unit:'ea', nw:0.80},
    {id:'c_conduit',   name:'Conduit run — commercial',        scope:'commercial',labor:12, mat:7,   matDesc:'Rigid/EMT + fittings',hrs:0,unit:'lin ft',custom:true,nw:0.50},
    {id:'c_data',      name:'Data / telecom drop',             scope:'commercial',labor:95, mat:25,  matDesc:'Cat6 + keystone', hrs:1,  unit:'drop',nw:0.35},
    {id:'c_motor_disc',name:'Motor disconnect (HVAC/equip)',   scope:'commercial',labor:250,mat:120, matDesc:'Disconnect switch',hrs:2,  unit:'ea', nw:0.70},
    {id:'c_park_light',name:'Parking lot / area light',        scope:'commercial',labor:450,mat:350, matDesc:'LED pole light',  hrs:4,  unit:'ea', nw:0.65},
    {id:'c_svc_600',   name:'Service upgrade (600A)',           scope:'commercial',labor:3500,mat:2000,matDesc:'600A service',  hrs:20, unit:'ea', nw:0.90},
    {id:'c_svc_1200',  name:'Service upgrade (1200A)',          scope:'commercial',labor:6000,mat:3500,matDesc:'1200A service', hrs:32, unit:'ea', nw:0.90},
    {id:'c_fire_rough',name:'Fire alarm rough-in (per device)',scope:'commercial',labor:95, mat:35,  matDesc:'Device + wire',   hrs:1,  unit:'ea', nw:0.35},
    {id:'c_backup_gen_3ph',name:'Generator hookup — 3-phase + ATS',scope:'commercial',labor:1500,mat:800,matDesc:'3-phase ATS+cable',hrs:12,unit:'ea',nw:1.0},
    {id:'c_ups_rough', name:'UPS / battery backup rough-in',   scope:'commercial',labor:600,mat:0,                              hrs:6,  unit:'ea', nw:0.80},
    {id:'c_submeter',  name:'Tenant sub-metering',             scope:'commercial',labor:450,mat:280, matDesc:'Sub-meter + CT',  hrs:5,  unit:'ea', nw:0.75},
    {id:'c_arc_flash', name:'Arc flash study + NFPA 70E labels',scope:'commercial',labor:800,mat:0,                             hrs:8,  unit:'ea', nw:1.0},
    {id:'c_vfd',       name:'VFD / soft starter install',      scope:'commercial',labor:600,mat:0,                              hrs:6,  unit:'ea', nw:0.75,freeForm:true,freeFormLabel:'VFD brand/model (e.g. ABB, Yaskawa, Allen-Bradley)'},
    {id:'c_trans',     name:'Step-down transformer install',   scope:'commercial',labor:700,mat:0,                              hrs:6,  unit:'ea', nw:0.80,freeForm:true,freeFormLabel:'Transformer kVA + voltage (e.g. 75kVA 480V-208V)'},
    {id:'c_mcc',       name:'Motor control center (MCC) work', scope:'commercial',labor:850,mat:0,                              hrs:8,  unit:'ea', nw:0.80},
    {id:'c_kitchen_hookup',name:'Commercial kitchen equip hookup',scope:'commercial',labor:350,mat:60,matDesc:'Wire + disconnect',hrs:4, unit:'ea', nw:0.65},
    {id:'c_medical',   name:'Hospital-grade / isolated-ground outlet',scope:'commercial',labor:145,mat:40,matDesc:'IG outlet',  hrs:1.5,unit:'ea', nw:0.25},
    {id:'c_temp_power',name:'Temporary power (construction)',  scope:'commercial',labor:450,mat:200, matDesc:'Spider box + cable',hrs:5, unit:'ea', nw:1.0},
    {id:'c_tenant_imp',name:'Tenant improvement — electrical', scope:'commercial',labor:2,  mat:1,                              hrs:0,  unit:'sqft',custom:true,nw:0.60},
    {id:'c_lcs',       name:'Lighting control system (Lutron/Wattstopper)',scope:'commercial',labor:1200,mat:0,                  hrs:12, unit:'ea', nw:0.70,freeForm:true,freeFormLabel:'System model + zone count'},
    {id:'c_sign',      name:'Outdoor sign / marquee wiring',   scope:'commercial',labor:300,mat:80,  matDesc:'Wire + disconnect',hrs:3,  unit:'ea', nw:0.65},
    {id:'c_ev_l3',     name:'EV DC fast charger (Level 3) rough-in',scope:'commercial',labor:2000,mat:0,                        hrs:16, unit:'ea', nw:0.75},
    {id:'c_ev_fleet',  name:'Multi-stall EV station + load mgmt',scope:'commercial',labor:2500,mat:0,                           hrs:20, unit:'ea', nw:0.70,freeForm:true,freeFormLabel:'Number of stalls + target kW'},
    {id:'c_switchgear',name:'Switchgear / MDP install',        scope:'commercial',labor:3500,mat:0,                             hrs:24, unit:'ea', nw:0.85,freeForm:true,freeFormLabel:'Switchgear rating + manufacturer'},
    {id:'c_pole_light',name:'Outdoor pole light (per pole)',   scope:'commercial',labor:400,mat:300, matDesc:'LED fixture + pole',hrs:4,  unit:'ea', nw:0.65},
    {id:'c_struct_cable',name:'Structured cabling / Cat6 backbone',scope:'commercial',labor:85,mat:30,matDesc:'Cat6 + keystone',hrs:1,  unit:'drop',nw:0.35},
    {id:'c_poe',       name:'PoE network drops',               scope:'commercial',labor:75, mat:25,  matDesc:'Cat6 + keystone', hrs:.75,unit:'drop',nw:0.35},
    {id:'highbay_led', name:'High-bay LED install',            scope:'commercial',labor:175,mat:120, matDesc:'High-bay fixture', hrs:2,  unit:'ea', nw:0.35},
    {id:'c_thermo_scan',name:'Thermographic scan',             scope:'commercial',labor:350,mat:0,                              hrs:3,  unit:'ea', nw:1.0},
    {id:'c_solar_comm',name:'Commercial solar (per kW)',       scope:'commercial',labor:500,mat:1100, matDesc:'Comm solar panels',hrs:0, unit:'kW', custom:true,freeForm:true,freeFormLabel:'Panel brand',nw:1.0},
  ],
  hvac:[
    // ── Residential ────────────────────────────────────────────────────────────
    {id:'tuneup',      name:'AC/furnace tune-up',          scope:'both', labor:120, mat:0,                                  hrs:1.5,unit:'ea'},
    {id:'filter',      name:'Filter replacement',          scope:'both', labor:45,  mat:20,  matDesc:'Filter',              hrs:.5, unit:'ea'},
    {id:'cap',         name:'Capacitor replacement',       scope:'both', labor:175, mat:55,  matDesc:'Run capacitor',       hrs:1,  unit:'ea'},
    {id:'refrig',      name:'Refrigerant recharge',        scope:'both', labor:250, mat:120, matDesc:'R-410A',              hrs:2,  unit:'ea'},
    {id:'refrig_454b', name:'Refrigerant — R-454B',       scope:'both', labor:275, mat:150, matDesc:'R-454B (new systems)', hrs:2,  unit:'ea'},
    {id:'therm',       name:'Thermostat install',          scope:'both', labor:125, mat:0,                                  hrs:1,  unit:'ea'},
    {id:'motor',       name:'Condenser fan motor',         scope:'both', labor:225, mat:175, matDesc:'Fan motor',           hrs:2,  unit:'ea'},
    {id:'coil_clean',  name:'Evaporator coil clean',       scope:'both', labor:175, mat:0,                                  hrs:1.5,unit:'ea'},
    {id:'duct',        name:'Duct sealing',                scope:'both', labor:350, mat:80,  matDesc:'Mastic + foil tape',  hrs:3,  unit:'zone'},
    {id:'duct_sqft',   name:'Duct sealing — per sqft',     scope:'both', labor:.85, mat:.40, matDesc:'Mastic',              hrs:0,  unit:'sqft',custom:true},
    {id:'ac2t',        name:'AC replacement (2-ton)',      scope:'resi', labor:1200,mat:2800,matDesc:'2-ton AC unit',       hrs:8,  unit:'ea'},
    {id:'ac3t',        name:'AC replacement (3-ton)',      scope:'resi', labor:1400,mat:3400,matDesc:'3-ton AC unit',       hrs:10, unit:'ea'},
    {id:'ac4t',        name:'AC replacement (4-ton)',      scope:'resi', labor:1600,mat:4200,matDesc:'4-ton AC unit',       hrs:12, unit:'ea'},
    {id:'furnace_80',  name:'Furnace (80k BTU)',           scope:'resi', labor:800, mat:1500,matDesc:'80k BTU furnace',     hrs:8,  unit:'ea'},
    {id:'furnace_100', name:'Furnace (100k BTU)',          scope:'resi', labor:900, mat:1800,matDesc:'100k BTU furnace',    hrs:9,  unit:'ea'},
    {id:'mini_1z',     name:'Mini-split — 1 zone',        scope:'both', labor:800, mat:1200,matDesc:'Mini-split',           hrs:6,  unit:'ea',freeForm:true,freeFormLabel:'Brand/model (e.g. Mitsubishi MSZ-GL, Daikin, LG)'},
    {id:'mini_2z',     name:'Mini-split — 2 zone',        scope:'both', labor:1200,mat:2400,matDesc:'Multi-split system',  hrs:10, unit:'ea',freeForm:true,freeFormLabel:'Brand/model (e.g. Mitsubishi MXZ-2C, Daikin)'},
    {id:'mini_3z',     name:'Mini-split — 3 zone',        scope:'both', labor:1600,mat:3600,matDesc:'Multi-split system',  hrs:14, unit:'ea',freeForm:true,freeFormLabel:'Brand/model + zones'},
    {id:'mini_head',   name:'Mini-split add\'l head',      scope:'both', labor:400, mat:800, matDesc:'Indoor head unit',    hrs:4,  unit:'ea',freeForm:true,freeFormLabel:'Head model (e.g. MSZ-GL09NA)'},
    {id:'hrv',         name:'HRV install',                 scope:'resi', labor:600, mat:1200,matDesc:'HRV unit',            hrs:6,  unit:'ea',freeForm:true,freeFormLabel:'Brand/model (e.g. Broan HRV90, Fantech)'},
    {id:'erv',         name:'ERV install',                 scope:'resi', labor:600, mat:1400,matDesc:'ERV unit',            hrs:6,  unit:'ea',freeForm:true,freeFormLabel:'Brand/model (e.g. Broan ERV90, Renewaire)'},
    // ── Commercial ─────────────────────────────────────────────────────────────
    {id:'c_rtu_3t',    name:'Commercial RTU (3-ton)',      scope:'commercial',labor:1800,mat:5500, matDesc:'3-ton RTU',    hrs:12, unit:'ea',freeForm:true,freeFormLabel:'Brand/model (e.g. Carrier, Trane, Lennox)'},
    {id:'c_rtu_5t',    name:'Commercial RTU (5-ton)',      scope:'commercial',labor:2200,mat:8000, matDesc:'5-ton RTU',    hrs:16, unit:'ea',freeForm:true,freeFormLabel:'Brand/model'},
    {id:'c_rtu_10t',   name:'Commercial RTU (10-ton)',     scope:'commercial',labor:3500,mat:14000,matDesc:'10-ton RTU',   hrs:24, unit:'ea',freeForm:true,freeFormLabel:'Brand/model'},
    {id:'c_vrf_zone',  name:'VRF system (per zone)',       scope:'commercial',labor:1500,mat:3500, matDesc:'VRF system',   hrs:12, unit:'zone',freeForm:true,freeFormLabel:'Brand/model (e.g. Mitsubishi CITY MULTI)'},
    {id:'c_exhaust',   name:'Commercial exhaust system',   scope:'commercial',labor:800, mat:600, matDesc:'Exhaust fan+duct',hrs:8,  unit:'ea'},
    {id:'c_hood',      name:'Kitchen hood ventilation',    scope:'commercial',labor:600, mat:400, matDesc:'Hood + fan',     hrs:6,  unit:'ea'},
    {id:'c_chiller',   name:'Chiller service',             scope:'commercial',labor:500, mat:0,                             hrs:4,  unit:'ea'},
    {id:'c_btu_meter', name:'BTU meter install',           scope:'commercial',labor:350, mat:280, matDesc:'BTU meter',      hrs:3,  unit:'ea'},
  ],
  roofing:[
    {id:'shingle_sm',  name:'Shingle ~1,000 sqft',        scope:'both', labor:1500,mat:2500,matDesc:'3-tab shingles + felt',hrs:10,unit:'job'},
    {id:'shingle_md',  name:'Shingle ~1,500 sqft',        scope:'both', labor:2250,mat:3750,matDesc:'3-tab shingles + felt',hrs:15,unit:'job'},
    {id:'shingle_lg',  name:'Shingle ~2,000 sqft',        scope:'both', labor:3000,mat:5000,matDesc:'Arch shingles + felt', hrs:20,unit:'job'},
    {id:'arch_md',     name:'Arch shingle ~1,500 sqft',   scope:'both', labor:2500,mat:4500,matDesc:'Arch shingles + felt', hrs:15,unit:'job'},
    {id:'sqft',        name:'Shingle — enter sqft',        scope:'both', labor:1.50,mat:2.50,matDesc:'Shingles + felt',     hrs:0, unit:'sqft',custom:true},
    {id:'flat_tpo',    name:'Flat/TPO — enter sqft',       scope:'both', labor:1.20,mat:1.80,matDesc:'TPO membrane',        hrs:0, unit:'sqft',custom:true},
    {id:'epdm',        name:'EPDM — enter sqft',           scope:'commercial',labor:1.10,mat:1.60,matDesc:'EPDM membrane',  hrs:0, unit:'sqft',custom:true},
    {id:'metal_sqft',  name:'Metal roofing — per sqft',    scope:'both', labor:2.50,mat:3.50,matDesc:'Standing seam metal', hrs:0, unit:'sqft',custom:true},
    {id:'gutters',     name:'Gutters — enter lin ft',      scope:'both', labor:8,   mat:5,   matDesc:'Aluminum gutter',     hrs:0, unit:'lin ft',custom:true},
    {id:'fascia',      name:'Fascia — enter lin ft',       scope:'both', labor:6,   mat:4,   matDesc:'Fascia board',        hrs:0, unit:'lin ft',custom:true},
    {id:'repair',      name:'Patch / repair',              scope:'both', labor:250, mat:80,  matDesc:'Flashing + materials', hrs:2, unit:'ea'},
    {id:'skylight',    name:'Skylight install',            scope:'both', labor:600, mat:800, matDesc:'Skylight unit',        hrs:6, unit:'ea'},
  ],
  landscaping:[
    {id:'mow_sm',      name:'Mowing — small lot',          scope:'resi', labor:45,  mat:0,                                  hrs:.75,unit:'visit'},
    {id:'mow_md',      name:'Mowing — medium lot',         scope:'resi', labor:65,  mat:0,                                  hrs:1,  unit:'visit'},
    {id:'mow_lg',      name:'Mowing — large lot',          scope:'resi', labor:95,  mat:0,                                  hrs:1.5,unit:'visit'},
    {id:'mow_comm',    name:'Mowing — commercial',         scope:'commercial',labor:150,mat:0,                              hrs:2,  unit:'visit'},
    {id:'mulch',       name:'Mulch install',               scope:'both', labor:35,  mat:35,  matDesc:'Mulch (per cu yd)',   hrs:.5, unit:'cu yd'},
    {id:'sod',         name:'Sod installation',            scope:'both', labor:65,  mat:80,  matDesc:'Sod (per 100 sqft)', hrs:1,  unit:'100 sqft'},
    {id:'tree_sm',     name:'Tree trimming — small',       scope:'both', labor:150, mat:0,                                  hrs:2,  unit:'ea'},
    {id:'tree_lg',     name:'Tree trimming — large',       scope:'both', labor:350, mat:0,                                  hrs:4,  unit:'ea'},
    {id:'removal',     name:'Tree/shrub removal',          scope:'both', labor:300, mat:0,                                  hrs:4,  unit:'ea'},
    {id:'cleanup',     name:'Cleanup / haul-away',         scope:'both', labor:95,  mat:0,                                  hrs:1.5,unit:'load'},
    {id:'fert',        name:'Fertilization',               scope:'both', labor:75,  mat:45,  matDesc:'Fertilizer',          hrs:1,  unit:'visit'},
    {id:'plant',       name:'Plant / shrub install',       scope:'both', labor:65,  mat:0,                                  hrs:1,  unit:'ea'},
    {id:'irrig',       name:'Irrigation repair',           scope:'both', labor:95,  mat:35,  matDesc:'Heads + fittings',    hrs:1,  unit:'ea'},
    {id:'irrig_zone',  name:'Irrigation zone add',         scope:'both', labor:350, mat:180, matDesc:'Valve + heads + pipe',hrs:3,  unit:'zone'},
    {id:'snow',        name:'Snow removal',                scope:'both', labor:75,  mat:0,                                  hrs:1,  unit:'visit'},
    {id:'aerate',      name:'Core aeration',               scope:'resi', labor:95,  mat:0,                                  hrs:1,  unit:'visit'},
  ],
  general:[
    {id:'demo',        name:'Demo / haul-away',            scope:'both', labor:95,  mat:0,                                  hrs:2,  unit:'load'},
    {id:'drywall',     name:'Drywall patch',               scope:'both', labor:85,  mat:25,  matDesc:'Drywall + mud',       hrs:1.5,unit:'ea'},
    {id:'caulk',       name:'Caulking',                    scope:'both', labor:65,  mat:12,  matDesc:'Caulk tubes',         hrs:1,  unit:'ea'},
    {id:'handyman',    name:'Handyman — hourly',           scope:'both', labor:75,  mat:0,                                  hrs:1,  unit:'hr'},
    {id:'power_wash',  name:'Power washing',               scope:'both', labor:150, mat:0,                                  hrs:2,  unit:'ea'},
    {id:'gutter_clean',name:'Gutter cleaning',             scope:'resi', labor:125, mat:0,                                  hrs:1.5,unit:'ea'},
    {id:'insulation',  name:'Attic insulation (per sqft)', scope:'resi', labor:.35, mat:.65, matDesc:'Blown-in insulation',  hrs:0,  unit:'sqft',custom:true},
    {id:'c_janitorial',name:'Post-construction cleanup',   scope:'commercial',labor:150,mat:0,                              hrs:2,  unit:'hr'},
  ],
  other:[
    {id:'consult',     name:'Consultation / site visit',   scope:'both', labor:0,   mat:0,                                  hrs:.5, unit:'ea'},
    {id:'hourly',      name:'Hourly labor',                scope:'both', labor:75,  mat:0,                                  hrs:1,  unit:'hr'},
    {id:'service',     name:'Flat-rate service call',      scope:'both', labor:150, mat:0,                                  hrs:2,  unit:'ea'},
  ],
};

const TRADE_JOB_CATS={
  plumbing:{
    '🚿 Fixtures':['faucet','toilet','disp','hose'],
    '🌡️ Water Heaters':['wh40','wh50','wh_elec','tankless_g','tankless_e','boiler'],
    '🔧 Drains & Pipes':['drain','hydro_jet','leak','pipe_cu','pipe_pvc'],
    '🔩 Valves & Pumps':['valve','sump'],
    '🔥 Gas Work':['gas_repair','gas_run','gas_conn'],
    '🏢 Commercial':['c_wh_comm','c_tankless','c_backflow','c_grease','c_booster','c_drain_comm','c_gas_main'],
  },
  electrical:{
    '🔌 Outlets & Switches':['outlet','gfci','switch','exterior','dimmer','afci','tr_outlet','doorbell','motion_sw'],
    '💡 Fixtures & Lighting':['light','recessed','fan','exhaust','smoke','under_cab','chandelier','vanity_bar','pendant','track_light','ballast_swap','led_retrofit'],
    '⚡ Circuits & Panels':['breaker','ded_120','ded_240','sub_panel','panel_100','panel_200','afci_bkr','conduit_lf','low_volt'],
    '🔋 Backup & EV':['xfer_man','xfer_auto','gen_hookup','ev_resi','ev_hw40','surge'],
    '🍳 Appliance Circuits':['dryer_30a','dryer_50a','range_50a','dishwasher_ckt','disposal_ckt','microwave_ckt','fridge_ckt','wh_elec_ckt','range_hood_ckt'],
    '🔧 Service & Upgrades':['svc_150','svc_400','meter_base','ug_svc','grounding_rod','bond_verify','alum_wire','barn_panel','workshop_panel'],
    '🏊 Pool & Outdoor':['hot_tub','pool_bond','pool_pump','pool_light','pool_auto','landscape_xfmr','path_light','deck_light','pond_light','deice_cable','xmas_outlet'],
    '🔒 Smart Home & Security':['home_auto','smart_panel','cam_rough','access_ctrl','intercom'],
    '🔍 Diagnostics':['elec_trouble','elec_insp','load_analysis','permit_pull','well_pump','sump_pump_ckt','sauna','attic_fan','rewire_room'],
    '☀️ Solar & Storage':['solar_kw','inverter','battery','bat_kwh','offgrid_design'],
    '🏢 Commercial':['c_3phase','c_lighting','c_ev_comm','c_panel_comm','c_emerg_light','c_solar_comm','c_sub','c_conduit','c_data','c_motor_disc','c_park_light','c_svc_600','c_svc_1200','c_fire_rough','c_backup_gen_3ph','c_ups_rough','c_submeter','c_arc_flash','c_vfd','c_trans','c_mcc','c_kitchen_hookup','c_medical','c_temp_power','c_tenant_imp','c_lcs','c_sign','c_ev_l3','c_ev_fleet','c_switchgear','c_pole_light','c_struct_cable','c_poe','highbay_led','c_thermo_scan'],
  },
  hvac:{
    '🔧 Service':['tuneup','filter','cap','refrig','refrig_454b','therm','motor','coil_clean'],
    '🌬️ Ductwork':['duct','duct_sqft'],
    '❄️ AC Systems':['ac2t','ac3t','ac4t'],
    '🔥 Heating':['furnace_80','furnace_100'],
    '🌀 Mini-Splits':['mini_1z','mini_2z','mini_3z','mini_head'],
    '💨 Ventilation':['hrv','erv'],
    '🏢 Commercial':['c_rtu_3t','c_rtu_5t','c_rtu_10t','c_vrf_zone','c_exhaust','c_hood','c_chiller','c_btu_meter'],
  },
  roofing:{
    '📐 Preset sizes':['shingle_sm','shingle_md','shingle_lg','arch_md'],
    '📏 By measurement':['sqft','flat_tpo','epdm','metal_sqft'],
    '🔧 Components':['gutters','fascia','repair','skylight'],
  },
  landscaping:{
    '🌿 Mowing':['mow_sm','mow_md','mow_lg','mow_comm'],
    '🌱 Planting & Sod':['mulch','sod','plant','irrig','irrig_zone'],
    '🌳 Trees':['tree_sm','tree_lg','removal'],
    '🧹 Maintenance':['cleanup','fert','aerate','snow'],
  },
};

const SURF_ORDER=['walls','ceiling','trim','epoxy','ext_walls','ext_trim','deck','fence','doors','windows','cabinets'];
const SURF_NEEDS_H=['walls','ceiling','ext_walls','deck'];
const SURF_IS_COUNT=['doors','windows','cabinets'];
const SURF_LABELS={walls:'Walls',ceiling:'Ceiling',trim:'Trim',doors:'Doors',windows:'Windows',cabinets:'Cabinets',ext_walls:'Siding',ext_trim:'Ext trim',deck:'Deck',fence:'Fence staining',epoxy:'Epoxy floor'};
const PROP_TIERS={
  rental: {key:'rental',mult:0.82,paint:'ProMar 700',label:'Rental / Fixer',hint:'Budget finish · ProMar 700',
    products:{interior:'pm700',exterior:'a100',trim:'pm200t'}},
  avg:    {key:'avg',   mult:1.00,paint:'ProMar 200',label:'Average Home',  hint:'Standard finish · ProMar 200',
    products:{interior:'pm200',exterior:'spe',trim:'pm200t'}},
  nice:   {key:'nice',  mult:1.22,paint:'SuperPaint', label:'Well-Maintained',hint:'Quality finish · SuperPaint',
    products:{interior:'sp',exterior:'spe',trim:'pclassw'}},
  premium:{key:'premium',mult:1.50,paint:'Duration Home',label:'High-End / Premium',hint:'Premium finish · Duration',
    products:{interior:'dur',exterior:'dure',ceiling:'emceil',trim:'pclassw'}},
  commercial:{key:'commercial',mult:1.65,paint:'Duration',label:'Commercial',hint:'Commercial · equipment & setup',
    products:{interior:'dur',exterior:'dure',ceiling:'emceil',trim:'pclassw'}},
};
const IRS_EXPENSE_CATS=[
  {id:'materials',        icon:'🪣', label:'Materials & supplies',       deductible:true, line:'Part II Line 22'},
  {id:'tools',            icon:'🔧', label:'Tools & equipment',          deductible:true, line:'Part II Line 22'},
  {id:'fuel',             icon:'⛽', label:'Vehicle — fuel',             deductible:true, line:'Part II Line 9'},
  {id:'vehicle',          icon:'🚗', label:'Vehicle — maintenance',      deductible:true, line:'Part II Line 9'},
  {id:'vehicle_purchase', icon:'🚘', label:'Vehicle purchase',           deductible:true, line:'Form 4562 / Section 179'},
  {id:'subs',             icon:'👷', label:'Subcontractors',             deductible:true, line:'Part II Line 11'},
  {id:'insurance',        icon:'🛡️', label:'Insurance',                  deductible:true, line:'Part II Line 15'},
  {id:'marketing',        icon:'📢', label:'Advertising & marketing',    deductible:true, line:'Part II Line 8'},
  {id:'phone',            icon:'📱', label:'Phone & software',           deductible:true, line:'Part II Line 25'},
  {id:'ppe',              icon:'🦺', label:'Uniforms & PPE',             deductible:true, line:'Part II Line 22'},
  {id:'meals',            icon:'🍽️', label:'Meals (50% deductible)',     deductible:true, meals_50:true, line:'Part II Line 24b'},
  {id:'professional',     icon:'⚖️', label:'Professional fees',          deductible:true, line:'Part II Line 17'},
  {id:'fees',             icon:'💳', label:'Payment processing fees',    deductible:true, line:'Part II Line 10'},
  {id:'rent',             icon:'🏠', label:'Rent & storage',             deductible:true, line:'Part II Line 20'},
  {id:'utilities',        icon:'💡', label:'Utilities',                  deductible:true, line:'Part II Line 25'},
  {id:'other',            icon:'📦', label:'Other business expense',     deductible:true, line:'Part II Line 27'},
];

// ── Expense flow ──────────────────────────────────────────────────────
const STATE_LABOR_MULT={AL:0.58,AK:1.27,AZ:0.73,AR:0.59,CA:1.11,CO:0.70,CT:1.02,DE:0.84,FL:0.60,GA:0.68,HI:1.19,ID:0.77,IL:0.86,IN:0.79,IA:0.72,KS:0.62,KY:0.70,LA:0.65,ME:0.82,MD:0.82,MA:1.19,MI:0.88,MN:1.11,MS:0.60,MO:0.75,MT:0.91,NE:0.62,NV:1.09,NH:0.95,NJ:1.03,NM:0.67,NY:1.04,NC:0.60,ND:1.15,OH:0.81,OK:0.57,OR:1.40,PA:1.08,RI:0.96,SC:0.60,SD:0.69,TN:0.65,TX:0.65,UT:0.74,VT:1.10,VA:0.77,WA:1.31,WV:0.83,WI:0.94,WY:0.73,DC:1.10};
const GEI_BUNDLES={
  residential:    ['outlet','gfci','switch','dimmer','afci','ext_outlet','recessed','light','fan','exhaust','smoke','under_cab','chandelier','vanity_bar','pendant','track_light','ballast_swap','led_retrofit','doorbell','motion_sw'],
  panels_circuits:['breaker','ded_120','ded_240','panel_100','panel_200','sub_panel','afci_bkr','conduit_lf','low_volt'],
  service_upgrades:['svc_150','svc_400','meter_base','ug_svc','grounding_rod','bond_verify','alum_wire','xfer_man','xfer_auto','gen_hookup'],
  ev_solar:       ['ev_resi','ev_hw40','surge','hot_tub','xfer_man','xfer_auto','gen_hookup','solar_kw','inverter','battery','bat_kwh','offgrid_design'],
  outdoor_pool:   ['hot_tub','pool_bond','pool_pump','pool_light','pool_auto','landscape_xfmr','path_light','deck_light','pond_light','deice_cable','xmas_outlet','exterior'],
  smart_security: ['doorbell','cam_rough','motion_sw','smart_panel','home_auto','intercom','access_ctrl'],
  appliances:     ['dryer_30a','dryer_50a','range_50a','dishwasher_ckt','disposal_ckt','microwave_ckt','fridge_ckt','wh_elec_ckt','range_hood_ckt'],
  diagnostics:    ['elec_trouble','elec_insp','load_analysis','permit_pull','gen_hookup','well_pump','sump_pump_ckt','sauna','attic_fan','barn_panel','workshop_panel','tr_outlet'],
  new_construction:['outlet','gfci','switch','recessed','light','fan','exhaust','smoke','ded_120','ded_240','panel_200','sub_panel','conduit_lf','low_volt','ev_resi','panel_100'],
  commercial:     ['c_3phase','c_lighting','c_ev_comm','c_panel_comm','c_emerg_light','c_solar_comm','c_sub','c_conduit','c_data','c_motor_disc','c_park_light','c_svc_600','c_svc_1200','c_fire_rough','c_backup_gen_3ph','c_ups_rough','c_submeter','c_arc_flash','c_vfd','c_trans','c_mcc','c_kitchen_hookup','c_medical','c_temp_power','c_tenant_imp','c_lcs','c_sign','c_ev_l3','c_ev_fleet','c_switchgear','c_pole_light','c_struct_cable','c_poe'],
};

const _PANEL_SLOTS={100:20,150:30,200:40,400:42};
const _PANEL_GAUGE={15:'14 AWG',20:'12 AWG',30:'10 AWG',40:'8 AWG',50:'8 AWG',60:'6 AWG',100:'3 AWG',150:'1/0',200:'2/0',240:'3/0'};
const IND_EQUIP_TYPES={
  drum_dryer_sm:{name:'Drum Dryer (small, <6ft dia)',  sqft:2000,prepRatio:.45,lift:false,note:''},
  drum_dryer_lg:{name:'Drum Dryer (large, 6ft+ dia)', sqft:4000,prepRatio:.45,lift:true, note:'Man-lift needed'},
  cold_feed_bin:{name:'Cold Feed Bin / Hopper',        sqft:800, prepRatio:.40,lift:false,note:''},
  conveyor_sm:  {name:'Conveyor Belt (<50ft)',         sqft:500, prepRatio:.35,lift:false,note:''},
  conveyor_lg:  {name:'Conveyor Belt (50ft+)',         sqft:1200,prepRatio:.40,lift:true, note:'Elevated sections'},
  hot_mix_silo: {name:'Hot Mix Storage Silo',          sqft:3000,prepRatio:.50,lift:true, note:'Scaffolding needed'},
  baghouse:     {name:'Baghouse / Dust Collector',     sqft:2500,prepRatio:.48,lift:true, note:''},
  control_house:{name:'Control House / Operator Booth',sqft:600, prepRatio:.30,lift:false,note:''},
  scalp_screen: {name:'Scalping Screen',               sqft:700, prepRatio:.40,lift:false,note:''},
  fuel_tank:    {name:'Fuel / Storage Tank',           sqft:1500,prepRatio:.45,lift:false,note:'Confirm no flammables before hot work'},
  excavator:    {name:'Excavator',                     sqft:800, prepRatio:.42,lift:false,note:''},
  loader:       {name:'Loader / Bulldozer',            sqft:700, prepRatio:.42,lift:false,note:''},
  crane_boom:   {name:'Crane / Boom Arm',              sqft:1200,prepRatio:.50,lift:true, note:'Man-lift or rigging needed'},
  dump_body:    {name:'Dump Truck / Trailer Body',     sqft:900, prepRatio:.38,lift:false,note:''},
  flatbed:      {name:'Flatbed Trailer',               sqft:600, prepRatio:.35,lift:false,note:''},
  tank_sm:      {name:'Tank / Vessel (<500 gal)',      sqft:300, prepRatio:.45,lift:false,note:''},
  tank_lg:      {name:'Tank / Vessel (500+ gal)',      sqft:1200,prepRatio:.48,lift:false,note:''},
  struct_steel: {name:'Structural Steel (custom sqft)',sqft:0,   prepRatio:.50,lift:false,note:''},
  misc:         {name:'Other / Custom (enter sqft)',   sqft:0,   prepRatio:.40,lift:false,note:''},
};
const IND_TIERS={
  appearance:{
    name:'Appearance',badge:'👁️',
    desc:'Wire wheel loose rust · DTM rust primer · enamel topcoat',
    products:'SW Iron Oxide Primer → SW DTM Alkyd Enamel',
    prepRate:600,paintRate:1800,coats:2,matPerSqft:1.15,laborRate:650,
  },
  standard:{
    name:'Standard',badge:'🛡️',
    desc:'SP-3 hand tool clean · full prime coat · 2 topcoats',
    products:'SW Kem Bond HS Primer → SW Urethane Alkyd Enamel (2 coats)',
    prepRate:400,paintRate:1600,coats:3,matPerSqft:1.75,laborRate:700,
  },
  industrial:{
    name:'Industrial Spec',badge:'⚙️',
    desc:'Blast SP-6+ · epoxy primer · epoxy/urethane topcoat',
    products:'SW Macropoxy 646 Epoxy → SW Hi-Build Epoxy Topcoat',
    prepRate:200,paintRate:1400,coats:3,matPerSqft:2.75,laborRate:800,
  },
};
const IND_KEYWORDS={
  drum_dryer_sm:['drum dryer','small dryer','dryer'],
  drum_dryer_lg:['large drum','big drum','large dryer'],
  cold_feed_bin:['cold feed','hopper','feed bin'],
  conveyor_sm:['conveyor','belt conveyor'],
  conveyor_lg:['long conveyor','large conveyor'],
  hot_mix_silo:['silo','hot mix','storage silo'],
  baghouse:['baghouse','dust collector','bag house'],
  control_house:['control house','operator booth','booth'],
  scalp_screen:['scalping screen','scalp screen','screen deck'],
  fuel_tank:['fuel tank','diesel tank','fuel storage'],
  excavator:['excavator'],
  loader:['loader','bulldozer'],
  crane_boom:['crane','boom arm','boom'],
  dump_body:['dump truck','dump body','dump trailer'],
  flatbed:['flatbed','flat bed'],
  tank_sm:['small tank','little tank','small vessel'],
  tank_lg:['large tank','big tank','big vessel','large vessel'],
  struct_steel:['structural steel','steel frame','structure','steel'],
};

