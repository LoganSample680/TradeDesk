#!/usr/bin/env node
'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CONSTANTS_PATH = path.join(__dirname, '../js/constants.js');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*' } }, res => {
      if ([301,302,303].includes(res.statusCode) && res.headers.location) {
        res.resume();
        const next = res.headers.location.startsWith('http') ? res.headers.location
          : new URL(res.headers.location, url).toString();
        return resolve(get(next));
      }
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function parseDollar(text) {
  const m = text.replace(/,/g, '').match(/\$(\d+)/);
  return m ? parseInt(m[1]) : null;
}

function extractBrackets(html) {
  // Extract all table rows from the page
  const rows = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rm;
  while ((rm = rowRe.exec(html)) !== null) {
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const cells = [];
    let cm;
    while ((cm = cellRe.exec(rm[1])) !== null) {
      cells.push(cm[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&#8209;/g, '-').trim());
    }
    if (cells.length >= 2) rows.push(cells);
  }

  // Find single filer bracket table rows by looking for rate percentages and dollar amounts
  // IRS tables typically have: Rate | Single | MFJ | MFS | HOH
  const brackets = {};
  const rates = [10, 12, 22, 24, 32, 35, 37];

  for (const row of rows) {
    const rateCell = row[0].replace(/[^0-9]/g, '');
    const rate = parseInt(rateCell);
    if (!rates.includes(rate)) continue;

    // Find dollar amounts in the single filer column (col index 1)
    // The threshold is the upper bound of this bracket (or starting bound of next)
    const singleCell = row[1] || '';
    // Extract all dollar amounts from cell
    const amounts = [];
    const amtRe = /\$[\d,]+/g;
    let am;
    while ((am = amtRe.exec(singleCell)) !== null) {
      const val = parseDollar(am[0]);
      if (val) amounts.push(val);
    }

    if (amounts.length === 0) continue;

    // For bracket threshold: "Up to $X" → X is top of 10% bracket
    // "$X to $Y" → Y is top of this bracket
    // "Over $X" → X is top of previous bracket (35% threshold)
    const isUpTo = /up to/i.test(singleCell);
    const isOver = /over/i.test(singleCell) && !/to \$/.test(singleCell);

    let threshold = null;
    if (isUpTo) {
      threshold = amounts[0];
    } else if (isOver) {
      // "Over $X" means X is the 35% floor = top of 32% bracket, skip, we get it from 32% row
      threshold = null;
    } else if (amounts.length >= 2) {
      // "$X to $Y", Y is the top of this bracket
      threshold = amounts[amounts.length - 1];
    } else if (amounts.length === 1) {
      threshold = amounts[0];
    }

    if (threshold && rate < 37) {
      const key = 'b' + rate;
      if (!brackets[key]) brackets[key] = threshold;
    }
  }

  return brackets;
}

function extractStdDed(html) {
  const ded = {};
  // Look for standard deduction section
  // Patterns like "single filers" near dollar amounts, or table with filing status + deduction amounts
  const rows = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rm;
  while ((rm = rowRe.exec(html)) !== null) {
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const cells = [];
    let cm;
    while ((cm = cellRe.exec(rm[1])) !== null) {
      cells.push(cm[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim());
    }
    if (cells.length >= 2) rows.push(cells);
  }

  for (const row of rows) {
    const label = (row[0] || '').toLowerCase();
    const valCell = row[1] || '';
    const amt = parseDollar(valCell);
    if (!amt) continue;

    if (/single|unmarried/i.test(label) && !/married/i.test(label)) {
      ded.fedSingle = ded.fedSingle || amt;
    } else if (/married filing jointly|mfj/i.test(label)) {
      ded.fedMFJ = ded.fedMFJ || amt;
    } else if (/married filing sep/i.test(label)) {
      ded.fedMFS = ded.fedMFS || amt;
    } else if (/head of household/i.test(label)) {
      ded.fedHOH = ded.fedHOH || amt;
    }
  }

  // Also scan plain text for standard deduction mentions
  if (!ded.fedSingle) {
    const singleRe = /standard deduction[^<]*single[^<]*\$([\d,]+)|single[^<]*standard deduction[^<]*\$([\d,]+)|\$([\d,]+)[^<]*single[^<]*standard deduction/i;
    const sm = html.replace(/<[^>]+>/g, ' ').match(singleRe);
    if (sm) {
      const raw = (sm[1] || sm[2] || sm[3] || '').replace(/,/g, '');
      if (raw) ded.fedSingle = parseInt(raw);
    }
  }

  return ded;
}

async function fetchBrackets(year) {
  const url = `https://www.irs.gov/newsroom/irs-provides-tax-inflation-adjustments-for-tax-year-${year}`;
  console.log(`Fetching: ${url}`);
  const { status, body } = await get(url);
  if (status === 404 || status === 403) {
    console.log(`  HTTP ${status} for tax year ${year}`);
    return null;
  }
  if (status !== 200) {
    throw new Error(`IRS HTTP ${status} for year ${year}`);
  }

  const brackets = extractBrackets(body);
  const stdDed = extractStdDed(body);

  return { brackets, stdDed, html: body };
}

async function fetchMileageRate(year) {
  const url = `https://www.irs.gov/newsroom/irs-issues-standard-mileage-rates-for-${year}`;
  console.log(`Fetching mileage: ${url}`);
  try {
    const { status, body } = await get(url);
    if (status !== 200) return null;
    // Look for cents-per-mile pattern like "67 cents per mile" or "70 cents"
    const plain = body.replace(/<[^>]+>/g, ' ');
    const m = plain.match(/(\d{2}(?:\.\d+)?)\s*cents?\s*per\s*mile/i);
    if (m) return parseFloat(m[1]) / 100;
    // Also try "$.XXX per mile"
    const m2 = plain.match(/\$0?\.(\d{3})\s*per\s*mile/i);
    if (m2) return parseFloat('0.' + m2[1]);
  } catch (e) {
    console.log(`  Mileage fetch failed: ${e.message}`);
  }
  return null;
}

function determineTaxYear() {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-based
  const currentYear = now.getFullYear();
  // IRS announces next year's brackets in Oct/Nov of current year
  // e.g. Oct 2025 announcement covers tax year 2026
  // So if we're in Oct/Nov/Dec, try currentYear+1 first, then currentYear
  if (month >= 10) {
    return [currentYear + 1, currentYear, currentYear - 1];
  }
  return [currentYear, currentYear - 1, currentYear + 1];
}

async function main() {
  const tryYears = determineTaxYear();
  console.log(`Will try tax years in order: ${tryYears.join(', ')}`);

  let result = null;
  let targetYear = null;

  for (const year of tryYears) {
    try {
      const r = await fetchBrackets(year);
      if (!r) continue;
      if (r.brackets.b10) {
        result = r;
        targetYear = year;
        break;
      }
      console.log(`  No b10 bracket found for ${year}, trying next year`);
    } catch (e) {
      console.log(`  Error for year ${year}: ${e.message}`);
    }
  }

  if (!result || !targetYear) {
    console.error('ERROR: Could not fetch bracket data for any target year');
    process.exit(1);
  }

  const { brackets, stdDed } = result;

  // Sanity check
  if (!brackets.b10 || brackets.b10 < 9000 || brackets.b10 > 20000) {
    console.error(`ERROR: Sanity check failed, b10=${brackets.b10} is outside expected range $9,000–$20,000`);
    console.error('Parsed brackets:', brackets);
    process.exit(1);
  }

  // Fetch mileage rate
  const irsRate = await fetchMileageRate(targetYear);

  // Build the new entry
  const entry = {
    fedSingle: stdDed.fedSingle || null,
    fedMFJ: stdDed.fedMFJ || (stdDed.fedSingle ? stdDed.fedSingle * 2 : null),
    fedMFS: stdDed.fedMFS || stdDed.fedSingle || null,
    fedHOH: stdDed.fedHOH || null,
    b10: brackets.b10,
    b12: brackets.b12 || null,
    b22: brackets.b22 || null,
    b24: brackets.b24 || null,
    b32: brackets.b32 || null,
    b35: brackets.b35 || null,
    irsRate: irsRate || null,
  };

  // Print summary
  const fmt = v => v ? '$' + v.toLocaleString() : '?';
  console.log(`\n${targetYear} brackets: b10=${fmt(entry.b10)} b12=${fmt(entry.b12)} b22=${fmt(entry.b22)} b24=${fmt(entry.b24)} b32=${fmt(entry.b32)} b35=${fmt(entry.b35)} fedSingle=${fmt(entry.fedSingle)} fedMFJ=${fmt(entry.fedMFJ)} fedMFS=${fmt(entry.fedMFS)} fedHOH=${fmt(entry.fedHOH)}${irsRate ? ' irsRate=$' + irsRate + '/mi' : ''}\n`);

  // Read constants.js
  let src = fs.readFileSync(CONSTANTS_PATH, 'utf8');

  // Build new entry string
  const entryStr = `  ${targetYear}:{fedSingle:${entry.fedSingle},fedMFJ:${entry.fedMFJ},fedMFS:${entry.fedMFS},fedHOH:${entry.fedHOH},b10:${entry.b10},b12:${entry.b12},b22:${entry.b22},b24:${entry.b24},b32:${entry.b32},b35:${entry.b35},irsRate:${irsRate ? irsRate.toFixed(3).replace(/0+$/, '').replace(/\.$/, '') : 'null'}},`;

  // Replace existing entry for this year or insert before closing brace
  const existingRe = new RegExp(`  ${targetYear}:\\{[^}]+\\},?\\n?`);
  if (existingRe.test(src)) {
    src = src.replace(existingRe, entryStr + '\n');
    console.log(`Updated existing ${targetYear} entry in TAX_HISTORY`);
  } else {
    // Insert before the closing brace of TAX_HISTORY
    src = src.replace(/^(const TAX_HISTORY=\{[\s\S]*?)(};)/m, (_, body, close) => {
      return body + entryStr + '\n' + close;
    });
    console.log(`Added new ${targetYear} entry to TAX_HISTORY`);
  }

  fs.writeFileSync(CONSTANTS_PATH, src, 'utf8');
  console.log(`Written: ${CONSTANTS_PATH}`);

  // Git commit and push
  execSync('git add js/constants.js', { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
  execSync(`git commit -m "chore: update ${targetYear} federal tax brackets from IRS"`, { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
  execSync('git push', { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
  console.log('Committed and pushed.');
}

main().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
