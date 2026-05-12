#!/usr/bin/env python3
"""Extract cloud.js from index.html — Step 3 of monolith refactor."""

import sys

INDEX = '/home/user/TradeDesk/index.html'
OUT   = '/home/user/TradeDesk/js/cloud.js'

# Ranges to extract (1-indexed, inclusive).
# Order in cloud.js follows file order.
RANGES = [
    (10378, 10539),   # Stripe block (_stripeConnectStatus through sendPaymentLink)
    (16621, 16669),   # loadAccountData (incl. section comment)
    (18250, 18337),   # Dev support block (incl. section comment)
    (18893, 20385),   # SUPA constants + supaInit + all cloud fns + visibilitychange
]

# Script tag to insert (after js/utils.js, before main <script>)
INSERT_AFTER = '<script src="js/utils.js"></script>'
NEW_TAG      = '<script src="js/cloud.js"></script>'

with open(INDEX, 'r', encoding='utf-8') as f:
    lines = f.readlines()

total = len(lines)
print(f'index.html: {total} lines')

# Build set of 0-indexed line numbers to extract
extract_set = set()
for (start, end) in RANGES:
    for i in range(start - 1, end):   # convert to 0-indexed
        if i < total:
            extract_set.add(i)

print(f'Lines to extract: {len(extract_set)}')

# Build cloud.js content (in file order)
cloud_lines = []
for i in sorted(extract_set):
    cloud_lines.append(lines[i])

# Build new index.html — remove extracted lines, insert script tag
new_index = []
for i, line in enumerate(lines):
    if i in extract_set:
        continue
    new_index.append(line)
    # Insert new <script> tag right after the utils.js tag
    if line.rstrip() == INSERT_AFTER:
        new_index.append(NEW_TAG + '\n')

print(f'cloud.js: {len(cloud_lines)} lines')
print(f'new index.html: {len(new_index)} lines (was {total})')
print(f'  removed {total - len(new_index) + 1} lines (net, including +1 for new script tag)')

with open(OUT, 'w', encoding='utf-8') as f:
    f.writelines(cloud_lines)

with open(INDEX, 'w', encoding='utf-8') as f:
    f.writelines(new_index)

print('Done.')
