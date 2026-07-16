#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Resolve repo root from this script's location
const root = path.resolve(__dirname, '..');

// 1. Get today's date in US Central Time
const now = new Date();
const ctStr = now.toLocaleString('en-US', { timeZone: 'America/Chicago' });
const ctDate = new Date(ctStr);
const mm = String(ctDate.getMonth() + 1).padStart(2, '0');
const dd = String(ctDate.getDate()).padStart(2, '0');
const yy = String(ctDate.getFullYear()).slice(-2);
const todayPrefix = `${mm}.${dd}.${yy}`;

// 2. Read current version from version.json
const versionFile = path.join(root, 'version.json');
const { version: currentVersion } = JSON.parse(fs.readFileSync(versionFile, 'utf8'));

// 3. Compute next version
const parts = currentVersion.split('.');
// parts: [MM, DD, YY, NN] , but MM.DD.YY is 3 parts and NN is 4th
const currentPrefix = `${parts[0]}.${parts[1]}.${parts[2]}`;
const currentNN = parseInt(parts[3], 10);

let nextVersion;
if (currentPrefix === todayPrefix) {
  nextVersion = `${todayPrefix}.${currentNN + 1}`;
} else {
  nextVersion = `${todayPrefix}.1`;
}

// 4. Write version.json
fs.writeFileSync(versionFile, JSON.stringify({ version: nextVersion }) + '\n', 'utf8');

// 5. Update sw.js, replace CACHE string
const swFile = path.join(root, 'sw.js');
let swContent = fs.readFileSync(swFile, 'utf8');
swContent = swContent.replace(
  /const CACHE = 'tradedesk-[^']+'/,
  `const CACHE = 'tradedesk-${nextVersion}'`
);
fs.writeFileSync(swFile, swContent, 'utf8');

// 6. Update js/cloud.js, replace APP_VERSION string
const cloudFile = path.join(root, 'js', 'cloud.js');
let cloudContent = fs.readFileSync(cloudFile, 'utf8');
cloudContent = cloudContent.replace(
  /const APP_VERSION='[^']+'/,
  `const APP_VERSION='${nextVersion}'`
);
fs.writeFileSync(cloudFile, cloudContent, 'utf8');

// 7. Stage all three files
execSync(`git -C "${root}" add version.json sw.js js/cloud.js`);

// 8. Report
process.stdout.write(`[bump-version] ${currentVersion} → ${nextVersion}\n`);
