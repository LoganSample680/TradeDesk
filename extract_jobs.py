#!/usr/bin/env python3
"""Extract js/jobs.js — Step 8."""

INDEX = '/home/user/TradeDesk/index.html'
OUT   = '/home/user/TradeDesk/js/jobs.js'

# Range 1: active time tracking + nearby job detection + buildScopeGrid
# Range 2: more menu toggle + leads filter + job filter + renderJobsPage + job sheet helpers
RANGES = [
    (4971, 5474),
    (12592, 13085),
]

INSERT_AFTER = '<script src="js/clients.js"></script>'
NEW_TAG      = '<script src="js/jobs.js"></script>'

with open(INDEX, 'r', encoding='utf-8') as f:
    lines = f.readlines()

extract_set = set()
for (s, e) in RANGES:
    extract_set.update(range(s - 1, e))

out_lines = [lines[i] for i in sorted(extract_set)]
new_index = []
for i, line in enumerate(lines):
    if i in extract_set:
        continue
    new_index.append(line)
    if line.rstrip() == INSERT_AFTER:
        new_index.append(NEW_TAG + '\n')

print(f'jobs.js: {len(out_lines)} lines | index.html: {len(lines)} → {len(new_index)}')
with open(OUT, 'w', encoding='utf-8') as f:
    f.writelines(out_lines)
with open(INDEX, 'w', encoding='utf-8') as f:
    f.writelines(new_index)
print('Done.')
