// ── Sales Tax Engine ─────────────────────────────────────────────────────────
// Handles what contractors COLLECT from clients on proposals and invoices.
// Completely separate from tax.js (income tax) — different concept entirely.
// tax.js = what you OWE the government. sales-tax.js = what you COLLECT for them.

// States with no sales tax — skip all calculation
const ST_NO_TAX = new Set(['AK','DE','MT','NH','OR']);

// States with gross receipts tax — full contract value taxable, labor included
const ST_GROSS_RECEIPTS = {
  HI:{label:'GET', note:'Hawaii General Excise Tax — applies to full contract value including labor'},
  NM:{label:'GRT', note:'New Mexico Gross Receipts Tax — applies to full contract value including labor'},
};

// States where landscaping / lawn care / tree services are taxed as a SERVICE
// (labor AND materials both taxable — different from construction trade rules)
const ST_LANDSCAPE_SERVICE = new Set([
  'AR','DC','IA','KS','KY','MD','MN','NE','NJ','NY','NC','ND',
  'OH','RI','SC','SD','TX','WA','WI','WV','WY'
]);

// States where commercial repair labor is also taxable
// Residential repair labor is exempt everywhere
const ST_COMMERCIAL_LABOR = new Set(['CT','SD','WV']);

// States requiring a signed capital improvement certificate before work begins
const ST_CI_CERT = {
  NY:{form:'ST-124', name:'Certificate of Capital Improvement'},
  NJ:{form:'ST-8',   name:'Certificate of Exempt Capital Improvement'},
  PA:{form:'REV-1220',name:'Pennsylvania Exemption Certificate'},
  CT:{form:'CERT-106',name:'Blanket Certificate for Exempt Purchases of Services'},
};

// State base sales tax rates — state portion only, before local add-ons
// Updated via code deploy when states change rates (historically rare — ~once per decade)
const ST_BASE_RATE = {
  AL:4.000, AK:0,     AZ:5.600, AR:6.500, CA:7.250, CO:2.900, CT:6.350, DE:0,
  FL:6.000, GA:4.000, HI:4.000, ID:6.000, IL:6.250, IN:7.000, IA:6.000, KS:6.500,
  KY:6.000, LA:4.450, ME:5.500, MD:6.000, MA:6.250, MI:6.000, MN:6.875, MS:7.000,
  MO:4.225, MT:0,     NE:5.500, NV:6.850, NH:0,     NJ:6.625, NM:5.125, NY:4.000,
  NC:4.750, ND:5.000, OH:5.750, OK:4.500, OR:0,     PA:6.000, RI:7.000, SC:6.000,
  SD:4.200, TN:7.000, TX:6.250, UT:6.100, VT:6.000, VA:5.300, WA:6.500, WV:6.000,
  WI:5.000, WY:4.000, DC:6.000,
};

// Maps TradeDesk bid.trade_type to tax category
const ST_TRADE_CATEGORY = {
  painting:'construction', plumbing:'construction', electrical:'construction',
  hvac:'construction', roofing:'construction', general:'construction',
  landscaping:'landscaping', lawn:'landscaping', tree:'landscaping',
};

/**
 * Determine the tax treatment for a job.
 * Returns a descriptor object that drives both UI display and tax calculation.
 *
 * @param {string} state        - 2-letter state abbreviation
 * @param {string} tradeType    - bid.trade_type (painting, electrical, landscaping, etc.)
 * @param {string} scope        - 'improvement' | 'repair' | 'maintenance' | 'tm'
 * @param {string} propertyType - 'residential' | 'commercial'
 * @returns {object} treatment descriptor
 */
function getJobTaxTreatment(state, tradeType, scope, propertyType) {
  const st = (state || 'KS').toUpperCase();
  const stateName = (typeof STATE_NAMES !== 'undefined' && STATE_NAMES[st]) || st;

  if (ST_NO_TAX.has(st)) {
    return {
      type:'no_tax', customerTax:false, laborTaxable:false, materialsTaxable:false,
      label:'No sales tax', note:stateName+' has no state sales tax',
    };
  }

  if (ST_GROSS_RECEIPTS[st]) {
    const gr = ST_GROSS_RECEIPTS[st];
    return {
      type:'gross_receipts', customerTax:true, laborTaxable:true, materialsTaxable:true,
      label:gr.label, note:gr.note,
    };
  }

  const cat = ST_TRADE_CATEGORY[tradeType] || 'construction';

  if (cat === 'landscaping') {
    if (ST_LANDSCAPE_SERVICE.has(st)) {
      return {
        type:'service', customerTax:true, laborTaxable:true, materialsTaxable:true,
        label:'Service tax',
        note:stateName+' taxes landscaping services including labor — full invoice taxable',
      };
    }
    return {
      type:'contractor_consumer', customerTax:false, laborTaxable:false, materialsTaxable:false,
      label:'No invoice tax',
      note:'Contractor pays tax on materials at purchase — no tax charged to client',
    };
  }

  // Construction trades (electrical, plumbing, HVAC, roofing, painting, general)
  if (scope === 'improvement') {
    const cert = ST_CI_CERT[st] || null;
    return {
      type:'contractor_consumer', customerTax:false, laborTaxable:false, materialsTaxable:false,
      label:'Capital improvement', certificate:cert,
      note:'Capital improvement: no sales tax charged to client. Contractor pays tax on materials at purchase.'
        + (cert ? ' Client must sign Form '+cert.form+' before work begins.' : ''),
    };
  }

  // repair / maintenance / tm all follow repair rules
  const commercialLabor = propertyType === 'commercial' && ST_COMMERCIAL_LABOR.has(st);
  return {
    type:'repair', customerTax:true, laborTaxable:commercialLabor, materialsTaxable:true,
    label:'Repair / service',
    note: commercialLabor
      ? 'Labor and materials taxable (commercial repair in '+stateName+')'
      : 'Materials taxable, labor exempt',
  };
}

/**
 * Calculate sales tax amount for a proposal.
 *
 * @param {object} params
 * @param {string} params.state
 * @param {string} params.tradeType
 * @param {string} params.scope           - 'improvement'|'repair'|'maintenance'|'tm'
 * @param {string} params.propertyType    - 'residential'|'commercial'
 * @param {number} params.taxRate         - combined rate as a percentage (e.g. 9.35)
 * @param {Array}  params.lineItems       - [{desc, total, lineType}]
 *                                          lineType: 'labor'|'materials'|'equipment'|null
 * @param {number} params.flatTotal       - used when no line items
 * @param {number} params.laborTotal      - labor portion (painting estimates)
 * @param {number} params.materialsTotal  - materials portion (painting estimates)
 * @returns {{taxAmount, taxableBase, treatment, effectiveRate}}
 */
function calcSalesTax({state, tradeType, scope, propertyType, taxRate, lineItems, flatTotal, laborTotal, materialsTotal}) {
  const treatment = getJobTaxTreatment(state, tradeType, scope, propertyType);

  if (!treatment.customerTax || !taxRate) {
    return {taxAmount:0, taxableBase:0, treatment, effectiveRate:0};
  }

  let taxableBase = 0;

  if (treatment.type === 'gross_receipts' || treatment.type === 'service') {
    taxableBase = (lineItems && lineItems.length)
      ? lineItems.reduce((s,li) => s + (li.total||0), 0)
      : (flatTotal||0);
  } else if (treatment.type === 'repair') {
    if (lineItems && lineItems.length) {
      lineItems.forEach(li => {
        const t = li.lineType || 'materials'; // unclassified defaults to materials (conservative)
        if (t === 'labor') { if (treatment.laborTaxable) taxableBase += (li.total||0); }
        else { taxableBase += (li.total||0); }
      });
    } else if (materialsTotal !== undefined) {
      taxableBase = (materialsTotal||0);
      if (treatment.laborTaxable) taxableBase += (laborTotal||0);
    } else {
      taxableBase = flatTotal||0;
    }
  }

  const taxAmount = Math.round(taxableBase * (taxRate / 100) * 100) / 100;
  return {taxAmount, taxableBase, treatment, effectiveRate:taxRate};
}

/**
 * Extract a 5-digit ZIP code from an address string.
 * Returns null if none found.
 */
function _extractZip(addr) {
  const m = (addr || '').match(/\b(\d{5})(?:-\d{4})?\b/);
  return m ? m[1] : null;
}

/**
 * Look up combined sales tax rate for a ZIP code from the Supabase tax_rates table.
 * Tries ZIP-level rate first, falls back to state base rate row, then hardcoded value.
 *
 * @param {string} zip   - 5-digit ZIP code
 * @param {string} state - 2-letter state abbreviation
 * @returns {Promise<{rate:number, source:string, warning?:string}>}
 */
async function lookupSalesTaxRate(zip, state) {
  const st = (state || 'KS').toUpperCase();
  const stateName = (typeof STATE_NAMES !== 'undefined' && STATE_NAMES[st]) || st;

  if (ST_NO_TAX.has(st)) return {rate:0, source:'no_tax'};

  if (typeof _supa !== 'undefined') {
    try {
      if (zip && /^\d{5}$/.test(zip)) {
        const {data} = await _supa.from('tax_rates').select('combined').eq('zip', zip).maybeSingle();
        if (data?.combined != null) return {rate:parseFloat(data.combined), source:'db_zip'};
      }
      // Fall back to state base row (seeded as "STATE-XX")
      const {data} = await _supa.from('tax_rates').select('combined').eq('zip','STATE-'+st).maybeSingle();
      if (data?.combined != null) {
        return {rate:parseFloat(data.combined), source:'db_state',
                warning:'Local rate not available — using '+stateName+' state base rate. Set your local rate for accuracy.'};
      }
    } catch(e) { /* network error — fall through */ }
  }

  const base = ST_BASE_RATE[st] || 0;
  return {rate:base, source:'hardcoded',
          warning:'Using '+stateName+' state base rate ('+base+'%). Enter your local rate for an accurate total.'};
}
