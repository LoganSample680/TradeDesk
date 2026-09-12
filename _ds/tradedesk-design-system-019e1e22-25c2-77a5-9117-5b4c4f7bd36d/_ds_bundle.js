/* @ds-bundle: {"format":3,"namespace":"TradeDeskDesignSystem_019e1e","components":[],"sourceHashes":{"js/dashboard.js":"b3324124937a","js/fleet.js":"b986359f5b89","js/generic-estimate.js":"7b20451623fc","js/mileage.js":"9626fb6f84e0","js/navigation.js":"7874cd79ffd6","js/settings.js":"96f1ec6c8d34","js/utils.js":"1ad39e7389d1","ui_kits/app/Books.jsx":"c82600a7de26","ui_kits/app/Calendar.jsx":"e9cadf44c89f","ui_kits/app/ClientDetail.jsx":"92ef49fb1c84","ui_kits/app/ClientHub.jsx":"e0766989b5cb","ui_kits/app/Clients.jsx":"9ce622975f7b","ui_kits/app/Collect.jsx":"c2b3b27a3eb2","ui_kits/app/Dashboard.jsx":"ddd96573607b","ui_kits/app/Estimate.jsx":"76d0f985c75f","ui_kits/app/EstimateBYO.jsx":"e382ea6beb88","ui_kits/app/EstimateChooser.jsx":"89d2274cc17f","ui_kits/app/EstimateTM.jsx":"0adbc79b2a82","ui_kits/app/Estimates.jsx":"1089fedc4bf2","ui_kits/app/Jobs.jsx":"5b7e32b82729","ui_kits/app/Leads.jsx":"a18e4b6ac246","ui_kits/app/NavSidebar.jsx":"f92bc582b3d3","ui_kits/app/Proposal.jsx":"b60ea4289386","ui_kits/app/Proposals.jsx":"f50fae26e336","ui_kits/app/Signature.jsx":"eedc9a5c78b5","ui_kits/app/data.js":"028c72d9581f"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.TradeDeskDesignSystem_019e1e = window.TradeDeskDesignSystem_019e1e || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// js/dashboard.js
try { (() => {
let _renderDashRunning = false;
let _dashFeedFilter = 'all';
function setDashFeedFilter(f) {
  _dashFeedFilter = f;
  ['all', 'money', 'urgent'].forEach(id => {
    const btn = document.getElementById('dff-' + id);
    if (btn) btn.classList.toggle('on', id === f);
  });
  renderTodayFeed();
}
function _trendHtml(curr, prev, reverseColor) {
  if (!prev || prev === 0) return '<div class="met-s">— est.</div>';
  const pct = Math.round((curr - prev) / Math.abs(prev) * 100);
  if (Math.abs(pct) < 1) return '<div class="met-s">— vs LY</div>';
  const isUp = pct > 0;
  const isGood = reverseColor ? !isUp : isUp;
  const color = isGood ? 'var(--c-green)' : 'var(--c-red)';
  const arrow = isUp ? '<svg viewBox="0 0 12 12" width="9" height="9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M2 9l4-4 4 4"/></svg>' : '<svg viewBox="0 0 12 12" width="9" height="9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M2 3l4 4 4-4"/></svg>';
  return '<div class="met-s" style="color:' + color + '">' + arrow + Math.abs(pct) + '% <span style="color:var(--text3);font-weight:500">vs LY</span></div>';
}
function renderDash() {
  if (_renderDashRunning) return; // prevent cascade
  _renderDashRunning = true;
  try {
    document.getElementById('dash-greet').textContent = getDashGreeting();
    document.getElementById('dash-date').textContent = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
    const _calDateEl = document.getElementById('dash-cal-date');
    if (_calDateEl) _calDateEl.textContent = new Date().toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
    const tk = todayKey();
    const yr = dashYear || new Date().getFullYear();
    const yrStr = String(yr);
    initDashYear();
    const _incomeSum = income.filter(r => r.date && _dashInRange(r.date)).reduce((s, r) => s + r.amount, 0);
    const _paymentsSum = payments.filter(p => p.date && _dashInRange(p.date) && p.amount > 0).reduce((s, p) => s + p.amount, 0);
    const tInc = _incomeSum + _paymentsSum;
    const tExp = expenses.filter(e => e.date && _dashInRange(e.date)).reduce((s, e) => s + e.amount, 0);
    const tMi = mileage.filter(m => m.date && _dashInRange(m.date)).reduce((s, m) => s + (m.miles || 0), 0);
    // Prior-year totals for trend arrows (year mode only)
    const prevYrStr = String(yr - 1);
    const _pInc = income.filter(r => r.date && r.date.startsWith(prevYrStr)).reduce((s, r) => s + r.amount, 0);
    const _pPay = payments.filter(p => p.date && p.date.startsWith(prevYrStr) && p.amount > 0).reduce((s, p) => s + p.amount, 0);
    const prevInc = _pInc + _pPay;
    const prevExp = expenses.filter(e => e.date && e.date.startsWith(prevYrStr)).reduce((s, e) => s + e.amount, 0);
    const prevMi = mileage.filter(m => m.date && m.date.startsWith(prevYrStr)).reduce((s, m) => s + (m.miles || 0), 0);
    const showTrends = dashPeriod === 'year';
    const net = tInc - tExp - tMi * IRS();
    const mileDed = Math.round(tMi * IRS());
    const netBeforeTax = Math.max(0, tInc - tExp - mileDed);
    const ytdTaxEst = estimateTax(netBeforeTax);
    const ytdTrueProfit = Math.round(tInc - tExp - ytdTaxEst);
    const wonBidsAll = bids.filter(b => b.status === 'Closed Won').length;
    const lostBidsAll = bids.filter(b => b.status === 'Closed Lost' || b.status === 'Abandoned').length;
    const totalDecided = wonBidsAll + lostBidsAll;
    const closeRatio = totalDecided > 0 ? Math.round(wonBidsAll / totalDecided * 100) : null;
    const closeColor = closeRatio === null ? 'var(--text3)' : closeRatio >= 40 ? 'var(--green-mid)' : closeRatio >= 25 ? 'var(--amber)' : '#A32D2D';
    const closeLabel = closeRatio === null ? '—' : closeRatio + '%';
    const closeSub = closeRatio === null ? 'No decided bids yet' : closeRatio >= 40 ? 'Above avg ✓' : closeRatio >= 25 ? 'Near avg (~33%)' : 'Below avg — follow up more';
    const wonBidAmts = bids.filter(b => b.status === 'Closed Won').map(b => b.amount || 0);
    const avgJobVal = wonBidAmts.length ? Math.round(wonBidAmts.reduce((s, a) => s + a, 0) / wonBidAmts.length) : null;

    // Attention sub-text for tbar
    const _subEl = document.getElementById('dash-sub');
    if (_subEl && !_isEmployee) {
      const _collectItems = bids.filter(b => b.status === 'Closed Won' && getBidBalance(b) > 0.01 && b.completion_date);
      const _collectOwed = _collectItems.reduce((s, b) => s + getBidBalance(b), 0);
      const _urgFu = bids.filter(b => b.status === 'Pending' && !b.signingToken && b.followup && b.followup <= tk).length;
      const _pendingBids = bids.filter(b => b.status === 'Pending').length;
      const _licAlerts = getLicenseAlerts().filter(l => _licStatus(l) === 'expired').length;
      // Closed Won bids that still need a job scheduled and/or deposit collected
      const _wonNeedAction = bids.filter(b => {
        if (b.status !== 'Closed Won' || b.completion_date) return false;
        const depositPaid = getBidPaid(b.id) > 0;
        const hasJob = jobs.some(j => (j.bid_id === b.id || j.client_id === b.client_id && !j.bid_id) && j.eventType !== 'estimate');
        return !(hasJob && depositPaid);
      }).length;
      // In-progress drafts (paint full draft OR generic Draft/Pending-unsent bids)
      const _ld = loadEstFullDraft();
      const _draftCount = (_ld && _ld.cname ? 1 : 0) + bids.filter(b => !b.signingToken && (b.status === 'Draft' || b.status === 'Pending' && !b.bid_date)).length;
      const _attnItems = _collectItems.length + _urgFu + _pendingBids + _licAlerts + _wonNeedAction + _draftCount;
      if (_attnItems > 0) {
        let _biggestNote = '';
        if (_collectOwed > 0) _biggestNote = 'The biggest one is ' + fmt(_collectOwed) + ' in outstanding balances.';else if (_wonNeedAction > 0) _biggestNote = _wonNeedAction + ' signed job' + (+_wonNeedAction > 1 ? 's' : '') + ' need scheduling or a deposit.';else if (_urgFu > 0) _biggestNote = _urgFu + ' follow-up' + (+_urgFu > 1 ? 's' : '') + ' are overdue.';else if (_pendingBids > 0) _biggestNote = _pendingBids + ' pending bid' + (+_pendingBids > 1 ? 's' : '') + ' need attention.';
        _subEl.textContent = _attnItems + ' thing' + (_attnItems > 1 ? 's' : '') + ' need' + (_attnItems === 1 ? 's' : '') + ' your attention today. ' + _biggestNote;
      } else {
        _subEl.textContent = 'You\'re all caught up — nothing urgent.';
      }
    } else if (_subEl) {
      _subEl.textContent = '';
    }
    const kpiEl = document.getElementById('dash-kpi');
    if (kpiEl && _isEmployee) {
      // Employee home: field-focused tiles, no financial data
      const activeJobs = jobs.filter(j => !j.completed && !j.cancelled);
      const todayJobs = activeJobs.filter(j => j.date === tk || j.scheduled_date === tk);
      const myMiles = mileage.filter(m => m.logged_by_id === _supaUser?.id && m.date && m.date.startsWith(yrStr)).reduce((s, m) => s + (m.miles || 0), 0);
      const recentClients = clients.slice(0, 3);
      kpiEl.innerHTML = '<div class="mets" style="margin-bottom:12px">' + '<div class="met" style="cursor:pointer" onclick="goPg(\'pg-jobs\')">' + '<div class="met-l">Active jobs</div>' + '<div class="met-v">' + activeJobs.length + '</div>' + '</div>' + '<div class="met" style="cursor:pointer" onclick="goPg(\'pg-jobs\')">' + '<div class="met-l">Today</div>' + '<div class="met-v" style="color:var(--blue)">' + todayJobs.length + '</div>' + '</div>' + '<div class="met" style="cursor:pointer" onclick="goPg(\'pg-clients\')">' + '<div class="met-l">Clients</div>' + '<div class="met-v">' + clients.length + '</div>' + '</div>' + '<div class="met">' + '<div class="met-l">My miles ' + yr + '</div>' + '<div class="met-v">' + Math.round(myMiles).toLocaleString() + ' <span style="font-size:11px;font-weight:400;color:var(--text3)">mi</span></div>' + '</div>' + '</div>' + (todayJobs.length ? '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:8px">Today\'s jobs</div>' + todayJobs.slice(0, 3).map(j => '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);margin-bottom:6px;cursor:pointer" onclick="goPg(\'pg-jobs\')">' + '<div style="font-size:18px">🔨</div>' + '<div style="min-width:0"><div style="font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(j.clientName || j.title || 'Job') + '</div>' + '<div style="font-size:11px;color:var(--text3)">' + escHtml(j.address || j.type || '') + '</div></div>' + '</div>').join('') : '');
    } else if (kpiEl) {
      const pBids = bids.filter(b => b.status === 'Pending');
      const prevTax = showTrends ? estimateTax(Math.max(0, prevInc - prevExp - Math.round(prevMi * IRS()))) : 0;
      const prevProfit = showTrends ? Math.round(prevInc - prevExp - prevTax) : 0;
      kpiEl.innerHTML = '<div class="mets" id="dash-mets-inner">' + '<div class="met" style="cursor:pointer" onclick="goToTrackerTab(\'income\')">' + '<div class="met-l">Revenue</div>' + '<div class="met-v" style="color:var(--c-green)">' + fmtShort(tInc) + '</div>' + (showTrends ? _trendHtml(tInc, prevInc, false) : '') + '</div>' + '<div class="met" style="cursor:pointer" onclick="goToTrackerTab(\'expenses\')">' + '<div class="met-l">Expenses</div>' + '<div class="met-v" style="color:var(--c-red)">' + fmtShort(tExp) + '</div>' + (showTrends ? _trendHtml(tExp, prevExp, true) : '') + '</div>' + '<div class="met" style="cursor:pointer" onclick="goToTrackerTab(\'mileage\')">' + '<div class="met-l">Mileage</div>' + '<div class="met-v">' + Math.round(tMi).toLocaleString() + '<span class="unit"> mi</span></div>' + (showTrends ? _trendHtml(tMi, prevMi, false) : '') + '</div>' + '<div class="met" style="cursor:pointer" data-pg="pg-taxes" onclick="goPg(this.dataset.pg)">' + '<div class="met-l">Taxes (est)</div>' + '<div class="met-v" style="color:var(--c-red)">' + fmtShort(ytdTaxEst) + '</div>' + (showTrends && prevTax ? _trendHtml(ytdTaxEst, prevTax, true) : '<div class="met-s">— est.</div>') + '</div>' + '<div class="met" style="cursor:pointer" data-chart="profit" onclick="showKpiChart(this.dataset.chart)">' + '<div class="met-l">Profit</div>' + '<div class="met-v" style="color:' + (ytdTrueProfit < 0 ? 'var(--c-red)' : 'var(--c-green)') + '">' + fmtShort(ytdTrueProfit) + '</div>' + (showTrends ? _trendHtml(ytdTrueProfit, prevProfit, false) : '') + '</div>' + '<div class="met">' + '<div class="met-l">Avg job</div>' + '<div class="met-v">' + (avgJobVal !== null ? fmtShort(avgJobVal) : '—') + '</div>' + '</div>' + '</div>';
    }

    // Hobby loss check — 3 of last 5 years negative profit
    const _hobbyEl = document.getElementById('dash-hobby-warn');
    if (_hobbyEl && !_isEmployee) {
      const _cy = new Date().getFullYear();
      let _lossYears = 0;
      for (let _yi = 0; _yi < 5; _yi++) {
        const _yrs = String(_cy - _yi);
        const _yi2 = income.filter(r => r.date && r.date.startsWith(_yrs)).reduce((s, r) => s + r.amount, 0);
        const _ye = expenses.filter(e => e.date && e.date.startsWith(_yrs)).reduce((s, e) => s + e.amount, 0);
        const _ym = mileage.filter(m => m.date && m.date.startsWith(_yrs)).reduce((s, m) => s + (m.miles || 0), 0);
        if (_yi2 - _ye - _ym * _getIrsRateForYear(_yrs) < 0) _lossYears++;
      }
      if (_lossYears >= 3) {
        _hobbyEl.style.display = 'block';
        _hobbyEl.innerHTML = '<div style="background:#FFF8E7;border:1.5px solid #D4A017;border-radius:var(--rl);padding:12px 14px;margin-bottom:10px">' + '<div style="font-size:12px;font-weight:700;color:#78350F;margin-bottom:3px">⚠️ Hobby Loss Risk — ' + _lossYears + ' of last 5 years show net losses</div>' + '<div style="font-size:12px;color:var(--text2);line-height:1.5">IRS may reclassify your business as a hobby, limiting deductions to hobby income only. Talk to your CPA about documenting profit motive.</div>' + '</div>';
      } else {
        _hobbyEl.style.display = 'none';
      }
    }
    const closeTip = document.getElementById('dash-close-tip');
    if (_isEmployee) {
      if (closeTip) closeTip.style.display = 'none';
    }
    if (!_isEmployee && closeTip) {
      if (closeRatio !== null && closeRatio < 25 && totalDecided >= 3) {
        closeTip.style.display = 'block';
        closeTip.innerHTML = '<div style="background:#FFF8F0;border:1px solid var(--amber);border-radius:var(--rl);padding:12px 14px">' + '<div style="font-size:12px;font-weight:700;color:#B8600A;margin-bottom:4px">&#128273; Closing ratio is ' + closeRatio + '% — below average</div>' + '<div style="font-size:12px;color:var(--text2);line-height:1.5">Industry average is around 33%. Common reasons: slow follow-up, price too high, or not enough urgency at the estimate.</div>' + '</div>';
      } else {
        closeTip.style.display = 'none';
      }
    }

    // Simple summary cards: Leads + Collections
    const LEAD_STAGES_DASH = ['incomplete', 'new', 'est_scheduled', 'bid_out', 'bid_urgent', 'abandoned'];
    const leadCount = clients.filter(c => LEAD_STAGES_DASH.includes(getClientStage(c.id).stage)).length;
    const urgentLeads = clients.filter(c => {
      const s = getClientStage(c.id).stage;
      return s === 'bid_urgent' || s === 'abandoned';
    }).length;
    const subLeads = leadCount === 0 ? 'No active leads' : urgentLeads ? urgentLeads + ' need follow-up · ' + leadCount + ' total' : leadCount + ' active lead' + (leadCount !== 1 ? 's' : '');
    const lsub = document.getElementById('dash-leads-sub');
    if (lsub) lsub.textContent = subLeads;
    const collectItems = bids.filter(b => b.status === 'Closed Won' && getBidBalance(b) > 0.01 && b.completion_date);
    const collectOwed = collectItems.reduce((s, b) => s + getBidBalance(b), 0);
    const subCollect = collectItems.length === 0 ? 'Nothing to collect 🎉' : collectItems.length + ' job' + (collectItems.length !== 1 ? 's' : '') + ' · ' + fmt(collectOwed) + ' owed';
    const csub = document.getElementById('dash-collect-sub');
    if (csub) {
      csub.textContent = subCollect;
      csub.style.color = collectItems.length ? '#A32D2D' : 'var(--text3)';
    }
    if (!_isEmployee) renderPipeline();else {
      const pe = document.getElementById('dash-pipeline');
      if (pe) pe.innerHTML = '';
    }
    // Section shared styles
    const _rowStyle = 'display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);margin-bottom:6px';
    const _nameStyle = 'font-size:13px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    const _btnStyle = 'font-size:11px;background:var(--bg);border-color:var(--border2)';
    const _btnPStyle = 'font-size:11px';
    const _xStyle = 'font-size:11px;color:var(--text3);padding:6px 8px;background:var(--bg);border-color:var(--border2)';
    // Estimates in progress + sent proposals now live in renderTodayFeed()
    renderGoal();
    checkGoalPrompt();
    renderLeadSources();
    renderDashToday();
    renderDashCollect();
    renderTodayFeed();
    const _nearbyEl = document.getElementById('dash-nearby');
    if (_nearbyEl) {
      if (_nearbyJob && !_activeTimer) {
        _nearbyEl.style.display = 'block';
        _nearbyEl.innerHTML = '<div style="background:linear-gradient(135deg,#1E4D2B,#2D7A44);border-radius:var(--r);padding:14px 16px;display:flex;align-items:center;gap:12px;cursor:pointer" onclick="openClockInSheet(' + _nearbyJob.jobId + ')">' + '<span style="font-size:24px">🔨</span>' + '<div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:800;color:#fff">You\'re at ' + escHtml(_nearbyJob.clientName) + '\'s</div>' + '<div style="font-size:12px;color:rgba(255,255,255,.75)">' + escHtml(_nearbyJob.addr) + ' · Tap to clock in</div></div>' + '<span style="font-size:20px;color:rgba(255,255,255,.6)">▶</span></div>';
      } else {
        _nearbyEl.style.display = 'none';
      }
    }
    // Update new nav badges
    const _owing = bids.filter(b => b.status === 'Closed Won' && getBidBalance(b) > 0.01);
    const _cl = document.getElementById('qa-collect-label');
    if (_cl) _cl.textContent = _owing.length ? 'Collect (' + _owing.length + ')' : 'Collect';
    const _qb = document.getElementById('qa-collect-btn');
    if (_qb) {
      _qb.style.background = _owing.length > 0 ? 'var(--green)' : 'var(--border2)';
      _qb.style.borderColor = _qb.style.background;
      _qb.style.color = _owing.length > 0 ? '#fff' : 'var(--text3)';
    }
    const _licBtn = document.getElementById('mmi-licensing');
    if (_licBtn) {
      const _la = getLicenseAlerts();
      _licBtn.style.position = 'relative';
      const _exBadge = _licBtn.querySelector('._lic-badge');
      if (_la.length) {
        if (!_exBadge) {
          const b = document.createElement('span');
          b.className = '_lic-badge';
          b.style.cssText = 'position:absolute;top:6px;right:calc(50% - 18px);width:8px;height:8px;background:#e53e3e;border-radius:50%;border:2px solid var(--nav-bg)';
          _licBtn.appendChild(b);
        } else {
          _exBadge.style.display = 'block';
        }
      } else {
        if (_exBadge) _exBadge.style.display = 'none';
      }
    }
    // Only re-render the currently visible workflow page (avoid rebuilding off-screen pages on every renderDash)
    const _activePg = document.querySelector('.pg.active')?.id;
    if (_activePg === 'pg-leads') renderLeadsPage();else if (_activePg === 'pg-jobs') renderJobsPage();else if (_activePg === 'pg-money') renderMoneyPage();else _updateNavBadges(); // fast badge-only update when on home or other pages
    window._pwaUpdateBadge && window._pwaUpdateBadge();
    renderContractsDash && renderContractsDash();
  } finally {
    _renderDashRunning = false;
  }
}
function renderDashToday() {
  const el = document.getElementById('dash-today');
  if (!el) return;
  const tk = todayKey();
  const todayJobs = jobs.filter(j => {
    if (j.status === 'canceled') return false;
    const d = parseInt(j.days) || 1;
    for (let i = 0; i < d; i++) {
      if (addDays(j.start, i) === tk) return true;
    }
    return false;
  }).sort((a, b) => {
    if (a.eventType === 'estimate' && b.eventType !== 'estimate') return -1;
    if (b.eventType === 'estimate' && a.eventType !== 'estimate') return 1;
    return (a.time || '').localeCompare(b.time || '');
  });
  if (!todayJobs.length) {
    const dow = new Date().getDay();
    const msgs = ['Nothing Sunday — recharge for the week.', 'Open Monday. Book an estimate today.', 'Open Tuesday. Good day to follow up.', 'Open Wednesday. Mid-week reach out.', 'Open Thursday. Book weekend estimates.', 'Open Friday. Homeowners are home this weekend.', 'Open Saturday. Great day for estimates.'];
    el.innerHTML = '<div style="text-align:center;padding:12px 0">' + '<div style="font-size:22px;margin-bottom:6px">' + (dow === 0 || dow === 6 ? '🛋️' : '🎯') + '</div>' + '<div style="font-size:13px;font-weight:700;margin-bottom:4px">' + msgs[dow] + '</div>' + '<div style="font-size:11px;color:var(--text3);margin-top:4px">Open day — check Make Money Today</div>' + '</div>';
    return;
  }
  el.innerHTML = todayJobs.map(j => {
    const c = getClientById(j.client_id);
    const isEst = j.eventType === 'estimate';
    const isActive = j.start <= tk && addDays(j.start, (parseInt(j.days) || 1) - 1) >= tk;
    return '<div onclick="' + (j.client_id ? 'openClientDetail(' + j.client_id + ')' : 'void(0)') + '" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 0;border-bottom:1px solid var(--border);cursor:' + (j.client_id ? 'pointer' : 'default') + '">' + '<div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">' + '<div style="width:10px;height:10px;border-radius:2px;background:' + (j.color || 'var(--blue)') + ';flex-shrink:0"></div>' + '<div style="min-width:0">' + '<div style="font-size:14px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + j.name + '</div>' + '<div style="font-size:11px;color:var(--text3)">' + (isEst ? (j.time ? '@ ' + fmtTime(j.time) + ' · ' : '') + '<span style="color:#7F77DD;font-weight:600">Estimate visit</span>' : (j.addr || c && c.addr ? '<span style="font-weight:600">' + (j.addr || c.addr || '').split(',')[0] + '</span>' : 'No address') + (j.value ? ' · ' + fmt(j.value) : '') + ' · ' + j.days + ' day' + (parseInt(j.days) !== 1 ? 's' : '')) + '</div>' + '</div>' + '</div>' + '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0">' + (j.client_id && isEst ? '<div onclick="event.stopPropagation();sendReminderSMS(' + j.client_id + ')" style="background:var(--bg2);border:1px solid var(--border2);border-radius:var(--r);padding:7px 9px;cursor:pointer" title="Send reminder">💬</div>' : '') + '<span style="font-size:10px;font-weight:700;padding:3px 8px;border-radius:10px;background:' + (isEst ? 'rgba(127,119,221,.15)' : 'rgba(24,95,165,.12)') + ';color:' + (isEst ? '#7F77DD' : 'var(--blue)') + '">' + (isEst ? 'Estimate' : 'Active') + '</span>' + '</div>' + '</div>';
  }).join('');
}

// ── Collection escalation & risk system ─────────────────────────────────

function getNextCollAction(stage) {
  const map = {
    none: {
      label: '💬 Send Reminder',
      smsKey: 'reminder',
      next: 'reminder'
    },
    reminder: {
      label: '💬 Send 2nd Notice',
      smsKey: 'second',
      next: 'second'
    },
    second: {
      label: '💬 Send Intent',
      smsKey: 'intent',
      next: 'intent'
    },
    intent: {
      label: '⚖️ File Lien',
      smsKey: null,
      next: 'lien_ready'
    },
    lien_ready: {
      label: '⚖️ File Lien Now',
      smsKey: null,
      next: 'lien_filed'
    },
    lien_filed: {
      label: '✓ Release Lien',
      smsKey: null,
      next: 'resolved'
    }
  };
  return map[stage] || map['none'];
}
function emitEvent(type, clientId, extra) {
  if (!events) events = [];
  events.push({
    id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    type,
    ts: new Date().toISOString(),
    client_id: clientId,
    ...(extra || {})
  });
  if (events.length > 600) events = events.slice(-600);
}
function autoLogContact(clientId, note) {
  const c = getClientById(clientId);
  if (!c) return;
  c.last_contact_date = todayKey();
  const pb = bids.find(b => b.client_id === clientId && b.status === 'Pending');
  if (pb) {
    pb.last_followup_date = todayKey();
    if (!pb.followup || pb.followup <= todayKey()) pb.followup = addDays(todayKey(), 7);
  }
  emitEvent(note || 'contact', clientId);
  try {
    saveAll();
  } catch (e) {}
}
function markFollowupSent(bidId) {
  const b = bids.find(x => x.id === bidId);
  if (!b) return;
  b.last_followup_date = todayKey();
  b.followupStage = (b.followupStage || 1) + 1;
  const nextDays = b.followupStage >= 3 ? 14 : 7;
  b.followup = addDays(todayKey(), nextDays);
  b.noResponseCount = (b.noResponseCount || 0) + 1;
  saveAll();
  setTimeout(renderDash, 600);
}
function _snoozeFollowup(bidId, days) {
  const b = bids.find(x => x.id === bidId);
  if (!b) return;
  b.followup = addDays(todayKey(), days || 2);
  saveAll();
  setTimeout(renderDash, 300);
  showToast('Follow-up snoozed ' + days + ' days', '⏰');
}
function openExpenseForJob(jobId, clientId) {
  const j = jobs.find(x => x.id === jobId);
  goPg('pg-tracker');
  setTimeout(() => {
    const sel = document.getElementById('exp-job');
    if (sel) {
      for (let i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value == jobId) {
          sel.selectedIndex = i;
          break;
        }
      }
    }
    const expSec = document.getElementById('add-exp-form') || document.getElementById('exp-add-section');
    if (expSec) expSec.scrollIntoView({
      behavior: 'smooth'
    });
  }, 200);
}
function renderDashCollect() {
  const el = document.getElementById('dash-collect');
  if (!el) return;
  const tk = todayKey();
  const collectItems = [];
  bids.filter(b => b.status === 'Closed Won' && getBidBalance(b) > 0.01).forEach(b => {
    const c = getClientById(b.client_id);
    if (!c) return;
    const jobDone = b.completion_date || (() => {
      const doneJob = jobs.find(x => x.client_id === b.client_id && x.eventType !== 'estimate' && x.status === 'done');
      if (doneJob) return doneJob.completion_date || doneJob.start;
      const pastJob = jobs.find(x => x.client_id === b.client_id && x.eventType !== 'estimate' && x.status !== 'canceled' && addDays(x.start, (parseInt(x.days) || 1) - 1) < tk);
      return pastJob ? addDays(pastJob.start, (parseInt(pastJob.days) || 1) - 1) : null;
    })();
    if (!jobDone) return;
    const daysOverdue = Math.floor((new Date(tk + 'T12:00') - new Date(jobDone + 'T12:00')) / 86400000);
    const balance = getBidBalance(b);
    collectItems.push({
      name: c.name,
      sub: fmt(balance) + ' owed' + (daysOverdue > 0 ? ' · ' + daysOverdue + 'd past completion' : ''),
      urgent: daysOverdue >= 7,
      veryUrgent: daysOverdue >= 30,
      balance,
      bidId: b.id,
      cid: b.client_id
    });
  });
  const badge = document.getElementById('daft-pay-badge');
  if (badge) {
    if (collectItems.length) {
      badge.innerHTML = '<span style="background:#A32D2D;color:#fff;border-radius:8px;padding:1px 6px;font-size:10px;font-weight:800">' + collectItems.length + '</span>';
    } else {
      badge.innerHTML = '';
    }
  }
  if (!collectItems.length) {
    el.innerHTML = '<div style="color:var(--text3);font-size:12px;padding:8px 0">All collected — no outstanding balances.</div>';
    return;
  }
  collectItems.sort((a, b) => b.balance - a.balance);
  el.innerHTML = collectItems.map(f => '<div style="padding:10px 0;border-bottom:1px solid var(--border)">' + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">' + '<div style="flex:1;min-width:0">' + '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:2px">' + '<div style="font-size:13px;font-weight:700">' + f.name + '</div>' + (f.veryUrgent ? '<span style="font-size:10px;font-weight:800;text-transform:uppercase;color:#fff;background:#A32D2D;padding:2px 5px;border-radius:4px">30+ days</span>' : f.urgent ? '<span style="font-size:10px;font-weight:800;text-transform:uppercase;color:#fff;background:var(--amber);padding:2px 5px;border-radius:4px">Overdue</span>' : '') + '</div>' + '<div style="font-size:11px;color:' + (f.urgent ? '#A32D2D' : 'var(--text3)') + '">' + f.sub + '</div>' + '</div>' + '<button class="btn btn-sm btn-g" onclick="openPayPanel(' + f.bidId + ')" style="flex-shrink:0;font-size:11px">Collect</button>' + '</div>' + '</div>').join('');
}

// ── On-load unpaid work alert ────────────────────────────────────────────────
function checkUnpaidOnLoad() {
  if (window._collOnLoadShown) return;
  window._collOnLoadShown = true;
  const tk = todayKey();
  const unpaid = bids.filter(b => b.status === 'Closed Won' && getBidBalance(b) > 0.01 && b.completion_date).map(b => ({
    b,
    days: Math.floor((new Date(tk + 'T12:00') - new Date(b.completion_date + 'T12:00')) / 86400000),
    stage: getBidCollStage(b)
  })).filter(x => x.days > 0).sort((a, b) => b.days - a.days);
  if (!unpaid.length) return;
  const {
    b,
    days,
    stage
  } = unpaid[0];
  const c = getClientById(b.client_id);
  if (!c) return;
  const bal = getBidBalance(b);
  const biz = S.bname || 'TradeDesk';
  const next = getNextCollAction(stage);
  const isFileable = stage === 'intent' || stage === 'lien_ready';
  const lienFiled = stage === 'lien_filed';
  const otherCount = unpaid.length - 1;
  const urgIcon = days >= 30 ? '🚨' : days >= 14 ? '⚠️' : '💰';
  const urgLabel = days >= 30 ? '30+ days overdue — act now' : days >= 14 ? 'Seriously overdue' : days >= 7 ? 'Overdue' : 'Balance due';
  const urgColor = days >= 14 ? '#A32D2D' : 'var(--amber)';
  let actionBtn = '';
  if (lienFiled) {
    actionBtn = '<button onclick="this.closest(\'.zmodal-overlay\').remove();openClientDetail(' + b.client_id + ')" style="flex:2;padding:13px;border-radius:var(--r);border:none;background:#3D0000;color:#FFB3B3;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">⚖️ View lien</button>';
  } else if (isFileable) {
    actionBtn = '<button onclick="this.closest(\'.zmodal-overlay\').remove();showFileLienDirect(' + b.id + ')" style="flex:2;padding:13px;border-radius:var(--r);border:none;background:#3D0000;color:#FFB3B3;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">⚖️ File Lien</button>';
  } else if (next.smsKey && c.phone) {
    actionBtn = '<button onclick="collSendSMS(bids.find(x=>x.id==' + b.id + '),\'' + next.smsKey + '\');this.closest(\'.zmodal-overlay\').remove()" style="flex:2;padding:13px;border-radius:var(--r);border:none;background:var(--amber);color:#1a1a1a;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">' + next.label + '</button>';
  } else if (c.phone) {
    actionBtn = '<a href="tel:' + c.phone.replace(/\D/g, '') + '" onclick="autoLogContact(' + c.id + ',\'call\')" style="flex:2;padding:13px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;text-decoration:none;display:block;text-align:center">📞 Call now</a>';
  }
  const ov = document.createElement('div');
  ov.className = 'zmodal-overlay';
  const box = document.createElement('div');
  box.className = 'zmodal';
  box.innerHTML = '<div style="text-align:center;font-size:30px;margin-bottom:6px">' + urgIcon + '</div>' + '<div style="font-size:16px;font-weight:800;text-align:center;margin-bottom:4px">Unpaid balance</div>' + '<div style="text-align:center;font-size:30px;font-weight:800;color:#A32D2D;margin-bottom:4px">' + fmt(bal) + '</div>' + '<div style="text-align:center;font-size:13px;color:var(--text2);margin-bottom:3px">' + escHtml(c.name) + '</div>' + '<div style="text-align:center;font-size:11px;color:' + urgColor + ';font-weight:700;margin-bottom:16px">' + urgLabel + ' · ' + days + 'd since completion</div>' + (otherCount > 0 ? '<div style="font-size:11px;color:var(--text3);text-align:center;margin-bottom:14px;padding:6px;background:var(--bg2);border-radius:var(--r)">+' + otherCount + ' other unpaid job' + (otherCount !== 1 ? 's' : '') + '</div>' : '') + '<div style="display:flex;gap:8px;margin-bottom:10px">' + '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="flex:1;padding:13px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);font-size:14px;font-weight:600;cursor:pointer;font-family:inherit">Later</button>' + actionBtn + '</div>' + '<button onclick="this.closest(\'.zmodal-overlay\').remove();openPayPanel(' + b.id + ')" style="width:100%;padding:11px;border-radius:var(--r);border:none;background:var(--green);color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">💳 Log payment received</button>';
  ov.appendChild(box);
  document.body.appendChild(ov);
  ov.addEventListener('click', e => {
    if (e.target === ov) ov.remove();
  });
}

// ── Kansas Mechanic's Lien document generator ────────────────────────────────
function printKansasLien(bidId) {
  const bid = bids.find(b => b.id === bidId);
  if (!bid) return;
  const lien = getBidLien(bidId);
  if (!lien) return;
  const c = getClientById(bid.client_id);
  if (!c) return;
  const bname = S.bname || 'TradeDesk';
  const bphone = S.bphone || '';
  const blic = S.blic || '';
  const owner = getOwnerName() || '';
  const claimAmt = (lien.amount || getBidBalance(bid) || 0).toFixed(2);
  const addr = bid.addr || c.addr || '';
  // Auto-detect county if not already set on the lien record
  const {
    stateCode: detectedState,
    county: detectedCounty
  } = getCountyForBid(bid);
  const stateName = typeof STATE_TAX !== 'undefined' && STATE_TAX[detectedState]?.name || detectedState;
  const isKS = detectedState === 'KS';
  const statuteRef = isKS ? 'K.S.A. 60-1101 et seq.' : detectedState + ' mechanic\'s lien statutes';
  const county = lien.county || detectedCounty + ', ' + detectedState;
  const countyShort = county.replace(/,\s*[A-Z]{2}$/, '');
  const filingInfo = getCountyFilingInfo(detectedState);
  const filedDate = lien.date || todayKey();
  const lastWorkDate = bid.completion_date || filedDate;
  // Derive first-work date from job start or bid date
  const job = jobs.find(j => j.bid_id === bidId);
  const firstWorkDate = job ? job.start : bid.bid_date || lastWorkDate;
  const fmtD = d => {
    if (!d) return '_______________';
    const [y, m, dy] = d.split('-');
    const mn = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return mn[parseInt(m) - 1] + ' ' + parseInt(dy) + ', ' + y;
  };
  const surfTypes = [...new Set((bid.surfaces || []).map(s => s.type).filter(Boolean))];
  const workDesc = surfTypes.length ? surfTypes.join(', ') + ' — painting and coating services' : bid.type || 'Painting and coating services';
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Mechanic's Lien — ${escHtml(c.name)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Times New Roman',Times,serif;font-size:13pt;color:#000;background:#fff;padding:40px}
  h1{font-size:18pt;text-align:center;text-transform:uppercase;letter-spacing:2px;margin-bottom:6px}
  h2{font-size:13pt;text-align:center;margin-bottom:24px;font-weight:normal}
  .subtitle{text-align:center;font-size:11pt;margin-bottom:30px;font-style:italic}
  .section{margin-bottom:18px}
  .label{font-size:10pt;font-weight:bold;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px}
  .value{border-bottom:1px solid #000;min-height:24px;padding:2px 4px;font-size:13pt}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  .notice{border:2px solid #000;padding:14px;margin:20px 0;font-size:11pt;line-height:1.6}
  .oath{margin:24px 0;font-size:11pt;line-height:1.8;text-align:justify}
  .sig-block{margin-top:36px}
  .sig-line{border-bottom:1px solid #000;min-height:36px;margin-bottom:4px}
  .sig-label{font-size:10pt;text-align:center;color:#333}
  .notary{border:1px solid #000;padding:16px;margin-top:28px;font-size:11pt;line-height:1.8}
  .notary-title{font-size:12pt;font-weight:bold;text-transform:uppercase;margin-bottom:10px;text-align:center}
  .page-break{page-break-after:always;margin-bottom:40px}
  .proposal-section{margin-top:40px}
  @media print{body{padding:20px}.no-print{display:none}}
</style></head><body>
<div class="no-print" style="background:#185FA5;color:#fff;padding:12px 16px;margin:-40px -40px 30px;display:flex;justify-content:space-between;align-items:center">
  <span style="font-size:15px;font-weight:700">${escHtml(stateName)} Mechanic's Lien — Ready to print</span>
  <button onclick="tdPrint()" style="padding:8px 20px;border-radius:6px;border:none;background:#fff;color:#185FA5;font-size:13px;font-weight:700;cursor:pointer">🖨️ Print</button>
</div>

<h1>Mechanic's Lien Statement</h1>
<h2>State of ${escHtml(stateName)}</h2>
<div class="subtitle">Pursuant to ${escHtml(statuteRef)}</div>

<div class="notice">
  <strong>NOTICE:</strong> This Mechanic's Lien Statement is filed with the Register of Deeds of ${escHtml(county)} pursuant to ${escHtml(stateName)} mechanic's lien statutes (${escHtml(statuteRef)}). This lien attaches to the real property described herein for labor, services, and materials furnished but unpaid.
</div>

<div class="section">
  <div class="label">1. Claimant (Contractor)</div>
  <div class="value">${escHtml(bname)}</div>
  ${bphone ? '<div class="value" style="margin-top:6px">Phone: ' + escHtml(bphone) + (blic ? ' &nbsp;|&nbsp; License: ' + escHtml(blic) : '') + '</div>' : ''}
  ${owner ? '<div class="value" style="margin-top:6px">Contractor/Owner: ' + escHtml(owner) + '</div>' : ''}
</div>

<div class="section">
  <div class="label">2. Property Owner (Debtor)</div>
  <div class="value">${escHtml(c.name)}</div>
  ${c.phone ? '<div class="value" style="margin-top:6px">Phone: ' + escHtml(c.phone) + '</div>' : ''}
</div>

<div class="section">
  <div class="label">3. Property Address (Location of Work)</div>
  <div class="value">${escHtml(addr)}</div>
</div>

<div class="section">
  <div class="label">4. Legal Description of Property</div>
  <div class="value" style="min-height:48px">The real property located at ${escHtml(addr)}, ${escHtml(countyShort)}, ${escHtml(stateName)} (legal description to be obtained from county records if required for filing)</div>
</div>

<div class="section">
  <div class="label">5. Description of Work Performed</div>
  <div class="value" style="min-height:48px">${escHtml(workDesc)}</div>
</div>

<div class="section grid2">
  <div>
    <div class="label">6. Date Work First Furnished</div>
    <div class="value">${fmtD(firstWorkDate)}</div>
  </div>
  <div>
    <div class="label">7. Date Work Last Furnished</div>
    <div class="value">${fmtD(lastWorkDate)}</div>
  </div>
</div>

<div class="section grid2">
  <div>
    <div class="label">8. Amount of Lien Claimed</div>
    <div class="value" style="font-size:16pt;font-weight:bold">$${escHtml(claimAmt)}</div>
  </div>
  <div>
    <div class="label">9. Date of This Lien Statement</div>
    <div class="value">${fmtD(filedDate)}</div>
  </div>
</div>

<div class="section">
  <div class="label">10. County of Filing</div>
  <div class="value">${escHtml(county)}</div>
</div>

${lien.notes ? '<div class="section"><div class="label">Notes / Case Reference</div><div class="value">' + escHtml(lien.notes) + '</div></div>' : ''}

<div class="oath">
  <strong>VERIFICATION:</strong> The undersigned, being duly sworn, states that the foregoing Mechanic's Lien Statement is true and correct to the best of their knowledge and belief; that the amount claimed is justly due and owing after deducting all just credits and offsets; and that the services described above were actually performed at the location identified herein.
</div>

<div class="sig-block">
  <div class="grid2">
    <div>
      <div class="label" style="margin-bottom:8px">Claimant Signature</div>
      <div class="sig-line"></div>
      <div class="sig-label">${escHtml(owner || 'Contractor')}</div>
    </div>
    <div>
      <div class="label" style="margin-bottom:8px">Date Signed</div>
      <div class="sig-line"></div>
      <div class="sig-label">Date</div>
    </div>
  </div>
  <div style="margin-top:16px">
    <div class="label" style="margin-bottom:8px">Printed Name & Title</div>
    <div class="sig-line"></div>
    <div class="sig-label">${escHtml(owner || 'Contractor')}, Owner — ${escHtml(bname)}</div>
  </div>
</div>

<div class="notary">
  <div class="notary-title">Notary Acknowledgment</div>
  State of ${escHtml(stateName)}<br>
  County of ____________________________<br><br>
  Subscribed and sworn to before me this _______ day of __________________, 20___,<br>
  by ____________________________________________.<br><br>
  <div style="margin-top:24px;display:flex;gap:40px">
    <div style="flex:1">
      <div style="border-bottom:1px solid #000;min-height:36px"></div>
      <div style="font-size:10pt;text-align:center;margin-top:4px">Notary Public Signature</div>
    </div>
    <div style="flex:1">
      <div style="border-bottom:1px solid #000;min-height:36px"></div>
      <div style="font-size:10pt;text-align:center;margin-top:4px">My Commission Expires</div>
    </div>
  </div>
  <div style="margin-top:12px;font-size:10pt">
    <strong>File with:</strong> ${escHtml(filingInfo.office)} — ${escHtml(countyShort)}, ${escHtml(detectedState)}<br>
    Search Apple Maps for "${escHtml(countyShort)} ${escHtml(filingInfo.office)}" to find the exact office address.<br>
    <strong>Statute:</strong> ${escHtml(filingInfo.cite)}<br>
    ${filingInfo.notes.map(n => '→ ' + escHtml(n)).join('<br>')}
  </div>
</div>

${bid.proposalHtml ? `<div class="page-break"></div><div class="proposal-section"><h1 style="margin-bottom:20px">Exhibit A — Original Proposal</h1><div style="border:1px solid #000;padding:16px">${bid.proposalHtml}</div></div>` : ''}

</body></html>`;
  const win = window.open('', '_blank');
  if (win) {
    win.document.write(html);
    win.document.close();
  } else {
    zAlert('Allow pop-ups to open the lien document. In Safari: tap AA in address bar → Allow pop-ups.');
  }
}
function _mmtToggle(id) {
  window['_mmtCol_' + id] = window['_mmtCol_' + id] === false ? true : false;
  renderTodayFeed();
}
function _markDepositCash(bidId) {
  const bid = bids.find(b => b.id === bidId);
  if (!bid) return;
  const depAmt = (bid.deposit || 0) > 0 ? bid.deposit : bid.amount || 0;
  zConfirm('Mark ' + fmt(depAmt) + ' deposit collected as cash?', () => {
    payments.push({
      id: Date.now(),
      bid_id: bidId,
      client_id: bid.client_id,
      client_name: bid.client_name,
      date: todayKey(),
      type: 'deposit',
      amount: depAmt,
      method: 'cash',
      ref: 'Cash — recorded from feed'
    });
    saveAll();
    renderDash();
    showToast('Cash deposit recorded', '💰');
  });
}
function renderTodayFeed() {
  const el = document.getElementById('dash-money-feed');
  if (!el) return;
  const tk = todayKey();
  const finalPayItems = [],
    depositItems = [],
    scheduleItems = [],
    pendingItems = [],
    buildItems = [],
    alertItems = [];

  // ALERTS — License expiring/expired (always first, outside sections)
  const licAlerts = getLicenseAlerts();
  if (licAlerts.length) {
    const hasExpired = licAlerts.some(l => _licStatus(l) === 'expired');
    alertItems.push('<div class="tf-card" onclick="goPg(\'pg-licensing\')" style="cursor:pointer">' + '<div class="tf-icon">' + (hasExpired ? '🚨' : '⚠️') + '</div>' + '<div class="tf-body">' + '<div class="tf-name">' + (hasExpired ? licAlerts.filter(l => _licStatus(l) === 'expired').length + ' expired license' + (licAlerts.filter(l => _licStatus(l) === 'expired').length > 1 ? 's' : '') : '') + (hasExpired && licAlerts.some(l => _licStatus(l) === 'soon') ? ' · ' : '') + (!hasExpired && licAlerts.filter(l => _licStatus(l) === 'soon').length ? licAlerts.filter(l => _licStatus(l) === 'soon').length + ' expiring soon' : '') + '</div>' + '<div class="tf-sub" style="color:' + (hasExpired ? 'var(--red)' : 'var(--amber)') + '">' + licAlerts.slice(0, 2).map(l => escHtml(l.label)).join(', ') + (licAlerts.length > 2 ? ' +more' : '') + '</div>' + '</div>' + '<div style="font-size:11px;color:var(--blue);font-weight:700;flex-shrink:0">View →</div>' + '</div>');
  }

  // COLLECT — Completed jobs with balance owed
  bids.filter(b => b.status === 'Closed Won' && getBidBalance(b) > 0.01 && b.completion_date).forEach(b => {
    const c = getClientById(b.client_id);
    if (!c) return;
    const bal = getBidBalance(b);
    const daysAgo = Math.floor((new Date(tk + 'T12:00') - new Date(b.completion_date + 'T12:00')) / 86400000);
    const {
      daysUntilDeadline
    } = getLienTimeline(b);
    const deadlineUrgent = daysUntilDeadline <= 30 && daysUntilDeadline > 0;
    const deadlineExpired = daysUntilDeadline <= 0;
    const countdownTag = deadlineExpired ? '<span style="display:inline-block;font-size:9px;font-weight:800;text-transform:uppercase;padding:2px 5px;border-radius:3px;background:#000;color:#FFB3B3;margin-left:4px">Lien window expired</span>' : deadlineUrgent ? '<span style="display:inline-block;font-size:9px;font-weight:800;text-transform:uppercase;padding:2px 5px;border-radius:3px;background:#A32D2D;color:#fff;margin-left:4px">' + daysUntilDeadline + 'd to file</span>' : '';
    const urgTag = daysAgo >= 30 ? '<span style="display:inline-block;font-size:9px;font-weight:800;text-transform:uppercase;padding:2px 5px;border-radius:3px;background:#A32D2D;color:#fff;margin-left:4px">30+ days</span>' : daysAgo >= 7 ? '<span style="display:inline-block;font-size:9px;font-weight:800;text-transform:uppercase;padding:2px 5px;border-radius:3px;background:#C0720A;color:#fff;margin-left:4px">Overdue</span>' : '';
    const stage = getBidCollStage(b);
    const next = getNextCollAction(stage);
    const lienStage = stage === 'lien_filed';
    const isFileable = stage === 'intent' || stage === 'lien_ready';
    let actBtns = '';
    if (c.phone) actBtns += '<a href="tel:' + c.phone.replace(/\D/g, '') + '" onclick="autoLogContact(' + c.id + ',\'call\')" class="btn btn-sm" style="font-size:11px">Call</a>';
    if (next.smsKey && c.phone) actBtns += '<button onclick="collSendSMS(bids.find(x=>x.id==' + b.id + '),\'' + next.smsKey + '\')" class="btn btn-sm" style="font-size:11px;border-color:var(--amber);color:#856404;background:var(--amber-lt)">' + next.label + '</button>';else if (isFileable) actBtns += '<button onclick="showFileLienDirect(' + b.id + ')" class="btn btn-sm" style="font-size:11px;background:#3D0000;color:#FFB3B3;border-color:#3D0000">⚖️ File Lien</button>';else if (lienStage) actBtns += '<button onclick="printKansasLien(' + b.id + ')" class="btn btn-sm" style="font-size:11px;background:#3D0000;color:#FFB3B3;border-color:#3D0000">⚖️ View lien doc</button>';
    actBtns += '<button onclick="openPayPanel(' + b.id + ')" class="btn btn-sm btn-g" style="font-size:11px">Collect →</button>';
    finalPayItems.push('<div class="tf-card">' + '<div class="tf-icon">💰</div>' + '<div class="tf-body">' + '<div class="tf-name">' + escHtml(c.name) + urgTag + countdownTag + '</div>' + '<div class="tf-sub" style="color:#A32D2D">' + fmt(bal) + ' owed · ' + daysAgo + 'd since completion</div>' + '</div>' + '<div class="tf-acts">' + actBtns + '</div>' + '</div>');
  });

  // COLLECT + SCHEDULE — Won bids not yet completed
  bids.filter(b => b.status === 'Closed Won' && !b.completion_date).forEach(b => {
    // If no deposit was required treat as paid — $0-deposit and cash-upfront jobs
    const depositRequired = (b.deposit || 0) > 0;
    const depositPaid = !depositRequired || getBidPaid(b.id) > 0;
    const hasJob = jobs.some(j => (j.bid_id === b.id || j.client_id === b.client_id && !j.bid_id) && j.eventType !== 'estimate');
    if (hasJob && depositPaid) return;
    const c = getClientById(b.client_id);
    const cDisp = c ? c.name : b.client_name || b.name || 'Client';
    if (!hasJob && depositPaid) {
      // Deposit collected (or not required) — just needs scheduling
      scheduleItems.push('<div class="tf-card">' + '<div class="tf-icon">📅</div>' + '<div class="tf-body">' + '<div class="tf-name">' + escHtml(cDisp) + '</div>' + '<div class="tf-sub" style="color:var(--blue)">' + fmt(b.amount) + ' · deposit paid · not yet scheduled</div>' + '</div>' + '<div class="tf-acts">' + '<button onclick="schedFromBid(' + b.id + ')" class="btn btn-sm btn-p" style="font-size:11px">Schedule →</button>' + '</div>' + '</div>');
    } else {
      // Deposit still needed — goes to Deposit & Schedule
      const depAmt = depositRequired ? fmt(b.deposit) : fmt(b.amount);
      const subText = hasJob ? 'Job in progress · deposit not collected · ' + depAmt : 'Deposit required before scheduling · ' + depAmt;
      depositItems.push('<div class="tf-card">' + '<div class="tf-icon">' + (hasJob ? '💰' : '💳') + '</div>' + '<div class="tf-body">' + '<div class="tf-name">' + escHtml(cDisp) + '</div>' + '<div class="tf-sub" style="color:' + (hasJob ? '#A32D2D' : 'var(--blue)') + '">' + subText + '</div>' + '</div>' + '<div class="tf-acts">' + '<button onclick="openPayPanel(' + b.id + ',\'deposit\')" class="btn btn-sm" style="font-size:11px;border-color:var(--blue);color:var(--blue)">Deposit</button>' + '<button onclick="_markDepositCash(' + b.id + ')" class="btn btn-sm" style="font-size:11px;color:var(--text3)">Paid Cash</button>' + '</div>' + '</div>');
    }
  });

  // CLOSE — 2nd follow-up needed
  bids.filter(b => b.status === 'Pending' && !b.signingToken && !b.draft && (b.noResponseCount || 0) >= 1).forEach(b => {
    const c = getClientById(b.client_id);
    if (!c) return;
    const fn = c.name.split(' ')[0];
    const smsBody = encodeURIComponent('Hey ' + fn + ', just wanted to see if this is still something you\'re wanting to move forward with?');
    const daysOut = b.followup ? Math.floor((new Date(tk + 'T12:00') - new Date(b.followup + 'T12:00')) / 86400000) : 0;
    pendingItems.push('<div class="tf-card">' + '<div class="tf-icon">🔥</div>' + '<div class="tf-body">' + '<div class="tf-name">' + escHtml(c.name) + '</div>' + '<div class="tf-sub" style="color:#A32D2D">2nd follow-up · ' + fmt(b.amount) + ' · ' + Math.abs(daysOut) + 'd waiting</div>' + '</div>' + '<div class="tf-acts">' + (c.phone ? '<a href="tel:' + c.phone.replace(/\D/g, '') + '" onclick="autoLogContact(' + c.id + ',\'call\')" class="btn btn-sm" style="font-size:11px">Call</a>' : '') + (c.phone ? '<a href="sms:' + c.phone.replace(/\D/g, '') + '&body=' + smsBody + '" onclick="autoLogContact(' + c.id + ',\'second_followup\');markFollowupSent(' + b.id + ')" class="btn btn-sm" style="font-size:11px;border-color:var(--amber);color:#856404;background:var(--amber-lt)">📱 Send</a>' : '') + '<button onclick="_snoozeFollowup(' + b.id + ',2)" class="btn btn-sm" style="font-size:11px;color:var(--text3)">Snooze 2d</button>' + '<button onclick="markFUWon(' + b.id + ',' + b.client_id + ')" class="btn btn-sm btn-g" style="font-size:11px">Won ✓</button>' + '</div>' + '</div>');
  });

  // CLOSE — Follow-up overdue
  bids.filter(b => b.status === 'Pending' && !b.signingToken && !b.draft && b.followup && b.followup <= tk && !(b.noResponseCount >= 1)).forEach(b => {
    const c = getClientById(b.client_id);
    if (!c) return;
    const fn = c.name.split(' ')[0];
    const stage = b.followupStage || 1;
    const msgs = ['Hey ' + fn + ', just checking in — did you get a chance to look over the proposal? Happy to answer any questions.', 'Hi ' + fn + ', wanted to follow up on the estimate I sent over. Let me know if you\'d like to move forward or have any questions.', 'Hey ' + fn + ', I have an opening coming up that might work great for your project. Would love to get it scheduled — let me know!'];
    const smsBody = encodeURIComponent(msgs[Math.min(stage - 1, msgs.length - 1)]);
    const daysOut = Math.floor((new Date(tk + 'T12:00') - new Date(b.followup + 'T12:00')) / 86400000);
    pendingItems.push('<div class="tf-card">' + '<div class="tf-icon">⏰</div>' + '<div class="tf-body">' + '<div class="tf-name">' + escHtml(c.name) + '</div>' + '<div class="tf-sub" style="color:var(--amber)">Follow-up #' + stage + ' · ' + (daysOut > 0 ? daysOut + 'd overdue' : 'due today') + ' · ' + fmt(b.amount) + '</div>' + '</div>' + '<div class="tf-acts">' + (c.phone ? '<a href="sms:' + c.phone.replace(/\D/g, '') + '&body=' + smsBody + '" onclick="autoLogContact(' + c.id + ',\'followup_sent\');markFollowupSent(' + b.id + ')" class="btn btn-sm" style="font-size:11px;border-color:var(--amber);color:#856404;background:var(--amber-lt)">📱 Send</a>' : '') + (c.phone ? '<a href="tel:' + c.phone.replace(/\D/g, '') + '" onclick="autoLogContact(' + c.id + ',\'call\')" class="btn btn-sm" style="font-size:11px">Call</a>' : '') + '<button onclick="_snoozeFollowup(' + b.id + ',2)" class="btn btn-sm" style="font-size:11px;color:var(--text3)">Snooze 2d</button>' + '<button onclick="markFUWon(' + b.id + ',' + b.client_id + ')" class="btn btn-sm btn-g" style="font-size:11px">Won ✓</button>' + '</div>' + '</div>');
  });

  // CLOSE — Awaiting signature
  bids.filter(b => b.signingToken && b.status === 'Pending').forEach(b => {
    const c = getClientById(b.client_id);
    if (!c) return;
    const days = b.bid_date ? Math.floor((new Date(tk + 'T12:00') - new Date(b.bid_date + 'T12:00')) / 86400000) : 0;
    const urgColor = days >= 14 ? '#A32D2D' : days >= 7 ? 'var(--amber)' : 'var(--text3)';
    const daysStr = days === 0 ? 'Sent today' : days === 1 ? '1 day waiting' : days + 'd waiting';
    // Show three distinct open timestamps + view counts per bid
    const _hubTs = typeof _proposalViewsByBidHubClient !== 'undefined' && _proposalViewsByBidHubClient ? _proposalViewsByBidHubClient[String(b.id)] : null;
    const _clientTs = typeof _proposalViewsByBidClient !== 'undefined' && _proposalViewsByBidClient ? _proposalViewsByBidClient[String(b.id)] : null;
    const _contractorTs = typeof _proposalViewsByBidContractor !== 'undefined' && _proposalViewsByBidContractor ? _proposalViewsByBidContractor[String(b.id)] : null;
    const _hubCnt = typeof _proposalViewsByBidHubCount !== 'undefined' && _proposalViewsByBidHubCount ? _proposalViewsByBidHubCount[String(b.id)] || 0 : 0;
    const _clientCnt = typeof _proposalViewsByBidClientCount !== 'undefined' && _proposalViewsByBidClientCount ? _proposalViewsByBidClientCount[String(b.id)] || 0 : 0;
    // Timezone-aware timestamp: "Today at 2:34 PM", "Yesterday at 9:15 AM", "Mon, May 25 at 3:20 PM"
    const _localTs = ts => {
      if (!ts) return '';
      const d = new Date(ts);
      const m = Math.floor((Date.now() - d) / 60000);
      if (m < 2) return 'just now';
      if (m < 60) return m + 'm ago';
      const t = d.toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit'
      });
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const yest = new Date(today - 86400000);
      if (d >= today) return 'Today at ' + t;
      if (d >= yest) return 'Yesterday at ' + t;
      return d.toLocaleDateString([], {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      }) + ' at ' + t;
    };
    let viewedBadge = '';
    if (_hubTs) {
      const _cStr = _hubCnt > 1 ? ' · ' + _hubCnt + '×' : '';
      viewedBadge = '<div style="font-size:11px;font-weight:700;color:#2563eb;margin-top:3px">🔗 Hub opened · ' + _localTs(_hubTs) + _cStr + '</div>';
    }
    if (_clientTs) {
      const _cStr = _clientCnt > 1 ? ' · ' + _clientCnt + '×' : '';
      viewedBadge += '<div style="font-size:11px;font-weight:700;color:#16a34a;margin-top:2px">👁 Proposal opened · ' + _localTs(_clientTs) + _cStr + '</div>';
    }
    if (!_hubTs && !_clientTs) {
      viewedBadge = '<div style="font-size:11px;color:var(--text3);margin-top:3px">Client hasn\'t opened yet</div>';
    }
    if (_contractorTs) {
      viewedBadge += '<div style="font-size:10px;color:var(--text3);margin-top:1px">You previewed · ' + _localTs(_contractorTs) + '</div>';
    }
    pendingItems.push('<div class="tf-card">' + '<div class="tf-icon">📨</div>' + '<div class="tf-body">' + '<div class="tf-name">' + escHtml(c.name) + '</div>' + '<div class="tf-sub" style="color:' + urgColor + '">' + fmt(b.amount) + ' · ' + daysStr + '</div>' + viewedBadge + '</div>' + '<div class="tf-acts">' + (b.proposalHtml ? '<button onclick="viewSavedProposal(' + b.id + ')" class="btn btn-sm" style="font-size:11px">View</button>' : '') + '<button onclick="resendProposalLink(' + b.id + ')" class="btn btn-sm" style="font-size:11px">Resend</button>' + '<button onclick="discardInProgressBid(' + b.id + ')" class="btn btn-sm" style="font-size:11px;color:#A32D2D">Delete</button>' + '</div>' + '</div>');
  });

  // BUILD — Unsaved wizard draft
  let draft = loadEstFullDraft();
  if (draft && draft.cname) {
    const alreadyWon = bids.some(b => b.status === 'Closed Won' && (b.client_name || b.name || '').toLowerCase().trim() === (draft.cname || '').toLowerCase().trim());
    if (alreadyWon) {
      clearEstFullDraft();
      draft = null;
    }
  }
  const _activeDraftBidId = draft?.lastBidId || null;
  if (draft && draft.cname) {
    buildItems.push('<div class="tf-card">' + '<div class="tf-icon">✏️</div>' + '<div class="tf-body">' + '<div class="tf-name">' + escHtml(draft.cname) + '</div>' + '<div class="tf-sub" style="color:var(--text3)">Unsaved draft — finish &amp; send</div>' + '</div>' + '<div class="tf-acts">' + '<button onclick="resumeEstimateDraft()" class="btn btn-sm btn-p" style="font-size:11px">Resume →</button>' + '<button onclick="clearEstFullDraft();renderDash()" class="btn btn-sm" style="font-size:11px;color:var(--text3)">Discard</button>' + '</div>' + '</div>');
  }
  bids.filter(b => !b.signingToken && (b.draft || b.status === 'Pending' || b.status === 'Draft' && b.geiLines !== undefined) && b.id !== _activeDraftBidId).forEach(b => {
    const c = getClientById(b.client_id);
    const displayName = c?.name || b.client_name || b.name || '';
    if (!displayName) return;
    const days = b.bid_date ? Math.floor((new Date(tk + 'T12:00') - new Date(b.bid_date + 'T12:00')) / 86400000) : 0;
    const isDraft = b.status === 'Draft' || b.draft;
    const subLabel = isDraft && !b.amount ? 'In progress — finish &amp; send' : isDraft ? 'Draft — finish &amp; send' : fmt(b.amount) + ' · built ' + (days === 0 ? 'today' : days + 'd ago') + ' · not sent yet';
    buildItems.push('<div class="tf-card">' + '<div class="tf-icon">✏️</div>' + '<div class="tf-body">' + '<div class="tf-name">' + escHtml(displayName) + '</div>' + (b.type ? '<div class="tf-sub" style="font-size:12px;font-weight:600;color:var(--text2);margin-bottom:1px">' + escHtml(b.type) + '</div>' : '') + '<div class="tf-sub" style="color:var(--text3)">' + subLabel + '</div>' + '</div>' + '<div class="tf-acts">' + '<button onclick="' + (b.geiLines !== undefined ? 'openGenericEstimate(getClientById(' + b.client_id + '),' + b.id + ',\'' + escHtml(b.trade_type || 'general') + '\')' : 'openEditBid(' + b.id + ',' + (b.lastStep || 1) + ')') + '" class="btn btn-sm btn-p" style="font-size:11px">Resume →</button>' + '<button onclick="discardInProgressBid(' + b.id + ')" class="btn btn-sm" style="font-size:11px;color:var(--text3)">Discard</button>' + '</div>' + '</div>');
  });

  // BUILD — New leads with no estimates yet
  const newLeads = clients.filter(c => {
    if (getClientStage(c.id).stage !== 'new') return false;
    if (bids.some(b => b.client_id === c.id)) return false;
    if (jobs.some(j => j.client_id === c.id && j.eventType === 'estimate')) return false;
    return true;
  });
  if (newLeads.length) {
    buildItems.push('<div class="tf-card">' + '<div class="tf-icon">🙋</div>' + '<div class="tf-body">' + '<div class="tf-name">' + (newLeads.length === 1 ? '1 new lead ready' : newLeads.length + ' new leads ready') + '</div>' + '<div class="tf-sub" style="color:var(--blue)">Build estimates to move them forward</div>' + '</div>' + '<div class="tf-acts"><button onclick="goPg(\'pg-leads\')" class="btn btn-sm btn-p" style="font-size:11px">View leads →</button></div>' + '</div>');
  }

  // Filter visibility per tab
  const showFinalPay = _dashFeedFilter !== 'urgent';
  const showDepSched = _dashFeedFilter !== 'urgent';
  const showPending = _dashFeedFilter !== 'money';
  const showBuild = _dashFeedFilter === 'all';

  // Section builder — defaultOpen=true makes the section expand on first render
  const _sec = (id, icon, label, color, items, show, defaultOpen = false) => {
    if (!show || !items.length) return '';
    if (defaultOpen && window['_mmtCol_' + id] === undefined) window['_mmtCol_' + id] = false;
    const col = window['_mmtCol_' + id] !== false;
    return '<div class="mmt-sec">' + '<div class="mmt-sec-hdr" onclick="_mmtToggle(\'' + id + '\')">' + '<span style="font-size:14px">' + icon + '</span>' + '<span class="mmt-sec-label" style="color:' + color + '">' + label + '</span>' + '<span class="mmt-sec-badge">' + items.length + '</span>' + '<span class="mmt-sec-chev">' + (col ? '›' : '⌄') + '</span>' + '</div>' + (col ? '' : '<div>' + items.join('') + '</div>') + '</div>';
  };
  const totalShown = (showBuild ? buildItems.length : 0) + (showPending ? pendingItems.length : 0) + (showDepSched ? depositItems.length + scheduleItems.length : 0) + (showFinalPay ? finalPayItems.length : 0) + alertItems.length;
  const _feedSub = document.getElementById('dash-feed-sub');
  if (!totalShown) {
    const msg = _dashFeedFilter === 'all' ? 'You\'re caught up — nothing to chase right now.' : _dashFeedFilter === 'money' ? 'No deposits or scheduling needed.' : 'No follow-ups needed right now.';
    el.innerHTML = '<div style="padding:14px;font-size:13px;color:var(--text3)">' + msg + '</div>';
    if (_feedSub) _feedSub.textContent = 'all caught up';
    return;
  }
  if (_feedSub) {
    const parts = [];
    if (showBuild && buildItems.length) parts.push(buildItems.length + ' to build');
    if (showPending && pendingItems.length) parts.push(pendingItems.length + ' pending');
    if (showDepSched && depositItems.length + scheduleItems.length) parts.push(depositItems.length + scheduleItems.length + ' to deposit/schedule');
    if (showFinalPay && finalPayItems.length) parts.push(finalPayItems.length + ' to collect');
    _feedSub.textContent = parts.join(' · ') || 'all caught up';
  }
  el.innerHTML = (alertItems.length ? '<div>' + alertItems.join('') + '</div>' : '') + _sec('build', '✏️', 'Build', 'var(--text2)', buildItems, showBuild) + _sec('pending', '📨', 'Pending', '#7c3aed', pendingItems, showPending) + _sec('dep-sched', '💳', 'Deposit & Schedule', 'var(--blue)', [...depositItems, ...scheduleItems], showDepSched, true) + _sec('collect', '💰', 'Collect', '#A32D2D', finalPayItems, showFinalPay, true);
}
function checkGoalPrompt() {
  if (S.goalMonthly) return;
  if (window._goalPromptShownThisSession) return;
  const paidJobs = bids.filter(b => b.status === 'Closed Won' && getBidBalance(b) <= 0.01);
  if (paidJobs.length < 5) return;
  if (window._goalPromptShown) return;
  window._goalPromptShown = true;
  const avgVal = Math.round(paidJobs.reduce((s, b) => s + b.amount, 0) / paidJobs.length);
  setTimeout(() => {
    const overlay = document.createElement('div');
    overlay.className = 'zmodal-overlay';
    const box = document.createElement('div');
    box.className = 'zmodal';
    box.innerHTML = '<div style="font-size:22px;text-align:center;margin-bottom:8px">🎯</div>' + '<div class="zmodal-title" style="text-align:center">5 paid jobs — milestone!</div>' + '<div class="zmodal-msg" style="text-align:center">Your average job is ' + fmt(avgVal) + '. Set a monthly revenue goal and the app will track your progress and tell you exactly how many estimates you need.</div>' + '<div class="zmodal-btns" style="flex-direction:column;gap:8px">' + '<input type="number" id="goal-prompt-input" placeholder="Monthly goal e.g. 8000" min="0" step="500" ' + 'style="font-size:18px;font-weight:700;padding:12px;border-radius:var(--r);border:2px solid var(--blue);background:var(--bg2);color:var(--text);width:100%;box-sizing:border-box;text-align:center">' + '<button id="goal-prompt-set" class="btn btn-p" style="font-size:15px;padding:12px;width:100%">Set my goal</button>' + '<button id="goal-prompt-skip" class="btn" style="font-size:13px;padding:10px;width:100%;color:var(--text3)">Maybe later</button>' + '</div>';
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    document.getElementById('goal-prompt-set').onclick = () => {
      const val = parseFloat(document.getElementById('goal-prompt-input').value) || 0;
      if (!val) return;
      S.goalMonthly = val;
      saveAll();
      overlay.remove();
      renderDash();
    };
    document.getElementById('goal-prompt-skip').onclick = () => {
      window._goalPromptShownThisSession = true;
      overlay.remove();
    };
    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        window._goalPromptShownThisSession = true;
        overlay.remove();
      }
    });
  }, 800);
}
function renderGoal() {
  const el = document.getElementById('dash-goal');
  if (!el) return;
  const goal = S.goalMonthly || 0;
  const paidJobs = bids.filter(b => b.status === 'Closed Won' && getBidBalance(b) <= 0.01);
  if (!goal || paidJobs.length < 5) {
    el.innerHTML = '';
    return;
  }
  const now = new Date();
  const monthKey = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const monthInc = income.filter(i => i.date && i.date.startsWith(monthKey)).reduce((s, i) => s + i.amount, 0);
  const wonAll = bids.filter(b => b.status === 'Closed Won');
  const decidedAll = bids.filter(b => b.status === 'Closed Won' || b.status === 'Closed Lost' || b.status === 'Abandoned');
  const avgJobVal = wonAll.length >= 3 ? Math.round(wonAll.reduce((s, b) => s + b.amount, 0) / wonAll.length) : 0;
  const closeRate = decidedAll.length >= 5 ? wonAll.length / decidedAll.length : null;
  const pct = Math.min(100, Math.round(monthInc / goal * 100));
  const remaining = Math.max(0, goal - monthInc);
  const onTrack = monthInc >= goal * (now.getDate() / new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate());
  const barColor = pct >= 100 ? 'var(--green)' : pct >= 60 ? 'var(--blue)' : pct >= 30 ? 'var(--amber)' : '#A32D2D';
  let html = '<div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--rl);padding:14px 16px">' + '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">' + '<div style="font-size:12px;font-weight:700;color:var(--text2)">' + now.toLocaleString('default', {
    month: 'long'
  }) + ' goal</div>' + '<div style="font-size:12px;color:var(--text3)">' + fmt(monthInc) + ' of ' + fmt(goal) + '</div>' + '</div>' + '<div style="background:var(--border);border-radius:4px;height:10px;margin-bottom:8px;overflow:hidden">' + '<div style="height:100%;border-radius:4px;background:' + barColor + ';width:' + pct + '%;transition:width .3s"></div>' + '</div>' + '<div style="display:flex;justify-content:space-between;align-items:center">' + '<div style="font-size:13px;font-weight:700;color:' + barColor + '">' + (pct >= 100 ? '🎯 Goal hit!' : pct + '% — ' + fmt(remaining) + ' to go') + '</div>' + '<div style="font-size:11px;color:' + (onTrack ? 'var(--green-mid)' : 'var(--amber)') + '">' + (onTrack ? 'On track' : 'Behind pace') + '</div>' + '</div>';
  if (remaining > 0 && avgJobVal > 0 && closeRate !== null) {
    const jobsNeeded = Math.ceil(remaining / avgJobVal);
    const estsNeeded = Math.ceil(jobsNeeded / closeRate);
    html += '<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);display:grid;grid-template-columns:repeat(3,1fr);gap:8px;text-align:center">' + '<div><div style="font-size:18px;font-weight:800;color:var(--blue)">' + fmt(remaining) + '</div><div style="font-size:10px;color:var(--text3)">Still needed</div></div>' + '<div><div style="font-size:18px;font-weight:800">' + jobsNeeded + '</div><div style="font-size:10px;color:var(--text3)">Jobs to close</div></div>' + '<div><div style="font-size:18px;font-weight:800;color:var(--amber)">' + estsNeeded + '</div><div style="font-size:10px;color:var(--text3)">Estimates needed</div></div>' + '</div>' + '<div style="font-size:10px;color:var(--text3);margin-top:6px;text-align:center">Based on ' + fmt(avgJobVal) + ' avg job · ' + Math.round(closeRate * 100) + '% close rate</div>';
  } else if (remaining > 0 && decidedAll.length < 5) {
    html += '<div style="margin-top:8px;font-size:11px;color:var(--text3);text-align:center">Need ' + Math.max(0, 5 - decidedAll.length) + ' more decided bids to calculate estimates needed</div>';
  }
  html += '</div>';
  el.innerHTML = html;
}
function renderLeadSources() {
  const el = document.getElementById('dash-sources');
  if (!el) return;
  if (!clients.length) {
    el.innerHTML = '<div class="empty">No clients yet. Lead source tracking starts when you add your first client.</div>';
    return;
  }
  const PALETTE = ['#185FA5', '#63B841', '#D85A30', '#7F77DD', '#E89A3C', '#3BAABF', '#A32D2D', '#2C7A3A', '#8C8C8C'];
  const ICONS = {
    'Door to door': '🚪',
    'Door hanger': '📄',
    'Vehicle / truck wrap': '🚛',
    'Yard sign': '🪧',
    'Word of mouth': '💬',
    'Word of mouth (organic)': '💬',
    'Referral': '🤝',
    'Referral — someone sent them': '🤝',
    'Real estate agent': '🏡',
    'Property manager': '🏢',
    'Builder / contractor': '🔨',
    'Repeat customer': '🔄',
    'Google / online': '🔍',
    'Facebook': '📘',
    'Nextdoor': '🏘️',
    'Instagram': '📸',
    'Craigslist': '📋',
    'Church / community': '⛪',
    'Neighborhood event': '🎪',
    'Other': '📋',
    'No source set': '❓'
  };
  const sources = {};
  clients.forEach(c => {
    const src = c.source || 'No source set';
    if (!sources[src]) sources[src] = {
      leads: 0,
      won: 0,
      lost: 0,
      revenue: 0,
      color: ''
    };
    sources[src].leads++;
    const cb = getClientBids(c.id);
    const wonBids = cb.filter(b => b.status === 'Closed Won');
    if (wonBids.length) {
      sources[src].won++;
      sources[src].revenue += wonBids.reduce((s, b) => s + (b.amount || 0), 0);
    } else if (cb.some(b => b.status === 'Closed Lost' || b.status === 'Abandoned')) {
      sources[src].lost++;
    }
  });
  const rows = Object.entries(sources).sort((a, b) => b[1].revenue - a[1].revenue || b[1].leads - a[1].leads);
  rows.forEach(([src, d], i) => d.color = PALETTE[i % PALETTE.length]);
  const totalLeads = rows.reduce((s, [, d]) => s + d.leads, 0);
  if (!totalLeads) {
    el.innerHTML = '<div class="empty">Add a lead source when creating clients to track this.</div>';
    return;
  }

  // Aggregate marketing spend by lead source
  const mktCosts = {};
  expenses.filter(e => e.cat === 'marketing' && e.lead_source).forEach(e => {
    mktCosts[e.lead_source] = (mktCosts[e.lead_source] || 0) + e.amount;
  });
  const hasAnyROI = Object.keys(mktCosts).length > 0;
  const showAll = window._leadSrcExpanded;
  const visible = showAll ? rows : rows.slice(0, 6);
  const noSrc = clients.filter(c => !c.source).length;
  const tbodyRows = visible.map(([src, d]) => {
    const decided = d.won + d.lost;
    const cr = decided > 0 ? Math.round(d.won / decided * 100) : null;
    const crCls = cr === null ? '' : cr >= 40 ? ' green' : cr >= 25 ? '' : ' red';
    const crStr = cr !== null ? cr + '%' : '—';
    const cost = mktCosts[src] || 0;
    const roi = cost > 0 && d.revenue > 0 ? Math.round(d.revenue / cost * 10) / 10 : null;
    const roiStr = roi !== null ? roi + '×' : cost > 0 ? '0×' : '—';
    const roiCls = roi === null ? '' : roi >= 3 ? ' green' : roi >= 1 ? '' : ' red';
    return `<tr>
      <td style="font-weight:700">${ICONS[src] || '📋'} ${escHtml(src)}</td>
      <td class="num">${d.leads}</td>
      <td class="num">${d.won}</td>
      <td class="num${crCls}">${crStr}</td>
      <td class="num">${d.revenue > 0 ? fmtShort(d.revenue) : '—'}</td>
      ${hasAnyROI ? `<td class="num">${cost > 0 ? fmtShort(cost) : '—'}</td><td class="num${roiCls}">${roiStr}</td>` : ''}
    </tr>`;
  }).join('');
  const toggleBtn = rows.length > 6 ? showAll ? `<button onclick="window._leadSrcExpanded=false;renderLeadSources()" style="border:none;background:none;cursor:pointer;font-size:12px;color:var(--text3);padding:8px 0;display:block;width:100%;text-align:center">&#8963; Show less</button>` : `<button onclick="window._leadSrcExpanded=true;renderLeadSources()" style="border:none;background:none;cursor:pointer;font-size:12px;color:var(--blue);padding:8px 0;font-weight:700;display:block;width:100%;text-align:center">&#8964; Show all ${rows.length - 6} more</button>` : '';
  const noSrcNote = noSrc ? `<div style="font-size:11px;color:var(--text3);padding:8px 18px 4px">${noSrc} client${noSrc > 1 ? 's' : ''} with no source set</div>` : '';
  const roiHint = !hasAnyROI ? `<div style="font-size:11px;color:var(--text3);padding:6px 18px 10px">💡 Log an <strong>Advertising &amp; marketing</strong> expense to see Cost &amp; ROI columns</div>` : '';
  el.innerHTML = `<div style="overflow-x:auto"><table class="tbl">
    <thead><tr>
      <th>Source</th>
      <th style="text-align:right">Leads</th>
      <th style="text-align:right">Won</th>
      <th style="text-align:right">Close %</th>
      <th style="text-align:right">Revenue</th>
      ${hasAnyROI ? '<th style="text-align:right">Cost</th><th style="text-align:right">ROI</th>' : ''}
    </tr></thead>
    <tbody>${tbodyRows}</tbody>
  </table></div>
  ${toggleBtn}${noSrcNote}${roiHint}`;
}
function closeSourceDetail() {
  const el = document.getElementById('source-detail');
  if (el) el.style.display = 'none';
}
function showSourceDetail(src) {
  const el = document.getElementById('source-detail');
  if (!el) return;
  const ICONS = {
    'Door to door': '🚪',
    'Door hanger': '📄',
    'Vehicle / truck wrap': '🚛',
    'Yard sign': '🪧',
    'Word of mouth': '💬',
    'Word of mouth (organic)': '💬',
    'Referral': '🤝',
    'Referral — someone sent them': '🤝',
    'Real estate agent': '🏡',
    'Property manager': '🏢',
    'Builder / contractor': '🔨',
    'Repeat customer': '🔄',
    'Google / online': '🔍',
    'Facebook': '📘',
    'Nextdoor': '🏘️',
    'Instagram': '📸',
    'Craigslist': '📋',
    'Church / community': '⛪',
    'Neighborhood event': '🎪',
    'Other': '📋',
    'No source set': '❓'
  };
  const srcClients = clients.filter(c => (c.source || 'Unknown') === src);
  let won = 0,
    lost = 0,
    revenue = 0,
    pending = 0;
  srcClients.forEach(c => {
    const cb = getClientBids(c.id);
    const wonBids = cb.filter(b => b.status === 'Closed Won');
    if (wonBids.length) {
      won++;
      revenue += wonBids.reduce((s, b) => s + (b.amount || 0), 0);
    } else if (cb.some(b => b.status === 'Closed Lost' || b.status === 'Abandoned')) {
      lost++;
    }
    if (cb.some(b => b.status === 'Pending')) pending++;
  });
  const decided = won + lost;
  const cr = decided > 0 ? Math.round(won / decided * 100) : null;
  const crColor = cr === null ? 'var(--text3)' : cr >= 40 ? 'var(--green-mid)' : cr >= 25 ? 'var(--amber)' : '#A32D2D';
  const avgVal = won > 0 ? fmt(Math.round(revenue / won)) : '—';
  el.style.display = 'block';
  el.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' + '<div style="font-size:13px;font-weight:700">' + (ICONS[src] || '📋') + ' ' + src + '</div>' + '<button onclick="closeSourceDetail()" style="border:none;background:none;font-size:16px;cursor:pointer;color:var(--text3)">&#10005;</button>' + '</div>' + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;text-align:center">' + '<div><div style="font-size:20px;font-weight:800">' + srcClients.length + '</div><div style="font-size:10px;color:var(--text3)">Leads</div></div>' + '<div><div style="font-size:20px;font-weight:800;color:' + crColor + '">' + (cr !== null ? cr + '%' : '—') + '</div><div style="font-size:10px;color:var(--text3)">Close rate</div></div>' + '<div><div style="font-size:20px;font-weight:800;color:var(--green-mid)">' + (revenue > 0 ? fmt(revenue) : '—') + '</div><div style="font-size:10px;color:var(--text3)">Revenue</div></div>' + '<div><div style="font-size:20px;font-weight:800">' + avgVal + '</div><div style="font-size:10px;color:var(--text3)">Avg job</div></div>' + '</div>' + (pending > 0 ? '<div style="font-size:11px;color:var(--amber);margin-top:8px;text-align:center">' + pending + ' pending bid' + (pending > 1 ? 's' : '') + ' — not yet counted in close rate</div>' : '');
}
const CLOSE_RATE = 0.60; // 60% industry avg for professional solo painter in Kansas

function renderPipeline() {
  const el = document.getElementById('dash-pipeline');
  if (!el) return;
  const tk = todayKey();
  function weekMonday(dateStr) {
    const d = parseD(dateStr),
      dow = d.getDay(),
      diff = dow === 0 ? -6 : 1 - dow;
    d.setDate(d.getDate() + diff);
    return dateKey(d);
  }
  function paintDaysInWeek(monday) {
    let n = 0;
    for (let i = 0; i < 5; i++) {
      const day = addDays(monday, i);
      const hasJob = jobs.some(j => j.eventType !== 'estimate' && parseInt(j.days) >= 1 && (() => {
        const d = parseInt(j.days) || 1;
        for (let k = 0; k < d; k++) if (addDays(j.start, k) === day) return true;
        return false;
      })());
      if (hasJob) n++;
    }
    return n;
  }
  const thisMonday = weekMonday(tk);
  const nextMonday = addDays(thisMonday, 7);
  const weekAfterMonday = addDays(thisMonday, 14);
  const w1paint = paintDaysInWeek(thisMonday);
  const w2paint = paintDaysInWeek(nextMonday);
  const w3paint = paintDaysInWeek(weekAfterMonday);
  const totalWorkDays = 5;
  const openDaysAhead = totalWorkDays - w2paint + (totalWorkDays - w3paint);
  const avgJobDays = 3;
  const estimatesNeeded = Math.ceil(openDaysAhead / avgJobDays / CLOSE_RATE);
  function weekBar(booked, total, color) {
    const filled = Math.round(booked / total * 5);
    let bar = '';
    for (let i = 0; i < 5; i++) bar += '<div style="flex:1;height:10px;border-radius:2px;background:' + (i < filled ? color : 'var(--border)') + ';margin:0 1px"></div>';
    return '<div style="display:flex;gap:0;margin-bottom:3px">' + bar + '</div>';
  }
  function statusLabel(booked) {
    if (booked >= 4) return {
      t: 'Booked',
      c: 'var(--green-mid)'
    };
    if (booked >= 2) return {
      t: 'Partial',
      c: 'var(--amber)'
    };
    return {
      t: 'Open',
      c: 'var(--red)'
    };
  }
  const w1s = statusLabel(w1paint),
    w2s = statusLabel(w2paint),
    w3s = statusLabel(w3paint);
  let healthColor,
    healthMsg,
    action = '';
  if (w2paint >= 4 && w3paint >= 4) {
    healthColor = 'var(--green-mid)';
    healthMsg = 'Pipeline full — focus on the work.';
  } else if (w2paint >= 2 || w3paint >= 2) {
    healthColor = 'var(--amber)';
    healthMsg = 'Pipeline needs attention.';
    action = estimatesNeeded > 0 ? 'Run <strong>' + estimatesNeeded + ' estimate' + (estimatesNeeded > 1 ? 's' : '') + ' this week</strong> to fill open days.' : '';
  } else {
    healthColor = '#A32D2D';
    healthMsg = 'Pipeline is thin — book estimates now.';
    action = 'You need <strong>' + estimatesNeeded + ' estimate' + (estimatesNeeded > 1 ? 's' : '') + ' this week</strong> to stay booked. Best days: Tuesday + Thursday evening.';
  }
  const w1label = parseD(thisMonday).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });
  const w2label = parseD(nextMonday).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });
  const w3label = parseD(weekAfterMonday).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });
  el.innerHTML = '<div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--rl);padding:14px;margin-bottom:10px">' + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' + '<div style="font-size:13px;font-weight:700;color:var(--text)">Pipeline</div>' + '<div style="font-size:11px;font-weight:700;color:' + healthColor + '">' + healthMsg + '</div>' + '</div>' + '<div style="display:grid;grid-template-columns:60px 1fr auto;gap:6px 10px;align-items:center;margin-bottom:10px">' + '<div style="font-size:10px;color:var(--text3)">This week</div>' + '<div>' + weekBar(w1paint, 5, w1s.c) + '</div>' + '<div style="font-size:10px;font-weight:700;color:' + w1s.c + ';white-space:nowrap">' + w1paint + '/5 days</div>' + '<div style="font-size:10px;color:var(--text3)">' + w2label + '</div>' + '<div>' + weekBar(w2paint, 5, w2s.c) + '</div>' + '<div style="font-size:10px;font-weight:700;color:' + w2s.c + ';white-space:nowrap">' + w2paint + '/5 days</div>' + '<div style="font-size:10px;color:var(--text3)">' + w3label + '</div>' + '<div>' + weekBar(w3paint, 5, w3s.c) + '</div>' + '<div style="font-size:10px;font-weight:700;color:' + w3s.c + ';white-space:nowrap">' + w3paint + '/5 days</div>' + '</div>' + (action ? '<div style="font-size:12px;color:var(--text2);line-height:1.6">' + action + '</div>' : '') + '</div>';
}
function renderLeadsPage() {
  const el = document.getElementById('leads-list');
  if (!el) return;
  const LEAD_STAGES = ['incomplete', 'new', 'est_scheduled', 'est_ready', 'bid_out', 'bid_urgent', 'abandoned'];
  const filterToStages = {
    all: LEAD_STAGES,
    incomplete: ['incomplete'],
    new: ['new'],
    estimate: ['est_scheduled'],
    follow_up: ['bid_urgent', 'abandoned'],
    pending: ['est_ready', 'bid_out']
  };
  const allowed = filterToStages[leadFilter] || LEAD_STAGES;
  const filtered = clients.filter(c => {
    const s = getClientStage(c.id).stage;
    return allowed.includes(s);
  }).sort((a, b) => {
    const pa = getClientStage(a.id).priority || 9,
      pb = getClientStage(b.id).priority || 9;
    return pa - pb;
  });
  // Update leads badge
  const allLeadClients = clients.filter(c => LEAD_STAGES.includes(getClientStage(c.id).stage));
  const badge = document.getElementById('nb-leads-badge');
  if (badge) {
    const fu = allLeadClients.filter(c => {
      const s = getClientStage(c.id);
      return s.stage === 'follow_up' || s.stage === 'bid_urgent';
    });
    badge.textContent = fu.length || '';
    badge.style.display = fu.length ? '' : 'none';
  }
  // Update tbar eyebrow
  const leadsEyebrow = document.getElementById('leads-tbar-eyebrow');
  if (leadsEyebrow) {
    const allLeadCount = clients.filter(c => LEAD_STAGES.includes(getClientStage(c.id).stage)).length;
    const fuCount = clients.filter(c => {
      const s = getClientStage(c.id).stage;
      return s === 'bid_urgent' || s === 'abandoned';
    }).length;
    leadsEyebrow.textContent = allLeadCount + ' lead' + (allLeadCount !== 1 ? 's' : '' + (fuCount ? ' · ' + fuCount + ' need follow-up' : ''));
  }
  if (!filtered.length) {
    el.innerHTML = _inboundReviewHTML() + '<div class="empty"><div class="em-emoji">🎯</div><h3>No ' + (leadFilter === 'all' ? 'active leads' : leadFilter.replace('_', ' ')) + ' right now</h3><p>Add a lead above to start tracking prospects.</p></div>';
    return;
  }
  const stgBdgMap = {
    incomplete: {
      cls: 'sf-pending',
      label: 'NEEDS SETUP'
    },
    new: {
      cls: 'sf-new',
      label: 'NEW LEAD'
    },
    est_scheduled: {
      cls: 'sf-upcoming',
      label: 'EST BOOKED'
    },
    est_ready: {
      cls: 'sf-deposit',
      label: 'EST READY'
    },
    bid_out: {
      cls: 'sf-pending',
      label: 'BID OUT'
    },
    bid_urgent: {
      cls: 'sf-overdue',
      label: 'FOLLOW UP'
    },
    abandoned: {
      cls: 'sf-done',
      label: 'COLD'
    }
  };
  el.innerHTML = _inboundReviewHTML() + filtered.map(c => {
    const st = getClientStage(c.id);
    const pendBids = getClientBids(c.id).filter(b => b.status === 'Pending');
    const bidAmtDisplay = pendBids.length > 1 ? pendBids.length + ' bids out' : pendBids.length === 1 ? fmtShort(pendBids[0].amount) : '';
    const addrLine = c.addr ? c.addr.split(',')[0] : 'No address yet';
    const addrColor = c.addr ? '' : 'color:var(--c-amber)';
    const sbdg = stgBdgMap[st.stage] || {
      cls: 'sf-done',
      label: st.label.toUpperCase()
    };
    const daysSince = c.created ? Math.floor((new Date() - new Date(c.created + 'T12:00')) / 86400000) : 0;
    return '<div class="client-card" data-lp-id="' + c.id + '" data-lp-type="lead" data-lp-label="' + escHtml(c.name || 'lead') + '" onclick="openClientDetail(' + c.id + ',\'leads\')" style="margin-bottom:8px">' + '<div class="cc-row">' + '<div class="cc-l">' + '<div class="cc-avatar">' + initials(c.name) + '</div>' + '<div style="min-width:0;flex:1">' + '<div class="cc-name">' + escHtml(c.name) + '</div>' + '<div class="cc-meta" style="' + addrColor + '">' + escHtml(addrLine) + '</div>' + '<div class="cc-stats">' + (c.source ? '<span class="cc-stat">' + escHtml(c.source) + '</span>' : '') + (bidAmtDisplay ? '<span class="cc-stat">' + bidAmtDisplay + '</span>' : '') + '</div>' + '</div>' + '</div>' + '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">' + '<span class="bdg-soft ' + sbdg.cls + '">' + sbdg.label + '</span>' + (daysSince > 0 ? '<span style="font-size:10px;color:var(--text3);font-weight:600">' + daysSince + 'd</span>' : '') + '</div>' + '</div>' + '</div>';
  }).join('');
}

// ── Proposals page ───────────────────────────────────────────────────────
function _pfToggleYr(yr) {
  window['_pfYr_' + yr] = window['_pfYr_' + yr] !== true;
  renderProposalsPage();
}
function _pfToggleMo(yr, mo) {
  window['_pfMo_' + yr + '_' + mo] = window['_pfMo_' + yr + '_' + mo] !== true;
  renderProposalsPage();
}

// Standalone bid detail popup — opens from proposals page or anywhere
function openBidDetail(bidId, view) {
  view = view || 'bid';
  const b = bids.find(x => x.id === bidId);
  if (!b) return;
  document.querySelector('[data-bdov]')?.remove();
  const ov = document.createElement('div');
  ov.setAttribute('data-bdov', '1');
  ov.style.cssText = 'position:fixed;inset:0;background:var(--bg);z-index:10001;overflow-y:auto;-webkit-overflow-scrolling:touch';
  const c = getClientById(b.client_id) || {
    name: b.client_name || b.name || ''
  };
  const dateStr = b.signedAt ? new Date(b.signedAt).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }) : b.bid_date || '';
  function _tabBtn(v, label, active) {
    return '<button id="bdd-tab-' + v + '" onclick="_bddView(\'' + v + '\')" style="padding:7px 16px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;border:1.5px solid ' + (active ? 'var(--blue)' : 'var(--border2)') + ';background:' + (active ? 'var(--blue-lt)' : 'var(--bg)') + ';color:' + (active ? 'var(--blue-dk)' : 'var(--text2)') + '">' + label + '</button>';
  }
  ov.innerHTML = '<div style="position:sticky;top:0;background:var(--bg);border-bottom:2px solid var(--border);padding:10px 14px;display:flex;align-items:center;gap:10px;z-index:2">' + '<button onclick="document.querySelector(\'[data-bdov]\').remove()" style="padding:7px 12px;border-radius:8px;border:1.5px solid var(--border2);background:var(--bg2);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;color:var(--text);white-space:nowrap">✕ Close</button>' + '<div id="bdd-tabs" style="display:flex;gap:6px;flex:1;justify-content:center">' + _tabBtn('bid', '📋 Our bid', view === 'bid') + _tabBtn('proposal', '📄 Client view', view === 'proposal') + '</div>' + '<div style="width:70px"></div>' + '</div>' + '<div style="padding:14px 16px;background:#1a365d;color:#fff">' + '<div style="font-size:12px;opacity:.7;font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">' + escHtml(c.name) + '</div>' + '<div style="font-size:17px;font-weight:800">' + escHtml(b.type || b.trade_type || 'Proposal') + '</div>' + (b.addr ? '<div style="font-size:12px;opacity:.7;margin-top:2px">' + escHtml(b.addr) + '</div>' : '') + '<div style="font-size:12px;opacity:.7;margin-top:4px">' + (dateStr ? 'Signed ' + dateStr + ' · ' : '') + fmt(b.amount) + '</div>' + '</div>' + '<div id="bdd-bid-pane" style="padding:16px;max-width:680px;margin:0 auto"></div>' + '<div id="bdd-proposal-pane" style="padding:16px;max-width:680px;margin:0 auto;display:none"></div>';
  document.body.appendChild(ov);

  // Bid pane — internal contractor details
  const pays = getBidPayments(bidId);
  const paid = getBidPaid(bidId);
  const PAINT = {
    'std': 'Standard (Behr/Valspar)',
    'prem': 'Sherwin-Williams Premium',
    'ultra': 'SW Emerald Ultra'
  };
  const COND = {
    '1.0': 'Good — minor prep',
    '1.2': 'Fair — moderate prep',
    '1.5': 'Poor — heavy prep'
  };
  const surfs = b.surfaces || [];
  const scope = b.scope ? Object.entries(b.scope).filter(([, v]) => v).map(([k]) => {
    const s = typeof SCOPE_ITEMS !== 'undefined' ? SCOPE_ITEMS.find(x => x.id === k) : null;
    return s ? s.label : k;
  }) : [];
  const SURF = {
    'walls': 'Walls',
    'ceiling': 'Ceiling',
    'trim': 'Trim',
    'doors': 'Doors',
    'windows': 'Windows',
    'cabinets': 'Cabinets',
    'ext_walls': 'Siding',
    'ext_trim': 'Ext trim',
    'deck': 'Deck',
    'fence': 'Fence',
    'epoxy': 'Epoxy floor'
  };
  let bidHTML = '';
  if (b.geiLines && b.geiLines.length) {
    bidHTML += '<div class="card" style="margin-bottom:12px"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:10px">Line items</div>' + b.geiLines.map(l => '<div style="display:flex;justify-content:space-between;align-items:baseline;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px"><span style="flex:1;padding-right:12px">' + escHtml(l.desc || l.name || '') + '</span><span style="font-weight:700;color:var(--green-mid);white-space:nowrap">' + fmt(l.total || l.amount || 0) + '</span></div>').join('') + '<div style="display:flex;justify-content:space-between;padding:10px 0 0;font-size:15px;font-weight:800"><span>Total</span><span style="color:var(--green-mid)">' + fmt(b.amount) + '</span></div>' + '</div>';
  } else if (surfs.length) {
    bidHTML += '<div class="card" style="margin-bottom:12px"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:10px">Surfaces</div>' + surfs.map(s => '<div style="display:flex;justify-content:space-between;font-size:13px;padding:5px 0;border-bottom:1px solid var(--border)"><span>' + (SURF[s.type] || s.type) + (s.room ? ' · ' + escHtml(s.room) : '') + '</span><span style="color:var(--text2)">' + ((s.qty || s.sqft || 0) + ' ' + (s.unit || 'sqft')) + '</span></div>').join('') + '</div>';
    if (b.paint || b.condition) bidHTML += '<div class="card" style="margin-bottom:12px"><div style="font-size:12px;color:var(--text2);margin-bottom:6px"><strong>Paint:</strong> ' + (PAINT[b.paint] || b.paint || '—') + '</div><div style="font-size:12px;color:var(--text2)"><strong>Condition:</strong> ' + (COND[b.condition] || b.condition || '—') + '</div></div>';
    if (scope.length) bidHTML += '<div class="card" style="margin-bottom:12px"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:8px">Scope of work</div>' + scope.map(s => '<div style="font-size:13px;padding:4px 0;border-bottom:1px solid var(--border)">' + escHtml(s) + '</div>').join('') + '</div>';
  } else {
    bidHTML += '<div class="card" style="margin-bottom:12px"><div style="font-size:13px;color:var(--text3);text-align:center;padding:12px 0;font-style:italic">No line items or surfaces stored for this bid.</div></div>';
  }
  if (b.notes) bidHTML += '<div class="card" style="margin-bottom:12px"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:6px">Notes</div><div style="font-size:13px;color:var(--text2);line-height:1.6">' + escHtml(b.notes) + '</div></div>';
  if (pays.length) {
    bidHTML += '<div class="card" style="margin-bottom:12px"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:8px">Payment history</div>' + pays.map(p => {
      const ref = p.type === 'refund';
      return '<div style="display:flex;justify-content:space-between;font-size:12px;padding:5px 0;border-bottom:1px solid var(--border)"><span style="color:var(--text2)">' + p.date + ' · ' + (ref ? 'REFUND' : (p.method || p.type) + (p.ref ? ' #' + p.ref : '')) + '</span><span style="font-weight:700;color:' + (ref ? '#A32D2D' : 'var(--green-mid)') + '">' + (ref ? '↩ -' : '+') + fmt(Math.abs(p.amount)) + '</span></div>';
    }).join('') + '<div style="display:flex;justify-content:space-between;font-size:14px;font-weight:800;padding:8px 0 0"><span>Total paid</span><span style="color:var(--green-mid)">' + fmt(paid) + '</span></div>' + '</div>';
  }
  bidHTML += '<div style="height:24px"></div>';
  document.getElementById('bdd-bid-pane').innerHTML = bidHTML || '<div style="padding:20px;text-align:center;color:var(--text3)">No details stored.</div>';

  // Proposal pane — what the client received
  const propPane = document.getElementById('bdd-proposal-pane');
  const storageKey = b.signingKey || b.proposalKey || null;
  const signedBadge = b.signedAt ? '<div style="background:#D1FAE5;border:1px solid #6EE7B7;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:12px;color:#065F46;display:flex;align-items:center;gap:8px"><span style="font-size:16px">✓</span><span><strong>Signed</strong> ' + new Date(b.signedAt).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }) + (b.signedName ? ' by ' + escHtml(b.signedName) : '') + '</span></div>' : '';
  function _renderPropHTML(html, extraTop) {
    propPane.innerHTML = (extraTop || '') + signedBadge + html;
  }
  if (b.proposalHtml) {
    _renderPropHTML(b.proposalHtml);
  } else if (storageKey && typeof _supa !== 'undefined') {
    propPane.innerHTML = '<div style="padding:40px 16px;text-align:center;color:var(--text3);font-size:13px">Loading proposal…</div>';
    _supa.storage.from('proposals').download(storageKey).then(({
      data,
      error
    }) => {
      if (error || !data) {
        propPane.innerHTML = '<div style="padding:40px 16px;text-align:center;color:var(--text3);font-size:13px;font-style:italic">Could not load proposal from storage.</div>';
        return;
      }
      data.text().then(txt => {
        try {
          const prop = JSON.parse(txt);
          const html = prop.proposalHtml || '';
          if (!html) {
            propPane.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text3);font-style:italic">No HTML found in stored proposal.</div>';
            return;
          }
          // Cache it on the bid so future opens are instant
          b.proposalHtml = html;
          let colorTop = '';
          const choices = prop.colorChoices || [];
          if (choices.length) colorTop = '<div style="background:#EFF6FF;border:1.5px solid #BFDBFE;border-radius:10px;padding:14px 16px;margin-bottom:16px"><div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#1E40AF;margin-bottom:10px">🎨 Client Color Selections</div>' + choices.map(ch => '<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #DBEAFE;font-size:13px"><span style="font-weight:600;color:#1E3A5F">' + escHtml(ch.room) + '</span><span style="color:#1E40AF;font-weight:700">' + escHtml(ch.colorName) + (ch.swCode ? ' <span style="font-size:11px;opacity:.7">(' + escHtml(ch.swCode) + ')</span>' : '') + '</span></div>').join('') + '</div>';
          _renderPropHTML(html, colorTop);
        } catch (e) {
          propPane.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text3);font-style:italic">Error parsing proposal.</div>';
        }
      });
    }).catch(() => {
      propPane.innerHTML = '<div style="padding:40px 16px;text-align:center;color:var(--text3);font-size:13px;font-style:italic">Could not load proposal.</div>';
    });
  } else {
    propPane.innerHTML = '<div style="padding:40px 16px;text-align:center;color:var(--text3);font-size:14px;font-style:italic">No proposal on file for this bid.</div>';
  }
  _bddView(view);
}
function _bddView(v) {
  ['bid', 'proposal'].forEach(x => {
    const pane = document.getElementById('bdd-' + x + '-pane');
    const tab = document.getElementById('bdd-tab-' + x);
    if (pane) pane.style.display = x === v ? '' : 'none';
    if (tab) {
      const a = x === v;
      tab.style.borderColor = a ? 'var(--blue)' : 'var(--border2)';
      tab.style.background = a ? 'var(--blue-lt)' : 'var(--bg)';
      tab.style.color = a ? 'var(--blue-dk)' : 'var(--text2)';
    }
  });
}
let _proposalFilter = 'all';
function setProposalFilter(f, btn) {
  _proposalFilter = f;
  document.querySelectorAll('#pg-proposals .fb').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderProposalsPage();
}
function renderProposalsPage() {
  const allBids = bids.filter(b => b.id);
  const sentBids = allBids.filter(b => b.signingToken);
  const draftBids = allBids.filter(b => !b.signingToken && (b.draft || b.status === 'Draft' || b.status === 'Pending'));
  const signed = sentBids.filter(b => b.status === 'Closed Won');
  const awaiting = sentBids.filter(b => b.status === 'Pending' || b.status === 'Draft');
  const declined = sentBids.filter(b => b.status === 'Closed Lost' || b.status === 'Abandoned');
  const counts = {
    all: allBids.length,
    draft: draftBids.length,
    awaiting_sig: awaiting.length,
    signed: signed.length,
    declined: declined.length
  };
  ['all', 'draft', 'awaiting_sig', 'signed', 'declined'].forEach(k => {
    const el = document.getElementById('pft-c-' + k);
    if (el) {
      el.textContent = counts[k] || '';
      el.style.display = counts[k] ? '' : 'none';
    }
  });
  const closeRate = sentBids.length ? Math.round(signed.length / sentBids.length * 100) : 0;
  const eyebrow = document.getElementById('proposals-eyebrow');
  if (eyebrow) eyebrow.textContent = sentBids.length + ' sent · ' + closeRate + '% close rate';
  const totalSent = sentBids.reduce((s, b) => s + (b.amount || 0), 0);
  const signedAmt = signed.reduce((s, b) => s + (b.amount || 0), 0);
  const awaitingAmt = awaiting.reduce((s, b) => s + (b.amount || 0), 0);
  const mets = document.getElementById('proposals-mets');
  if (mets) mets.innerHTML = '<div class="met"><div class="met-l">Sent</div><div class="met-v">' + fmt(totalSent) + '</div><div class="met-s">' + sentBids.length + ' proposals</div></div>' + '<div class="met"><div class="met-l">Signed</div><div class="met-v" style="color:var(--green)">' + fmt(signedAmt) + '</div><div class="met-s up">' + signed.length + ' clients</div></div>' + '<div class="met"><div class="met-l">Awaiting sig</div><div class="met-v" style="color:var(--amber)">' + fmt(awaitingAmt) + '</div><div class="met-s">' + awaiting.length + ' clients</div></div>' + '<div class="met"><div class="met-l">Close rate</div><div class="met-v">' + closeRate + '<span class="unit">%</span></div><div class="met-s">of sent</div></div>';
  const f = _proposalFilter;
  const filtered = f === 'all' ? allBids : f === 'draft' ? draftBids : f === 'signed' ? signed : f === 'awaiting_sig' ? awaiting : declined;
  const list = document.getElementById('proposals-list');
  if (!list) return;
  if (!filtered.length) {
    list.innerHTML = '<div class="empty"><div class="em-emoji">📨</div><h3>Nothing here</h3><p>Try a different filter, or start a new estimate from a client card.</p></div>';
    return;
  }

  // Signed tab — year/month accordion with proposal detail cards
  if (f === 'signed') {
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const SHORT_MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const byYear = {};
    const sortedSigned = [...filtered].map(b => {
      const dk = b.signedAt ? new Date(b.signedAt).toISOString().slice(0, 10) : b.completion_date || b.bid_date || '';
      return {
        ...b,
        _dk: dk
      };
    }).sort((a, b) => b._dk.localeCompare(a._dk));
    sortedSigned.forEach(b => {
      const yr = b._dk.slice(0, 4) || '—';
      const mo = b._dk.slice(0, 7) || '—';
      if (!byYear[yr]) byYear[yr] = {};
      if (!byYear[yr][mo]) byYear[yr][mo] = [];
      byYear[yr][mo].push(b);
    });
    const years = Object.keys(byYear).sort((a, b) => b.localeCompare(a));
    if (years.length) {
      const ry = years[0];
      if (window['_pfYr_' + ry] === undefined) window['_pfYr_' + ry] = true;
      const rmos = Object.keys(byYear[ry]).sort((a, b) => b.localeCompare(a));
      if (rmos.length && window['_pfMo_' + ry + '_' + rmos[0]] === undefined) window['_pfMo_' + ry + '_' + rmos[0]] = true;
    }
    function _pfCard(b) {
      const c = getClientById(b.client_id) || {
        name: b.client_name || b.name || 'Unknown'
      };
      const dateStr = b.signedAt ? new Date(b.signedAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }) : b._dk || '';
      const proj = b.addr || b.type || b.trade_type || 'Proposal';
      return '<div class="card" style="margin:0 0 10px;border-radius:12px">' + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">' + '<div style="flex:1;min-width:0">' + '<div style="font-size:15px;font-weight:800">' + escHtml(c.name) + '</div>' + '<div style="font-size:11px;color:var(--text3);margin-top:2px">' + escHtml((proj + '').split(',')[0]) + '</div>' + '<div style="font-size:11px;color:var(--green-mid);font-weight:600;margin-top:3px">✓ Signed ' + dateStr + (b.signedName ? ' · ' + escHtml(b.signedName) : '') + '</div>' + '</div>' + '<div style="font-size:18px;font-weight:800;color:var(--green-mid);margin-left:12px;flex-shrink:0">' + fmt(b.amount) + '</div>' + '</div>' + '<div style="display:flex;gap:8px">' + '<button onclick="openBidDetail(' + b.id + ',\'bid\')" class="btn btn-sm" style="flex:1;justify-content:center;font-size:12px;font-weight:700">📋 Our bid</button>' + (b.proposalHtml ? '<button onclick="openBidDetail(' + b.id + ',\'proposal\')" class="btn btn-sm" style="flex:1;justify-content:center;font-size:12px;font-weight:700;background:var(--blue-lt);color:var(--blue-dk);border-color:var(--blue)">📄 Client view</button>' : '<span style="flex:1;font-size:11px;color:var(--text3);display:flex;align-items:center;justify-content:center;font-style:italic">No proposal saved</span>') + '</div>' + '</div>';
    }
    const accHTML = years.map(yr => {
      const yrOpen = window['_pfYr_' + yr] === true;
      const yrBids = Object.values(byYear[yr]).flat();
      const months = Object.keys(byYear[yr]).sort((a, b) => b.localeCompare(a));
      const moHTML = yrOpen ? months.map(mo => {
        const moOpen = window['_pfMo_' + yr + '_' + mo] === true;
        const moBids = byYear[yr][mo];
        const moIdx = parseInt(mo.slice(5)) - 1;
        return '<div style="border-top:1px solid var(--border)">' + '<div onclick="_pfToggleMo(\'' + yr + '\',\'' + mo + '\')" style="display:flex;align-items:center;gap:8px;padding:10px 16px 10px 28px;cursor:pointer;-webkit-user-select:none;user-select:none">' + '<span style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;flex:1;color:var(--text2)">' + SHORT_MO[moIdx] + '</span>' + '<span style="font-size:11px;font-weight:700;background:var(--border2);border-radius:10px;padding:1px 8px;color:var(--text2)">' + moBids.length + '</span>' + '<span style="font-size:13px;color:var(--text3);width:14px;text-align:center">' + (moOpen ? '⌄' : '›') + '</span>' + '</div>' + (moOpen ? '<div style="padding:4px 14px 14px">' + moBids.map(_pfCard).join('') + '</div>' : '') + '</div>';
      }).join('') : '';
      return '<div style="border-top:1px solid var(--line);background:var(--bg)">' + '<div onclick="_pfToggleYr(\'' + yr + '\')" style="display:flex;align-items:center;gap:10px;padding:14px 16px;cursor:pointer;-webkit-user-select:none;user-select:none;background:var(--cream)">' + '<span style="font-size:16px;font-weight:800;flex:1">' + yr + '</span>' + '<span style="font-size:12px;font-weight:700;background:var(--border2);border-radius:10px;padding:2px 10px;color:var(--text2)">' + yrBids.length + ' proposal' + (yrBids.length !== 1 ? 's' : '') + '</span>' + '<span style="font-size:14px;color:var(--text3);width:14px;text-align:center">' + (yrOpen ? '⌄' : '›') + '</span>' + '</div>' + moHTML + '</div>';
    }).join('');
    list.innerHTML = accHTML || '<div class="empty">No signed proposals.</div>';
    return;
  }

  // All other tabs — flat table
  const statusChip = b => {
    if (b.status === 'Closed Won') return '<span class="bdg-soft sf-won">SIGNED</span>';
    if (b.status === 'Closed Lost' || b.status === 'Abandoned') return '<span class="bdg-soft sf-lost">DECLINED</span>';
    if (b.draft || b.status === 'Draft') return '<span class="bdg-soft sf-done">DRAFT</span>';
    if (b.signingToken) return '<span class="bdg-soft sf-pending">AWAITING SIG</span>';
    return '<span class="bdg-soft sf-done">PENDING</span>';
  };
  const typeChip = b => {
    if (b.isTM) return '<span style="font-size:9px;color:var(--text3);font-weight:700">⏱️ T&M · </span>';
    if (b.geiLines !== undefined) return '<span style="font-size:9px;color:var(--text3);font-weight:700">BYO · </span>';
    return '';
  };
  const rows = filtered.map(b => {
    const c = getClientById(b.client_id) || {
      name: b.client_name || b.name || 'Unknown'
    };
    const proj = b.addr || b.type || '—';
    const deposit = b.status === 'Closed Won' && b.deposit ? '<div style="font-size:10px;color:var(--green);font-weight:700;margin-top:2px">Deposit ' + fmt(b.deposit) + ' received</div>' : '';
    const amt = b.isTM && b.tmNteCap ? '~' + fmt(b.amount) + ' NTE ' + fmt(b.tmNteCap) : b.amount ? fmt(b.amount) : '—';
    const revFn = b.status === 'Closed Won' ? 'openBidDetail(' + b.id + ',\'bid\')' : b.geiLines !== undefined ? 'openGenericEstimate(getClientById(' + b.client_id + '),' + b.id + ',\'' + escHtml(b.trade_type || 'general') + '\')' : 'openEditBid(' + b.id + ')';
    return '<tr style="cursor:pointer" onclick="' + revFn + '">' + '<td><div style="font-weight:800">' + escHtml(c.name) + '</div>' + '<div style="font-size:10px;color:var(--text3);font-weight:500;margin-top:2px">' + typeChip(b) + escHtml((proj + '').split(',')[0]) + '</div>' + deposit + '</td>' + '<td>' + statusChip(b) + '</td>' + '<td class="muted">' + escHtml(b.bid_date || '') + '</td>' + '<td class="num">' + amt + '</td>' + '<td style="text-align:right"><button class="btn btn-sm btn-p" onclick="event.stopPropagation();' + revFn + '">Open →</button></td>' + '</tr>';
  }).join('');
  list.innerHTML = '<div class="card card-pad-0" style="overflow:hidden">' + '<div class="card-hd"><div class="card-hd-title">Proposals</div></div>' + '<table class="tbl"><thead><tr><th>Client &amp; project</th><th>Status</th><th>Date</th><th class="num">Amount</th><th></th></tr></thead>' + '<tbody>' + rows + '</tbody></table></div>';
}

// ── Estimates page ────────────────────────────────────────────────────────
let _estFilter = 'all';
function setEstFilter(f, btn) {
  _estFilter = f;
  document.querySelectorAll('#pg-estimates .fb').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderEstimatesPage();
}
function renderEstimatesPage() {
  const allBids = bids.filter(b => b.id);
  const _bidType = b => b.isTM ? 'tm' : b.geiLines !== undefined ? 'freeform' : 'scope';
  const f = _estFilter;
  let filtered;
  if (f === 'all') filtered = allBids;else if (f === 'draft') filtered = allBids.filter(b => b.draft || b.status === 'Draft');else filtered = allBids.filter(b => _bidType(b) === f);
  const total = allBids.length;
  const drafts = allBids.filter(b => b.draft || b.status === 'Draft').length;
  const awaiting = allBids.filter(b => b.signingToken && b.status === 'Pending').length;
  const eyebrow = document.getElementById('estimates-eyebrow');
  if (eyebrow) eyebrow.textContent = total + ' estimates · ' + drafts + ' draft' + (drafts === 1 ? '' : 's') + ' · ' + awaiting + ' awaiting sig';
  const hd = document.getElementById('estimates-hd-title');
  if (hd) hd.textContent = f === 'all' ? 'All estimates' : f === 'tm' ? 'Time & Materials' : f === 'freeform' ? 'Build Your Own' : f === 'draft' ? 'Drafts' : 'Scope & Price';
  const wrap = document.getElementById('estimates-tbl-wrap');
  const empty = document.getElementById('estimates-empty');
  if (!wrap) return;
  if (!filtered.length) {
    wrap.innerHTML = '';
    if (empty) empty.style.display = '';
    return;
  }
  if (empty) empty.style.display = 'none';
  const typeChip = b => {
    if (b.isTM) return '<span class="bdg-soft sf-pending">T&amp;M</span>';
    if (b.geiLines !== undefined) return '<span class="bdg-soft sf-active">Build Your Own</span>';
    return '<span class="bdg-soft sf-deposit">Scope &amp; Price</span>';
  };
  const statusChip = b => {
    if (b.status === 'Closed Won') return '<span class="bdg-soft sf-won">SIGNED</span>';
    if (b.status === 'Closed Lost' || b.status === 'Abandoned') return '<span class="bdg-soft sf-lost">DECLINED</span>';
    if (b.draft || b.status === 'Draft') return '<span class="bdg-soft sf-done">DRAFT</span>';
    if (b.signingToken) return '<span class="bdg-soft sf-pending">AWAITING SIG</span>';
    return '<span class="bdg-soft sf-done">PENDING</span>';
  };
  const rows = filtered.map(b => {
    const c = getClientById(b.client_id) || {
      name: b.client_name || b.name || 'Unknown'
    };
    const proj = b.addr || b.type || '—';
    const amt = b.isTM && b.tmNteCap ? '~' + fmt(b.amount) + ' / NTE ' + fmt(b.tmNteCap) : b.amount ? fmt(b.amount) : '—';
    const revFn = b.geiLines !== undefined ? 'openGenericEstimate(getClientById(' + b.client_id + '),' + b.id + ',\'' + escHtml(b.trade_type || 'general') + '\')' : 'openEditBid(' + b.id + ')';
    return '<tr style="cursor:pointer" onclick="' + revFn + '">' + '<td><div style="font-weight:800">' + escHtml(c.name) + '</div>' + '<div style="font-size:10px;color:var(--text3);font-weight:500;margin-top:2px">' + escHtml((proj + '').split(',')[0]) + '</div></td>' + '<td>' + typeChip(b) + '</td>' + '<td>' + statusChip(b) + '</td>' + '<td class="muted">' + escHtml(b.bid_date || '') + '</td>' + '<td class="num">' + amt + '</td>' + '<td style="text-align:right"><button class="btn btn-sm btn-p" onclick="event.stopPropagation();' + revFn + '">Open →</button></td>' + '</tr>';
  }).join('');
  wrap.innerHTML = '<table class="tbl"><thead><tr><th>Client &amp; project</th><th>Type</th><th>Status</th><th>Date</th><th class="num">Amount</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
}

// ── Jobs page ─────────────────────────────────────────────────────────────
})(); } catch (e) { __ds_ns.__errors.push({ path: "js/dashboard.js", error: String((e && e.message) || e) }); }

// js/fleet.js
try { (() => {
// js/fleet.js — Fleet management module
// Vehicles are stored in S.vehicles (settings, syncs to Supabase)
// Maintenance records are stored in `maintenance` array (localStorage zp3_maint)

/* ── Service type definitions ───────────────────────────────────────────────── */
const MAINT_TYPES = {
  oil_change: {
    label: 'Oil Change',
    icon: '🛢️',
    reminder: true,
    intervalMi: 5000,
    intervalMo: 6
  },
  tire_rotate: {
    label: 'Tire Rotation',
    icon: '🔄',
    reminder: true,
    intervalMi: 7500,
    intervalMo: 6
  },
  alignment: {
    label: 'Alignment',
    icon: '⚖️',
    reminder: false
  },
  shocks: {
    label: 'Shocks / Struts',
    icon: '🔩',
    reminder: false
  },
  brakes: {
    label: 'Brakes',
    icon: '🔴',
    reminder: false
  },
  fuel_filter: {
    label: 'Fuel Filter',
    icon: '⛽',
    reminder: false
  },
  air_filter: {
    label: 'Air Filter',
    icon: '💨',
    reminder: true,
    intervalMi: 15000,
    intervalMo: 12
  },
  trans: {
    label: 'Transmission',
    icon: '⚙️',
    reminder: false
  },
  coolant: {
    label: 'Coolant Flush',
    icon: '🌡️',
    reminder: false
  },
  battery: {
    label: 'Battery',
    icon: '🔋',
    reminder: false
  },
  belt: {
    label: 'Belt / Hose',
    icon: '〰️',
    reminder: false
  },
  tires: {
    label: 'Tire Replacement',
    icon: '⭕',
    reminder: false
  },
  windshield: {
    label: 'Windshield / Glass',
    icon: '🪟',
    reminder: false
  },
  bodywork: {
    label: 'Bodywork / Paint',
    icon: '🎨',
    reminder: false
  },
  inspection: {
    label: 'Inspection',
    icon: '✅',
    reminder: true,
    intervalMo: 12
  },
  registration: {
    label: 'Registration',
    icon: '📋',
    reminder: true,
    intervalMo: 12
  },
  wash: {
    label: 'Detail / Wash',
    icon: '🧽',
    reminder: false
  },
  other: {
    label: 'Other',
    icon: '🔧',
    reminder: false
  }
};

/* ── Tab switching ───────────────────────────────────────────────────────────── */
let _fleetTabActive = 'fleet';
function setFleetTab(tab) {
  _fleetTabActive = tab;
  ['fleet', 'team'].forEach(t => {
    const el = document.getElementById('ft-' + t);
    const b = document.getElementById('ft-t-' + t);
    if (el) el.style.display = t === tab ? '' : 'none';
    if (b) b.classList.toggle('active', t === tab);
  });
  const addFleet = document.getElementById('fleet-add-btn');
  const addTeam = document.getElementById('team-add-btn');
  if (addFleet) addFleet.style.display = tab === 'fleet' ? '' : 'none';
  if (addTeam) addTeam.style.display = tab === 'team' ? '' : 'none';
  if (tab === 'fleet') renderFleetVehicles();
  if (tab === 'team' && typeof renderTeam === 'function') renderTeam();
}

/* ── Main render ─────────────────────────────────────────────────────────────── */
function renderFleet() {
  if (_fleetTabActive === 'fleet') {
    renderFleetVehicles();
  }
}
function renderFleetVehicles() {
  const el = document.getElementById('fleet-vehicle-list');
  if (!el) return;
  const vehs = getVehicles();
  if (!vehs.length) {
    el.innerHTML = '<div style="padding:28px 20px 24px;text-align:center">' + '<div style="font-size:40px;margin-bottom:10px">🚛</div>' + '<div style="font-size:18px;font-weight:800;margin-bottom:6px;color:var(--text)">Set up your first vehicle</div>' + '<div style="font-size:13px;color:var(--text3);margin-bottom:20px;line-height:1.5;max-width:300px;margin-left:auto;margin-right:auto">The IRS requires a vehicle description on every business trip log. Add one here to unlock mileage tracking, maintenance records, and tax deductions.</div>' + '<button class="btn btn-p" onclick="openAddVehicleModal(-1)" style="font-size:15px;padding:13px 28px;margin-bottom:24px">+ Add your first vehicle</button>' + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;text-align:left;max-width:340px;margin:0 auto">' + '<div style="background:var(--bg2);border-radius:var(--r);padding:10px 12px"><div style="font-size:15px;margin-bottom:3px">🗺️</div><div style="font-size:12px;font-weight:700;color:var(--text)">IRS mileage log</div><div style="font-size:11px;color:var(--text3)">Per-vehicle trip log the IRS requires</div></div>' + '<div style="background:var(--bg2);border-radius:var(--r);padding:10px 12px"><div style="font-size:15px;margin-bottom:3px">🔧</div><div style="font-size:12px;font-weight:700;color:var(--text)">Maintenance records</div><div style="font-size:11px;color:var(--text3)">Service log + cost per mile</div></div>' + '<div style="background:var(--bg2);border-radius:var(--r);padding:10px 12px"><div style="font-size:15px;margin-bottom:3px">📊</div><div style="font-size:12px;font-weight:700;color:var(--text)">Business use %</div><div style="font-size:11px;color:var(--text3)">Auto-calculated from odometer</div></div>' + '<div style="background:var(--bg2);border-radius:var(--r);padding:10px 12px"><div style="font-size:15px;margin-bottom:3px">💰</div><div style="font-size:12px;font-weight:700;color:var(--text)">P&L per vehicle</div><div style="font-size:11px;color:var(--text3)">Deductions vs. actual costs</div></div>' + '</div>' + '</div>';
    return;
  }
  // Sort: active first, down second, sold last
  const sorted = [...vehs.entries()].sort(([, a], [, b]) => {
    const order = {
      active: 0,
      down: 1,
      sold: 2
    };
    return (order[a.status || 'active'] || 0) - (order[b.status || 'active'] || 0);
  });
  el.innerHTML = sorted.map(([idx, v]) => _fleetCard(v, idx)).join('');
  // Summary row at bottom
  const active = vehs.filter(v => (v.status || 'active') === 'active');
  const totalCost = vehs.reduce((s, v) => s + (v.purchasePrice || 0), 0);
  const yr = new Date().getFullYear().toString();
  const ytdMiles = vehs.reduce((s, v) => {
    return s + mileage.filter(t => t.vehicle === v.name && (t.date || '').startsWith(yr)).reduce((ss, t) => ss + (t.miles || 0), 0);
  }, 0);
  const maintYTD = maintenance.filter(m => (m.date || '').startsWith(yr)).reduce((s, m) => s + (m.cost || 0), 0);
  el.innerHTML += `<div style="margin:16px 0 4px;padding:12px 14px;background:var(--bg2);border-radius:var(--r);border:1px solid var(--border)">
    <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:8px">Fleet summary</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
      <div style="text-align:center"><div style="font-size:18px;font-weight:800;color:var(--text)">${active.length}</div><div style="font-size:10px;color:var(--text3)">Active vehicles</div></div>
      <div style="text-align:center"><div style="font-size:18px;font-weight:800;color:var(--text)">${ytdMiles > 0 ? Math.round(ytdMiles).toLocaleString() : '—'}</div><div style="font-size:10px;color:var(--text3)">YTD miles</div></div>
      <div style="text-align:center"><div style="font-size:18px;font-weight:800;color:var(--blue)">${maintYTD > 0 ? '$' + maintYTD.toLocaleString() : '$0'}</div><div style="font-size:10px;color:var(--text3)">Maint YTD</div></div>
    </div>
    ${totalCost > 0 ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:11px;color:var(--text3);text-align:center">Total cost basis: <strong style="color:var(--text)">$${totalCost.toLocaleString()}</strong></div>` : ''}
  </div>`;
}
function _fleetCard(v, idx) {
  const status = v.status || 'active';
  const statusColors = {
    active: 'var(--green)',
    down: 'var(--red)',
    sold: 'var(--text3)'
  };
  const statusLabels = {
    active: '● Active',
    down: '🔴 Down',
    sold: '📦 Sold'
  };
  const statusColor = statusColors[status] || statusColors.active;
  const yr = new Date().getFullYear().toString();
  const trips = mileage.filter(t => t.vehicle === v.name && (t.date || '').startsWith(yr));
  const ytdMi = Math.round(trips.reduce((s, t) => s + (t.miles || 0), 0));
  const maint = maintenance.filter(m => m.vehicleName === v.name);
  const lastMaint = maint.slice().sort((a, b) => b.date > a.date ? 1 : -1)[0];
  const due = _fleetDueAlerts(v, maint);
  const maintYTD = maint.filter(m => (m.date || '').startsWith(yr)).reduce((s, m) => s + (m.cost || 0), 0);
  const downDays = _fleetDownDays(v, yr);

  // P&L quick calc
  const pnl = _fleetPnLCalc(v, maint, trips, yr);
  return `<div class="card" style="margin-bottom:10px;${status === 'down' ? 'border-left:3px solid var(--red);' : ''}${status === 'sold' ? 'opacity:.7;' : ''}" onclick="openFleetVehicleDetail(${idx})">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div style="flex:1;min-width:0">
        <div style="font-size:16px;font-weight:800;color:var(--text);margin-bottom:1px">${v.nickname || v.name}</div>
        ${v.nickname ? `<div style="font-size:11px;color:var(--text3)">${v.name}</div>` : ''}
        <div style="font-size:11px;color:${statusColor};font-weight:700;margin-top:3px">${statusLabels[status] || statusLabels.active}</div>
      </div>
      <button onclick="event.stopPropagation();openAddVehicleModal(${idx})" class="btn btn-sm" style="font-size:11px;padding:3px 8px;flex-shrink:0">Edit</button>
    </div>
    ${due.length ? `<div style="margin-top:8px">${due.map(d => `<div style="font-size:11px;background:var(--amber-lt);color:#92400E;border-radius:4px;padding:3px 8px;margin-bottom:3px;display:inline-block;margin-right:4px">⚠️ ${d}</div>`).join('')}</div>` : ''}
    <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">
      <div style="background:var(--bg2);border-radius:var(--r);padding:6px 8px;text-align:center">
        <div style="font-size:15px;font-weight:800;color:var(--text)">${ytdMi > 0 ? ytdMi.toLocaleString() : '—'}</div>
        <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em">YTD miles</div>
      </div>
      <div style="background:var(--bg2);border-radius:var(--r);padding:6px 8px;text-align:center">
        <div style="font-size:15px;font-weight:800;color:${maintYTD > 0 ? 'var(--text)' : 'var(--text3)'}">${maintYTD > 0 ? '$' + maintYTD.toLocaleString() : '$0'}</div>
        <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em">Maint YTD</div>
      </div>
      <div style="background:var(--bg2);border-radius:var(--r);padding:6px 8px;text-align:center">
        <div style="font-size:15px;font-weight:800;color:${pnl.costPerMile > 0 ? 'var(--text)' : 'var(--text3)'}">${pnl.costPerMile > 0 ? '$' + pnl.costPerMile.toFixed(2) : '—'}</div>
        <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em">Cost/mile</div>
      </div>
    </div>
    ${downDays > 0 ? `<div style="margin-top:8px;font-size:11px;color:var(--red)">⏱ Down ${downDays} day${downDays === 1 ? '' : 's'} this year</div>` : ''}
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px;gap:8px">
      <button onclick="event.stopPropagation();openFleetVehicleDetail(${idx});setTimeout(()=>setFleetDetailTab('service'),80)" style="background:none;border:none;padding:0;cursor:pointer;text-align:left;font-size:11px;color:var(--blue);font-family:inherit;flex:1;min-width:0">
        ${lastMaint ? `🔧 ${lastMaint.typeLabel || lastMaint.type} <span style="color:var(--text3)">${_fleetFmtDate(lastMaint.date)}</span> <span style="color:var(--text3)">›</span>` : '<span style="color:var(--text3)">No service records</span>'}
      </button>
      <button onclick="event.stopPropagation();openAddMaintenanceModal(${idx})" class="btn btn-sm" style="font-size:11px;padding:3px 10px;flex-shrink:0">+ Log service</button>
    </div>
    ${v.purchasePrice ? `<div style="font-size:11px;color:var(--text3);margin-top:2px">Purchased: $${v.purchasePrice.toLocaleString()}${v.purchaseDate ? ' · ' + _fleetFmtDate(v.purchaseDate) : ''}</div>` : ''}
  </div>`;
}

/* ── Due service alerts ──────────────────────────────────────────────────────── */
function _fleetDueAlerts(v, maintRecords) {
  const alerts = [];
  const todayStr = todayKey();
  const getLastService = type => maintRecords.filter(m => m.type === type).slice().sort((a, b) => b.date > a.date ? 1 : -1)[0];
  Object.entries(MAINT_TYPES).forEach(([type, def]) => {
    if (!def.reminder) return;
    const last = getLastService(type);
    if (!last) return;

    // Miles-based check
    if (def.intervalMi && last.nextOilMiles) {
      // Can't check without live odo, skip miles check unless nextOilDate says due
    }

    // Date-based check
    if (def.intervalMo) {
      const nextDate = last.nextOilDate || _fleetAddMonths(last.date, def.intervalMo);
      if (nextDate && nextDate <= todayStr) {
        alerts.push(def.label + ' due');
      }
    }
  });
  return alerts;
}
function _fleetAddMonths(dateStr, months) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr + 'T12:00:00');
    d.setMonth(d.getMonth() + months);
    return d.toISOString().slice(0, 10);
  } catch (e) {
    return '';
  }
}

/* ── Downtime calculations ───────────────────────────────────────────────────── */
function _fleetDownDays(v, year) {
  if (!v.downtimeLog || !v.downtimeLog.length) return 0;
  let total = 0;
  const yearStart = year + '-01-01';
  const yearEnd = year + '-12-31';
  v.downtimeLog.forEach(d => {
    const s = d.start > yearStart ? d.start : yearStart;
    const e = (d.end || todayKey()) < yearEnd ? d.end || todayKey() : yearEnd;
    if (s <= e) {
      const days = Math.round((new Date(e + 'T12:00:00') - new Date(s + 'T12:00:00')) / (1000 * 60 * 60 * 24));
      total += days + 1;
    }
  });
  return total;
}

/* ── P&L calculation ─────────────────────────────────────────────────────────── */
function _fleetPnLCalc(v, maintRecords, trips, year) {
  const method = v.deductionMethod || 'mileage';
  const totalMiles = trips.reduce((s, t) => s + (t.miles || 0), 0);
  const maintCostYTD = maintRecords.filter(m => (m.date || '').startsWith(year)).reduce((s, m) => s + (m.cost || 0), 0);
  const purchasePrice = v.purchasePrice || 0;
  const bizPct = (v.bizUse || 100) / 100;
  if (method === 'actual') {
    // Actual expense method: deduct actual costs at the business-use %
    // 5-year straight-line depreciation on the business-use portion
    const annualDeprec = purchasePrice > 0 ? +(purchasePrice * bizPct / 5).toFixed(2) : 0;
    const deductibleMaint = +(maintCostYTD * bizPct).toFixed(2);
    const totalDeduction = +(deductibleMaint + annualDeprec).toFixed(2);
    const costPerMile = totalMiles > 0 ? +(totalDeduction / totalMiles).toFixed(2) : 0;
    return {
      method: 'actual',
      totalMiles,
      irsDeduction: 0,
      maintCostYTD,
      deductibleMaint,
      annualDeprec,
      totalDeduction,
      totalCost: totalDeduction,
      costPerMile,
      netPosition: totalDeduction
    };
  } else {
    // Standard mileage method: IRS rate × miles × biz% = deduction; maintenance is records-only
    const irsDeduction = +(totalMiles * (S.irsRate || 0.67) * bizPct).toFixed(2);
    // "Real" cost per mile based on actual maintenance spend (for awareness, not deduction)
    const costPerMile = totalMiles > 0 ? +(maintCostYTD / totalMiles).toFixed(2) : 0;
    return {
      method: 'mileage',
      totalMiles,
      irsDeduction,
      maintCostYTD,
      deductibleMaint: 0,
      annualDeprec: 0,
      totalDeduction: irsDeduction,
      totalCost: maintCostYTD,
      costPerMile,
      netPosition: irsDeduction
    };
  }
}

/* ── Vehicle detail modal ────────────────────────────────────────────────────── */
let _fleetDetailIdx = -1;
let _fleetDetailTab = 'overview';
function openFleetVehicleDetail(idx) {
  const vehs = getVehicles();
  if (idx < 0 || idx >= vehs.length) return;
  _fleetDetailIdx = idx;
  _fleetDetailTab = 'overview';
  _renderFleetDetailModal();
}
function _renderFleetDetailModal() {
  const vehs = getVehicles();
  if (_fleetDetailIdx < 0) return;
  const v = vehs[_fleetDetailIdx];
  if (!v) return;
  const ov = document.getElementById('fleet-detail-overlay') || _createFleetDetailOverlay();
  const box = document.getElementById('fleet-detail-box');
  if (!box) return;
  const yr = new Date().getFullYear().toString();
  const trips = mileage.filter(t => t.vehicle === v.name);
  const maint = maintenance.filter(m => m.vehicleName === v.name).slice().sort((a, b) => b.date > a.date ? 1 : -1);
  const pnl = _fleetPnLCalc(v, maint, trips.filter(t => (t.date || '').startsWith(yr)), yr);
  const downDays = _fleetDownDays(v, yr);
  const allDownDays = _fleetTotalDownDays(v);
  const status = v.status || 'active';
  const statusColors = {
    active: 'var(--green)',
    down: 'var(--red)',
    sold: 'var(--text3)'
  };
  const statusLabels = {
    active: '● Active',
    down: '🔴 Down',
    sold: '📦 Sold'
  };
  const tabs = ['overview', 'service', 'pl'];
  const tabLabels = {
    overview: 'Overview',
    service: 'Service Log',
    pl: 'P&L'
  };
  box.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 16px 0">
      <div>
        <div style="font-size:18px;font-weight:800">${v.nickname || v.name}</div>
        ${v.nickname ? `<div style="font-size:11px;color:var(--text3)">${v.name}</div>` : ''}
        <div style="font-size:12px;font-weight:700;color:${statusColors[status]};margin-top:2px">${statusLabels[status]}</div>
      </div>
      <button onclick="_closeFleetDetail()" style="font-size:22px;line-height:1;background:none;border:none;color:var(--text3);cursor:pointer;padding:4px">×</button>
    </div>
    <div class="fbar" style="padding:0 16px;margin-top:8px">
      ${tabs.map(t => `<button type="button" class="fb${_fleetDetailTab === t ? ' active' : ''}" onclick="setFleetDetailTab('${t}')">${tabLabels[t]}</button>`).join('')}
    </div>
    <div id="fleet-detail-content" style="padding:14px 16px 80px;overflow-y:auto;max-height:65vh">
      ${_fleetDetailTab === 'overview' ? _fleetDetailOverviewHtml(v, pnl, maint, downDays, allDownDays, yr) : ''}
      ${_fleetDetailTab === 'service' ? _fleetDetailServiceHtml(v, maint) : ''}
      ${_fleetDetailTab === 'pl' ? _fleetDetailPnLHtml(v, pnl, maint, trips) : ''}
    </div>
  `;
  ov.style.display = 'flex';
}
function _createFleetDetailOverlay() {
  const ov = document.createElement('div');
  ov.id = 'fleet-detail-overlay';
  ov.style.cssText = 'display:none;position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,.5);align-items:flex-end;justify-content:center';
  const box = document.createElement('div');
  box.id = 'fleet-detail-box';
  box.style.cssText = 'background:var(--bg);border-radius:var(--rl) var(--rl) 0 0;width:100%;max-width:520px;max-height:95vh;overflow:hidden;display:flex;flex-direction:column';
  ov.appendChild(box);
  document.body.appendChild(ov);
  ov.addEventListener('click', e => {
    if (e.target === ov) _closeFleetDetail();
  });
  return ov;
}
function _closeFleetDetail() {
  const ov = document.getElementById('fleet-detail-overlay');
  if (ov) ov.style.display = 'none';
}
function setFleetDetailTab(tab) {
  _fleetDetailTab = tab;
  _renderFleetDetailModal();
}
function _fleetDetailOverviewHtml(v, pnl, maint, downDays, allDownDays, yr) {
  const due = _fleetDueAlerts(v, maint);
  const status = v.status || 'active';
  const allTrips = mileage.filter(t => t.vehicle === v.name);
  const lifetimeMi = Math.round(allTrips.reduce((s, t) => s + (t.miles || 0), 0));
  const bizPct = v.bizUse || 100;
  return `
    ${due.length ? `<div style="background:var(--amber-lt);border:1px solid #F59E0B;border-radius:var(--r);padding:10px 12px;margin-bottom:12px">${due.map(d => `<div style="font-size:12px;color:#92400E;font-weight:600">⚠️ ${d}</div>`).join('')}</div>` : ''}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">
      <div style="background:var(--bg2);border-radius:var(--r);padding:10px;text-align:center">
        <div style="font-size:20px;font-weight:800">${pnl.totalMiles > 0 ? Math.round(pnl.totalMiles).toLocaleString() : '—'}</div>
        <div style="font-size:10px;color:var(--text3)">Miles this year</div>
      </div>
      <div style="background:var(--bg2);border-radius:var(--r);padding:10px;text-align:center">
        <div style="font-size:20px;font-weight:800;color:${pnl.costPerMile > 0 ? 'var(--text)' : 'var(--text3)'}">${pnl.costPerMile > 0 ? '$' + pnl.costPerMile : '—'}</div>
        <div style="font-size:10px;color:var(--text3)">Cost per mile</div>
      </div>
      <div style="background:var(--bg2);border-radius:var(--r);padding:10px;text-align:center">
        <div style="font-size:20px;font-weight:800;color:var(--blue)">${pnl.maintCostYTD > 0 ? '$' + pnl.maintCostYTD.toLocaleString() : '$0'}</div>
        <div style="font-size:10px;color:var(--text3)">Maintenance YTD</div>
      </div>
      <div style="background:var(--bg2);border-radius:var(--r);padding:10px;text-align:center">
        <div style="font-size:20px;font-weight:800;color:${lifetimeMi > 0 ? 'var(--text)' : 'var(--text3)'}">${lifetimeMi > 0 ? lifetimeMi.toLocaleString() : '—'}</div>
        <div style="font-size:10px;color:var(--text3)">Lifetime miles logged</div>
      </div>
    </div>
    <button onclick="openOdometerReport(${_fleetDetailIdx})" class="btn" style="width:100%;margin-bottom:12px;background:var(--bg2);border-color:var(--border2);font-size:13px;display:flex;align-items:center;justify-content:center;gap:6px">
      📊 Year-end mileage report
      ${bizPct < 100 ? `<span style="font-size:10px;background:var(--blue);color:#fff;border-radius:99px;padding:1px 7px;font-weight:700">${bizPct}% biz</span>` : ''}
    </button>

    ${v.purchasePrice || v.purchaseDate || v.plate || v.vin ? `
    <div style="border:1px solid var(--border);border-radius:var(--r);padding:10px 12px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:8px">Vehicle info</div>
      ${v.purchasePrice ? `<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:12px;color:var(--text3)">Purchase price</span><span style="font-size:12px;font-weight:700">$${v.purchasePrice.toLocaleString()}</span></div>` : ''}
      ${v.purchaseDate ? `<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:12px;color:var(--text3)">Purchase date</span><span style="font-size:12px">${_fleetFmtDate(v.purchaseDate)}</span></div>` : ''}
      ${v.purchaseOdo ? `<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:12px;color:var(--text3)">Odometer at purchase</span><span style="font-size:12px">${v.purchaseOdo.toLocaleString()} mi</span></div>` : ''}
      ${v.plate ? `<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:12px;color:var(--text3)">License plate</span><span style="font-size:12px;font-weight:700">${v.plate}</span></div>` : ''}
      ${v.vin ? `<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:12px;color:var(--text3)">VIN</span><span style="font-size:11px;font-family:monospace">${v.vin}</span></div>` : ''}
      ${v.color ? `<div style="display:flex;justify-content:space-between"><span style="font-size:12px;color:var(--text3)">Color</span><span style="font-size:12px">${v.color}</span></div>` : ''}
    </div>` : ''}

    ${status === 'sold' && v.saleDate ? `
    <div style="border:1px solid var(--border);border-radius:var(--r);padding:10px 12px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:8px">Sale info</div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:12px;color:var(--text3)">Sale date</span><span style="font-size:12px">${_fleetFmtDate(v.saleDate)}</span></div>
      ${v.salePrice ? `<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:12px;color:var(--text3)">Sale price</span><span style="font-size:12px;font-weight:700">$${v.salePrice.toLocaleString()}</span></div>` : ''}
      ${v.purchasePrice && v.salePrice ? `<div style="display:flex;justify-content:space-between;padding-top:6px;border-top:1px solid var(--border)"><span style="font-size:12px;color:var(--text3)">Gain / (Loss)</span><span style="font-size:12px;font-weight:700;color:${v.salePrice >= v.purchasePrice ? 'var(--green)' : 'var(--red)'}">$${(v.salePrice - v.purchasePrice).toLocaleString()}</span></div>` : ''}
    </div>` : ''}

    ${allDownDays > 0 ? `
    <div style="border:1px solid var(--border);border-radius:var(--r);padding:10px 12px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:8px">Downtime log</div>
      ${(v.downtimeLog || []).map(d => `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid var(--border)">
          <div>
            <div style="font-size:12px;font-weight:600">${_fleetFmtDate(d.start)} – ${d.end ? _fleetFmtDate(d.end) : 'ongoing'}</div>
            ${d.reason ? `<div style="font-size:11px;color:var(--text3)">${d.reason}</div>` : ''}
          </div>
          <div style="font-size:11px;color:var(--red)">${_fleetDowntimeDays(d)} day${_fleetDowntimeDays(d) === 1 ? '' : 's'}</div>
        </div>
      `).join('')}
    </div>` : ''}

    <div style="display:grid;gap:8px">
      <button class="btn btn-p" onclick="openAddMaintenanceModal(${_fleetDetailIdx})" style="font-size:15px;padding:14px">+ Log service</button>
      ${status === 'active' ? `<button class="btn" onclick="openFleetStatusModal(${_fleetDetailIdx},'down')" style="background:var(--bg2);border-color:var(--border2);color:var(--red);font-weight:700">🔴 Mark as down / in shop</button>` : ''}
      ${status === 'down' ? `<button class="btn" onclick="openFleetStatusModal(${_fleetDetailIdx},'active')" style="background:var(--green-lt);border-color:var(--green);color:var(--green)">✅ Back in service</button>` : ''}
      ${status !== 'sold' ? `<button class="btn" onclick="openFleetSaleModal(${_fleetDetailIdx})" style="background:var(--bg2);border-color:var(--border2);font-size:13px">📦 Record sale</button>` : ''}
    </div>
  `;
}
function _fleetDetailServiceHtml(v, maint) {
  if (!maint.length) return `
    <div style="text-align:center;padding:24px 0;color:var(--text3)">
      <div style="font-size:28px;margin-bottom:8px">🔧</div>
      <div style="font-size:13px;margin-bottom:12px">No service records yet</div>
      <button class="btn btn-p" onclick="openAddMaintenanceModal(${_fleetDetailIdx})" style="font-size:14px;padding:12px 24px">+ Log first service</button>
    </div>`;
  const _svcParts = m => {
    const parts = [];
    if (m.oilBrand || m.oilType) parts.push((m.oilBrand ? m.oilBrand + ' ' : '') + m.oilType);
    if (m.oilFilterPart) parts.push('Filter: ' + m.oilFilterPart);
    if (m.tireBrand) parts.push(m.tireBrand + (m.tireSize ? ' ' + m.tireSize : '') + (m.tireCount ? ' ×' + m.tireCount : ''));
    if (m.vendor) parts.push(m.vendor);
    return parts.join(' · ');
  };
  return `
    <button class="btn btn-p" onclick="openAddMaintenanceModal(${_fleetDetailIdx})" style="width:100%;margin-bottom:10px;font-size:14px;padding:12px">+ Log service</button>
    <div style="border:1px solid var(--border);border-radius:var(--r);overflow:hidden">
      <!-- header row -->
      <div style="display:grid;grid-template-columns:72px 1fr 64px 44px;gap:0;background:var(--bg2);border-bottom:1px solid var(--border);padding:6px 10px">
        <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3)">Date</div>
        <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3)">Service / Parts</div>
        <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);text-align:right">Mi</div>
        <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);text-align:right">Cost</div>
      </div>
      ${maint.map((m, i) => {
    const parts = _svcParts(m);
    const icon = MAINT_TYPES[m.type] ? MAINT_TYPES[m.type].icon : '🔧';
    const dateShort = m.date ? new Date(m.date + 'T12:00').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    }) : '—';
    const nextInfo = m.nextOilMiles ? `<div style="font-size:10px;color:var(--text3);margin-top:1px">Next: ${m.nextOilMiles.toLocaleString()} mi</div>` : '';
    const notesInfo = m.notes ? `<div style="font-size:10px;color:var(--text3);font-style:italic;margin-top:1px">${m.notes}</div>` : '';
    return `<div style="display:grid;grid-template-columns:72px 1fr 64px 44px;gap:0;padding:8px 10px;border-bottom:1px solid var(--border);align-items:start;${i % 2 === 1 ? 'background:var(--bg2)' : ''}">
          <div style="font-size:12px;font-weight:700;color:var(--text);padding-right:6px">${dateShort}</div>
          <div style="min-width:0">
            <div style="font-size:12px;font-weight:700">${icon} ${m.typeLabel || m.type}</div>
            ${parts ? `<div style="font-size:11px;color:var(--text3);margin-top:1px;word-break:break-word">${parts}</div>` : ''}
            ${nextInfo}${notesInfo}
            <div style="margin-top:4px;display:flex;gap:10px">
              ${m.photo ? `<span style="font-size:10px;color:var(--blue);cursor:pointer" onclick="_showMaintPhoto('${m.id}')">📷 Receipt</span>` : ''}
              <span style="font-size:10px;color:var(--text3);cursor:pointer" onclick="openAddMaintenanceModal(${_fleetDetailIdx},${m.id})">Edit</span>
            </div>
          </div>
          <div style="font-size:12px;color:var(--text3);text-align:right;padding-left:4px">${m.odo ? m.odo.toLocaleString() : '—'}</div>
          <div style="font-size:12px;font-weight:700;color:${m.cost ? 'var(--blue)' : 'var(--text3)'};text-align:right">${m.cost ? '$' + m.cost.toLocaleString() : '—'}</div>
        </div>`;
  }).join('')}
    </div>
  `;
}
function _fleetDetailPnLHtml(v, pnl, maint, trips) {
  const yrs = [...new Set([...trips.map(t => (t.date || '').slice(0, 4)), ...maint.map(m => (m.date || '').slice(0, 4))].filter(Boolean))].sort().reverse();
  if (!yrs.length) yrs.push(new Date().getFullYear().toString());
  const method = v.deductionMethod || 'mileage';
  const methodBadge = method === 'actual' ? `<span style="font-size:10px;background:var(--blue);color:#fff;border-radius:4px;padding:2px 6px;margin-left:6px;font-weight:700">Actual Expenses</span>` : `<span style="font-size:10px;background:var(--green);color:#fff;border-radius:4px;padding:2px 6px;margin-left:6px;font-weight:700">Standard Mileage</span>`;
  return yrs.map(yr => {
    const yrTrips = trips.filter(t => (t.date || '').startsWith(yr));
    const yrMaint = maint.filter(m => (m.date || '').startsWith(yr));
    const p = _fleetPnLCalc(v, yrMaint, yrTrips, yr);
    if (method === 'actual') {
      return `
        <div style="border:1px solid var(--border);border-radius:var(--r);padding:12px;margin-bottom:12px">
          <div style="display:flex;align-items:center;margin-bottom:10px"><span style="font-size:13px;font-weight:800">${yr}</span>${methodBadge}</div>
          <div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="font-size:12px;color:var(--text3)">Business miles</span><span style="font-size:12px;font-weight:600">${Math.round(p.totalMiles).toLocaleString()} mi</span></div>
          <div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="font-size:12px;color:var(--text3)">Business use</span><span style="font-size:12px;font-weight:600">${v.bizUse || 100}%</span></div>
          <div style="border-top:1px solid var(--border);margin:6px 0"></div>
          <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:12px;color:var(--text3)">Maintenance costs</span><span style="font-size:12px">$${p.maintCostYTD.toLocaleString()}</span></div>
          <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:12px;color:var(--text3)">Deductible portion (×${v.bizUse || 100}%)</span><span style="font-size:12px;color:var(--red)">−$${p.deductibleMaint.toLocaleString()}</span></div>
          ${p.annualDeprec > 0 ? `<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:12px;color:var(--text3)">Depreciation (5-yr straight-line)</span><span style="font-size:12px;color:var(--red)">−$${p.annualDeprec.toLocaleString()}</span></div>` : ''}
          <div style="border-top:1px solid var(--border);margin:6px 0"></div>
          <div style="display:flex;justify-content:space-between">
            <span style="font-size:13px;font-weight:700">Vehicle deduction</span>
            <span style="font-size:14px;font-weight:800;color:var(--green)">$${p.totalDeduction.toLocaleString()}</span>
          </div>
          ${p.costPerMile > 0 ? `<div style="font-size:11px;color:var(--text3);text-align:center;margin-top:6px">Cost per mile: $${p.costPerMile}</div>` : ''}
        </div>
      `;
    } else {
      // Standard mileage method
      return `
        <div style="border:1px solid var(--border);border-radius:var(--r);padding:12px;margin-bottom:12px">
          <div style="display:flex;align-items:center;margin-bottom:10px"><span style="font-size:13px;font-weight:800">${yr}</span>${methodBadge}</div>
          <div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="font-size:12px;color:var(--text3)">Business miles</span><span style="font-size:12px;font-weight:600">${Math.round(p.totalMiles).toLocaleString()} mi</span></div>
          <div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="font-size:12px;color:var(--text3)">IRS rate (${((S.irsRate || 0.67) * 100).toFixed(0)}¢/mi × ${v.bizUse || 100}% biz)</span><span style="font-size:12px;font-weight:600;color:var(--green)">$${p.irsDeduction.toLocaleString()}</span></div>
          <div style="border-top:1px solid var(--border);margin:6px 0"></div>
          <div style="background:var(--bg2);border-radius:var(--r);padding:8px 10px;margin-bottom:8px">
            <div style="font-size:11px;font-weight:700;color:var(--text3);margin-bottom:3px">📋 Maintenance — records only</div>
            <div style="font-size:11px;color:var(--text3)">Under the standard mileage method, maintenance costs are included in the IRS rate — they are not deducted separately.</div>
            <div style="display:flex;justify-content:space-between;margin-top:6px"><span style="font-size:12px;color:var(--text3)">Actual maintenance spend</span><span style="font-size:12px;color:var(--text3)">$${p.maintCostYTD.toLocaleString()}</span></div>
          </div>
          <div style="border-top:1px solid var(--border);margin:6px 0"></div>
          <div style="display:flex;justify-content:space-between">
            <span style="font-size:13px;font-weight:700">Vehicle deduction</span>
            <span style="font-size:14px;font-weight:800;color:var(--green)">$${p.irsDeduction.toLocaleString()}</span>
          </div>
          ${p.costPerMile > 0 ? `<div style="font-size:11px;color:var(--text3);text-align:center;margin-top:6px">Real cost per mile (actual): $${p.costPerMile}</div>` : ''}
        </div>
      `;
    }
  }).join('');
}
function _fleetTotalDownDays(v) {
  if (!v.downtimeLog || !v.downtimeLog.length) return 0;
  return v.downtimeLog.reduce((s, d) => s + _fleetDowntimeDays(d), 0);
}
function _fleetDowntimeDays(d) {
  const s = d.start || todayKey();
  const e = d.end || todayKey();
  const days = Math.round((new Date(e + 'T12:00:00') - new Date(s + 'T12:00:00')) / (1000 * 60 * 60 * 24));
  return Math.max(0, days + 1);
}

/* ── Odometer year-end report ────────────────────────────────────────────────── */
let _odoReportVehIdx = -1;
let _odoReportYear = new Date().getFullYear();
function openOdometerReport(vehIdx) {
  const vehs = getVehicles();
  const v = vehs[vehIdx];
  if (!v) return;
  _odoReportVehIdx = vehIdx;
  _odoReportYear = new Date().getFullYear();
  _renderOdometerReport();
}
function _renderOdometerReport() {
  const vehs = getVehicles();
  const v = vehs[_odoReportVehIdx];
  if (!v) return;
  const yr = String(_odoReportYear);
  const log = S.vehicleOdoLog || {};
  const key = _vehKey(v);
  const rec = log[yr] && log[yr][key] || {};
  const loggedMiles = mileage.filter(t => t.vehicle === v.name && (t.date || '').startsWith(yr)).reduce((s, t) => s + (t.miles || 0), 0);
  const startOdo = rec.start || 0;
  const endOdo = rec.end || 0;
  const totalDriven = endOdo > startOdo ? endOdo - startOdo : 0;
  const bizPct = totalDriven > 0 ? Math.min(100, Math.round(loggedMiles / totalDriven * 100)) : 0;
  const curYr = new Date().getFullYear();
  let ov = document.getElementById('odo-report-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'odo-report-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:3003;background:rgba(0,0,0,.5);display:flex;align-items:flex-end;justify-content:center';
    ov.addEventListener('click', e => {
      if (e.target === ov) ov.remove();
    });
    document.body.appendChild(ov);
  }
  ov.innerHTML = `
    <div style="background:var(--bg);border-radius:var(--rl) var(--rl) 0 0;width:100%;max-width:520px">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 16px 14px;border-bottom:1px solid var(--border)">
        <div style="font-size:20px;font-weight:800">📊 Mileage report</div>
        <button onclick="document.getElementById('odo-report-overlay').remove()" style="font-size:22px;background:none;border:none;color:var(--text3);cursor:pointer;padding:4px">×</button>
      </div>
      <div style="padding:14px 16px 40px;overflow-y:auto;max-height:75vh">
        <div style="font-size:13px;font-weight:700;color:var(--text3);margin-bottom:12px">${v.nickname || v.name}</div>
        <div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap">
          ${[0, 1, 2, 3].map(d => {
    const y = curYr - d;
    return `<button onclick="_odoReportYear=${y};_renderOdometerReport()" style="padding:6px 12px;border-radius:99px;border:1.5px solid ${y === _odoReportYear ? 'var(--blue)' : 'var(--border2)'};background:${y === _odoReportYear ? 'var(--blue-lt)' : 'var(--bg2)'};color:${y === _odoReportYear ? 'var(--blue)' : 'var(--text3)'};font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">${y}</button>`;
  }).join('')}
        </div>
        <div class="card" style="margin-bottom:12px">
          <div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:10px">Odometer readings (IRS Pub. 463)</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div class="f"><label>Jan 1 reading (mi)</label>
              <input type="number" id="odo-start" min="0" step="1" placeholder="Start of year" value="${rec.start || ''}">
            </div>
            <div class="f"><label>Dec 31 reading (mi)</label>
              <input type="number" id="odo-end" min="0" step="1" placeholder="End of year" value="${rec.end || ''}">
            </div>
          </div>
        </div>
        <div class="card" style="margin-bottom:16px;background:var(--bg2)">
          <div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:10px">Calculated business use — ${yr}</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px">
            <div style="text-align:center">
              <div style="font-size:18px;font-weight:800">${totalDriven > 0 ? totalDriven.toLocaleString() : '—'}</div>
              <div style="font-size:10px;color:var(--text3)">Total miles driven</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:18px;font-weight:800;color:var(--blue)">${loggedMiles > 0 ? Math.round(loggedMiles).toLocaleString() : '—'}</div>
              <div style="font-size:10px;color:var(--text3)">Business miles</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:18px;font-weight:800;color:${bizPct > 0 ? 'var(--green)' : 'var(--text3)'}">${bizPct > 0 ? bizPct + '%' : '—'}</div>
              <div style="font-size:10px;color:var(--text3)">Business use</div>
            </div>
          </div>
          ${totalDriven === 0 ? '<div style="font-size:11px;color:var(--text3)">Enter odometer readings above to calculate business use %.</div>' : ''}
          ${totalDriven > 0 && loggedMiles === 0 ? '<div style="font-size:11px;color:var(--text3)">No trips logged yet for ' + yr + ' — log them in the mileage tab.</div>' : ''}
          ${bizPct > 0 ? `<div style="font-size:11px;color:var(--text3);margin-top:4px">Saving will apply ${bizPct}% business use to this vehicle's deduction calculations.</div>` : ''}
        </div>
        <button onclick="saveOdometerReport()" class="btn btn-p" style="width:100%;padding:14px;font-size:16px;font-weight:700">Save readings</button>
      </div>
    </div>
  `;
  ov.style.display = 'flex';
}
function saveOdometerReport() {
  const startEl = document.getElementById('odo-start');
  const endEl = document.getElementById('odo-end');
  const start = parseInt(startEl && startEl.value) || 0;
  const end = parseInt(endEl && endEl.value) || 0;
  if (end > 0 && start > 0 && end < start) {
    zAlert('End odometer must be greater than start odometer.');
    return;
  }
  const vehs = getVehicles();
  const v = vehs[_odoReportVehIdx];
  if (!v) return;
  const yr = String(_odoReportYear);
  const key = _vehKey(v);
  if (!S.vehicleOdoLog) S.vehicleOdoLog = {};
  if (!S.vehicleOdoLog[yr]) S.vehicleOdoLog[yr] = {};
  if (!S.vehicleOdoLog[yr][key]) S.vehicleOdoLog[yr][key] = {};
  if (start > 0) S.vehicleOdoLog[yr][key].start = start;
  if (end > 0) S.vehicleOdoLog[yr][key].end = end;
  // Auto-calculate and save business use %
  const loggedMiles = mileage.filter(t => t.vehicle === v.name && (t.date || '').startsWith(yr)).reduce((s, t) => s + (t.miles || 0), 0);
  const totalDriven = end > start ? end - start : 0;
  if (totalDriven > 0 && loggedMiles > 0) {
    v.bizUse = Math.min(100, Math.round(loggedMiles / totalDriven * 100));
    vehs[_odoReportVehIdx] = v;
    S.vehicles = vehs;
    S.vehiclesTs = Date.now();
  }
  saveAll();
  document.getElementById('odo-report-overlay')?.remove();
  showToast('Mileage report saved' + (totalDriven > 0 && loggedMiles > 0 ? ' — ' + v.bizUse + '% business use' : ''), '📊');
  if (_fleetDetailIdx >= 0) _renderFleetDetailModal();
}

/* ── Add/edit vehicle modal ──────────────────────────────────────────────────── */
let _fleetEditIdx = -1;
function openAddVehicleModal(idx) {
  _fleetEditIdx = typeof idx === 'number' ? idx : -1;
  const vehs = getVehicles();
  const v = _fleetEditIdx >= 0 ? vehs[_fleetEditIdx] || {} : {};
  const isEdit = _fleetEditIdx >= 0;
  const ov = document.getElementById('fleet-veh-overlay') || _createFleetVehOverlay();
  const box = document.getElementById('fleet-veh-box');
  if (!box) return;
  box.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 16px 14px;border-bottom:1px solid var(--border)">
      <div style="font-size:20px;font-weight:800;color:var(--text)">${isEdit ? 'Edit vehicle' : 'Add vehicle'}</div>
      <button class="btn btn-ghost" onclick="_closeFleetVehModal()">Cancel</button>
    </div>
    <div style="padding:14px 16px 100px;overflow-y:auto;max-height:80vh">
      <div class="card" style="margin-bottom:12px">
        <div class="f"><label>Year, make, model <span style="color:var(--red)">*</span></label>
          <input id="fv-name" placeholder="e.g. 2019 F-150" value="${v.name || ''}">
        </div>
        <div class="f"><label>Nickname <span style="font-size:10px;color:var(--text3)">(optional)</span></label>
          <input id="fv-nick" placeholder="e.g. Work Truck" value="${v.nickname || ''}">
        </div>
        <div class="fg fg2">
          <div class="f"><label>Color</label><input id="fv-color" placeholder="White" value="${v.color || ''}"></div>
          <div class="f"><label>License plate</label><input id="fv-plate" placeholder="ABC-1234" value="${v.plate || ''}"></div>
        </div>
        <div class="f"><label>VIN <span style="font-size:10px;color:var(--text3)">(17 chars)</span></label>
          <input id="fv-vin" placeholder="1FTFW1ET..." maxlength="17" value="${v.vin || ''}" style="font-family:monospace;font-size:13px">
        </div>
      </div>
      <div class="card" style="margin-bottom:12px">
        <div style="font-size:12px;font-weight:700;color:var(--text3);margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em">Purchase info</div>
        <div class="fg fg2">
          <div class="f"><label>Purchase date</label><input type="text" id="fv-pdate" inputmode="numeric" placeholder="MM/DD/YYYY" maxlength="10" value="${v.purchaseDate ? _ymdToMdY(v.purchaseDate) : ''}" oninput="_fmtExpDate(this)"></div>
          <div class="f"><label>Purchase price ($)</label><input type="number" id="fv-pprice" min="0" step="100" placeholder="Optional" value="${v.purchasePrice > 0 ? v.purchasePrice : ''}"></div>
        </div>
        <div class="f"><label>Odometer at purchase (mi)</label>
          <input type="number" id="fv-podo" min="0" step="1" placeholder="Optional" value="${v.purchaseOdo > 0 ? v.purchaseOdo : ''}">
        </div>
        <div style="font-size:11px;color:var(--text3);margin-top:4px">Purchase price is logged as a vehicle expense (actual expense method only).</div>
      </div>
      <div class="card" style="margin-bottom:12px">
        <div style="font-size:12px;font-weight:700;color:var(--text3);margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em">IRS settings</div>
        <div style="background:var(--bg2);border-radius:var(--r);padding:8px 10px;margin-bottom:10px;font-size:11px;color:var(--text3)">💡 Business use % is calculated automatically from your year-end odometer report — no manual entry needed.</div>
        <div class="f"><label>IRS weight class (GVWR)</label>
          <select id="fv-gvwr" onchange="_renderGvwrNote(this.value)">
            <option value="">— Select —</option>
            <option value="light" ${v.gvwr === 'light' ? 'selected' : ''}>Under 6,000 lbs (car, crossover)</option>
            <option value="heavy_truck" ${v.gvwr === 'heavy_truck' ? 'selected' : ''}>Over 6k lbs — Truck/Van</option>
            <option value="heavy_suv" ${v.gvwr === 'heavy_suv' ? 'selected' : ''}>Over 6k lbs — Large SUV</option>
            <option value="commercial" ${v.gvwr === 'commercial' ? 'selected' : ''}>Over 14,000 lbs (box truck)</option>
          </select>
          <div id="fv-gvwr-note" style="margin-top:4px">${_gvwrNote(v.gvwr || '')}</div>
        </div>
        <div class="f" style="margin-top:8px">
          <label>Tax deduction method <span style="font-size:10px;font-weight:400;color:var(--text3)">(pick one per vehicle — IRS doesn't allow both)</span></label>
          <div style="display:grid;gap:6px;margin-top:6px">
            <label style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border:1.5px solid ${(v.deductionMethod || 'mileage') === 'mileage' ? 'var(--blue)' : 'var(--border2)'};border-radius:var(--r);cursor:pointer;background:${(v.deductionMethod || 'mileage') === 'mileage' ? 'rgba(45,93,168,.06)' : 'var(--bg2)'}">
              <input type="radio" name="fv-deduct" value="mileage" style="margin-top:2px;accent-color:var(--blue);flex-shrink:0" ${(v.deductionMethod || 'mileage') === 'mileage' ? 'checked' : ''}>
              <div style="flex:1;min-width:0">
                <div style="font-size:13px;font-weight:700">Standard mileage rate</div>
                <div style="font-size:11px;color:var(--text3);margin-top:2px">Deduct ${((S.irsRate || 0.67) * 100).toFixed(0)}¢ per business mile. Simpler — no need to track every expense. Maintenance records are for your info only.</div>
              </div>
            </label>
            <label style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border:1.5px solid ${v.deductionMethod === 'actual' ? 'var(--blue)' : 'var(--border2)'};border-radius:var(--r);cursor:pointer;background:${v.deductionMethod === 'actual' ? 'rgba(45,93,168,.06)' : 'var(--bg2)'}">
              <input type="radio" name="fv-deduct" value="actual" style="margin-top:2px;accent-color:var(--blue);flex-shrink:0" ${v.deductionMethod === 'actual' ? 'checked' : ''}>
              <div style="flex:1;min-width:0">
                <div style="font-size:13px;font-weight:700">Actual expenses</div>
                <div style="font-size:11px;color:var(--text3);margin-top:2px">Deduct real costs — fuel, maintenance, depreciation at your business-use %. Requires keeping all receipts.</div>
              </div>
            </label>
          </div>
        </div>
      </div>
      <button class="btn btn-p" onclick="saveFleetVehicle()" style="width:100%;padding:14px;font-size:16px;font-weight:700">${isEdit ? 'Save changes' : 'Add vehicle'}</button>
      ${isEdit && (v.status || 'active') !== 'sold' ? `<button class="btn" onclick="openFleetSaleModal(${_fleetEditIdx})" style="width:100%;margin-top:8px;background:var(--bg2);border-color:var(--border2);font-size:13px">📦 Record sale of this vehicle</button>` : ''}
      ${isEdit ? `<button class="btn" onclick="_confirmRemoveVehicle(${_fleetEditIdx})" style="width:100%;margin-top:8px;background:none;border:none;color:var(--red);font-size:13px">Remove vehicle</button>` : ''}
    </div>
  `;
  ov.style.display = 'flex';
}
function _createFleetVehOverlay() {
  const ov = document.createElement('div');
  ov.id = 'fleet-veh-overlay';
  ov.style.cssText = 'display:none;position:fixed;inset:0;z-index:3001;background:rgba(0,0,0,.5);align-items:flex-end;justify-content:center';
  const box = document.createElement('div');
  box.id = 'fleet-veh-box';
  box.style.cssText = 'background:var(--bg);border-radius:var(--rl) var(--rl) 0 0;width:100%;max-width:520px;overflow:hidden';
  ov.appendChild(box);
  document.body.appendChild(ov);
  ov.addEventListener('click', e => {
    if (e.target === ov) _closeFleetVehModal();
  });
  return ov;
}
function _closeFleetVehModal() {
  const ov = document.getElementById('fleet-veh-overlay');
  if (ov) ov.style.display = 'none';
}
function saveFleetVehicle() {
  const name = (document.getElementById('fv-name') ? document.getElementById('fv-name').value : '').trim();
  if (!name) {
    zAlert('Enter a year, make, and model for this vehicle.');
    return;
  }
  const vehs = getVehicles();
  const isEdit = _fleetEditIdx >= 0;
  const oldV = isEdit ? vehs[_fleetEditIdx] || {} : {};
  const deductEl = document.querySelector('input[name="fv-deduct"]:checked');
  const newV = {
    ...oldV,
    name,
    nickname: (document.getElementById('fv-nick') ? document.getElementById('fv-nick').value : '').trim(),
    color: (document.getElementById('fv-color') ? document.getElementById('fv-color').value : '').trim(),
    plate: (document.getElementById('fv-plate') ? document.getElementById('fv-plate').value : '').trim().toUpperCase(),
    vin: (document.getElementById('fv-vin') ? document.getElementById('fv-vin').value : '').trim().toUpperCase(),
    bizUse: oldV.bizUse || 100,
    // updated by year-end odometer report, not manual entry
    gvwr: document.getElementById('fv-gvwr') ? document.getElementById('fv-gvwr').value : '',
    deductionMethod: deductEl ? deductEl.value : oldV.deductionMethod || 'mileage',
    purchaseDate: _mdYToYmd(document.getElementById('fv-pdate') ? document.getElementById('fv-pdate').value : '') || '',
    purchasePrice: parseFloat(document.getElementById('fv-pprice') ? document.getElementById('fv-pprice').value : 0) || 0,
    purchaseOdo: parseInt(document.getElementById('fv-podo') ? document.getElementById('fv-podo').value : 0) || 0,
    status: oldV.status || 'active',
    downtimeLog: oldV.downtimeLog || [],
    addedDate: oldV.addedDate || todayKey()
  };

  // Auto-create expense if purchase price is new or changed — only for actual expense method
  const newPrice = newV.purchasePrice;
  const oldPrice = oldV.purchasePrice || 0;
  if (newPrice > 0 && newPrice !== oldPrice && newV.deductionMethod === 'actual') {
    const expId = Date.now();
    expenses.unshift({
      id: expId,
      date: newV.purchaseDate || todayKey(),
      cat: 'vehicle_purchase',
      catLabel: 'Vehicle purchase',
      vendor: name,
      amount: newPrice,
      notes: 'Vehicle purchase: ' + name,
      deductible: true,
      created_at: new Date().toISOString()
    });
    newV.purchaseExpenseId = expId;
  } else if (newV.deductionMethod === 'mileage') {
    // Clear any previously-linked purchase expense if user switched to mileage method
    newV.purchaseExpenseId = null;
  }
  if (isEdit) vehs[_fleetEditIdx] = newV;else vehs.push(newV);
  S.vehicles = vehs;
  S.vehiclesTs = Date.now();
  saveAll();
  _closeFleetVehModal();
  renderFleetVehicles();
  showToast(isEdit ? 'Vehicle updated' : 'Vehicle added', '🚗');
  if (!isEdit) setTimeout(() => {
    if (typeof _checkOdometerPrompt === 'function') _checkOdometerPrompt();
  }, 500);
}
function _gvwrNote(gvwr) {
  if (gvwr === 'light') return '<div style="font-size:11px;background:#FEF3C7;border:1px solid #D97706;border-radius:var(--r);padding:6px 8px;color:#92400E">⚠️ <strong>Section 280F applies:</strong> first-year depreciation capped ~$12,200. Standard mileage rate often beats actual expenses for these vehicles.</div>';
  if (gvwr === 'heavy_truck') return '<div style="font-size:11px;background:#F0FDF4;border:1px solid #16A34A;border-radius:var(--r);padding:6px 8px;color:#166534">✓ <strong>No 280F limits.</strong> Full Section 179 or bonus depreciation (up to $70,000). Keep mileage log proving &gt;50% business use every year.</div>';
  if (gvwr === 'heavy_suv') return '<div style="font-size:11px;background:#FEF3C7;border:1px solid #D97706;border-radius:var(--r);padding:6px 8px;color:#92400E">⚠️ <strong>Section 179 SUV cap:</strong> max $31,300 in 2025. A pickup truck with a bed doesn\'t have this cap.</div>';
  if (gvwr === 'commercial') return '<div style="font-size:11px;background:#F0FDF4;border:1px solid #16A34A;border-radius:var(--r);padding:6px 8px;color:#166534">✓ <strong>Commercial vehicle:</strong> no Section 280F limits. Full Section 179 deductible. Maintain &gt;50% business use documentation.</div>';
  return '<div style="font-size:10px;color:var(--text3)">Set weight class above — determines how much depreciation you can deduct (IRS §280F).</div>';
}
function _renderGvwrNote(val) {
  const el = document.getElementById('fv-gvwr-note');
  if (el) el.innerHTML = _gvwrNote(val || '');
}
function _confirmRemoveVehicle(idx) {
  const vehs = getVehicles();
  const v = vehs[idx];
  if (!v) return;
  zConfirm('Remove ' + (v.nickname || v.name) + '? This will not delete service records.', () => {
    vehs.splice(idx, 1);
    S.vehicles = vehs;
    S.vehiclesTs = Date.now();
    saveAll();
    _closeFleetVehModal();
    renderFleetVehicles();
  }, {
    title: 'Remove vehicle',
    yes: 'Remove'
  });
}

/* ── Status modal (down / active) ────────────────────────────────────────────── */
function openFleetStatusModal(idx, toStatus) {
  const vehs = getVehicles();
  const v = vehs[idx];
  if (!v) return;
  if (toStatus === 'active') {
    v.status = 'active';
    const open = (v.downtimeLog || []).find(d => !d.end);
    if (open) open.end = todayKey();
    S.vehicles = vehs;
    S.vehiclesTs = Date.now();
    saveAll();
    _closeFleetDetail();
    renderFleetVehicles();
    showToast((v.nickname || v.name) + ' back in service', '✅');
    return;
  }
  // toStatus === 'down' — ask for reason
  zPrompt('Reason for downtime (optional):', reason => {
    v.status = 'down';
    v.downtimeLog = v.downtimeLog || [];
    v.downtimeLog.push({
      start: todayKey(),
      end: null,
      reason: reason || ''
    });
    S.vehicles = vehs;
    S.vehiclesTs = Date.now();
    saveAll();
    _closeFleetDetail();
    renderFleetVehicles();
    showToast((v.nickname || v.name) + ' marked as down', '🔴');
  }, {
    title: 'Mark as down',
    placeholder: 'e.g. Engine work, tires...'
  });
}

/* ── Sale modal ──────────────────────────────────────────────────────────────── */
function openFleetSaleModal(idx) {
  const vehs = getVehicles();
  const v = vehs[idx];
  if (!v) return;
  _closeFleetVehModal();
  _closeFleetDetail();
  const existing = document.getElementById('fleet-sale-overlay');
  if (existing) existing.remove();
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:3002;background:rgba(0,0,0,.5);display:flex;align-items:flex-end;justify-content:center';
  ov.id = 'fleet-sale-overlay';
  ov.innerHTML = `
    <div style="background:var(--bg);border-radius:var(--rl) var(--rl) 0 0;width:100%;max-width:520px;padding:20px 16px 60px">
      <div style="font-size:18px;font-weight:800;margin-bottom:16px">📦 Record vehicle sale</div>
      <div style="font-size:14px;font-weight:600;color:var(--text3);margin-bottom:14px">${v.nickname || v.name}</div>
      <div class="fg fg2">
        <div class="f"><label>Sale date</label><input type="date" id="fs-date" value="${todayKey()}"></div>
        <div class="f"><label>Sale price ($)</label><input type="number" id="fs-price" min="0" step="100" placeholder="0"></div>
      </div>
      <div class="f"><label>Odometer at sale (mi)</label><input type="number" id="fs-odo" min="0" step="100" placeholder="0"></div>
      ${v.purchasePrice ? `<div style="margin-top:8px;padding:8px 10px;background:var(--bg2);border-radius:var(--r);font-size:12px;color:var(--text3)">Purchase price: $${v.purchasePrice.toLocaleString()} — enter sale price to see gain/loss</div>` : ''}
      <div style="display:grid;gap:8px;margin-top:16px">
        <button class="btn btn-p" onclick="saveFleetSale(${idx})" style="padding:14px;font-size:16px;font-weight:700">Record sale</button>
        <button class="btn" onclick="document.getElementById('fleet-sale-overlay').remove()" style="background:var(--bg2)">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => {
    if (e.target === ov) ov.remove();
  });
}
function saveFleetSale(idx) {
  const vehs = getVehicles();
  const v = vehs[idx];
  if (!v) return;
  const saleDate = document.getElementById('fs-date') ? document.getElementById('fs-date').value || todayKey() : todayKey();
  const salePrice = parseFloat(document.getElementById('fs-price') ? document.getElementById('fs-price').value || 0 : 0) || 0;
  const saleOdo = parseInt(document.getElementById('fs-odo') ? document.getElementById('fs-odo').value || 0 : 0) || 0;
  v.status = 'sold';
  v.saleDate = saleDate;
  v.salePrice = salePrice;
  v.saleOdo = saleOdo;

  // Close any open downtime
  const open = (v.downtimeLog || []).find(d => !d.end);
  if (open) open.end = saleDate;

  // Auto-create income record for sale proceeds
  if (salePrice > 0) {
    const incId = Date.now();
    income.unshift({
      id: incId,
      date: saleDate,
      type: 'Vehicle Sale',
      amount: salePrice,
      notes: 'Sale of ' + (v.nickname || v.name),
      created_at: new Date().toISOString()
    });
    v.saleIncomeId = incId;
  }
  S.vehicles = vehs;
  S.vehiclesTs = Date.now();
  saveAll();
  const saleOv = document.getElementById('fleet-sale-overlay');
  if (saleOv) saleOv.remove();
  renderFleetVehicles();
  showToast('Vehicle sale recorded', '📦');
}

/* ── Add maintenance record modal ────────────────────────────────────────────── */
let _maintModalVehIdx = -1;
let _maintEditId = null;
let _maintPhotoB64 = null;
function openAddMaintenanceModal(vehIdx, editId) {
  _maintModalVehIdx = vehIdx;
  _maintEditId = editId || null;
  _maintPhotoB64 = null;
  if (_maintEditId) {
    const rec = maintenance.find(m => m.id === _maintEditId);
    if (rec && rec.photo) _maintPhotoB64 = rec.photo;
  }
  _renderMaintModal();
}
function _renderMaintModal(savedType) {
  const vehs = getVehicles();
  const v = vehs[_maintModalVehIdx];
  if (!v) return;
  const editRec = _maintEditId ? maintenance.find(m => m.id === _maintEditId) : null;
  const selType = savedType || editRec && editRec.type || 'oil_change';
  const isActualMethod = v.deductionMethod === 'actual';
  const ov = document.getElementById('fleet-maint-overlay') || _createMaintOverlay();
  const box = document.getElementById('fleet-maint-box');
  if (!box) return;
  const typeOptions = Object.entries(MAINT_TYPES).map(([k, d]) => `<option value="${k}"${k === selType ? ' selected' : ''}>${d.icon} ${d.label}</option>`).join('');
  box.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 16px 14px;border-bottom:1px solid var(--border)">
      <div style="min-width:0;flex:1">
        <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);margin-bottom:2px">${v.nickname || v.name}</div>
        <div style="font-size:18px;font-weight:800;color:var(--text)">${_maintEditId ? 'Edit service record' : 'Log service'}</div>
      </div>
      <button class="btn btn-ghost" onclick="_closeMaintModal()" style="flex-shrink:0">Cancel</button>
    </div>
    <div style="padding:14px 16px 100px;overflow-y:auto;max-height:80vh">
      <div class="card" style="margin-bottom:12px">
        <div class="f">
          <label>Service type</label>
          <select id="maint-type" onchange="refreshMaintTypeFields()" style="font-size:14px;font-weight:700">${typeOptions}</select>
        </div>
        <div class="fg fg2">
          <div class="f"><label>Date</label><input type="text" id="maint-date" inputmode="numeric" placeholder="MM/DD/YYYY" maxlength="10" value="${_ymdToMdY(editRec && editRec.date || todayKey())}" oninput="_fmtExpDate(this)"></div>
          <div class="f"><label>Odometer (mi)</label><input type="number" id="maint-odo" min="0" step="1" placeholder="Optional" value="${editRec && editRec.odo || ''}"></div>
        </div>
        <div class="fg fg2">
          <div class="f"><label>Cost ($)</label><input type="number" id="maint-cost" min="0" step="1" placeholder="0.00" value="${editRec && editRec.cost || ''}"></div>
          <div class="f"><label>Vendor / shop</label><input id="maint-vendor" placeholder="Jiffy Lube, AutoZone..." value="${editRec && editRec.vendor || ''}"></div>
        </div>
      </div>
      <div id="maint-type-fields" style="margin-bottom:12px"></div>
      <div class="card" style="margin-bottom:16px">
        <div class="f"><label>Notes</label>
          <textarea id="maint-notes" rows="2" placeholder="Any details..." style="width:100%;padding:8px;font-size:13px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-family:inherit;resize:vertical">${editRec && editRec.notes || ''}</textarea>
        </div>
        ${isActualMethod ? `<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;margin-top:8px">
               <input type="checkbox" id="maint-make-expense" style="width:16px;height:16px;accent-color:var(--blue)" ${editRec && editRec.expenseId ? '' : 'checked'}>
               Log cost as a deductible expense
             </label>` : `<div style="background:var(--bg2);border-radius:var(--r);padding:8px 10px;margin-top:8px">
               <div style="font-size:11px;font-weight:700;color:var(--text3)">📋 Records only — standard mileage method</div>
               <div style="font-size:11px;color:var(--text3);margin-top:2px">Maintenance costs are not deducted separately. The IRS mileage rate already covers them. Switch to actual expenses in vehicle settings to deduct real costs.</div>
             </div>`}
        <div style="margin-top:12px">
          <div style="font-size:11px;font-weight:700;color:var(--text3);margin-bottom:6px">Receipt / service record photo</div>
          <div id="maint-photo-preview" style="${_maintPhotoB64 ? '' : 'display:none;'}margin-bottom:8px">
            <img id="maint-photo-img" src="${_maintPhotoB64 || ''}" style="width:100%;max-height:180px;object-fit:cover;border-radius:var(--r);border:1px solid var(--border)">
            <button onclick="_clearMaintPhoto()" style="width:100%;margin-top:4px;padding:6px;border-radius:var(--r);border:1px solid var(--border2);background:none;color:var(--red);font-size:12px;cursor:pointer;font-family:inherit">Remove photo</button>
          </div>
          <label style="display:flex;align-items:center;justify-content:center;gap:8px;padding:10px 12px;border:1.5px dashed var(--border2);border-radius:var(--r);cursor:pointer;font-size:13px;font-weight:600;color:var(--blue)">
            📷 Scan receipt
            <input type="file" accept="image/*" capture="environment" style="display:none" onchange="_handleMaintPhoto(this)">
          </label>
        </div>
      </div>
      <button class="btn btn-p" onclick="saveMaintRecord()" style="width:100%;padding:14px;font-size:16px;font-weight:700">Save service record</button>
      ${_maintEditId ? `<button onclick="deleteMaintenanceRecord(${_maintEditId})" style="width:100%;margin-top:8px;padding:11px;background:none;border:none;color:var(--red);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">Delete this record</button>` : ''}
    </div>
  `;
  _renderMaintTypeFields(selType, editRec);
  ov.style.display = 'flex';
}
function _createMaintOverlay() {
  const ov = document.createElement('div');
  ov.id = 'fleet-maint-overlay';
  ov.style.cssText = 'display:none;position:fixed;inset:0;z-index:3002;background:rgba(0,0,0,.5);align-items:flex-end;justify-content:center';
  const box = document.createElement('div');
  box.id = 'fleet-maint-box';
  box.style.cssText = 'background:var(--bg);border-radius:var(--rl) var(--rl) 0 0;width:100%;max-width:520px;overflow:hidden';
  ov.appendChild(box);
  document.body.appendChild(ov);
  ov.addEventListener('click', e => {
    if (e.target === ov) _closeMaintModal();
  });
  return ov;
}
function _closeMaintModal() {
  const ov = document.getElementById('fleet-maint-overlay');
  if (ov) ov.style.display = 'none';
  _maintPhotoB64 = null;
}
function _handleMaintPhoto(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  // Compress to ~800px wide JPEG before storing
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const MAX = 800;
      const scale = img.width > MAX ? MAX / img.width : 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      _maintPhotoB64 = canvas.toDataURL('image/jpeg', 0.8);
      const preview = document.getElementById('maint-photo-preview');
      const imgEl = document.getElementById('maint-photo-img');
      if (preview) preview.style.display = '';
      if (imgEl) imgEl.src = _maintPhotoB64;
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
function _clearMaintPhoto() {
  _maintPhotoB64 = null;
  const preview = document.getElementById('maint-photo-preview');
  if (preview) preview.style.display = 'none';
}
function refreshMaintTypeFields() {
  const typeEl = document.getElementById('maint-type');
  const type = typeEl ? typeEl.value : '';
  if (type) _renderMaintTypeFields(type, null);
}
function _renderMaintTypeFields(type, rec) {
  const el = document.getElementById('maint-type-fields');
  if (!el) return;
  if (type === 'oil_change') {
    const curOdoEl = document.getElementById('maint-odo');
    const curOdo = curOdoEl ? parseInt(curOdoEl.value) || 0 : 0;
    const defaultNext = curOdo > 0 ? curOdo + 5000 : '';
    const defaultNextDate = _fleetAddMonths(todayKey(), 6);
    el.innerHTML = `
      <div class="card">
        <div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:10px">🛢️ Oil change details</div>
        <div class="fg fg2">
          <div class="f"><label>Oil type</label>
            <select id="m-oil-type">
              <option value="">— Select —</option>
              ${['0W-20 Full Synthetic', '5W-20 Full Synthetic', '5W-30 Full Synthetic', '5W-30 Semi-Synthetic', '5W-30 Conventional', '5W-40 Full Synthetic', '10W-30 Conventional', '10W-40 Conventional', '0W-16 Full Synthetic', 'Diesel 15W-40'].map(o => `<option${rec && rec.oilType === o ? ' selected' : ''}>${o}</option>`).join('')}
            </select>
          </div>
          <div class="f"><label>Oil brand</label><input id="m-oil-brand" placeholder="Mobil 1, Castrol..." value="${rec && rec.oilBrand || ''}"></div>
        </div>
        <div class="f"><label>Filter part #</label>
          <input id="m-oil-filter" placeholder="Part number" value="${rec && rec.oilFilterPart || ''}">
        </div>
        <div class="fg fg2">
          <div class="f"><label>Next change (mi) <span style="font-size:10px;font-weight:400;color:var(--text3)">optional</span></label><input type="number" id="m-next-mi" placeholder="e.g. 92000" value="${rec && rec.nextOilMiles || ''}"></div>
          <div class="f"><label>Next change (date) <span style="font-size:10px;font-weight:400;color:var(--text3)">optional</span></label><input type="text" id="m-next-date" inputmode="numeric" placeholder="MM/DD/YYYY" maxlength="10" value="${rec && rec.nextOilDate ? _ymdToMdY(rec.nextOilDate) : ''}" oninput="_fmtExpDate(this)"></div>
        </div>
      </div>`;
  } else if (type === 'brakes') {
    el.innerHTML = `<div class="card">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:10px">🔴 Brake details</div>
      <div class="fg fg2">
        <div class="f"><label>Axle</label>
          <select id="m-brake-axle">
            <option value="">— Select —</option>
            <option value="front" ${rec && rec.brakeAxle === 'front' ? 'selected' : ''}>Front</option>
            <option value="rear" ${rec && rec.brakeAxle === 'rear' ? 'selected' : ''}>Rear</option>
            <option value="both" ${rec && rec.brakeAxle === 'both' ? 'selected' : ''}>Both axles</option>
          </select>
        </div>
        <div class="f"><label>Pad brand</label><input id="m-brake-brand" placeholder="Brembo, Akebono..." value="${rec && rec.brakePadBrand || ''}"></div>
      </div>
      <div class="f"><label>Pad part #</label><input id="m-brake-part" placeholder="Part number" value="${rec && rec.brakePadPart || ''}"></div>
    </div>`;
  } else if (type === 'tires') {
    el.innerHTML = `<div class="card">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:10px">⭕ Tire details</div>
      <div class="fg fg2">
        <div class="f"><label>Tire brand</label><input id="m-tire-brand" placeholder="Michelin, BFG..." value="${rec && rec.tireBrand || ''}"></div>
        <div class="f"><label>Tire size</label><input id="m-tire-size" placeholder="265/70R17" value="${rec && rec.tireSize || ''}"></div>
      </div>
      <div class="f"><label># of tires replaced</label>
        <select id="m-tire-count">
          ${[1, 2, 3, 4, 5, 6].map(n => `<option value="${n}"${rec && rec.tireCount === n ? ' selected' : ''}>${n} tire${n === 1 ? '' : 's'}</option>`).join('')}
        </select>
      </div>
    </div>`;
  } else if (type === 'battery') {
    el.innerHTML = `<div class="card">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:10px">🔋 Battery details</div>
      <div class="fg fg2">
        <div class="f"><label>Brand</label><input id="m-bat-brand" placeholder="Optima, Interstate..." value="${rec && rec.batteryBrand || ''}"></div>
        <div class="f"><label>Part #</label><input id="m-bat-part" placeholder="Part number" value="${rec && rec.batteryPart || ''}"></div>
      </div>
      <div class="f"><label>Cold cranking amps (CCA)</label><input id="m-bat-cca" placeholder="720 CCA" value="${rec && rec.batteryCCA || ''}"></div>
    </div>`;
  } else if (type === 'fuel_filter' || type === 'air_filter' || type === 'belt') {
    const def = MAINT_TYPES[type];
    el.innerHTML = `<div class="card">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:10px">${def.icon} ${def.label} details</div>
      <div class="fg fg2">
        <div class="f"><label>Brand</label><input id="m-part-brand" placeholder="Brand name" value="${rec && rec.partBrand || ''}"></div>
        <div class="f"><label>Part #</label><input id="m-part-num" placeholder="Part number" value="${rec && rec.partNum || ''}"></div>
      </div>
    </div>`;
  } else {
    el.innerHTML = '';
  }
}
function saveMaintRecord() {
  const vehs = getVehicles();
  const v = vehs[_maintModalVehIdx];
  if (!v) return;
  const typeEl = document.getElementById('maint-type');
  const type = typeEl ? typeEl.value : 'other';
  const dateEl = document.getElementById('maint-date');
  const date = _mdYToYmd(dateEl ? dateEl.value : '') || todayKey();
  const odoEl = document.getElementById('maint-odo');
  const odo = odoEl ? parseInt(odoEl.value) || 0 : 0;
  const costEl = document.getElementById('maint-cost');
  const cost = costEl ? parseFloat(costEl.value) || 0 : 0;
  const vendorEl = document.getElementById('maint-vendor');
  const vendor = vendorEl ? (vendorEl.value || '').trim() : '';
  const notesEl = document.getElementById('maint-notes');
  const notes = notesEl ? (notesEl.value || '').trim() : '';
  const rec = {
    id: _maintEditId || Date.now(),
    vehicleName: v.name,
    date,
    odo,
    type,
    typeLabel: MAINT_TYPES[type] ? MAINT_TYPES[type].label : type,
    cost,
    vendor,
    notes,
    photo: _maintPhotoB64 || (_maintEditId && maintenance.find(m => m.id === _maintEditId) || {}).photo || null,
    created_at: new Date().toISOString()
  };

  // Collect type-specific fields
  if (type === 'oil_change') {
    const oilTypeEl = document.getElementById('m-oil-type');
    const oilBrandEl = document.getElementById('m-oil-brand');
    const oilFilterEl = document.getElementById('m-oil-filter');
    const nextMiEl = document.getElementById('m-next-mi');
    const nextDateEl = document.getElementById('m-next-date');
    rec.oilType = oilTypeEl ? oilTypeEl.value || '' : '';
    rec.oilBrand = oilBrandEl ? (oilBrandEl.value || '').trim() : '';
    rec.oilFilterPart = oilFilterEl ? (oilFilterEl.value || '').trim() : '';
    rec.nextOilMiles = nextMiEl ? parseInt(nextMiEl.value) || 0 : 0;
    rec.nextOilDate = nextDateEl ? _mdYToYmd(nextDateEl.value) || '' : '';
  } else if (type === 'brakes') {
    const axleEl = document.getElementById('m-brake-axle');
    const brandEl = document.getElementById('m-brake-brand');
    const partEl = document.getElementById('m-brake-part');
    rec.brakeAxle = axleEl ? axleEl.value || '' : '';
    rec.brakePadBrand = brandEl ? (brandEl.value || '').trim() : '';
    rec.brakePadPart = partEl ? (partEl.value || '').trim() : '';
  } else if (type === 'tires') {
    const tbEl = document.getElementById('m-tire-brand');
    const tsEl = document.getElementById('m-tire-size');
    const tcEl = document.getElementById('m-tire-count');
    rec.tireBrand = tbEl ? (tbEl.value || '').trim() : '';
    rec.tireSize = tsEl ? (tsEl.value || '').trim() : '';
    rec.tireCount = tcEl ? parseInt(tcEl.value) || 4 : 4;
  } else if (type === 'battery') {
    const bbEl = document.getElementById('m-bat-brand');
    const bpEl = document.getElementById('m-bat-part');
    const bcEl = document.getElementById('m-bat-cca');
    rec.batteryBrand = bbEl ? (bbEl.value || '').trim() : '';
    rec.batteryPart = bpEl ? (bpEl.value || '').trim() : '';
    rec.batteryCCA = bcEl ? (bcEl.value || '').trim() : '';
  } else if (type === 'fuel_filter' || type === 'air_filter' || type === 'belt') {
    const pbEl = document.getElementById('m-part-brand');
    const pnEl = document.getElementById('m-part-num');
    rec.partBrand = pbEl ? (pbEl.value || '').trim() : '';
    rec.partNum = pnEl ? (pnEl.value || '').trim() : '';
  }

  // Auto-create expense — only for actual expense method
  const isActualMethod = v.deductionMethod === 'actual';
  const makeExpEl = document.getElementById('maint-make-expense');
  const makeExpense = isActualMethod && makeExpEl ? makeExpEl.checked : false;
  if (makeExpense && cost > 0) {
    const expId = Date.now() + 1;
    expenses.unshift({
      id: expId,
      date,
      cat: 'vehicle',
      catLabel: 'Vehicle — maintenance',
      vendor: vendor || v.nickname || v.name,
      amount: cost,
      notes: (MAINT_TYPES[type] ? MAINT_TYPES[type].label : type) + (notes ? ' — ' + notes : ''),
      deductible: true,
      created_at: new Date().toISOString()
    });
    rec.expenseId = expId;
  }
  if (_maintEditId) {
    const idx = maintenance.findIndex(m => m.id === _maintEditId);
    if (idx >= 0) maintenance[idx] = rec;
  } else {
    maintenance.unshift(rec);
  }
  saveAll();
  _closeMaintModal();
  renderFleetVehicles();

  // Refresh detail modal if open
  if (_fleetDetailIdx === _maintModalVehIdx) {
    _renderFleetDetailModal();
  }
  showToast('Service logged', '🔧');
}
function deleteMaintenanceRecord(id) {
  zConfirm('Delete this service record?', () => {
    const idx = maintenance.findIndex(m => m.id === id);
    if (idx >= 0) maintenance.splice(idx, 1);
    saveAll();
    _closeMaintModal();
    _renderFleetDetailModal();
    renderFleetVehicles();
  }, {
    title: 'Delete record',
    yes: 'Delete',
    danger: true
  });
}
function _showMaintPhoto(id) {
  const rec = maintenance.find(m => String(m.id) === String(id));
  if (!rec || !rec.photo) return;
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.9);display:flex;align-items:center;justify-content:center;cursor:pointer';
  ov.innerHTML = `<img src="${rec.photo}" style="max-width:95vw;max-height:90vh;border-radius:var(--r);object-fit:contain">`;
  ov.addEventListener('click', () => ov.remove());
  document.body.appendChild(ov);
}

/* ── Utility helpers ─────────────────────────────────────────────────────────── */
function _fleetFmtDate(d) {
  if (!d) return '';
  try {
    return new Date(d + 'T12:00:00').toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  } catch (e) {
    return d;
  }
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "js/fleet.js", error: String((e && e.message) || e) }); }

// js/generic-estimate.js
try { (() => {
function openBidNotes(bidId) {
  editingBidId = bidId;
  lastCreatedBidId = bidId;
}
function showNotesFab() {}
function hideNotesFab() {}
function toggleNotesPanel() {}
function notesExpandCanvas() {}
function clearNotesPanel() {}
function _resetNotesForNewEstimate() {}
let hittersFilter = 'all';
function setHittersFilter(f, btn) {
  hittersFilter = f;
  ['all', 'A', 'B'].forEach(t => {
    const b = document.getElementById('hl-filter-' + t);
    if (b) {
      b.style.background = t === f ? 'var(--blue)' : '';
      b.style.color = t === f ? '#fff' : '';
      b.style.borderColor = t === f ? 'var(--blue)' : 'var(--border2)';
    }
  });
  renderHittersList();
}
function renderHittersList() {
  const el = document.getElementById('hl-list');
  const stats = document.getElementById('hl-stats');
  if (!el) return;
  if (!clients.length) {
    el.innerHTML = '<div class="empty">No clients yet. Add clients and set their occupation to build your Top Clients list.</div>';
    return;
  }
  // Score each client
  const scored = clients.map(c => {
    const tier = getClientTier(c);
    const cBids = getClientBids(c.id);
    const revenue = getClientIncome(c.id).reduce((s, i) => s + i.amount, 0);
    const wonJobs = cBids.filter(b => b.status === 'Closed Won').length;
    const hasEmail = !!c.email;
    const lastContact = cBids.length ? cBids.sort((a, b) => (b.bid_date || '').localeCompare(a.bid_date || ''))[0].bid_date : '';
    const daysSince = lastContact ? Math.floor((new Date() - new Date(lastContact + 'T12:00')) / 86400000) : 999;
    // Score: A=3pts, B=2pts, C=1pt + revenue bonuses + realtor bonus
    let score = tier === 'A' ? 30 : tier === 'B' ? 20 : 10;
    score += Math.min(revenue / 1000, 30); // up to 30pts for revenue
    score += wonJobs * 5;
    if (c.occupation === 'Realtor / Real estate agent' || c.occupation === 'Property manager') score += 20;
    if (c.source === 'Real estate agent') score += 15;
    if (daysSince < 90) score += 10;
    if (hasEmail) score += 5;
    return {
      c,
      tier,
      revenue,
      wonJobs,
      score,
      daysSince,
      hasEmail,
      lastContact
    };
  }).filter(x => hittersFilter === 'all' || x.tier === hittersFilter).sort((a, b) => b.score - a.score);

  // Stats header
  const aCount = clients.filter(c => getClientTier(c) === 'A').length;
  const bCount = clients.filter(c => getClientTier(c) === 'B').length;
  const realtors = clients.filter(c => c.occupation === 'Realtor / Real estate agent' || c.source === 'Real estate agent').length;
  stats.innerHTML = '<div class="mets">' + '<div class="met"><div class="met-l">A-tier clients</div><div class="met-v" style="color:var(--green-mid)">' + aCount + '</div></div>' + '<div class="met"><div class="met-l">B-tier clients</div><div class="met-v" style="color:var(--blue)">' + bCount + '</div></div>' + '<div class="met"><div class="met-l">Realtors / PMs</div><div class="met-v" style="color:var(--amber)">' + realtors + '</div></div>' + '</div>';
  if (!scored.length) {
    el.innerHTML = '<div class="empty">No ' + hittersFilter + '-tier clients yet.</div>';
    return;
  }
  el.innerHTML = scored.map(({
    c,
    tier,
    revenue,
    wonJobs,
    score,
    daysSince,
    hasEmail,
    lastContact
  }) => {
    const tierColor = getTierColor(tier);
    const isRealtor = c.occupation === 'Realtor / Real estate agent' || c.source === 'Real estate agent';
    const isPM = c.occupation === 'Property manager' || c.source === 'Property manager';
    const daysLabel = daysSince === 999 ? 'No contact yet' : daysSince === 0 ? 'Today' : daysSince === 1 ? 'Yesterday' : daysSince + ' days ago';
    return '<div onclick="openClientDetail(' + c.id + ')" class="card" style="cursor:pointer;margin-bottom:8px;border-left:3px solid ' + tierColor + '">' + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">' + '<div style="flex:1;min-width:0">' + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;flex-wrap:wrap">' + '<div style="font-size:14px;font-weight:700">' + c.name + '</div>' + '<span style="font-size:10px;font-weight:800;padding:2px 6px;border-radius:10px;background:' + tierColor + '22;color:' + tierColor + '">' + tier + '-tier</span>' + (isRealtor ? '<span style="font-size:10px;font-weight:700;color:var(--amber)">🏡 Realtor</span>' : '') + (isPM ? '<span style="font-size:10px;font-weight:700;color:var(--blue)">🏢 PM</span>' : '') + '</div>' + (c.occupation ? '<div style="font-size:11px;color:var(--text2);margin-bottom:2px">' + c.occupation + '</div>' : '') + '<div style="font-size:11px;color:var(--text3)">Last contact: ' + daysLabel + (revenue ? ' · ' + fmt(revenue) + ' lifetime' : '') + (wonJobs ? ' · ' + wonJobs + ' job' + (wonJobs !== 1 ? 's' : '') : '') + '</div>' + '</div>' + '<div style="text-align:right;flex-shrink:0">' + '<div style="font-size:11px;font-weight:700;color:var(--text3)">Score</div>' + '<div style="font-size:18px;font-weight:800;color:' + tierColor + '">' + Math.round(score) + '</div>' + '</div>' + '</div>' + (hasEmail ? '<div style="margin-top:8px;display:flex;gap:6px">' + '<a href="mailto:' + c.email + '" onclick="event.stopPropagation()" class="btn btn-sm" style="font-size:11px;text-decoration:none">📧 Email</a>' + (c.phone ? '<a href="sms:' + c.phone.replace(/\D/g, '') + '" onclick="event.stopPropagation()" class="btn btn-sm" style="font-size:11px;text-decoration:none">💬 Text</a>' : '') + '</div>' : c.phone ? '<div style="margin-top:8px">' + '<a href="sms:' + c.phone.replace(/\D/g, '') + '" onclick="event.stopPropagation()" class="btn btn-sm" style="font-size:11px;text-decoration:none">💬 Text</a>' + '</div>' : '') + '</div>';
  }).join('');
}
function applyPermissions() {
  const taxNav = document.getElementById('nb-taxes');
  if (taxNav) taxNav.style.display = canSeeTaxes() ? '' : 'none';
  // Hide restricted nav items for employees
  if (_isEmployee) {
    ['nb-leads', 'nb-tracker', 'nb-team', 'nb-settings', 'mtb-leads', 'mmi-tracker', 'mmi-taxes', 'mmi-team', 'mmi-settings', 'mmi-money'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    // Also hide taxes nav button (already hidden by canSeeTaxes but be explicit)
    if (taxNav) taxNav.style.display = 'none';
  }
  _renderDevTradeCard();
  // Update nav user section
  const nameEl = document.getElementById('nav-user-name');
  const roleEl = document.getElementById('nav-user-role');
  const avatarEl = document.getElementById('nav-user-avatar');
  const _meta = _supaUser?.user_metadata;
  const _metaName = _meta?.full_name || _meta?.name || '';
  const _rawName = _isEmployee ? _employeeRecord?.name || 'Employee' : getOwnerName() || _metaName || '';
  // Never display an email address as the nav name — fall back to business name
  const name = _rawName && !_rawName.includes('@') ? _rawName : S.bname || 'My Account';
  if (nameEl) nameEl.textContent = name;
  if (roleEl) roleEl.textContent = _isEmployee ? 'Employee' : getRole().charAt(0).toUpperCase() + getRole().slice(1);
  if (avatarEl) avatarEl.textContent = name === 'My Account' ? '👤' : name.charAt(0).toUpperCase();
}

// ── Multi-trade support ───────────────────────────────────────────────
const TRADE_META = {
  painting: {
    icon: '🎨',
    label: 'Painting'
  },
  plumbing: {
    icon: '🔧',
    label: 'Plumbing'
  },
  electrical: {
    icon: '⚡',
    label: 'Electrical'
  },
  hvac: {
    icon: '❄️',
    label: 'HVAC'
  },
  roofing: {
    icon: '🏠',
    label: 'Roofing'
  },
  landscaping: {
    icon: '🌿',
    label: 'Landscaping'
  },
  general: {
    icon: '🔨',
    label: 'General'
  },
  other: {
    icon: '🛠',
    label: 'Other'
  }
};
let _activeTrade = null; // set on login from account_config.business_type

function getActiveTrade() {
  return _activeTrade || _config?.business_type || 'painting';
}
function setActiveTrade(type) {
  _activeTrade = type;
  _renderNavTradeSwitcher();
  _renderDevTradeCard();
  _renderSettingsTradeSections();
}
function _getTradeLines() {
  const raw = _config?.trade_lines;
  if (!raw) return [getActiveTrade()];
  if (Array.isArray(raw)) return raw;
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}
function _renderNavTradeSwitcher() {
  const wrap = document.getElementById('nav-trade-switcher');
  const pills = document.getElementById('nav-trade-pills');
  if (!wrap || !pills) return;
  const lines = _getTradeLines();
  if (lines.length <= 1) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = '';
  const active = getActiveTrade();
  pills.innerHTML = lines.map(t => {
    const m = TRADE_META[t] || {
      icon: '🔧',
      label: t
    };
    const sel = t === active;
    return `<button onclick="setActiveTrade('${t}')" style="padding:4px 8px;border-radius:20px;border:1px solid ${sel ? 'var(--blue)' : 'rgba(255,255,255,.15)'};background:${sel ? 'var(--blue)' : 'rgba(255,255,255,.06)'};color:${sel ? '#fff' : 'rgba(255,255,255,.55)'};font-size:11px;font-weight:${sel ? 700 : 400};cursor:pointer;font-family:inherit">${m.icon} ${m.label}</button>`;
  }).join('');
}

// ── Generic estimate (non-painting trades) ────────────────────────────
let _geiClientId = null,
  _geiEditBidId = null,
  _geiLines = [],
  _geiTrade = null,
  _geiIsCommercial = false,
  _geiEmergency = false,
  _geiStep = 1,
  _geiNewWork = false;
let _panelSched = null; // null = not active, obj = panel schedule data
let _geiIsTM = false,
  _tmCrewCount = 1,
  _tmRatePerMan = 0,
  _tmEstHours = 0,
  _tmBillingCycle = 'weekly';
let _tmMatMarkup = 0,
  _tmCapAction = 'Stop & get re-approval';
let _geiIsFreeForm = false;
function openTMEstimate(c, bidId) {
  _geiIsTM = true;
  _geiIsFreeForm = false;
  openGenericEstimate(c, bidId, null);
}
function openFreeFormEstimate(c, bidId) {
  _geiIsFreeForm = true;
  _geiIsTM = false;
  openGenericEstimate(c, bidId, null);
}
function openGenericEstimate(c, bidId, _tradePick) {
  _geiClientId = c?.id || null;
  _geiEditBidId = bidId || null;
  _geiLines = [];
  _byoItems = [];
  _byoCustomSections = [];
  _byoCustomTerms = '';
  _geiIsCommercial = false;
  _geiEmergency = false;
  _panelSched = null;
  _geiStep = 1;
  _geiNewWork = false;
  const _wasTM = _geiIsTM,
    _wasFF = _geiIsFreeForm;
  _geiIsTM = false;
  _geiIsFreeForm = false;
  if (_wasTM) {
    _geiIsTM = true;
  } else {
    _tmCrewCount = 1;
    _tmRatePerMan = 0;
    _tmEstHours = 0;
    _tmBillingCycle = 'weekly';
    _tmMatMarkup = 0;
    _tmCapAction = 'Stop & get re-approval';
  }
  if (_wasFF) _geiIsFreeForm = true;
  document.getElementById('gei-cart-bar')?.remove();
  if (_tradePick) _activeTrade = _tradePick;
  _geiTrade = _tradePick || getActiveTrade();
  const trade = _geiTrade;
  const m = TRADE_META[trade] || {
    icon: '🔧',
    label: trade.charAt(0).toUpperCase() + trade.slice(1)
  };
  const titleEl = document.getElementById('gei-trade-title');
  if (titleEl) titleEl.textContent = m.icon + ' ' + m.label + ' Proposal';
  const eyebrowEl = document.getElementById('gei-tbar-eyebrow');
  if (eyebrowEl) eyebrowEl.textContent = m.label + ' proposal';
  const sf = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
  };
  sf('gei-client', c?.name || '');
  sf('gei-addr', c?.addr || '');
  const DESC_PH = {
    electrical: 'e.g. Panel upgrade, add EV charger in garage',
    plumbing: 'e.g. Replace water heater, install shutoff valves',
    hvac: 'e.g. Replace AC unit, charge refrigerant',
    roofing: 'e.g. Full shingle replacement, fix ridge flashing',
    landscaping: 'e.g. Weekly mowing, spring cleanup, new mulch',
    general: 'e.g. Drywall repair, power washing, handyman'
  };
  sf('gei-desc', '');
  sf('gei-notes', '');
  sf('gei-tax-pct', '0');
  sf('gei-duration', '');
  const descEl = document.getElementById('gei-desc');
  if (descEl) descEl.placeholder = DESC_PH[_geiTrade] || 'Describe the job';
  const nwEl = document.getElementById('gei-new-work');
  if (nwEl) nwEl.checked = false;
  document.getElementById('gei-date').value = todayKey();
  if (bidId) {
    const b = bids.find(x => x.id === bidId);
    if (b) {
      sf('gei-desc', b.type || '');
      sf('gei-notes', b.notes || '');
      if (b.geiLines && b.geiLines.length) _geiLines = JSON.parse(JSON.stringify(b.geiLines));
      if (b.geiTaxPct) sf('gei-tax-pct', b.geiTaxPct);
      if (b.geiDuration) sf('gei-duration', b.geiDuration);
      if (b.geiNewWork) {
        _geiNewWork = true;
        if (nwEl) nwEl.checked = true;
      }
      if (b.panelSched) _panelSched = JSON.parse(JSON.stringify(b.panelSched));
      if (b.isTM) {
        _geiIsTM = true;
        _tmCrewCount = b.tmCrewCount || 1;
        _tmRatePerMan = b.tmRatePerMan || 0;
        _tmEstHours = b.tmEstHours || 0;
        _tmBillingCycle = b.tmBillingCycle || 'weekly';
        _tmMatMarkup = b.tmMatMarkup || b.geiTaxPct || 0;
        _tmCapAction = b.tmCapAction || 'Stop & get re-approval';
      }
      if (b.isFreeForm) _geiIsFreeForm = true;
      // Restore deposit pct from saved bid (back-calculate from deposit/amount)
      if (!b.isTM && b.amount > 0 && b.deposit > 0) {
        const _storedPct = Math.round(b.deposit / b.amount * 100);
        const _depEl = document.getElementById('byo-deposit-pct');
        if (_depEl) _depEl.value = _storedPct;
      }
    }
  }
  if (!_geiEditBidId) {
    // Reuse any existing GEI draft or unsent bid for this client+trade (prevents duplicates).
    // Two-pass: exact trade match first; then heal old bids with undefined trade_type.
    const _tMatch = b => b.client_id === _geiClientId && !b.signingToken && b.geiLines !== undefined && (b.status === 'Draft' || b.status === 'Pending');
    let _existingGei = bids.find(b => _tMatch(b) && b.trade_type === _geiTrade);
    if (!_existingGei) {
      // Fallback: pick up old bids that predate the trade_type field
      _existingGei = bids.find(b => _tMatch(b) && (b.trade_type === undefined || b.trade_type === null || b.trade_type === ''));
    }
    if (_existingGei) {
      _existingGei.trade_type = _geiTrade; // heal legacy bids
      _geiEditBidId = _existingGei.id;
      const _b = _existingGei;
      sf('gei-desc', _b.type || '');
      sf('gei-notes', _b.notes || '');
      if (_b.geiLines && _b.geiLines.length) _geiLines = JSON.parse(JSON.stringify(_b.geiLines));
      if (_b.geiTaxPct) sf('gei-tax-pct', _b.geiTaxPct);
      if (_b.geiDuration) sf('gei-duration', _b.geiDuration);
      if (_b.geiNewWork) {
        _geiNewWork = true;
        if (nwEl) nwEl.checked = true;
      }
      if (_b.panelSched) _panelSched = JSON.parse(JSON.stringify(_b.panelSched));
      if (_b.isFreeForm) _geiIsFreeForm = true;
      if (_b.isTM) {
        _geiIsTM = true;
        _tmCrewCount = _b.tmCrewCount || 1;
        _tmRatePerMan = _b.tmRatePerMan || 0;
        _tmEstHours = _b.tmEstHours || 0;
        _tmBillingCycle = _b.tmBillingCycle || 'weekly';
        _tmMatMarkup = _b.tmMatMarkup || _b.geiTaxPct || 20;
        _tmCapAction = _b.tmCapAction || 'Stop & get re-approval';
      }
      if (!_b.isTM && _b.amount > 0 && _b.deposit > 0) {
        const _storedPct = Math.round(_b.deposit / _b.amount * 100);
        const _depEl = document.getElementById('byo-deposit-pct');
        if (_depEl) _depEl.value = _storedPct;
      }
      // Purge other empty duplicates for this client+trade now that we have the right one
      bids = bids.filter(b => b.id === _existingGei.id || !(b.client_id === _geiClientId && !b.signingToken && b.geiLines !== undefined && !b.amount && !(b.geiLines || []).length && (b.status === 'Draft' || b.status === 'Pending') && (b.trade_type === _geiTrade || !b.trade_type)));
      saveAll();
    }
  }
  if (!_geiEditBidId) {
    const _draftClientName = c ? c.name || '' : '';
    const _draftTypeLabel = TRADE_META && TRADE_META[_geiTrade] ? TRADE_META[_geiTrade].label || 'Trade' : 'Trade';
    const draftBid = {
      id: _newBidId(),
      client_id: _geiClientId,
      client_name: _draftClientName,
      bid_date: todayKey(),
      amount: 0,
      deposit: 0,
      type: _draftTypeLabel + ' estimate',
      notes: '',
      status: 'Draft',
      draft: true,
      trade_type: _geiTrade,
      geiLines: [],
      geiTaxPct: 0
    };
    bids.unshift(draftBid);
    _geiEditBidId = draftBid.id;
    saveAll();
  }
  goPg('pg-est-generic');
  goGeiStep(1);
}
function goGeiStep(n) {
  // T&M mode — single-page layout
  if (_geiIsTM) {
    _geiStep = n;
    _tmShowPage();
    window.scrollTo({
      top: 0,
      behavior: 'instant'
    });
    return;
  }
  // BYO / free-form mode — single-page layout
  if (_geiIsFreeForm) {
    _geiStep = n;
    _byoShowPage();
    window.scrollTo({
      top: 0,
      behavior: 'instant'
    });
    return;
  }
  // If going to Step 2 and no bundles are set, show the onboarding picker first (skip for free-form)
  if (n === 2 && (!S.myBundles || !S.myBundles.length) && !_geiIsFreeForm) {
    showGeiOnboarding();
    return;
  }
  _geiStep = n;
  [1, 2, 3].forEach(i => {
    const el = document.getElementById('gei-s' + i);
    if (el) el.style.display = i === n ? '' : 'none';
  });
  window.scrollTo({
    top: 0,
    behavior: 'instant'
  });
  _geiRenderStepBar();
  _geiSyncScopeButtons();
  const show = v => id => {
    const d = document.getElementById(id);
    if (d) d.style.display = v;
  };
  // Always hide all mode chips/sections first
  ['gei-tm-chip', 'gei-tm-reason-wrap', 'gei-tm-crew', 'gei-tm-terms', 'gei-ff-chip'].forEach(id => {
    const d = document.getElementById(id);
    if (d) d.style.display = 'none';
  });
  const svcWrap = document.getElementById('gei-svc-wrap');
  if (_geiIsTM) {
    show('block')('gei-tm-chip');
    show('block')('gei-tm-reason-wrap');
    if (n === 2) show('block')('gei-tm-crew');
    if (n === 3) {
      show('block')('gei-tm-terms');
      _tmSyncCycleButtons();
      _tmCalcDeposit();
      _tmCalcNte();
    }
    const titleEl = document.getElementById('gei-trade-title');
    if (titleEl) titleEl.textContent = '⏱️ Time & Materials';
    const eyebrowEl = document.getElementById('gei-tbar-eyebrow');
    if (eyebrowEl) eyebrowEl.textContent = 'T&M estimate';
    if (svcWrap) svcWrap.style.display = 'none';
    if (n === 2) {
      const cd = document.getElementById('tm-crew-display');
      if (cd) cd.textContent = _tmCrewCount;
      const ri = document.getElementById('tm-rate');
      if (ri && _tmRatePerMan) ri.value = _tmRatePerMan;
      const hi = document.getElementById('tm-hours');
      if (hi && _tmEstHours) hi.value = _tmEstHours;
      if (_tmRatePerMan || _tmEstHours) _tmRecalc();
    }
    if (n === 1) {
      const b = bids.find(x => x.id === _geiEditBidId);
      if (b?.tmReason) {
        const rs = document.getElementById('tm-reason');
        if (rs) rs.value = b.tmReason;
      }
      if (b?.tmReasonNote) {
        const rn = document.getElementById('tm-reason-note');
        if (rn) rn.value = b.tmReasonNote;
      }
    }
  } else if (_geiIsFreeForm) {
    show('block')('gei-ff-chip');
    if (svcWrap) svcWrap.style.display = 'none';
    const titleEl = document.getElementById('gei-trade-title');
    if (titleEl) titleEl.textContent = '✏️ Build Your Own';
    const eyebrowEl = document.getElementById('gei-tbar-eyebrow');
    if (eyebrowEl) eyebrowEl.textContent = 'Free-form estimate';
  } else {
    if (svcWrap) svcWrap.style.display = 'flex';
  }
  const bar = document.getElementById('gei-cart-bar');
  if (bar) bar.style.display = n === 2 && _geiLines.length ? 'flex' : 'none';
  if (n === 2) {
    if (_geiIsFreeForm) _geiRenderFreeFormBuilder();else if (!_geiIsTM) _geiRenderTemplates();
    _geiRenderCartBar();
  }
  if (n === 3) {
    renderGeiLines();
    calcGeiTotal();
    _panelRenderSection();
  }
}

// ── T&M helpers ──────────────────────────────────────────────────────────────
function _tmAdj(delta) {
  _tmCrewCount = Math.max(1, _tmCrewCount + delta);
  const d = document.getElementById('tm-crew-display');
  if (d) d.textContent = _tmCrewCount;
  _tmRecalc();
}
function _tmRecalc() {
  _tmCrewCount = parseInt(document.getElementById('tm-crew-display')?.textContent) || _tmCrewCount || 1;
  _tmRatePerMan = parseFloat(document.getElementById('tm-rate')?.value) || 0;
  _tmEstHours = parseFloat(document.getElementById('tm-hours')?.value) || 0;
  const labor = _tmCrewCount * _tmRatePerMan * _tmEstHours;
  const el = document.getElementById('tm-labor-est');
  if (el) el.textContent = labor ? '$' + labor.toLocaleString('en-US', {
    maximumFractionDigits: 0
  }) : '—';
  const fml = document.getElementById('tm-crew-formula');
  if (fml) fml.textContent = _tmRatePerMan && _tmEstHours ? _tmCrewCount + ' worker' + (_tmCrewCount > 1 ? 's' : '') + ' × $' + _tmRatePerMan + '/hr × ' + _tmEstHours + 'hrs' : 'Enter rate & hours above';
  // Upsert labor line
  const idx = _geiLines.findIndex(l => l._tmLabor);
  const desc = 'Labor — ' + _tmCrewCount + ' worker' + (_tmCrewCount > 1 ? 's' : '') + ' @ $' + _tmRatePerMan + '/hr';
  const line = {
    desc,
    qty: _tmEstHours,
    unit: 'hr',
    rate: Math.round(_tmRatePerMan * _tmCrewCount),
    _tmLabor: true,
    total: Math.round(_tmRatePerMan * _tmCrewCount * _tmEstHours)
  };
  if (idx >= 0) {
    if (labor > 0) _geiLines[idx] = line;else _geiLines.splice(idx, 1);
  } else if (labor > 0) _geiLines.unshift(line);
  renderGeiLines();
  calcGeiTotal();
}
function _tmCalcDeposit() {
  const {
    sub
  } = calcGeiTotal();
  const pct = parseFloat(document.getElementById('tm-dep-pct')?.value) || 20;
  const amt = Math.round(sub * pct / 100);
  const el = document.getElementById('tm-dep-amt');
  if (el) el.textContent = amt ? '$' + amt.toLocaleString('en-US', {
    maximumFractionDigits: 0
  }) : '—';
  // Also update NTE suggestion if not manually set
  _tmCalcNte();
}
function _tmCalcNte() {
  const on = document.getElementById('tm-nte-on')?.checked;
  const wrap = document.getElementById('tm-nte-wrap');
  if (wrap) wrap.style.display = on ? 'block' : 'none';
  if (!on) return;
  const cap = document.getElementById('tm-nte-cap');
  if (cap && (!cap.value || parseFloat(cap.value) === 0)) {
    const {
      sub
    } = calcGeiTotal();
    if (sub > 0) cap.value = Math.round(sub * 1.15 / 500) * 500; // round to nearest $500
  }
}
function _tmSetCycle(v) {
  _tmBillingCycle = v;
  _tmSyncCycleButtons();
}
function _tmSyncCycleButtons() {
  ['weekly', 'biweekly', 'milestone', 'completion'].forEach(c => {
    const btn = document.getElementById('tmc-' + c);
    if (!btn) return;
    const active = _tmBillingCycle === c;
    btn.style.background = active ? 'var(--blue)' : 'var(--bg2)';
    btn.style.color = active ? '#fff' : 'var(--text2)';
    btn.style.border = active ? '1.5px solid var(--blue)' : '1.5px solid var(--border2)';
  });
}

// ── T&M single-page layout (matches design spec EstimateTM.jsx) ──────────────
function _tmShowPage() {
  // Hide legacy wizard UI inside pg-est-generic
  ['gei-old-tbar', 'gei-step-bar', 'gei-s1', 'gei-s2', 'gei-s3'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const p = document.getElementById('gei-tm-page');
  if (p) p.style.display = '';
  // Trade branding in title
  const _tm = TRADE_META[_geiTrade || getActiveTrade()] || {
    icon: '🔧',
    label: 'Trade'
  };
  const titleEl = document.getElementById('tm-tbar-title');
  if (titleEl) titleEl.textContent = _tm.icon + ' ' + _tm.label + ' · Time & Materials';
  // Sub-header: client name · address
  const c = getClientById(_geiClientId);
  const sub = document.getElementById('tm-page-sub');
  if (sub) {
    const parts = [];
    if (c?.name) parts.push(c.name);
    if (c?.addr) parts.push(c.addr.split(',')[0]);
    sub.textContent = parts.join(' · ') || 'New estimate';
  }
  // Populate inputs from current state
  const setV = (id, v) => {
    const e = document.getElementById(id);
    if (e) e.value = v === 0 || v ? v : '';
  };
  setV('tm-i-rate', _tmRatePerMan || '');
  setV('tm-i-hours', _tmEstHours || '');
  const crewDisp = document.getElementById('tm-i-crew-count');
  if (crewDisp) crewDisp.textContent = Math.max(1, _tmCrewCount || 1);
  setV('tm-i-markup', _tmMatMarkup || '');
  const b = bids.find(x => x.id === _geiEditBidId);
  if (b?.tmNteCap) setV('tm-i-nte', b.tmNteCap);
  if (b?.tmCapAction) {
    setV('tm-i-cap-action', b.tmCapAction);
    _tmCapAction = b.tmCapAction;
  }
  _tmRenderMatList();
  _tmInputChange();
  _tmSyncCadence();
}
function _tmHidePage() {
  const p = document.getElementById('gei-tm-page');
  if (p) p.style.display = 'none';
  ['gei-old-tbar', 'gei-step-bar'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = '';
  });
}

// ── Build Your Own single-page layout ────────────────────────────────────────
let _byoItems = [],
  _byoCustomSections = [],
  _byoCustomTerms = '';
const _BYO_DEFAULT_SECTIONS = ['Interior', 'Exterior', 'Materials', 'Add-ons'];
function _byoShowPage() {
  _tmHidePage(); // must run first — _tmHidePage re-shows gei-old-tbar, then we hide it below
  ['gei-old-tbar', 'gei-step-bar', 'gei-s1', 'gei-s2', 'gei-s3'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const p = document.getElementById('gei-byo-page');
  if (p) p.style.display = '';
  // Trade branding in title
  const _bm = TRADE_META[_geiTrade || getActiveTrade()] || {
    icon: '🔧',
    label: 'Trade'
  };
  const byoTitle = document.getElementById('byo-tbar-title');
  if (byoTitle) {
    const _customName = document.getElementById('gei-desc')?.value?.trim();
    byoTitle.textContent = _customName || _bm.icon + ' ' + _bm.label + ' · Build Your Own';
  }
  const c = getClientById(_geiClientId);
  const sub = document.getElementById('byo-page-sub');
  if (sub) {
    const parts = [];
    if (c?.name) parts.push(c.name);
    if (c?.addr) parts.push(c.addr.split(',')[0]);
    sub.textContent = parts.join(' · ') || 'New estimate';
  }
  // Load items from saved bid, otherwise start blank
  const b = bids.find(x => x.id === _geiEditBidId);
  if (b?.byoItems && b.byoItems.length) {
    _byoItems = b.byoItems.map(x => ({
      ...x
    }));
  } else {
    _byoItems = [];
  }
  _byoCustomSections = b?.byoCustomSections ? [...b.byoCustomSections] : [];
  _byoCustomTerms = b?.byoCustomTerms || '';
  _byoRenderSections();
  _byoUpdateRail();
}
function _byoHidePage() {
  const p = document.getElementById('gei-byo-page');
  if (p) p.style.display = 'none';
  ['gei-old-tbar', 'gei-step-bar'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = '';
  });
}
function _editByoTitle() {
  const titleEl = document.getElementById('byo-tbar-title');
  const btn = document.getElementById('byo-edit-title-btn');
  if (!titleEl || titleEl.querySelector('input')) return; // already editing
  const prev = titleEl.textContent.trim();
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.value = prev;
  inp.style.cssText = 'font-family:var(--font-display);font-size:inherit;font-weight:900;letter-spacing:-1.2px;color:var(--text);background:transparent;border:none;border-bottom:2px solid var(--blue);outline:none;width:240px;max-width:55vw;padding:0 0 2px;line-height:1';
  titleEl.textContent = '';
  titleEl.appendChild(inp);
  if (btn) btn.style.opacity = '0';
  inp.focus();
  inp.select();
  let _done = false;
  const commit = () => {
    if (_done) return;
    _done = true;
    const val = inp.value.trim() || prev;
    titleEl.textContent = val;
    if (btn) btn.style.opacity = '';
    const descEl = document.getElementById('gei-desc');
    if (descEl) descEl.value = val;
  };
  const cancel = () => {
    if (_done) return;
    _done = true;
    titleEl.textContent = prev;
    if (btn) btn.style.opacity = '';
  };
  inp.addEventListener('blur', commit);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      inp.removeEventListener('blur', commit);
      commit();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      inp.removeEventListener('blur', commit);
      cancel();
    }
  });
}
function _byoRenderSections() {
  const wrap = document.getElementById('byo-sections');
  if (!wrap) return;
  const extraFromItems = _byoItems.map(x => x.section).filter(s => !_BYO_DEFAULT_SECTIONS.includes(s));
  const allExtra = [..._byoCustomSections, ...extraFromItems.filter(s => !_byoCustomSections.includes(s))];
  const sections = [..._BYO_DEFAULT_SECTIONS, ...new Set(allExtra)];
  const secHtml = sections.map(sec => {
    const rows = _byoItems.filter(it => it.section === sec);
    const isCustom = !_BYO_DEFAULT_SECTIONS.includes(sec);
    const rowHtml = rows.length ? rows.map(it => {
      const idx = _byoItems.indexOf(it);
      return '<div class="byo-row' + (it.on ? ' on' : '') + '" onclick="_byoToggle(' + idx + ')">' + '<div class="byo-check' + (it.on ? ' on' : '') + '">' + (it.on ? '✓' : '') + '</div>' + '<div class="byo-body">' + '<div class="byo-label">' + escHtml(it.label) + '</div>' + (it.notes ? '<div class="byo-meta" style="font-size:11px;color:var(--text-3)">' + escHtml(it.notes) + '</div>' : '') + '</div>' + '<div class="byo-price">$' + it.price.toLocaleString() + '</div>' + '<div style="display:flex;gap:4px;flex-shrink:0;margin-left:6px">' + '<button onclick="event.stopPropagation();_byoEditItem(' + idx + ')" title="Edit" style="background:none;border:1px solid var(--border2);border-radius:6px;padding:4px 8px;font-size:12px;cursor:pointer;font-family:inherit;color:var(--blue);touch-action:manipulation">Edit</button>' + '<button onclick="event.stopPropagation();_byoDelItem(' + idx + ')" title="Remove" style="background:none;border:1px solid var(--border2);border-radius:6px;padding:4px 8px;font-size:12px;cursor:pointer;font-family:inherit;color:#A32D2D;touch-action:manipulation">✕</button>' + '</div>' + '</div>';
    }).join('') : '<div style="padding:14px 16px;font-size:12px;color:var(--text-3);font-style:italic">No items yet — tap + Add item</div>';
    return '<div class="card card-pad-0" style="margin-bottom:12px">' + '<div class="card-hd"><div class="card-hd-title">' + escHtml(sec) + '</div>' + '<div style="display:flex;gap:6px">' + (isCustom ? '<button class="btn btn-sm" onclick="_byoDeleteSection(\'' + escHtml(sec) + '\')" style="color:#A32D2D;border-color:#A32D2D" title="Remove section">✕</button>' : '') + '<button class="btn btn-sm" onclick="_byoAddItem(\'' + escHtml(sec) + '\')">+ Add item</button>' + '</div></div>' + '<div>' + rowHtml + '</div>' + '</div>';
  }).join('');
  const addSecBtn = '<div style="margin-bottom:12px">' + '<button class="btn btn-ghost btn-full" onclick="_byoAddSection()" style="border:1.5px dashed var(--border2)">+ Add section</button>' + '</div>';
  const tcCard = '<div class="card card-pad-0" style="margin-bottom:12px">' + '<div class="card-hd"><div class="card-hd-title">📋 Terms &amp; Conditions</div></div>' + '<div style="padding:12px 14px">' + '<div style="font-size:11px;color:var(--text-3);margin-bottom:8px">Custom terms print on the proposal below the standard payment terms.</div>' + '<textarea id="byo-custom-terms" rows="5" placeholder="e.g. All paint supplied by client. Contractor not responsible for pre-existing damage to surfaces..." ' + 'oninput="_byoCustomTerms=this.value" ' + 'style="width:100%;padding:10px 12px;border:1.5px solid var(--border2);border-radius:var(--r);font-size:13px;font-family:inherit;background:var(--bg2);color:var(--text);resize:vertical;box-sizing:border-box;line-height:1.5">' + escHtml(_byoCustomTerms || '') + '</textarea>' + '</div>' + '</div>';
  wrap.innerHTML = secHtml + addSecBtn + tcCard;
}
function _byoToggle(idx) {
  if (_byoItems[idx] && !_byoItems[idx].required) {
    _byoItems[idx].on = !_byoItems[idx].on;
    _byoRenderSections();
    _byoUpdateRail();
  }
}
function _byoDelItem(idx) {
  if (_byoItems[idx] && !_byoItems[idx].required) {
    _byoItems.splice(idx, 1);
    _byoRenderSections();
    _byoUpdateRail();
  }
}
function _byoUpdateRail() {
  const selected = _byoItems.filter(it => it.on);
  const total = selected.reduce((s, it) => s + it.price, 0);
  const depPct = (parseFloat(document.getElementById('byo-deposit-pct')?.value) || 30) / 100;
  const deposit = Math.round(total * depPct);
  const setT = (id, v) => {
    const e = document.getElementById(id);
    if (e) e.textContent = v;
  };
  setT('byo-rail-total', '$' + total.toLocaleString());
  setT('byo-rail-meta', selected.length + ' of ' + _byoItems.length + ' items');
  setT('byo-rail-sub', '$' + total.toLocaleString());
  setT('byo-rail-deposit', '$' + deposit.toLocaleString());
  setT('byo-rail-balance', '$' + (total - deposit).toLocaleString());
  _geiLines = selected.map(it => ({
    desc: it.label,
    qty: 1,
    unit: 'ea',
    rate: it.price,
    total: it.price,
    notes: it.notes || '',
    _byoSection: it.section
  }));
}
function _byoAddItem(sec) {
  document.getElementById('_byo-add-modal')?.remove();
  const ov = document.createElement('div');
  ov.id = '_byo-add-modal';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';
  ov.innerHTML = '<div style="background:var(--bg);border-radius:14px;width:100%;max-width:480px;padding:20px 16px 24px;max-height:90vh;overflow-y:auto">' + '<div style="font-weight:800;font-size:16px;margin-bottom:16px">Add to ' + escHtml(sec) + '</div>' + '<div class="f" style="margin-bottom:10px"><label>What is it?</label><input type="text" id="_bya-label" placeholder="e.g. Bedroom 3 — walls only"></div>' + '<div class="f" style="margin-bottom:10px"><label>Price ($)</label><div class="input-prefix"><span>$</span><input type="number" id="_bya-price" placeholder="0" min="0" step="50"></div></div>' + '<div class="f" style="margin-bottom:6px"><label>Notes <span style="font-weight:400;color:var(--text-3)">(optional)</span></label><input type="text" id="_bya-notes" placeholder="e.g. Two coats, ceilings included"></div>' + '<div style="font-size:11px;color:var(--text-3);margin-bottom:14px">Tab or Enter from Notes to save &amp; add another</div>' + '<div style="display:flex;gap:10px">' + '<button onclick="document.getElementById(\'_byo-add-modal\')?.remove()" class="btn" style="flex:1">Cancel</button>' + '<button onclick="_byaConfirm(\'' + escHtml(sec) + '\')" class="btn btn-p" style="flex:2">Add item</button>' + '</div></div>';
  document.body.appendChild(ov);
  ov.addEventListener('click', e => {
    if (e.target === ov) ov.remove();
  });
  setTimeout(() => {
    const labelEl = document.getElementById('_bya-label');
    const priceEl = document.getElementById('_bya-price');
    const notesEl = document.getElementById('_bya-notes');
    if (labelEl) labelEl.focus();
    // Tab from label → price (default), Tab from price → notes (default)
    // Tab or Enter from notes → save + open next
    if (notesEl) {
      notesEl.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === 'Tab' && !e.shiftKey) {
          e.preventDefault();
          _byaConfirmAndNext(sec);
        }
      });
    }
    // Enter on label or price → move to next field
    if (labelEl) {
      labelEl.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          priceEl?.focus();
        }
      });
    }
    if (priceEl) {
      priceEl.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          notesEl?.focus();
        }
      });
    }
  }, 50);
}
function _byaConfirm(sec) {
  const label = (document.getElementById('_bya-label')?.value || '').trim();
  const price = parseFloat(document.getElementById('_bya-price')?.value) || 0;
  const notes = (document.getElementById('_bya-notes')?.value || '').trim();
  if (!label) return;
  const nextId = _byoItems.reduce((m, x) => Math.max(m, x.id), 0) + 1;
  _byoItems.push({
    id: nextId,
    section: sec,
    label,
    price,
    notes,
    on: true
  });
  document.getElementById('_byo-add-modal')?.remove();
  _byoRenderSections();
  _byoUpdateRail();
}
function _byaConfirmAndNext(sec) {
  // Save current item (if label is filled) then immediately open a fresh modal for same section
  const label = (document.getElementById('_bya-label')?.value || '').trim();
  const price = parseFloat(document.getElementById('_bya-price')?.value) || 0;
  const notes = (document.getElementById('_bya-notes')?.value || '').trim();
  if (label) {
    const nextId = _byoItems.reduce((m, x) => Math.max(m, x.id), 0) + 1;
    _byoItems.push({
      id: nextId,
      section: sec,
      label,
      price,
      notes,
      on: true
    });
    _byoRenderSections();
    _byoUpdateRail();
  }
  // Open next item modal for the same section
  _byoAddItem(sec);
}
function _byoEditItem(idx) {
  const it = _byoItems[idx];
  if (!it) return;
  document.getElementById('_byo-add-modal')?.remove();
  const ov = document.createElement('div');
  ov.id = '_byo-add-modal';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';
  ov.innerHTML = '<div style="background:var(--bg);border-radius:14px;width:100%;max-width:480px;padding:20px 16px 24px;max-height:90vh;overflow-y:auto">' + '<div style="font-weight:800;font-size:16px;margin-bottom:16px">Edit item</div>' + '<div class="f" style="margin-bottom:10px"><label>What is it?</label><input type="text" id="_bya-label" value="' + escHtml(it.label) + '" placeholder="e.g. Bedroom 3 — walls only"></div>' + '<div class="f" style="margin-bottom:10px"><label>Price ($)</label><div class="input-prefix"><span>$</span><input type="number" id="_bya-price" value="' + it.price + '" placeholder="0" min="0" step="50"></div></div>' + '<div class="f" style="margin-bottom:16px"><label>Notes <span style="font-weight:400;color:var(--text-3)">(optional)</span></label><input type="text" id="_bya-notes" value="' + escHtml(it.notes || '') + '" placeholder="e.g. Two coats, ceilings included"></div>' + '<div style="display:flex;gap:10px">' + '<button onclick="document.getElementById(\'_byo-add-modal\')?.remove()" class="btn" style="flex:1">Cancel</button>' + '<button onclick="_byaEditConfirm(' + idx + ')" class="btn btn-p" style="flex:2">Save changes</button>' + '</div></div>';
  document.body.appendChild(ov);
  ov.addEventListener('click', e => {
    if (e.target === ov) ov.remove();
  });
  setTimeout(() => {
    const labelEl = document.getElementById('_bya-label');
    const priceEl = document.getElementById('_bya-price');
    const notesEl = document.getElementById('_bya-notes');
    if (labelEl) {
      labelEl.focus();
      labelEl.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          priceEl?.focus();
        }
      });
    }
    if (priceEl) {
      priceEl.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          notesEl?.focus();
        }
      });
    }
    if (notesEl) {
      notesEl.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          _byaEditConfirm(idx);
        }
      });
    }
  }, 50);
}
function _byaEditConfirm(idx) {
  const it = _byoItems[idx];
  if (!it) return;
  const label = (document.getElementById('_bya-label')?.value || '').trim();
  const price = parseFloat(document.getElementById('_bya-price')?.value) || 0;
  const notes = (document.getElementById('_bya-notes')?.value || '').trim();
  if (!label) return;
  it.label = label;
  it.price = price;
  it.notes = notes;
  document.getElementById('_byo-add-modal')?.remove();
  _byoRenderSections();
  _byoUpdateRail();
}
function _byoAddSection() {
  document.getElementById('_byo-sec-modal')?.remove();
  const ov = document.createElement('div');
  ov.id = '_byo-sec-modal';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';
  ov.innerHTML = '<div style="background:var(--bg);border-radius:14px;width:100%;max-width:380px;padding:20px 16px 24px">' + '<div style="font-weight:800;font-size:16px;margin-bottom:16px">New section</div>' + '<div class="f" style="margin-bottom:16px"><label>Section name</label>' + '<input type="text" id="_byo-sec-name" placeholder="e.g. Prep work, Ceilings, Garage..."></div>' + '<div style="display:flex;gap:10px">' + '<button onclick="document.getElementById(\'_byo-sec-modal\')?.remove()" class="btn" style="flex:1">Cancel</button>' + '<button onclick="_byoConfirmSection()" class="btn btn-p" style="flex:2">Add section</button>' + '</div></div>';
  document.body.appendChild(ov);
  ov.addEventListener('click', e => {
    if (e.target === ov) ov.remove();
  });
  setTimeout(() => document.getElementById('_byo-sec-name')?.focus(), 50);
}
function _byoConfirmSection() {
  const name = (document.getElementById('_byo-sec-name')?.value || '').trim();
  if (!name) return;
  const all = [..._BYO_DEFAULT_SECTIONS, ..._byoCustomSections];
  if (all.map(s => s.toLowerCase()).includes(name.toLowerCase())) {
    const inp = document.getElementById('_byo-sec-name');
    if (inp) {
      inp.style.borderColor = '#A32D2D';
      inp.placeholder = 'That section already exists';
    }
    return;
  }
  _byoCustomSections.push(name);
  document.getElementById('_byo-sec-modal')?.remove();
  _byoRenderSections();
}
function _byoDeleteSection(sec) {
  if (_BYO_DEFAULT_SECTIONS.includes(sec)) return;
  const hasItems = _byoItems.some(x => x.section === sec);
  const doDelete = () => {
    _byoCustomSections = _byoCustomSections.filter(s => s !== sec);
    _byoItems = _byoItems.filter(x => x.section !== sec);
    _byoRenderSections();
    _byoUpdateRail();
  };
  if (hasItems) {
    zConfirm('Remove the "' + sec + '" section and all its items?', doDelete, {
      title: 'Remove section',
      yes: 'Remove',
      danger: true
    });
  } else doDelete();
}
function _byoPreviewClient() {
  sendGenericProposal(true);
}
function _byoDuplicateBid() {
  if (!_geiEditBidId) {
    showToast('Save your draft first, then duplicate', '⚠️');
    return;
  }
  saveGenericEstimate(true);
  const src = bids.find(x => x.id === _geiEditBidId);
  if (!src) {
    showToast('Bid not found', '⚠️');
    return;
  }
  // Label the original "Option A" so both show distinct names in the bid list
  const baseName = (src.type || 'Custom Proposal').replace(/\s*—\s*Option\s+[AB]$/i, '').trim();
  if (!/option [ab]$/i.test(src.type || '')) {
    src.type = baseName + ' — Option A';
    const descEl = document.getElementById('gei-desc');
    if (descEl) descEl.value = src.type;
    const titleEl = document.getElementById('byo-tbar-title');
    if (titleEl) titleEl.textContent = src.type;
  }
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = _newBidId();
  copy.type = baseName + ' — Option B';
  copy.status = 'Draft';
  copy.draft = true;
  copy.signingToken = undefined;
  copy.proposalKey = undefined;
  copy.proposalSentDate = undefined;
  bids.unshift(copy);
  saveAll();
  // Open the copy in the editor
  _byoShowPage({
    id: copy.client_id,
    name: copy.client_name || copy.name || ''
  }, copy.id);
  showToast('Duplicated — edit Option B now', '📋');
}
function _showProposalPreviewOverlay(proposalHtml) {
  document.getElementById('_prop-preview-ov')?.remove();
  const ov = document.createElement('div');
  ov.id = '_prop-preview-ov';
  ov.style.cssText = 'position:fixed;inset:0;z-index:9500;background:#0007;display:flex;flex-direction:column';
  const hdr = document.createElement('div');
  hdr.style.cssText = 'background:#1a365d;color:#fff;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0';
  hdr.innerHTML = '<span style="font-size:15px;font-weight:800">👁 Client preview — how they\'ll see it</span><button onclick="document.getElementById(\'_prop-preview-ov\')?.remove()" style="background:rgba(255,255,255,.15);border:none;color:#fff;padding:7px 14px;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;touch-action:manipulation">✕ Close</button>';
  const body = document.createElement('div');
  body.style.cssText = 'flex:1;overflow-y:auto;padding:16px;box-sizing:border-box;background:#f0f4f8';
  body.innerHTML = proposalHtml;
  ov.appendChild(hdr);
  ov.appendChild(body);
  document.body.appendChild(ov);
}
// ─── Comparison proposal picker ─────────────────────────────────────────────
// Show a picker so the contractor can send two side-by-side options to a client.
// The picker lets the contractor preview the comparison before sending.
function _openComparisonPicker() {
  if (!_geiClientId) {
    showToast('Open from a client to compare bids', 'ℹ️');
    return;
  }
  const clientBids = bids.filter(x => x.client_id === _geiClientId && (x.isFreeForm || x.geiLines));
  if (clientBids.length < 2) {
    showToast('You need at least 2 saved bids for this client to compare', 'ℹ️');
    return;
  }
  document.getElementById('_cmp-picker-ov')?.remove();
  const ov = document.createElement('div');
  ov.id = '_cmp-picker-ov';
  ov.style.cssText = 'position:fixed;inset:0;z-index:9600;background:#0009;display:flex;align-items:flex-end;justify-content:center';
  const box = document.createElement('div');
  box.style.cssText = 'background:#fff;border-radius:18px 18px 0 0;width:100%;max-width:520px;padding:20px 16px 32px;box-sizing:border-box;max-height:80vh;overflow-y:auto';
  const rows = clientBids.map((b, i) => {
    const total = b.amount || 0;
    const label = b.type || 'Bid ' + (i + 1);
    return `<label style="display:flex;align-items:center;gap:12px;padding:12px;border:1.5px solid var(--border2);border-radius:10px;margin-bottom:8px;cursor:pointer"><input type="checkbox" name="cmp-bid" value="${b.id}" style="width:20px;height:20px;accent-color:var(--blue);flex-shrink:0"><span style="flex:1"><span style="font-size:14px;font-weight:700;display:block">${escHtml(label)}</span><span style="font-size:12px;color:var(--text-3)">$${total.toLocaleString()} · ${b.status || 'Draft'}</span></span></label>`;
  }).join('');
  box.innerHTML = `<div style="font-size:17px;font-weight:800;margin-bottom:4px">📊 Compare & Send</div><div style="font-size:13px;color:var(--text-3);margin-bottom:16px">Pick exactly 2 bids — your client will see both side by side and can choose one.</div>${rows}<button onclick="_buildComparisonPreview()" style="width:100%;padding:14px;border-radius:var(--rl);border:none;background:var(--blue);color:#fff;font-size:16px;font-weight:700;cursor:pointer;font-family:inherit;touch-action:manipulation;margin-top:8px">👁 Preview comparison</button><button onclick="document.getElementById('_cmp-picker-ov')?.remove()" style="width:100%;padding:12px;border-radius:var(--rl);border:none;background:none;color:var(--text-3);font-size:14px;cursor:pointer;font-family:inherit;margin-top:6px">Cancel</button>`;
  ov.appendChild(box);
  document.body.appendChild(ov);
  ov.addEventListener('click', e => {
    if (e.target === ov) ov.remove();
  });
}
function _buildComparisonPreview() {
  const checked = [...document.querySelectorAll('input[name="cmp-bid"]:checked')].map(x => x.value);
  if (checked.length !== 2) {
    showToast('Select exactly 2 bids to compare', '⚠️');
    return;
  }
  const bidA = bids.find(x => x.id === checked[0]);
  const bidB = bids.find(x => x.id === checked[1]);
  if (!bidA || !bidB) {
    showToast('Bids not found', '⚠️');
    return;
  }
  const fmt = n => '$' + (n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  const makeCard = (b, label, accentColor) => {
    const lineRows = (b.geiLines || []).filter(l => l.desc || l.rate).map(l => `<tr style="border-bottom:1px solid #e2e8f0"><td style="padding:7px 12px;font-size:12px;color:#2d3748"><div>${escHtml(l.desc || '')}${l.qty !== 1 ? `<span style="color:#94a3b8;font-size:11px"> ×${l.qty}</span>` : ''}</div>${l.notes ? `<div style="font-size:11px;color:#718096;margin-top:2px">${escHtml(l.notes)}</div>` : ''}</td><td style="padding:7px 8px;text-align:right;font-size:12px;font-weight:600;color:#1a365d">${fmt((l.qty || 1) * (l.rate || 0))}</td></tr>`).join('');
    const notes = b.notes ? `<div style="padding:10px 14px;border-top:1px solid #e2e8f0;font-size:12px;color:#4a5568;line-height:1.5"><strong>Notes:</strong> ${escHtml(b.notes)}</div>` : '';
    return `<div style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 2px 12px rgba(0,0,0,.08);margin-bottom:16px"><div style="background:${accentColor};color:#fff;padding:14px 16px"><div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;opacity:.85">Option</div><div style="font-size:20px;font-weight:800;margin-top:2px">${label}</div><div style="font-size:13px;opacity:.85;margin-top:4px">${escHtml(b.type || 'Proposal')}</div></div><table style="width:100%;border-collapse:collapse;font-size:12px"><tbody>${lineRows}</tbody><tfoot><tr style="background:${accentColor};color:#fff"><td style="padding:10px 14px;font-weight:800;font-size:14px">TOTAL</td><td style="padding:10px 14px;text-align:right;font-weight:800;font-size:14px">${fmt(b.amount)}</td></tr></tfoot></table>${notes}<div style="padding:12px 14px;background:#f8fafc;text-align:center"><button style="width:100%;padding:12px;border-radius:10px;border:2px solid ${accentColor};background:#fff;color:${accentColor};font-size:15px;font-weight:800;cursor:pointer;font-family:inherit;touch-action:manipulation">✓ I choose this option</button></div></div>`;
  };
  const compHtml = `<div style="max-width:560px;margin:0 auto;padding:16px 0"><div style="text-align:center;padding:16px 0 20px"><div style="font-size:18px;font-weight:800;color:#1a365d">Choose your option</div><div style="font-size:13px;color:#718096;margin-top:4px">Both options are from the same contractor. Review each and tap to accept the one that works best for you.</div></div>${makeCard(bidA, 'A', '#1a365d')}${makeCard(bidB, 'B', '#2a4a7f')}</div>`;
  document.getElementById('_cmp-picker-ov')?.remove();
  _showProposalPreviewOverlay(compHtml);
}
// ─── End comparison ──────────────────────────────────────────────────────────
function _tmCrewStep(delta) {
  _tmCrewCount = Math.max(1, Math.min(20, (_tmCrewCount || 1) + delta));
  const d = document.getElementById('tm-i-crew-count');
  if (d) d.textContent = _tmCrewCount;
  const lbl = document.getElementById('tm-i-crew-label');
  if (lbl) lbl.textContent = _tmCrewCount === 1 ? 'solo' : _tmCrewCount === 2 ? 'me + helper' : 'crew';
  _tmInputChange();
}
function _tmInputChange() {
  _tmRatePerMan = parseFloat(document.getElementById('tm-i-rate')?.value) || 0;
  // Crew count driven by stepper; read stepper display, not a select
  const crewDisp = document.getElementById('tm-i-crew-count');
  if (crewDisp) _tmCrewCount = parseInt(crewDisp.textContent) || _tmCrewCount || 1;
  _tmEstHours = parseFloat(document.getElementById('tm-i-hours')?.value) || 0;
  _tmMatMarkup = parseFloat(document.getElementById('tm-i-markup')?.value) || 0;
  const labor = _tmCrewCount * _tmRatePerMan * _tmEstHours;
  // Upsert labor line in _geiLines (same shape the rest of the app expects)
  const idx = _geiLines.findIndex(l => l._tmLabor);
  const desc = 'Labor — ' + _tmCrewCount + ' worker' + (_tmCrewCount > 1 ? 's' : '') + ' @ $' + _tmRatePerMan + '/hr';
  const line = {
    desc,
    qty: _tmEstHours,
    unit: 'hr',
    rate: Math.round(_tmRatePerMan * _tmCrewCount),
    _tmLabor: true,
    total: Math.round(_tmRatePerMan * _tmCrewCount * _tmEstHours)
  };
  if (idx >= 0) {
    if (labor > 0) _geiLines[idx] = line;else _geiLines.splice(idx, 1);
  } else if (labor > 0) _geiLines.unshift(line);
  // Stat tiles
  const dayRate = _tmCrewCount * _tmRatePerMan * 8;
  const days = _tmEstHours > 0 ? Math.ceil(_tmEstHours / 8) : 0;
  const setT = (id, v) => {
    const e = document.getElementById(id);
    if (e) e.textContent = v;
  };
  setT('tm-stat-day', '$' + dayRate.toLocaleString());
  setT('tm-stat-day-s', _tmRatePerMan && _tmCrewCount ? _tmCrewCount + '-person crew · 8hr day' : 'enter rate & crew');
  setT('tm-stat-labor', '$' + labor.toLocaleString());
  setT('tm-stat-labor-s', _tmRatePerMan && _tmEstHours ? _tmEstHours + 'hr × ' + _tmCrewCount + ' × $' + _tmRatePerMan : '—');
  setT('tm-stat-days', days);
  // Materials subtotal — markup baked in, invisible to client
  const matRaw = _geiLines.filter(l => !l._tmLabor).reduce((s, l) => s + (l.total || (l.qty || 0) * (l.rate || 0)), 0);
  const markupMult = _tmMatMarkup > 0 ? 1 + _tmMatMarkup / 100 : 1;
  const markedUpMat = Math.round(matRaw * markupMult);
  const total = labor + markedUpMat;
  // Rail breakdown
  setT('tm-rail-total', '$' + total.toLocaleString());
  setT('tm-rail-labor', '$' + labor.toLocaleString());
  setT('tm-rail-mat', '$' + markedUpMat.toLocaleString());
  let nte = parseFloat(document.getElementById('tm-i-nte')?.value) || 0;
  const nteInp = document.getElementById('tm-i-nte');
  if (nteInp && nte > 0 && nte < total) {
    nteInp.style.borderColor = 'var(--red)';
    nteInp.title = 'NTE cap cannot be less than the estimated total ($' + total.toLocaleString() + ')';
  } else if (nteInp) {
    nteInp.style.borderColor = '';
    nteInp.title = '';
  }
  const nteRow = document.getElementById('tm-rail-nte-row');
  if (nteRow) nteRow.style.display = nte > 0 ? 'flex' : 'none';
  if (nte > 0) setT('tm-rail-nte-amt', '$' + nte.toLocaleString());
  // Mirror values to legacy DOM ids so saveGenericEstimate/sendGenericProposal pick them up
  const setV = (id, v) => {
    const e = document.getElementById(id);
    if (e) e.value = v;
  };
  setV('tm-rate', _tmRatePerMan);
  setV('tm-hours', _tmEstHours);
  const cd = document.getElementById('tm-crew-display');
  if (cd) cd.textContent = _tmCrewCount;
  setV('tm-nte-cap', nte || '');
  setV('tm-dep-pct', 20);
  const nteOn = document.getElementById('tm-nte-on');
  if (nteOn) nteOn.checked = nte > 0;
  setV('gei-tax-pct', _tmMatMarkup); // materials markup folds into the existing tax/markup field
  // Keep the legacy line items + totals in sync (used by save/proposal)
  if (typeof renderGeiLines === 'function') renderGeiLines();
  if (typeof calcGeiTotal === 'function') calcGeiTotal();
}
function _tmRenderMatList() {
  const el = document.getElementById('tm-mat-list');
  if (!el) return;
  const mats = _geiLines.map((l, i) => ({
    l,
    i
  })).filter(x => !x.l._tmLabor);
  if (!mats.length) {
    el.innerHTML = '<div class="tm-mat-empty">No material categories yet — tap "+ Add category" to start.</div>';
    return;
  }
  const mm = _tmMatMarkup > 0 ? 1 + _tmMatMarkup / 100 : 1;
  el.innerHTML = mats.map(({
    l,
    i
  }) => {
    const rawTotal = l.total || (l.qty || 0) * (l.rate || 0);
    const dispTotal = Math.round(rawTotal * mm);
    return '<div class="tm-mat-row">' + '<div style="flex:1;cursor:pointer;min-width:0" onclick="_tmEditMatCat(' + i + ')">' + '<div class="tm-mat-cat">' + escHtml(l.desc || 'Untitled') + '</div>' + (l.notes ? '<div class="tm-mat-notes">' + escHtml(l.notes) + '</div>' : '') + '</div>' + '<div style="display:flex;align-items:flex-start;gap:0">' + '<div class="tm-mat-est">$' + (dispTotal || 0).toLocaleString() + '</div>' + '<button class="tm-mat-del" onclick="_tmDelMatCat(' + i + ')" title="Remove category">×</button>' + '</div>' + '</div>';
  }).join('');
}
function _tmAddMatCat() {
  _tmMatCatModal(-1);
}
function _tmEditMatCat(idx) {
  _tmMatCatModal(idx);
}
function _tmMatCatModal(idx) {
  const isEdit = idx >= 0;
  const l = isEdit ? _geiLines[idx] : null;
  if (isEdit && (!l || l._tmLabor)) return;
  const cur = isEdit ? l.total || (l.qty || 0) * (l.rate || 0) : 0;
  document.getElementById('_tm-mat-modal')?.remove();
  const ov = document.createElement('div');
  ov.id = '_tm-mat-modal';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';
  ov.innerHTML = '<div style="background:var(--bg);border-radius:14px;width:100%;max-width:480px;padding:20px 16px 24px;max-height:90vh;overflow-y:auto">' + '<div style="font-weight:800;font-size:16px;color:var(--text);margin-bottom:16px">' + (isEdit ? 'Edit category' : 'Add material category') + '</div>' + '<div class="f" style="margin-bottom:10px"><label>Category name</label><input type="text" id="tcm-name" placeholder="e.g. Paint &amp; primer" value="' + escHtml(l?.desc || '') + '" style="font-size:15px"></div>' + '<div class="f" style="margin-bottom:10px"><label>Notes <span style="font-weight:400;color:var(--text3)">(optional)</span></label><input type="text" id="tcm-notes" placeholder="Brand, product type, etc." value="' + escHtml(l?.notes || '') + '"></div>' + '<div class="f" style="margin-bottom:16px"><label>Estimated cost ($)</label><div class="input-prefix"><span>$</span><input type="number" id="tcm-cost" min="0" step="10" placeholder="0" value="' + (cur || '') + '" inputmode="decimal"></div></div>' + '<div style="display:flex;gap:10px">' + '<button onclick="document.getElementById(\'_tm-mat-modal\')?.remove()" class="btn" style="flex:1">Cancel</button>' + '<button onclick="_tmMatCatSave(' + idx + ')" class="btn btn-p" style="flex:2">' + (isEdit ? 'Save changes' : 'Add category') + '</button>' + '</div>' + '</div>';
  document.body.appendChild(ov);
  ov.addEventListener('click', e => {
    if (e.target === ov) ov.remove();
  });
  setTimeout(() => document.getElementById('tcm-name')?.focus(), 50);
}
function _tmMatCatSave(idx) {
  const name = (document.getElementById('tcm-name')?.value || '').trim();
  if (!name) {
    document.getElementById('tcm-name')?.focus();
    return;
  }
  const notes = (document.getElementById('tcm-notes')?.value || '').trim();
  const cost = parseFloat(document.getElementById('tcm-cost')?.value) || 0;
  if (idx >= 0) {
    const l = _geiLines[idx];
    if (!l) return;
    l.desc = name;
    l.notes = notes;
    l.qty = 1;
    l.unit = 'lot';
    l.rate = cost;
    l.total = cost;
  } else {
    _geiLines.push({
      desc: name,
      notes,
      qty: 1,
      unit: 'lot',
      rate: cost,
      total: cost
    });
  }
  document.getElementById('_tm-mat-modal')?.remove();
  _tmRenderMatList();
  _tmInputChange();
}
function _tmDelMatCat(idx) {
  const l = _geiLines[idx];
  if (!l || l._tmLabor) return;
  if (!confirm('Remove "' + (l.desc || 'this category') + '"?')) return;
  _geiLines.splice(idx, 1);
  _tmRenderMatList();
  _tmInputChange();
}
function _tmCadence(v) {
  _tmBillingCycle = v;
  _tmSyncCadence();
}
function _tmSyncCadence() {
  ['weekly', 'milestone', 'completion'].forEach(c => {
    const el = document.getElementById('tm-cad-' + c);
    if (!el) return;
    if (_tmBillingCycle === c) el.classList.add('on');else el.classList.remove('on');
  });
}
function _tmPreviewClient() {
  // Save draft first so the latest data is persisted, then open the existing proposal preview flow
  saveGenericEstimate(true);
  // Fall back to sending if no dedicated preview exists yet
  showToast('Preview as client — sending proposal flow opens for review', '👁');
  if (typeof sendGenericProposal === 'function') sendGenericProposal();
}
function _geiBack() {
  if (_geiStep > 1) goGeiStep(_geiStep - 1);else {
    document.getElementById('gei-cart-bar')?.remove();
    goPg('pg-clients');
  }
}

// ── Free-form (Build Your Own) builder ───────────────────────────────────────
function _geiRenderFreeFormBuilder() {
  const el = document.getElementById('gei-templates');
  if (!el) return;
  const curTrade = _geiTrade || 'general';
  const allHist = (S.lineHistory || []).slice().sort((a, b) => (b.count || 0) - (a.count || 0));
  const hist = allHist.filter(h => !h.trade || h.trade === curTrade || h.trade === 'general').slice(0, 6);
  const histHtml = hist.length ? '<div style="margin-bottom:14px">' + '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:8px">Recently used — ' + curTrade.charAt(0).toUpperCase() + curTrade.slice(1) + '</div>' + '<div style="display:flex;flex-wrap:wrap;gap:6px">' + hist.map((h, i) => {
    const realIdx = allHist.findIndex(x => x.desc === h.desc && x.trade === h.trade);
    return '<button onclick="_geiHistoryChipAdd(' + realIdx + ')" style="padding:6px 12px;border-radius:20px;border:1.5px solid var(--border2);background:var(--bg2);font-size:12px;cursor:pointer;font-family:inherit;color:var(--text2);display:inline-flex;align-items:center;gap:5px">' + escHtml(h.desc) + '<span style="color:var(--blue);font-weight:700">$' + (h.rate || 0).toLocaleString('en-US', {
      maximumFractionDigits: 0
    }) + '</span></button>';
  }).join('') + '</div></div>' : '';
  const hasLines = _geiLines.length > 0;
  el.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' + '<div style="font-size:13px;font-weight:700;color:var(--text)">Line items</div>' + '<button onclick="_geiAddFreeFormLine()" class="btn btn-p btn-sm" style="padding:6px 14px;font-size:12px">+ Add line</button>' + '</div>' + histHtml + '<div id="gei-ff-lines"></div>' + (!hasLines ? '<div style="text-align:center;padding:24px 0;font-size:13px;color:var(--text3)">Tap <strong>+ Add line</strong> to start building your estimate.</div>' : '');
  _geiRenderFreeFormLines();
}
function _geiRenderFreeFormLines() {
  const el = document.getElementById('gei-ff-lines');
  if (!el) return;
  if (!_geiLines.length) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = _geiLines.map((l, i) => {
    const total = (l.qty || 1) * (l.rate || 0);
    const totalFmt = '$' + total.toLocaleString('en-US', {
      maximumFractionDigits: 0
    });
    return '<div style="background:var(--bg2);border-radius:var(--r);border:1px solid var(--border2);padding:11px 13px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:flex-start;gap:10px">' + '<div style="flex:1;min-width:0">' + '<div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:2px">' + escHtml(l.desc || '—') + '</div>' + '<div style="font-size:11px;color:var(--text3)">' + (l.qty || 1) + ' ' + (l.unit || 'ea') + ' @ $' + (l.rate || 0).toLocaleString('en-US', {
      maximumFractionDigits: 0
    }) + '</div>' + '</div>' + '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0">' + '<div style="font-size:15px;font-weight:800;color:var(--blue)">' + totalFmt + '</div>' + '<button onclick="_geiEditFreeFormLine(' + i + ')" style="background:none;border:none;cursor:pointer;color:var(--blue);font-size:11px;font-weight:700;font-family:inherit;padding:3px 6px;border-radius:4px;border:1px solid var(--blue)">Edit</button>' + '<button onclick="_geiLines.splice(' + i + ',1);_geiRenderFreeFormBuilder();_geiRenderCartBar();" style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:20px;padding:0;line-height:1">×</button>' + '</div>' + '</div>';
  }).join('');
}
function _geiHistoryChipAdd(i) {
  const hist = (S.lineHistory || []).slice().sort((a, b) => (b.count || 0) - (a.count || 0));
  const h = hist[i];
  if (!h) return;
  _geiLines.push({
    desc: h.desc,
    qty: h.qty || 1,
    unit: h.unit || 'ea',
    rate: h.rate || 0,
    total: (h.qty || 1) * (h.rate || 0)
  });
  _geiRenderFreeFormBuilder();
  _geiRenderCartBar();
}
function _geiAddFreeFormLine(prefill) {
  const d = prefill || {};
  const isEdit = d._edit !== undefined;
  const ov = document.createElement('div');
  ov.id = '_ff-add-ov';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';
  ov.innerHTML = '<div style="background:var(--bg);border-radius:var(--rl);padding:20px 18px 24px;width:100%;max-width:480px;box-sizing:border-box;max-height:90vh;overflow-y:auto">' + '<div style="font-size:15px;font-weight:800;color:var(--text);margin-bottom:14px">' + (isEdit ? 'Edit line' : 'Add line item') + '</div>' + '<div class="f" style="margin-bottom:10px"><label>Description</label>' + '<input id="_ffa-desc" type="text" value="' + escHtml(d.desc || '') + '" placeholder="e.g. Interior paint — 2 coats, Labor, Material" autocomplete="off" style="font-size:14px">' + '</div>' + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px">' + '<div class="f"><label>Qty</label><input id="_ffa-qty" type="number" value="' + (d.qty || 1) + '" min="0.01" step="any" oninput="_ffaLiveTotal()" style="font-size:14px"></div>' + '<div class="f"><label>Unit</label><input id="_ffa-unit" type="text" value="' + escHtml(d.unit || 'ea') + '" placeholder="ea" style="font-size:14px"></div>' + '<div class="f"><label>Price per unit ($)</label><input id="_ffa-rate" type="number" value="' + (d.rate || '') + '" min="0" step="any" placeholder="0" oninput="_ffaLiveTotal()" style="font-size:14px"></div>' + '</div>' + '<div style="display:flex;justify-content:space-between;align-items:center;background:var(--bg2);padding:9px 12px;border-radius:var(--r);margin-bottom:14px">' + '<span style="font-size:12px;color:var(--text2)">Line total</span>' + '<span id="_ffa-total-disp" style="font-size:18px;font-weight:800;color:var(--blue)">' + (d.qty && d.rate ? '$' + ((d.qty || 1) * (d.rate || 0)).toLocaleString('en-US', {
    maximumFractionDigits: 0
  }) : '—') + '</span>' + '</div>' + '<button class="btn btn-p" onclick="_geiConfirmFreeFormAdd(' + (isEdit ? d._edit : -1) + ')" style="margin-bottom:8px">' + (isEdit ? 'Update line' : 'Add to estimate') + '</button>' + '<button class="btn" onclick="document.getElementById(\'_ff-add-ov\')?.remove()" style="color:var(--text2);font-size:13px">Cancel</button>' + '</div>';
  document.body.appendChild(ov);
  ov.addEventListener('click', e => {
    if (e.target === ov) ov.remove();
  });
  setTimeout(() => document.getElementById('_ffa-desc')?.focus(), 100);
}
function _ffaLiveTotal() {
  const qty = parseFloat(document.getElementById('_ffa-qty')?.value) || 0;
  const rate = parseFloat(document.getElementById('_ffa-rate')?.value) || 0;
  const el = document.getElementById('_ffa-total-disp');
  if (el) el.textContent = qty && rate ? '$' + (qty * rate).toLocaleString('en-US', {
    maximumFractionDigits: 0
  }) : '—';
}
function _geiConfirmFreeFormAdd(editIdx) {
  const desc = (document.getElementById('_ffa-desc')?.value || '').trim();
  if (!desc) {
    const inp = document.getElementById('_ffa-desc');
    if (inp) {
      inp.style.borderColor = '#dc2626';
      inp.focus();
    }
    return;
  }
  const qty = parseFloat(document.getElementById('_ffa-qty')?.value) || 1;
  const unit = (document.getElementById('_ffa-unit')?.value || 'ea').trim();
  const rate = parseFloat(document.getElementById('_ffa-rate')?.value) || 0;
  document.getElementById('_ff-add-ov')?.remove();
  const line = {
    desc,
    qty,
    unit,
    rate,
    total: qty * rate
  };
  if (editIdx >= 0 && editIdx < _geiLines.length) _geiLines[editIdx] = line;else _geiLines.push(line);
  _geiRenderFreeFormBuilder();
  _geiRenderCartBar();
}
function _geiEditFreeFormLine(i) {
  const l = _geiLines[i];
  if (!l) return;
  _geiAddFreeFormLine({
    ...l,
    _edit: i
  });
}
function _geiRenderStepBar() {
  const el = document.getElementById('gei-step-bar');
  if (!el) return;
  const steps = ['Job info', 'Build', 'Review'];
  el.innerHTML = '<div class="steps" style="margin-bottom:16px">' + steps.map((s, i) => {
    const n = i + 1;
    const cls = n === _geiStep ? 'step active' : n < _geiStep ? 'step done' : 'step';
    const sep = i < steps.length - 1 ? '<div class="ssep"></div>' : '';
    return `<div class="${cls}"><div class="snum">${n}</div><span class="slbl">${s}</span></div>${sep}`;
  }).join('') + '</div>';
}
function _geiSyncScopeButtons() {
  const resi = document.getElementById('gei-resi-btn');
  const comm = document.getElementById('gei-comm-btn');
  const emrg = document.getElementById('gei-emrg-btn');
  if (resi) {
    resi.style.border = `2px solid ${!_geiIsCommercial ? 'var(--blue)' : 'var(--border2)'}`;
    resi.style.background = !_geiIsCommercial ? 'var(--blue-lt)' : 'var(--bg2)';
    resi.style.color = !_geiIsCommercial ? 'var(--blue-dk)' : 'var(--text2)';
  }
  if (comm) {
    comm.style.border = `2px solid ${_geiIsCommercial ? 'var(--blue)' : 'var(--border2)'}`;
    comm.style.background = _geiIsCommercial ? 'var(--blue-lt)' : 'var(--bg2)';
    comm.style.color = _geiIsCommercial ? 'var(--blue-dk)' : 'var(--text2)';
  }
  if (emrg) {
    emrg.style.border = `2px solid ${_geiEmergency ? '#dc2626' : 'var(--border2)'}`;
    emrg.style.background = _geiEmergency ? '#fef2f2' : 'var(--bg2)';
    emrg.style.color = _geiEmergency ? '#dc2626' : 'var(--text2)';
  }
}
function _geiPriceMult() {
  // Apply property tier multiplier to default job prices
  const c = clients.find(x => x.id === _geiClientId);
  const tier = c?.propertyTier || 'standard';
  if (tier === 'premium') return 1.25;
  if (tier === 'basic') return 0.85;
  return 1.0;
}
function _geiTierBadge() {
  const c = clients.find(x => x.id === _geiClientId);
  if (!c?.propertyTier || c.propertyTier === 'standard') return '';
  const tier = c.propertyTier;
  const cfg = {
    premium: {
      label: 'Premium property',
      bg: '#fef3c7',
      color: '#92400e'
    },
    basic: {
      label: 'Rental / budget',
      bg: '#fee2e2',
      color: '#991b1b'
    }
  }[tier] || null;
  if (!cfg) return '';
  return `<div style="font-size:11px;font-weight:700;background:${cfg.bg};color:${cfg.color};border-radius:20px;padding:3px 10px;display:inline-block;margin-bottom:12px">${cfg.label} · prices adjusted</div>`;
}
function _geiLocationMult() {
  return STATE_LABOR_MULT[S.state] || 1.0;
}
function _geiJobPrice(job) {
  const propMult = _geiPriceMult();
  const custom = (S.myRates || {})[job.id];
  if (custom) {
    return {
      labor: Math.round((custom.labor || 0) * propMult),
      mat: Math.round((custom.mat || 0) * propMult),
      isCustom: true
    };
  }
  const locMult = _geiLocationMult();
  const emergMult = _geiEmergency ? 1.5 : 1.0;
  const nwMult = _geiNewWork && (job.nw ?? 1) < 1 ? job.nw ?? 1 : 1.0;
  return {
    labor: Math.round((job.labor || 0) * nwMult * locMult * emergMult * propMult),
    mat: Math.round((job.mat || 0) * propMult),
    isCustom: false
  };
}
function _geiAddWithRate(job, inputEl) {
  const entered = parseInt(inputEl?.value) || 0;
  const p = _geiJobPrice(job);
  const marketTotal = p.labor + (p.mat || 0);
  if (entered !== marketTotal && entered > 0) {
    S.myRates = S.myRates || {};
    S.myRates[job.id] = {
      labor: entered,
      mat: 0
    };
    saveAll();
    showToast('Rate saved for ' + job.name, '💾');
  }
  if (job.gasLic) showToast('Gas work — verify you\'re licensed for gas in your state', '⚠️');
  if (job.freeForm) {
    _geiShowFreeFormModal(job);
    return;
  }
  const rate = entered || marketTotal;
  if (job.custom) {
    const unitLabel = {
      sqft: 'square footage',
      'lin ft': 'linear feet',
      kW: 'kilowatts',
      kWh: 'kilowatt-hours',
      fixture: 'number of fixtures'
    }[job.unit] || job.unit;
    const raw = prompt('Enter ' + unitLabel + ' for: ' + job.name);
    if (!raw) return;
    const qty = parseFloat(raw);
    if (!qty || isNaN(qty)) return;
    _geiLines.push({
      desc: job.name + ' — labor',
      qty,
      unit: job.unit,
      rate: Math.round(p.labor),
      total: qty * Math.round(p.labor),
      jobId: job.id
    });
    if (p.mat > 0) _geiLines.push({
      desc: job.matDesc || 'Materials',
      qty,
      unit: job.unit,
      rate: p.mat,
      total: qty * p.mat
    });
  } else {
    if (p.labor > 0) _geiLines.push({
      desc: job.name + ' — labor',
      qty: 1,
      unit: job.unit,
      rate: p.labor,
      total: p.labor,
      jobId: job.id
    });
    if (p.mat > 0) _geiLines.push({
      desc: job.matDesc || 'Materials',
      qty: 1,
      unit: job.unit,
      rate: p.mat,
      total: p.mat
    });
  }
  renderGeiLines();
  calcGeiTotal();
}
function _geiVisibleJobIds() {
  const bundles = S.myBundles || [];
  if (!bundles.length || bundles[0] === '__all') return null;
  const ids = new Set();
  bundles.forEach(b => (GEI_BUNDLES[b] || []).forEach(id => ids.add(id)));
  return ids;
}
function _geiOpenCatSheet(catLabel) {
  const trade = _geiTrade || 'general';
  const allJobs = TRADE_JOBS[trade] || TRADE_JOBS.general;
  const scope = _geiIsCommercial ? 'commercial' : 'resi';
  const jobs = allJobs.filter(j => !j.scope || j.scope === 'both' || j.scope === scope);
  const ids = (TRADE_JOB_CATS[trade] || {})[catLabel] || [];
  const jobById = Object.fromEntries(jobs.map(j => [j.id, j]));
  const catJobs = ids.map(id => jobById[id]).filter(Boolean);
  const mult = _geiPriceMult();
  const ov = document.createElement('div');
  ov.id = '_gei-cat-ov';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';
  ov.onclick = e => {
    if (e.target === ov) ov.remove();
  };
  const sheet = document.createElement('div');
  sheet.style.cssText = 'background:var(--bg);border-radius:var(--rl);width:100%;max-width:460px;padding:16px 16px 24px;max-height:80vh;overflow-y:auto;box-sizing:border-box';
  const rows = catJobs.map(job => {
    const p = _geiJobPrice(job);
    const defaultTotal = p.labor + (p.mat || 0);
    const isCustomRate = p.isCustom;
    const gasTag = job.gasLic ? `<span style="font-size:10px;background:#fef3c7;color:#92400e;border-radius:3px;padding:1px 5px;margin-left:6px">GAS LIC</span>` : '';
    const rateLabel = isCustomRate ? `<span style="color:#16a34a;font-size:10px;margin-top:2px">✓ your rate</span>` : `<span style="color:var(--text3);font-size:10px;margin-top:2px">📍 ${S.state || 'US'} avg${_geiNewWork && (job.nw || 1) < 1 ? ' · new work' : ''}</span>`;
    const inputBorder = isCustomRate ? 'border:1.5px solid #16a34a' : 'border:1.5px solid var(--border2)';
    const inputColor = isCustomRate ? 'color:#16a34a' : 'color:var(--blue)';
    const inputId = '_gei-rate-' + job.id;
    return `<div style="display:flex;align-items:center;gap:10px;padding:11px 14px;border:1.5px solid var(--border2);border-radius:var(--r);background:var(--bg2);margin-bottom:7px;box-sizing:border-box">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700;color:var(--text)">${escHtml(job.name)}${gasTag}</div>
        ${rateLabel}
      </div>
      <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
        <span style="font-size:12px;color:var(--text3)">$</span>
        <input type="number" id="${inputId}" value="${defaultTotal}" min="0" step="1"
          style="width:74px;padding:5px 4px;border-radius:var(--r);${inputBorder};font-size:14px;font-weight:800;${inputColor};text-align:right;background:var(--bg);font-family:inherit"
          onclick="event.stopPropagation()">
        <button onclick="_geiAddWithRate(${JSON.stringify(job).replace(/"/g, '&quot;')},document.getElementById('${inputId}'));document.getElementById('_gei-cat-ov')?.remove();_geiRenderCartBar()"
          style="padding:7px 12px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-weight:700;font-size:13px;cursor:pointer;white-space:nowrap">+ Add</button>
      </div>
    </div>`;
  }).join('');
  const firstTimeBanner = !S.myRates || !Object.keys(S.myRates).length ? `<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:var(--r);padding:10px 14px;margin-bottom:12px;font-size:12px;color:#1e40af;line-height:1.5">📍 Showing <strong>${S.state || 'US'} market averages</strong> (BLS labor data). Edit any price to set your own rate — saves automatically.</div>` : '';
  const newWorkBadge = _geiNewWork ? `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:var(--r);padding:6px 12px;margin-bottom:10px;font-size:12px;color:#15803d;font-weight:600">🏗️ New construction rates active — lower labor</div>` : '';
  sheet.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <div style="font-size:16px;font-weight:800;color:var(--text)">${catLabel}</div>
      <button onclick="document.getElementById('_gei-cat-ov')?.remove()" style="background:none;border:none;font-size:24px;cursor:pointer;color:var(--text3);padding:0;line-height:1">×</button>
    </div>
    ${firstTimeBanner}${newWorkBadge}${_geiTierBadge()}
    ${rows || '<div style="font-size:13px;color:var(--text3);text-align:center;padding:20px 0">No services in this category for current scope.</div>'}`;
  ov.appendChild(sheet);
  document.body.appendChild(ov);
}
function _geiRenderCartBar() {
  const bar = document.getElementById('gei-cart-bar') || (() => {
    const b = document.createElement('div');
    b.id = 'gei-cart-bar';
    b.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:8000;background:var(--blue);padding:13px 20px 30px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;box-shadow:0 -2px 16px rgba(0,0,0,.15)';
    b.onclick = () => goGeiStep(3);
    document.body.appendChild(b);
    return b;
  })();
  const {
    sub
  } = calcGeiTotal();
  const n = _geiLines.length;
  if (!n || _geiStep !== 2) {
    bar.style.display = 'none';
    return;
  }
  bar.style.display = 'flex';
  bar.innerHTML = `<span style="color:#fff;font-size:13px;font-weight:600">${n} item${n !== 1 ? 's' : ''} added</span><span style="color:#fff;font-size:16px;font-weight:800">$${sub.toLocaleString('en-US', {
    maximumFractionDigits: 0
  })} · Review →</span>`;
}
function _geiRenderTemplates() {
  const el = document.getElementById('gei-templates');
  if (!el) return;
  const trade = _geiTrade || 'general';
  const allJobs = TRADE_JOBS[trade] || TRADE_JOBS.general;
  const scope = _geiIsCommercial ? 'commercial' : 'resi';
  const jobs = allJobs.filter(j => !j.scope || j.scope === 'both' || j.scope === scope);
  const visibleIds = _geiVisibleJobIds();
  let html = '';
  if (_geiEmergency) html += `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:var(--r);padding:9px 12px;font-size:12px;color:#b91c1c;margin-bottom:12px;font-weight:600">🚨 Emergency mode — labor rates ×1.5 · after-hours surcharge added</div>`;
  if (_geiNewWork) html += `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:var(--r);padding:7px 12px;font-size:12px;color:#15803d;margin-bottom:12px;font-weight:600">🏗️ New construction rates active — lower labor</div>`;

  // Category tile grid for trades with categories
  const cats = TRADE_JOB_CATS[trade];
  if (cats) {
    const jobById = Object.fromEntries(jobs.map(j => [j.id, j]));
    html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">`;
    for (const [catLabel, ids] of Object.entries(cats)) {
      const catJobs = ids.map(id => jobById[id]).filter(Boolean).filter(j => !visibleIds || visibleIds.has(j.id));
      if (!catJobs.length) continue;
      const parts = catLabel.split(' ');
      const emoji = parts[0];
      const name = parts.slice(1).join(' ');
      const safeLabel = escHtml(catLabel);
      html += `<button data-cat="${escHtml(catLabel)}" onclick="_geiOpenCatSheet(this.dataset.cat)"
        style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:14px 8px;border-radius:var(--rl);border:1.5px solid var(--border2);background:var(--bg2);cursor:pointer;font-family:inherit;gap:5px;min-height:85px;text-align:center">
        <span style="font-size:28px;line-height:1">${emoji}</span>
        <span style="font-size:12px;font-weight:700;color:var(--text)">${escHtml(name)}</span>
        <span style="font-size:10px;color:var(--text3)">${catJobs.length} service${catJobs.length !== 1 ? 's' : ''}</span>
      </button>`;
    }
    html += `</div>`;
    if (visibleIds) {
      const totalCount = (TRADE_JOBS[trade] || []).length;
      html += `<button onclick="_geiShowAllServices()" style="width:100%;margin-top:12px;padding:10px;background:none;border:1px dashed var(--border2);border-radius:var(--r);color:var(--text3);font-size:12px;cursor:pointer;font-family:inherit">+ Find unlisted service (search all ${totalCount} services)</button>`;
    }
  } else {
    // Flat chip fallback for general/other
    const makeChip = job => {
      const p = _geiJobPrice(job);
      const total = p.labor + (p.mat || 0);
      const priceStr = job.custom ? `$${total}/${job.unit}` : `$${total.toLocaleString()}`;
      const safeJob = escHtml(JSON.stringify(job));
      return `<button onclick="_geiAddTemplate(JSON.parse(this.dataset.job));_geiRenderCartBar()" data-job="${safeJob}" style="display:inline-flex;flex-direction:column;align-items:flex-start;padding:8px 12px;border-radius:var(--r);border:1.5px solid var(--border2);background:var(--bg2);cursor:pointer;font-family:inherit;text-align:left"><span style="font-size:12px;font-weight:700;color:var(--text)">${escHtml(job.name)}</span><span style="font-size:10px;color:var(--text3)">${priceStr}</span></button>`;
    };
    html += `<div style="display:flex;flex-wrap:wrap;gap:6px">${jobs.map(makeChip).join('')}</div>`;
  }
  el.innerHTML = html;
}
function _geiShowAllServices() {
  S.myBundles = ['__all'];
  saveAll();
  _geiRenderTemplates();
  showToast('Showing all services', '✓');
}
function showGeiOnboarding(opts) {
  if (!opts?.force && S.myBundles && S.myBundles.length) return;
  const BUNDLE_CARDS = [{
    id: 'residential',
    emoji: '🏠',
    label: 'Residential\nService'
  }, {
    id: 'panels_circuits',
    emoji: '⚡',
    label: 'Panels &\nCircuits'
  }, {
    id: 'service_upgrades',
    emoji: '🔧',
    label: 'Service\nUpgrades'
  }, {
    id: 'ev_solar',
    emoji: '☀️',
    label: 'EV & Solar'
  }, {
    id: 'outdoor_pool',
    emoji: '🏊',
    label: 'Outdoor\n& Pool'
  }, {
    id: 'smart_security',
    emoji: '🔒',
    label: 'Smart Home\n& Security'
  }, {
    id: 'appliances',
    emoji: '🍳',
    label: 'Appliance\nCircuits'
  }, {
    id: 'diagnostics',
    emoji: '🔍',
    label: 'Diagnostics\n& Specialty'
  }, {
    id: 'new_construction',
    emoji: '🏗️',
    label: 'New\nConstruction'
  }, {
    id: 'commercial',
    emoji: '🏢',
    label: 'Commercial'
  }];
  const selected = new Set();
  const ov = document.createElement('div');
  ov.id = '_gei-onboard-ov';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';
  function render() {
    const stateStr = S.state || 'US';
    const mult = STATE_LABOR_MULT[S.state] || 1.0;
    const multNote = mult !== 1.0 ? ` (${mult > 1 ? '+' : ''}${Math.round((mult - 1) * 100)}% vs national avg)` : '';
    ov.innerHTML = `<div style="background:var(--bg);border-radius:var(--rl);width:100%;max-width:480px;max-height:90vh;overflow-y:auto;box-sizing:border-box;padding:22px 18px 28px">
      <div style="font-size:20px;font-weight:800;color:var(--text);margin-bottom:4px">⚡ Set up your services</div>
      <div style="font-size:12px;color:var(--text3);margin-bottom:14px">Takes about 30 seconds · you can change this anytime</div>
      <div style="background:var(--blue-lt);border:1px solid var(--blue);border-radius:var(--r);padding:10px 14px;margin-bottom:16px;font-size:12px;color:var(--blue-dk)">
        📍 You're in <strong>${stateStr}</strong> — market rates loaded${multNote}
        <button onclick="document.getElementById('_gei-state-sel')?.classList.toggle('show')" style="margin-left:8px;background:none;border:none;color:var(--blue);font-size:11px;cursor:pointer;text-decoration:underline;font-family:inherit">Change</button>
        <select id="_gei-state-sel" class="show" onchange="S.state=this.value;saveAll();showGeiOnboarding()" style="display:block;margin-top:8px;padding:6px 8px;border-radius:var(--r);border:1px solid var(--border2);font-size:13px;background:var(--bg);color:var(--text);width:100%">
          ${['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC'].map(st => `<option value="${st}"${S.state === st ? ' selected' : ''}>${st}</option>`).join('')}
        </select>
      </div>
      <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px">What kind of work do you do? <span style="font-weight:400;color:var(--text3)">(tap all that apply)</span></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:18px">
        ${BUNDLE_CARDS.map(b => {
      const on = selected.has(b.id);
      return `<button onclick="_geiOnboardToggle('${b.id}')" data-bid="${b.id}" style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:14px 8px;border-radius:var(--rl);border:2px solid ${on ? 'var(--blue)' : 'var(--border2)'};background:${on ? 'var(--blue-lt)' : 'var(--bg2)'};cursor:pointer;font-family:inherit;gap:5px;min-height:80px;text-align:center;box-sizing:border-box">
            <span style="font-size:26px;line-height:1">${b.emoji}</span>
            <span style="font-size:11px;font-weight:700;color:${on ? 'var(--blue-dk)' : 'var(--text)'};white-space:pre-line;line-height:1.3">${b.label}</span>
            ${on ? '<span style="font-size:10px;color:var(--blue);font-weight:700">✓</span>' : ''}
          </button>`;
    }).join('')}
      </div>
      <button onclick="_geiOnboardFinish()" id="_gei-ob-btn" style="width:100%;padding:14px;border-radius:var(--rl);border:none;background:${selected.size ? 'var(--blue)' : 'var(--border2)'};color:${selected.size ? '#fff' : 'var(--text3)'};font-weight:800;font-size:15px;cursor:${selected.size ? 'pointer' : 'default'};font-family:inherit;margin-bottom:10px">
        ${selected.size ? `Get started → (${selected.size} service type${selected.size !== 1 ? 's' : ''})` : 'Select at least one service type'}
      </button>
      <button onclick="_geiOnboardSkip()" style="width:100%;padding:10px;background:none;border:none;color:var(--text3);font-size:12px;cursor:pointer;font-family:inherit">Set up later — you'll be reminded next time</button>
    </div>`;
  }
  window._geiOnboardToggle = function (id) {
    if (selected.has(id)) selected.delete(id);else selected.add(id);
    document.getElementById('_gei-onboard-ov')?.remove();
    document.body.appendChild(ov);
    render();
  };
  window._geiOnboardFinish = function () {
    if (!selected.size) return;
    S.myBundles = [...selected];
    S.hasOnboarded = true;
    saveAll();
    ov.remove();
    showToast('Services set up — showing ' + S.state + ' market rates', '✓');
  };
  window._geiOnboardSkip = function () {
    ov.remove(); // session-only dismiss — myBundles stays unset, popup re-appears next load
  };
  render();
  document.body.appendChild(ov);
}
function _geiSetScope(commercial) {
  _geiIsCommercial = !!commercial;
  _geiSyncScopeButtons();
  if (_geiStep === 2) _geiRenderTemplates();
}
function _geiToggleEmergency() {
  _geiEmergency = !_geiEmergency;
  _geiSyncScopeButtons();
  if (_geiEmergency && !_geiLines.some(l => l.desc && l.desc.includes('Emergency'))) {
    _geiLines.unshift({
      desc: 'Emergency / after-hours service call',
      qty: 1,
      unit: 'ea',
      rate: 125,
      total: 125
    });
    if (_geiStep === 3) {
      renderGeiLines();
      calcGeiTotal();
    }
    _geiRenderCartBar();
  }
  if (_geiStep === 2) _geiRenderTemplates();
}
function _geiAddTemplate(job) {
  if (job.gasLic) showToast('Gas work — verify you\'re licensed for gas in your state', '⚠️');
  if (job.freeForm) {
    _geiShowFreeFormModal(job);
    return;
  }
  const laborRate = _geiEmergency ? Math.round(job.labor * 1.5) : job.labor;
  if (job.custom) {
    const unitLabel = {
      sqft: 'square footage',
      'lin ft': 'linear feet',
      kW: 'kilowatts',
      kWh: 'kilowatt-hours',
      fixture: 'number of fixtures'
    }[job.unit] || job.unit;
    const raw = prompt('Enter ' + unitLabel + ' for: ' + job.name);
    if (!raw) return;
    const qty = parseFloat(raw);
    if (!qty || isNaN(qty)) return;
    if (laborRate > 0) _geiLines.push({
      desc: job.name + ' — labor',
      qty,
      unit: job.unit,
      rate: laborRate,
      total: qty * laborRate
    });
    if (job.mat > 0) _geiLines.push({
      desc: job.matDesc || 'Materials',
      qty,
      unit: job.unit,
      rate: job.mat,
      total: qty * job.mat
    });
  } else {
    if (laborRate > 0) _geiLines.push({
      desc: job.name + ' — labor',
      qty: 1,
      unit: job.unit,
      rate: laborRate,
      total: laborRate
    });
    if (job.mat > 0) _geiLines.push({
      desc: job.matDesc || 'Materials',
      qty: 1,
      unit: job.unit,
      rate: job.mat,
      total: job.mat
    });
  }
  renderGeiLines();
  calcGeiTotal();
}
function _geiShowFreeFormModal(job) {
  const laborRate = _geiEmergency ? Math.round(job.labor * 1.5) : job.labor;
  const isCustomQty = !!job.custom;
  const unitLabel = {
    sqft: 'sqft',
    'lin ft': 'lin ft',
    kW: 'kW',
    kWh: 'kWh',
    fixture: 'fixtures'
  }[job.unit] || job.unit;
  const ov = document.createElement('div');
  ov.id = '_gei-ff-ov';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';
  ov.innerHTML = `
    <div style="background:var(--bg);border-radius:14px;padding:20px 18px 24px;width:100%;max-width:480px;box-sizing:border-box;max-height:90vh;overflow-y:auto">
      <div style="font-size:14px;font-weight:800;color:var(--text);margin-bottom:4px">${escHtml(job.name)}</div>
      <div style="font-size:12px;color:var(--text3);margin-bottom:14px">${escHtml(job.freeFormLabel || 'Specify brand/model')}</div>
      <div class="f" style="margin-bottom:10px"><label>Brand / model</label>
        <input id="_ff-model" type="text" placeholder="${escHtml(job.freeFormLabel || 'e.g. Mitsubishi MSZ-GL09NA')}" style="font-size:14px" autocomplete="off">
      </div>
      ${isCustomQty ? `<div class="fg fg2" style="margin-bottom:10px">
        <div class="f"><label>Quantity (${unitLabel})</label><input id="_ff-qty" type="number" value="1" min="0.1" step="any" style="font-size:14px"></div>
        <div></div>
      </div>` : ''}
      <div class="fg fg2" style="margin-bottom:14px">
        <div class="f"><label>Labor rate ($/${job.unit})</label><input id="_ff-labor" type="number" value="${laborRate}" min="0" step="any" style="font-size:14px"></div>
        ${job.mat > 0 ? `<div class="f"><label>Material cost ($/${job.unit})</label><input id="_ff-mat" type="number" value="${job.mat}" min="0" step="any" style="font-size:14px"></div>` : '<div></div>'}
      </div>
      <button class="btn btn-p" onclick="_geiConfirmFreeForm(${JSON.stringify(job).replace(/"/g, '&quot;')})" style="margin-bottom:8px">Add to estimate</button>
      <button class="btn" onclick="document.getElementById('_gei-ff-ov')?.remove()" style="color:var(--text2);font-size:13px">Cancel</button>
    </div>`;
  document.body.appendChild(ov);
  setTimeout(() => document.getElementById('_ff-model')?.focus(), 100);
}
function _geiConfirmFreeForm(job) {
  const model = (document.getElementById('_ff-model')?.value || '').trim();
  const laborRate = parseFloat(document.getElementById('_ff-labor')?.value) || 0;
  const matRate = parseFloat(document.getElementById('_ff-mat')?.value) || 0;
  const qty = parseFloat(document.getElementById('_ff-qty')?.value) || 1;
  document.getElementById('_gei-ff-ov')?.remove();
  const modelTag = model ? ' — ' + model : '';
  if (laborRate > 0) _geiLines.push({
    desc: job.name + modelTag + ' — labor',
    qty,
    unit: job.unit,
    rate: laborRate,
    total: qty * laborRate
  });
  if (matRate > 0) _geiLines.push({
    desc: (model || job.matDesc || 'Materials') + modelTag,
    qty,
    unit: job.unit,
    rate: matRate,
    total: qty * matRate
  });
  renderGeiLines();
  calcGeiTotal();
}
function _geiAddFromBook(i) {
  const trade = _geiTrade || 'general';
  const book = S.priceBook && S.priceBook[trade] || [];
  if (!book[i]) return;
  _geiLines.push({
    desc: book[i].desc,
    qty: 1,
    unit: book[i].unit || '',
    rate: book[i].rate,
    total: book[i].rate
  });
  renderGeiLines();
  calcGeiTotal();
}
function _geiSaveToPriceBook(i) {
  const line = _geiLines[i];
  if (!line || !line.desc || !line.rate) return;
  const trade = _geiTrade || 'general';
  if (!S.priceBook) S.priceBook = {};
  if (!S.priceBook[trade]) S.priceBook[trade] = [];
  if (S.priceBook[trade].some(x => x.desc === line.desc && x.rate === line.rate)) {
    showToast('Already in price book');
    return;
  }
  S.priceBook[trade].push({
    desc: line.desc,
    unit: line.unit || 'ea',
    rate: line.rate
  });
  saveAll();
  showToast('Saved to price book', '🔖');
  _geiRenderTemplates();
}
function renderGeiLines() {
  const el = document.getElementById('gei-lines');
  if (!el) return;
  if (!_geiLines.length) {
    el.innerHTML = '<div style="font-size:13px;color:var(--text3);text-align:center;padding:20px 0">No line items yet — tap <strong>+ Add line</strong> above.</div>';
    return;
  }
  el.innerHTML = _geiLines.map((l, i) => {
    const total = (l.qty || 1) * (l.rate || 0);
    const totalFmt = '$' + total.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    });
    const isLabor = l._tmLabor;
    return `<div style="background:var(--bg2);border-radius:var(--rl);border:1px solid var(--border2);padding:13px 14px;margin-bottom:8px">
      <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:10px">
        <input type="text" value="${escHtml(l.desc || '')}" ${isLabor ? 'readonly' : ''} oninput="_geiLines[${i}].desc=this.value" placeholder="Description" style="flex:1;background:transparent;border:none;border-bottom:1.5px solid var(--border2);font-size:14px;font-weight:600;font-family:inherit;color:var(--text);padding:2px 0 7px;outline:none;${isLabor ? 'opacity:.7;' : ''}">
        ${isLabor ? '' : `<button onclick="_geiLines.splice(${i},1);renderGeiLines();calcGeiTotal();_geiRenderCartBar()" style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:22px;padding:0 2px;line-height:1;flex-shrink:0;margin-top:-2px" aria-label="Remove">×</button>`}
      </div>
      <div style="display:grid;grid-template-columns:60px 50px 1fr 90px;gap:8px;align-items:end">
        <div>
          <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:4px">Qty</div>
          <input type="number" value="${l.qty || 1}" min="0" step="any" inputmode="decimal" ${isLabor ? 'readonly' : ''}
            oninput="_geiLines[${i}].qty=parseFloat(this.value)||1;calcGeiTotal();document.getElementById('gei-line-total-${i}').textContent='$'+((parseFloat(this.value)||1)*(${l.rate || 0})).toLocaleString('en-US',{maximumFractionDigits:0})"
            style="width:100%;padding:6px 4px;border-radius:var(--r);border:1px solid var(--border2);font-size:14px;text-align:center;background:var(--bg);color:var(--text);font-family:inherit;box-sizing:border-box;${isLabor ? 'opacity:.7;' : ''}">
        </div>
        <div>
          <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:4px">Unit</div>
          <input type="text" value="${escHtml(l.unit || 'ea')}" ${isLabor ? 'readonly' : ''} oninput="_geiLines[${i}].unit=this.value"
            style="width:100%;padding:6px 4px;border-radius:var(--r);border:1px solid var(--border2);font-size:12px;text-align:center;background:var(--bg);color:var(--text2);font-family:inherit;box-sizing:border-box;${isLabor ? 'opacity:.7;' : ''}">
        </div>
        <div>
          <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:4px">Rate ($)</div>
          <input type="number" value="${l.rate || ''}" min="0" step="any" inputmode="decimal" ${isLabor ? 'readonly' : ''}
            oninput="_geiLines[${i}].rate=parseFloat(this.value)||0;calcGeiTotal();document.getElementById('gei-line-total-${i}').textContent='$'+((${l.qty || 1})*(parseFloat(this.value)||0)).toLocaleString('en-US',{maximumFractionDigits:0})"
            onblur="_geiRateBlur(${i},this.value)" placeholder="0"
            style="width:100%;padding:6px 8px;border-radius:var(--r);border:1px solid var(--border2);font-size:14px;text-align:right;background:var(--bg);color:var(--text);font-family:inherit;box-sizing:border-box;${isLabor ? 'opacity:.7;' : ''}">
        </div>
        <div style="text-align:right">
          <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:4px">Total</div>
          <div id="gei-line-total-${i}" style="font-size:18px;font-weight:800;color:var(--blue);line-height:1.2">${totalFmt}</div>
        </div>
      </div>
      ${isLabor ? '' : `<div style="display:flex;justify-content:flex-end;margin-top:8px"><button onclick="_geiSaveToPriceBook(${i})" style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:11px;font-weight:600;font-family:inherit;padding:0;display:flex;align-items:center;gap:3px">🔖 Save to price book</button></div>`}
    </div>`;
  }).join('');
}
function addGeiLine() {
  _geiLines.push({
    desc: '',
    qty: 1,
    unit: 'ea',
    rate: '',
    total: 0
  });
  renderGeiLines();
  calcGeiTotal();
}
function _saveToLineHistory() {
  if (!_geiLines.length) return;
  if (!S.lineHistory) S.lineHistory = [];
  _geiLines.forEach(l => {
    if (!l.desc || l._tmLabor) return;
    const key = l.desc.toLowerCase().trim();
    const idx = S.lineHistory.findIndex(h => (h.desc || '').toLowerCase().trim() === key);
    if (idx >= 0) {
      S.lineHistory[idx].count = (S.lineHistory[idx].count || 0) + 1;
      if (l.rate) S.lineHistory[idx].rate = l.rate;
      if (l.unit) S.lineHistory[idx].unit = l.unit;
      if (l.qty) S.lineHistory[idx].qty = l.qty;
      S.lineHistory[idx].lastUsed = Date.now();
      S.lineHistory[idx].trade = _geiTrade || 'general';
    } else {
      S.lineHistory.push({
        desc: l.desc,
        qty: l.qty || 1,
        unit: l.unit || 'ea',
        rate: l.rate || 0,
        count: 1,
        lastUsed: Date.now(),
        trade: _geiTrade || 'general'
      });
    }
  });
  S.lineHistory.sort((a, b) => (b.count || 0) - (a.count || 0));
  if (S.lineHistory.length > 100) S.lineHistory.length = 100;
  saveAll();
}
function _geiRateBlur(i, val) {
  const line = _geiLines[i];
  if (!line || !line.jobId) return;
  let job = null;
  for (const t of Object.values(TRADE_JOBS)) {
    job = (t || []).find(j => j.id === line.jobId);
    if (job) break;
  }
  if (!job) return;
  const p = _geiJobPrice(job);
  const market = p.labor + (p.mat || 0);
  const entered = parseInt(val) || 0;
  if (entered > 0 && entered !== market) {
    S.myRates = S.myRates || {};
    S.myRates[line.jobId] = {
      labor: entered,
      mat: 0
    };
    saveAll();
    showToast('Rate saved', '💾');
  }
}

// ─── Panel Schedule Builder ───────────────────────────────────────────────────
function _panelAutoGauge(a) {
  const hits = Object.keys(_PANEL_GAUGE).map(Number).filter(k => k >= a);
  return _PANEL_GAUGE[hits.length ? Math.min(...hits) : 200] || '';
}
function _panelCalcBalance() {
  if (!_panelSched) return {
    l1: 0,
    l2: 0,
    slots: 0,
    used: 0,
    imbalance: 0
  };
  const {
    panelAmps,
    circuits
  } = _panelSched;
  const slots = _PANEL_SLOTS[panelAmps] || 40;
  let l1 = 0,
    l2 = 0,
    used = 0;
  (circuits || []).forEach(c => {
    const a = +c.amps || 0;
    if (c.phase === '2pole') {
      l1 += a;
      l2 += a;
      used += 2;
    } else if (c.phase === 'L2') {
      l2 += a;
      used += 1;
    } else {
      l1 += a;
      used += 1;
    }
  });
  const imbalance = Math.max(l1, l2) > 0 ? Math.abs(l1 - l2) / Math.max(l1, l2) : 0;
  return {
    l1,
    l2,
    slots,
    used,
    imbalance,
    spare: Math.max(0, slots - used)
  };
}
function _panelRenderSection() {
  const el = document.getElementById('gei-panel-section');
  if (!el) return;
  if (_geiTrade !== 'electrical') {
    el.innerHTML = '';
    return;
  }
  if (!_panelSched) {
    el.innerHTML = `<button onclick="_panelOpen()" style="width:100%;padding:12px;border-radius:var(--r);border:1.5px dashed var(--border2);background:var(--bg2);color:var(--text3);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;text-align:center">📋 Add panel schedule <span style="font-size:11px;font-weight:400">(optional — leave with the panel)</span></button>`;
    return;
  }
  const {
    l1,
    l2,
    slots,
    used,
    imbalance,
    spare
  } = _panelCalcBalance();
  const pa = _panelSched.panelAmps || 200;
  const imbalBadge = imbalance > 0.10 ? `<span style="background:#fef2f2;color:#dc2626;border:1px solid #fca5a5;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:700;margin-left:8px">⚠️ ${(imbalance * 100).toFixed(0)}% imbalance</span>` : '<span style="background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:700;margin-left:8px">✓ balanced</span>';
  const circuits = _panelSched.circuits || [];
  const rowStyle = 'display:grid;grid-template-columns:1fr 52px 70px 60px 34px 34px 20px;gap:4px;align-items:center;margin-bottom:5px';
  const hdStyle = 'font-size:10px;font-weight:700;color:var(--text3);text-align:center';
  let rows = `<div style="${rowStyle};margin-bottom:8px">
    <div style="${hdStyle};text-align:left">Circuit description</div>
    <div style="${hdStyle}">Amps</div>
    <div style="${hdStyle}">Phase</div>
    <div style="${hdStyle}">Wire gauge</div>
    <div style="${hdStyle}">AFCI</div>
    <div style="${hdStyle}">GFCI</div>
    <div></div>
  </div>`;
  circuits.forEach((c, i) => {
    const phaseOpts = ['L1', 'L2', '2pole'].map(p => `<option value="${p}"${c.phase === p ? ' selected' : ''}>${p === '2pole' ? '2-pole' : p}</option>`).join('');
    rows += `<div style="${rowStyle}">
      <input type="text" value="${escHtml(c.desc || '')}" oninput="_panelSched.circuits[${i}].desc=this.value" placeholder="e.g. Kitchen outlets" style="padding:6px 7px;border-radius:var(--r);border:1px solid var(--border2);font-size:12px;font-family:inherit;background:var(--bg2);color:var(--text);width:100%;box-sizing:border-box">
      <input type="number" value="${c.amps || ''}" min="1" max="400" step="1" oninput="_panelSched.circuits[${i}].amps=+this.value;_panelSched.circuits[${i}].gauge=_panelSched.circuits[${i}].gauge||_panelAutoGauge(+this.value);_panelRenderSection()" placeholder="20" style="padding:6px 4px;border-radius:var(--r);border:1px solid var(--border2);font-size:12px;text-align:center;background:var(--bg2);color:var(--text);width:100%;box-sizing:border-box">
      <select oninput="_panelSched.circuits[${i}].phase=this.value;_panelRenderSection()" style="padding:6px 4px;border-radius:var(--r);border:1px solid var(--border2);font-size:12px;background:var(--bg2);color:var(--text);width:100%;box-sizing:border-box">${phaseOpts}</select>
      <input type="text" value="${escHtml(c.gauge || '')}" oninput="_panelSched.circuits[${i}].gauge=this.value" placeholder="12 AWG" style="padding:6px 4px;border-radius:var(--r);border:1px solid var(--border2);font-size:11px;background:var(--bg2);color:var(--text3);width:100%;box-sizing:border-box">
      <label style="display:flex;align-items:center;justify-content:center;cursor:pointer"><input type="checkbox" ${c.afci ? 'checked' : ''} onchange="_panelSched.circuits[${i}].afci=this.checked" style="width:16px;height:16px;cursor:pointer"></label>
      <label style="display:flex;align-items:center;justify-content:center;cursor:pointer"><input type="checkbox" ${c.gfci ? 'checked' : ''} onchange="_panelSched.circuits[${i}].gfci=this.checked" style="width:16px;height:16px;cursor:pointer"></label>
      <button onclick="_panelRemoveCircuit(${i})" style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:16px;padding:0;line-height:1">×</button>
    </div>`;
  });
  const l1Pct = Math.max(l1, l2) > 0 ? Math.round(l1 / Math.max(l1, l2) * 100) : 50;
  const l2Pct = Math.max(l1, l2) > 0 ? Math.round(l2 / Math.max(l1, l2) * 100) : 50;
  el.innerHTML = `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text3)">📋 Panel schedule</div>
      <div style="display:flex;gap:6px">
        <button onclick="_panelPrint()" style="padding:5px 11px;border-radius:var(--r);border:1.5px solid var(--border2);background:var(--bg2);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;color:var(--text2)">🖨️ Print</button>
        <button onclick="_panelClose()" style="padding:5px 11px;border-radius:var(--r);border:1.5px solid #fca5a5;background:#fef2f2;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;color:#dc2626">Remove</button>
      </div>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:6px">
        <label style="font-size:12px;color:var(--text2);white-space:nowrap">Panel size:</label>
        <select onchange="_panelSched.panelAmps=+this.value;_panelRenderSection()" style="padding:6px 8px;border-radius:var(--r);border:1.5px solid var(--border2);font-size:13px;font-weight:700;background:var(--bg2);color:var(--text)">
          ${[100, 150, 200, 400].map(a => `<option value="${a}"${pa === a ? ' selected' : ''}>${a}A</option>`).join('')}
        </select>
      </div>
      <div style="font-size:12px;color:var(--text2)">${used} of ${slots} slots used · <strong>${spare} spare</strong>${imbalBadge}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
      <div style="background:var(--bg2);border-radius:var(--r);padding:8px 10px">
        <div style="font-size:10px;font-weight:700;color:var(--text3);margin-bottom:4px">L1 LEG</div>
        <div style="font-size:18px;font-weight:800;color:var(--text)">${l1}A</div>
        <div style="height:6px;background:var(--border);border-radius:3px;margin-top:5px"><div style="height:100%;width:${l1Pct}%;background:var(--blue);border-radius:3px"></div></div>
      </div>
      <div style="background:var(--bg2);border-radius:var(--r);padding:8px 10px">
        <div style="font-size:10px;font-weight:700;color:var(--text3);margin-bottom:4px">L2 LEG</div>
        <div style="font-size:18px;font-weight:800;color:var(--text)">${l2}A</div>
        <div style="height:6px;background:var(--border);border-radius:3px;margin-top:5px"><div style="height:100%;width:${l2Pct}%;background:#7c3aed;border-radius:3px"></div></div>
      </div>
    </div>
    <div id="panel-rows">${rows}</div>
    <button onclick="_panelAddCircuit()" class="btn btn-sm" style="width:100%;padding:8px;font-size:12px;margin-top:4px">+ Add circuit</button>
  </div>`;
}
function _panelOpen() {
  _panelSched = {
    panelAmps: 200,
    circuits: []
  };
  _panelAddCircuit();
  _panelRenderSection();
}
function _panelClose() {
  _panelSched = null;
  _panelRenderSection();
}
function _panelAddCircuit() {
  if (!_panelSched) return;
  _panelSched.circuits.push({
    desc: '',
    amps: 20,
    phase: 'L1',
    gauge: '12 AWG',
    afci: false,
    gfci: false
  });
  _panelRenderSection();
}
function _panelRemoveCircuit(i) {
  if (!_panelSched) return;
  _panelSched.circuits.splice(i, 1);
  _panelRenderSection();
}
function _panelPrint() {
  if (!_panelSched) return;
  const {
    l1,
    l2,
    slots,
    used,
    imbalance,
    spare
  } = _panelCalcBalance();
  const pa = _panelSched.panelAmps;
  const circuits = _panelSched.circuits || [];
  const client = document.getElementById('gei-client')?.value || '';
  const addr = document.getElementById('gei-addr')?.value || '';
  const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  const biz = S.bname || getBusinessName() || '';
  const imbalTxt = imbalance > 0.10 ? `<span style="color:#dc2626;font-weight:700">⚠️ ${(imbalance * 100).toFixed(0)}% imbalance — rebalance recommended</span>` : `<span style="color:#16a34a;font-weight:700">✓ Balanced (${(imbalance * 100).toFixed(0)}% difference)</span>`;
  const rows = circuits.map((c, i) => `<tr>
    <td style="text-align:center;padding:4px 6px;border:1px solid #ccc">${i + 1}</td>
    <td style="padding:4px 8px;border:1px solid #ccc">${escHtml(c.desc || '—')}</td>
    <td style="text-align:center;padding:4px 6px;border:1px solid #ccc;font-weight:700">${c.amps || ''}A</td>
    <td style="text-align:center;padding:4px 6px;border:1px solid #ccc">${c.phase === '2pole' ? '2-pole' : c.phase}</td>
    <td style="text-align:center;padding:4px 6px;border:1px solid #ccc">${escHtml(c.gauge || '')}</td>
    <td style="text-align:center;padding:4px 6px;border:1px solid #ccc">${c.afci ? '✓' : ''}</td>
    <td style="text-align:center;padding:4px 6px;border:1px solid #ccc">${c.gfci ? '✓' : ''}</td>
  </tr>`).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Panel Schedule</title>
  <style>
    body{font-family:-apple-system,Arial,sans-serif;margin:0;padding:20px;font-size:13px;color:#111}
    h1{font-size:18px;margin:0 0 4px}
    .meta{color:#555;font-size:12px;margin-bottom:16px}
    .stats{display:flex;gap:24px;margin-bottom:16px;background:#f5f5f5;padding:10px 14px;border-radius:6px}
    .stat{text-align:center}.stat-val{font-size:22px;font-weight:800}.stat-lbl{font-size:10px;color:#666;text-transform:uppercase}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th{background:#1a1a2e;color:#fff;padding:6px 8px;border:1px solid #ccc;font-size:11px;text-align:center}
    @media print{button{display:none!important}}
  </style></head><body>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
    <div><h1>⚡ Panel Schedule</h1><div class="meta">${escHtml(biz)}${client ? ' · ' + escHtml(client) : ''}${addr ? ' · ' + escHtml(addr) : ''}<br>Date: ${dateStr}</div></div>
    <div style="text-align:right;font-size:13px"><strong>${pa}A Main Panel</strong><br>${used} of ${slots} slots used · ${spare} spare<br>${imbalTxt}</div>
  </div>
  <div class="stats">
    <div class="stat"><div class="stat-val">${l1}A</div><div class="stat-lbl">L1 Leg</div></div>
    <div class="stat"><div class="stat-val">${l2}A</div><div class="stat-lbl">L2 Leg</div></div>
    <div class="stat"><div class="stat-val">${Math.abs(l1 - l2)}A</div><div class="stat-lbl">Difference</div></div>
    <div class="stat"><div class="stat-val">${spare}</div><div class="stat-lbl">Spare slots</div></div>
  </div>
  <table><thead><tr>
    <th>#</th><th style="text-align:left">Circuit description</th><th>Amps</th><th>Phase</th><th>Wire gauge</th><th>AFCI</th><th>GFCI</th>
  </tr></thead><tbody>${rows}</tbody></table>
  <div style="margin-top:16px;font-size:10px;color:#888;border-top:1px solid #ddd;padding-top:8px">Generated by TradeDesk · ${biz} · ${dateStr}</div>
  <button onclick="window.print()" style="margin-top:16px;padding:10px 24px;background:#1a1a2e;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:700;cursor:pointer">🖨️ Print / Save PDF</button>
  </body></html>`;
  const win = window.open('', '_blank');
  if (win) {
    win.document.write(html);
    win.document.close();
  } else showToast('Allow pop-ups to print', '⚠️');
}
function calcGeiTotal() {
  const sub = _geiLines.reduce((s, l) => s + (l.qty || 1) * (l.rate || 0), 0);
  const pct = parseFloat(document.getElementById('gei-tax-pct')?.value) || 0;
  const tax = sub * pct / 100;
  const total = sub + tax;
  const fmt = n => '$' + n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };
  set('gei-subtotal', fmt(sub));
  set('gei-tax-amt', fmt(tax));
  set('gei-total', fmt(total));
  return {
    sub,
    tax,
    total
  };
}
function saveGenericEstimate(draft) {
  const v = id => document.getElementById(id)?.value || '';
  const {
    total,
    sub
  } = calcGeiTotal();
  const trade = _geiTrade || getActiveTrade();
  const taxPct = parseFloat(v('gei-tax-pct')) || 0;
  // T&M extra fields
  const _tmNteFromNew = parseFloat(v('tm-i-nte')) || 0;
  const _tmNteOnEl = document.getElementById('tm-nte-on');
  const _tmNteOnChecked = _tmNteOnEl ? _tmNteOnEl.checked || false : false;
  const _tmFields = _geiIsTM ? {
    isTM: true,
    tmReason: v('tm-reason'),
    tmReasonNote: v('tm-reason-note'),
    tmCrewCount: _tmCrewCount,
    tmRatePerMan: _tmRatePerMan,
    tmEstHours: _tmEstHours,
    tmBillingCycle: _tmBillingCycle || 'weekly',
    tmMatMarkup: _tmMatMarkup,
    tmCapAction: v('tm-i-cap-action') || _tmCapAction || '',
    tmDepositPct: parseFloat(v('tm-dep-pct')) || 20,
    tmDepositAmt: Math.round(sub * (parseFloat(v('tm-dep-pct')) || 20) / 100),
    tmNteEnabled: _tmNteFromNew > 0 || _tmNteOnChecked,
    tmNteCap: _tmNteFromNew || parseFloat(v('tm-nte-cap')) || 0
  } : {
    isTM: false
  };
  const _byoDepPct = _geiIsTM ? null : (parseFloat(document.getElementById('byo-deposit-pct')?.value) || 25) / 100;
  const _deposit = _geiIsTM ? _tmFields.tmDepositAmt || 0 : Math.round(total * _byoDepPct * 100) / 100;
  const _typeLabel = _geiIsTM ? 'Time & Materials Proposal' : _geiIsFreeForm ? 'Custom Proposal' : (TRADE_META[trade]?.label || 'Trade') + ' Proposal';
  // Extract BYO field values before object literals — Safari fails to parse ?.?? inside spread conditionals
  const _byoTermsEl = document.getElementById('byo-custom-terms');
  const _byoTermsSave = _byoTermsEl ? _byoTermsEl.value : _byoCustomTerms || '';
  const _byoSecsSave = [..._byoCustomSections];
  if (_geiEditBidId) {
    const b = bids.find(x => x.id === _geiEditBidId);
    if (b) {
      b.amount = total;
      b.type = v('gei-desc') || _typeLabel;
      b.notes = v('gei-notes');
      b.geiLines = JSON.parse(JSON.stringify(_geiLines));
      b.geiTaxPct = taxPct;
      b.status = draft ? 'Draft' : 'Pending';
      b.draft = !!draft;
      b.geiDuration = v('gei-duration') || '';
      b.geiNewWork = _geiNewWork || false;
      b.trade_type = trade;
      b.deposit = _deposit;
      b.isFreeForm = _geiIsFreeForm || false;
      if (_geiIsFreeForm && _byoItems.length) b.byoItems = JSON.parse(JSON.stringify(_byoItems));
      if (_geiIsFreeForm) {
        b.byoCustomSections = _byoSecsSave;
        b.byoCustomTerms = _byoTermsSave;
      }
      if (_panelSched) b.panelSched = JSON.parse(JSON.stringify(_panelSched));else delete b.panelSched;
      Object.assign(b, _tmFields);
      saveAll();
    }
  } else {
    const newBid = {
      id: _newBidId(),
      client_id: _geiClientId,
      client_name: v('gei-client'),
      name: v('gei-client'),
      phone: '',
      addr: v('gei-addr'),
      bid_date: v('gei-date') || todayKey(),
      amount: total,
      deposit: _deposit,
      type: v('gei-desc') || _typeLabel,
      notes: v('gei-notes'),
      status: draft ? 'Draft' : 'Pending',
      draft: !!draft,
      isFreeForm: _geiIsFreeForm || false,
      ...(_geiIsFreeForm && _byoItems.length ? {
        byoItems: JSON.parse(JSON.stringify(_byoItems))
      } : {}),
      ...(_geiIsFreeForm ? {
        byoCustomSections: _byoSecsSave,
        byoCustomTerms: _byoTermsSave
      } : {}),
      geiLines: JSON.parse(JSON.stringify(_geiLines)),
      geiTaxPct: taxPct,
      geiDuration: v('gei-duration') || '',
      geiNewWork: _geiNewWork || false,
      trade_type: trade,
      ...(_panelSched ? {
        panelSched: JSON.parse(JSON.stringify(_panelSched))
      } : {}),
      ..._tmFields
    };
    bids.unshift(newBid);
    _geiEditBidId = newBid.id;
    saveAll();
  }
  if (!draft) _saveToLineHistory();
  showToast(draft ? 'Draft saved' : 'Proposal saved', '✅');
  if (!draft) goPg('pg-clients');
}
async function sendGenericProposal(previewOnly) {
  saveGenericEstimate(true); // draft=true skips navigation — modal shows over estimate page
  _saveToLineHistory();
  if (!previewOnly) {
    // Build minimal proposal for sign.html
    if (!navigator.onLine) {
      zAlert('You\'re offline — the proposal link can\'t be activated right now.\n\nYour estimate is saved. Once you\'re back online, open this bid and tap Send to send the link to your client.', {
        title: 'No internet connection'
      });
      return;
    }
    if (!supaEnabled() || !_supaUser) {
      zAlert('Sign in to send client links.');
      return;
    }
  }
  if (_stripeConnectStatus === null) _fetchStripeConnectStatus().catch(() => {});
  const v = id => {
    const _e = document.getElementById(id);
    return _e ? _e.value || '' : '';
  };
  const {
    total,
    sub
  } = calcGeiTotal();
  const trade = _geiTrade || getActiveTrade();
  const taxPct = parseFloat(v('gei-tax-pct')) || 0;
  const bname = escHtml(S.bname || getBusinessName() || '');
  const bphone = escHtml(S.bphone || '');
  const blic = escHtml(S.blic || '');
  const clientName = escHtml(v('gei-client'));
  const clientAddr = escHtml(v('gei-addr'));
  const jobDesc = escHtml(v('gei-desc'));
  const duration = escHtml(v('gei-duration'));
  const _tradeM = TRADE_META[trade] || null;
  const tradeName = _tradeM && _tradeM.label || 'Service';
  const tradeIcon = _tradeM && _tradeM.icon || '🔧';
  const estNum = _geiEditBidId ? String(_geiEditBidId).slice(-6) : '—';
  const dateStr = new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
  const totalFmt = '$' + total.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  const _tmDepPct = parseFloat(v('tm-dep-pct')) || 20;
  const _byoDepPctEl = document.getElementById('byo-deposit-pct');
  const _sendByoDepPct = _geiIsTM ? null : (parseFloat(_byoDepPctEl ? _byoDepPctEl.value : null) || 25) / 100;
  const _sendByoDepPctLabel = _geiIsTM ? null : Math.round(_sendByoDepPct * 100);
  const _tmDepAmt = _geiIsTM ? Math.round(sub * _tmDepPct / 100) : Math.round(total * _sendByoDepPct * 100) / 100;
  const _tmNteCap = parseFloat(v('tm-nte-cap')) || 0;
  const depositFmt = '$' + _tmDepAmt.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  // MUST be declared before the template literals below that use it — TDZ if declared after
  const _stateKey = S && S.state ? S.state : 'KS';
  const _tmDepRow = _geiIsTM ? `<tr style="background:#0369a1;color:rgba(255,255,255,.88)"><td colspan="2" style="padding:6px 18px;font-size:11px;font-weight:600">Mobilization Deposit (${_tmDepPct}%) Due Before Work Begins</td><td style="padding:6px 18px;text-align:right;font-size:12px;font-weight:700">${depositFmt}</td></tr>` : `<tr style="background:#2a4a7f;color:rgba(255,255,255,.88)"><td colspan="2" style="padding:6px 18px;font-size:11px;font-weight:600">${_sendByoDepPctLabel}% Deposit Due Before Work Begins</td><td style="padding:6px 18px;text-align:right;font-size:12px;font-weight:700">${depositFmt}</td></tr>`;
  const _tmPayTerms = _geiIsTM ? `<div style="font-size:11px;color:#2d3748;line-height:2"><div>1. <strong>Contract type:</strong> Time &amp; Materials${_tmNteCap ? ` — not to exceed $${_tmNteCap.toLocaleString()}` : ' (T&amp;M)'}</div><div>2. <strong>Mobilization deposit:</strong> ${_tmDepPct}% (${depositFmt}) due before work begins.</div><div>3. <strong>Billing:</strong> ${_tmBillingCycle === 'weekly' ? 'Weekly' : 'Bi-weekly'} invoices with time sheets and material receipts attached.</div><div>4. <strong>Change Orders:</strong> Any additional scope not described herein requires a written change order signed by both parties.</div><div>5. <strong>Warranty:</strong> All workmanship warranted for one (1) year from date of completion.</div><div>6. <strong>Limitation of Liability:</strong> Contractor is not responsible for pre-existing conditions or damage not disclosed prior to the start of work.</div><div>7. <strong>Mechanic&#39;s Lien:</strong> Contractor reserves the right to file a mechanic&#39;s lien for any unpaid amounts under this agreement.</div></div>` : `<div style="font-size:11px;color:#2d3748;line-height:2"><div>1. <strong>Deposit:</strong> ${_sendByoDepPctLabel}% due before work begins and before a start date is scheduled. Balance due upon completion.</div><div>2. <strong>Cancellation &amp; Deposits:</strong> Buyer may cancel within ${typeof STATE_CANCEL !== 'undefined' && STATE_CANCEL[_stateKey] ? STATE_CANCEL[_stateKey].days : 3} business days of signing (${_cancelCitation(_stateKey)}) for a full refund of any deposit. After that period, if Buyer cancels or fails to proceed, the deposit is retained as liquidated damages for mobilization, scheduling, administrative, and material procurement costs — a reasonable estimate of actual damages, not a penalty. ${bname}'s right to retain the deposit is conditioned on ${bname}'s readiness and willingness to perform. If ${bname} fails to substantially complete the agreed scope of work through no fault of Buyer, the deposit shall be refunded in full. The deposit does not compensate for work not performed.</div><div>3. <strong>Change Orders:</strong> Any additional work not described herein requires a written change order signed by both parties.</div><div>4. <strong>Limitation of Liability:</strong> ${bname} is not responsible for pre-existing conditions or damage not disclosed prior to the start of work.</div><div>5. <strong>Mechanic&#39;s Lien:</strong> ${_lienNotice(_stateKey)}</div></div>`;
  const _tmPropMarkupMult = _geiIsTM && _tmMatMarkup > 0 ? 1 + _tmMatMarkup / 100 : 1;
  // Safari lazy-parses function bodies on first call — extract ?.?? to plain variables
  const _byoTermsEl2 = document.getElementById('byo-custom-terms');
  const _byoTermsText = (_byoTermsEl2 ? _byoTermsEl2.value : _byoCustomTerms || '').trim();
  const _customTermsBlock = _byoTermsText ? `<div style="padding:16px 24px;border-top:1px solid #e2e8f0;background:#f8fafc"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#1a365d;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #e2e8f0">Additional Terms</div><div style="font-size:11px;color:#2d3748;line-height:1.8;white-space:pre-wrap">${escHtml(_byoTermsText)}</div></div>` : '';
  const lineRows = _geiLines.filter(l => l.desc || l.rate).map(l => {
    let amt = (l.qty || 1) * (l.rate || 0);
    // For T&M, bake markup into material prices — client never sees the markup percentage
    if (_geiIsTM && !l._tmLabor) amt = Math.round(amt * _tmPropMarkupMult);
    return `<tr style="border-bottom:1px solid #e2e8f0"><td style="padding:9px 18px;font-size:12px;color:#2d3748"><div>${escHtml(l.desc || '')}${l.qty !== 1 ? `<span style="color:#94a3b8;font-size:11px"> ×${l.qty}</span>` : ''}</div>${l.notes ? `<div style="font-size:11px;color:#718096;margin-top:2px">${escHtml(l.notes)}</div>` : ''}</td><td style="padding:9px 6px;text-align:center;font-size:12px;color:#64748b">${l.qty || 1}</td><td style="padding:9px 18px 9px 4px;text-align:right;font-size:12px;font-weight:600;color:#1a365d">$${amt.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}</td></tr>`;
  }).join('');
  // Suppress markup/tax row for T&M — markup is already in the line prices
  const taxRow = !_geiIsTM && taxPct ? `<tr style="border-bottom:1px solid #e2e8f0;background:#f8fafc"><td colspan="2" style="padding:8px 18px;font-size:12px;color:#64748b">Tax / markup (${taxPct}%)</td><td style="padding:8px 18px;text-align:right;font-size:12px;color:#64748b">$${(total * (taxPct / (100 + taxPct))).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}</td></tr>` : '';
  const notesHtml = v('gei-notes') ? `<div style="padding:14px 24px;border-top:1px solid #e2e8f0;font-size:12px;color:#4a5568;line-height:1.6"><strong style="color:#1a365d">Notes:</strong> ${escHtml(v('gei-notes'))}</div>` : '';
  let _propPanelHtml = '';
  if (_panelSched) {
    const {
      l1: _pl1,
      l2: _pl2,
      imbalance: _pimb
    } = _panelCalcBalance();
    const _pRows = (_panelSched.circuits || []).map((c, i) => `<tr><td style="text-align:center;padding:4px 6px;border:1px solid #cbd5e1;font-size:11px">${i + 1}</td><td style="padding:4px 8px;border:1px solid #cbd5e1;font-size:11px">${escHtml(c.desc || '—')}</td><td style="text-align:center;padding:4px 6px;border:1px solid #cbd5e1;font-size:11px">${c.amps || ''}A</td><td style="text-align:center;padding:4px 6px;border:1px solid #cbd5e1;font-size:11px">${c.phase === '2pole' ? '2-pole' : c.phase}</td><td style="text-align:center;padding:4px 6px;border:1px solid #cbd5e1;font-size:11px">${escHtml(c.gauge || '')}</td><td style="text-align:center;padding:4px 6px;border:1px solid #cbd5e1;font-size:11px">${c.afci ? '✓' : ''}</td><td style="text-align:center;padding:4px 6px;border:1px solid #cbd5e1;font-size:11px">${c.gfci ? '✓' : ''}</td></tr>`).join('');
    _propPanelHtml = `<div style="padding:16px 24px;border-top:2px solid #e2e8f0"><div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#1a365d;margin-bottom:10px">📋 Panel Schedule — ${_panelSched.panelAmps}A</div><p style="font-size:11px;color:#64748b;margin:0 0 8px">L1 leg: ${_pl1}A · L2 leg: ${_pl2}A${_pimb > 0.10 ? ' · <strong style="color:#dc2626">⚠️ Rebalance recommended</strong>' : ' · ✓ Balanced'}</p><table style="width:100%;border-collapse:collapse"><thead><tr><th style="background:#1a365d;color:#fff;padding:5px 6px;border:1px solid #cbd5e1;font-size:10px">#</th><th style="background:#1a365d;color:#fff;padding:5px 8px;border:1px solid #cbd5e1;text-align:left;font-size:10px">Circuit</th><th style="background:#1a365d;color:#fff;padding:5px 6px;border:1px solid #cbd5e1;font-size:10px">Amps</th><th style="background:#1a365d;color:#fff;padding:5px 6px;border:1px solid #cbd5e1;font-size:10px">Phase</th><th style="background:#1a365d;color:#fff;padding:5px 6px;border:1px solid #cbd5e1;font-size:10px">Wire</th><th style="background:#1a365d;color:#fff;padding:5px 6px;border:1px solid #cbd5e1;font-size:10px">AFCI</th><th style="background:#1a365d;color:#fff;padding:5px 6px;border:1px solid #cbd5e1;font-size:10px">GFCI</th></tr></thead><tbody>${_pRows}</tbody></table></div>`;
  }
  const _hdrLabel = _geiIsTM ? '⏱️ Time &amp; Materials' : tradeIcon + ' Service Proposal';
  const _nteRow = _geiIsTM && _tmNteCap ? `<tr style="background:#075985;color:rgba(255,255,255,.8)"><td colspan="2" style="padding:5px 18px;font-size:11px">Not-to-exceed cap</td><td style="padding:5px 18px;text-align:right;font-size:11px;font-weight:700">$${_tmNteCap.toLocaleString()}</td></tr>` : '';
  const proposalHtml = `<div style="background:#fff;color:#1a1a1a;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 4px 24px rgba(0,0,0,.10)"><div style="background:linear-gradient(135deg,#1a365d 0%,#2a4a7f 100%);color:#fff;padding:20px 24px;display:flex;justify-content:space-between;align-items:flex-start"><div><div style="font-size:18px;font-weight:800">${bname}</div>${bphone ? `<div style="font-size:12px;opacity:.7;margin-top:3px">${bphone}</div>` : ''}${blic ? `<div style="font-size:11px;opacity:.6;margin-top:2px">Lic# ${blic}</div>` : ''}</div><div style="text-align:right"><div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.12em;opacity:.9">${_hdrLabel}</div><div style="font-size:11px;opacity:.6;margin-top:6px"># ${estNum}</div><div style="font-size:11px;opacity:.6">Date: ${dateStr}</div></div></div><div style="display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid #e2e8f0"><div style="padding:14px 18px;border-right:1px solid #e2e8f0"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;margin-bottom:6px">Customer</div><div style="font-size:14px;font-weight:700;color:#1a365d">${clientName}</div>${clientAddr ? `<div style="font-size:12px;color:#4a5568;margin-top:4px">${clientAddr}</div>` : ''}</div><div style="padding:14px 18px"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;margin-bottom:6px">Project</div><div style="font-size:13px;font-weight:600;color:#1a365d">${jobDesc || tradeName + ' service'}</div>${duration ? `<div style="font-size:11px;color:#718096;margin-top:5px">Est. duration: ${duration}</div>` : ''}<div style="font-size:11px;color:#718096;margin-top:3px">Valid 30 days</div></div></div><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:#f1f5f9;border-bottom:2px solid #e2e8f0"><th style="padding:8px 18px;text-align:left;font-weight:800;text-transform:uppercase;color:#64748b;font-size:9px;letter-spacing:.08em">Description</th><th style="padding:8px 6px;text-align:center;font-weight:800;text-transform:uppercase;color:#64748b;font-size:9px;letter-spacing:.08em;width:40px">Qty</th><th style="padding:8px 18px 8px 4px;text-align:right;font-weight:800;text-transform:uppercase;color:#64748b;font-size:9px;letter-spacing:.08em;width:90px">Amount</th></tr></thead><tbody>${lineRows}</tbody><tfoot>${taxRow}<tr style="background:#1a365d;color:#fff"><td colspan="2" style="padding:12px 18px;font-weight:800;font-size:15px">${_geiIsTM ? 'ESTIMATED TOTAL' : 'TOTAL'}</td><td style="padding:12px 18px;text-align:right;font-weight:800;font-size:15px">${totalFmt}</td></tr>${_tmDepRow}${_nteRow}</tfoot></table>${notesHtml}${_propPanelHtml}<div style="padding:18px 24px;border-top:2px solid #e2e8f0;background:#f8fafc"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#1a365d;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #e2e8f0">Payment Terms</div>${_tmPayTerms}</div>${_customTermsBlock}</div>`;
  // Preview-only mode — show proposal in a fullscreen overlay, no upload
  if (previewOnly) {
    _showProposalPreviewOverlay(proposalHtml);
    return;
  }
  const bidId = _geiEditBidId;
  const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const proposalKey = `proposals/${_supaUser.id}/${bidId}_${token}.json`;
  // Extract optional chaining out of object literal — Safari chokes on ?. inside { }
  const _stripeEnabled = _stripeConnectStatus ? _stripeConnectStatus.charges_enabled ? true : false : false;
  const proposalData = {
    id: bidId,
    token,
    clientName: v('gei-client'),
    businessName: S.bname || getBusinessName(),
    contractorUserId: _supaUser.id,
    contractorEmail: _supaUser.email,
    clientId: _geiClientId || null,
    proposalHtml,
    clientAddr: v('gei-addr'),
    amount: total,
    deposit: _tmDepAmt,
    createdAt: new Date().toISOString(),
    status: 'pending',
    notifyEmail: _supaUser.email,
    businessPhone: S.bphone || '',
    stripeConnectEnabled: _stripeEnabled,
    trade_type: trade
  };
  const _uploadRes = await _supa.storage.from('proposals').upload(proposalKey, JSON.stringify(proposalData), {
    contentType: 'application/json',
    upsert: true
  }).catch(e => ({
    error: e
  }));
  if (_uploadRes && _uploadRes.error) {
    showToast('Upload failed — check connection and try again', 'error');
    console.error('[proposal upload]', _uploadRes.error);
    return;
  }
  const b = bids.find(x => x.id === bidId);
  if (b) {
    b.signingToken = token;
    b.proposalKey = proposalKey;
    // Mark Pending now so hub snapshot shows the proposal — _commitProposalSent still
    // fires on Text/Email but is safe to call twice (idempotent status change)
    if (b.status === 'Draft' || !b.status) b.status = 'Pending';
    b.draft = false;
    if (!b.proposalSentDate) b.proposalSentDate = todayKey();
    saveAll();
  }
  const baseUrl = _clientBaseUrl();
  const signingUrl = baseUrl + 'sign.html?t=' + token + '&u=' + _supaUser.id + '&b=' + bidId;
  const shortUrl = await shortenUrl(signingUrl);
  const signingDirectUrl = shortUrl || signingUrl;
  let shareUrl = signingDirectUrl;
  if (b && b.client_id) {
    try {
      const _hu = await _uploadClientHub(b.client_id);
      if (_hu) shareUrl = _hu;
    } catch (e) {}
  }
  const bar = document.getElementById('proposal-link-bar');
  const input = document.getElementById('proposal-link-input');
  const _cl = getClientById(b ? b.client_id : null);
  if (bar) {
    bar.dataset.signingUrl = shareUrl;
    bar.dataset.signingDirectUrl = signingDirectUrl;
    bar.dataset.cname = clientName;
    bar.dataset.bname = bname;
    bar.dataset.cphone = (_cl && _cl.phone || '').replace(/\D/g, '');
    bar.dataset.cemail = _cl && _cl.email || '';
  }
  if (input) input.value = shareUrl;
  _pendingSignToken = {
    bidId,
    token,
    proposalKey
  };
  // Show send bar — let user choose Text / Email / Other app (same as paint estimate)
  const geiSendBar = document.getElementById('gei-send-bar');
  if (geiSendBar) {
    geiSendBar.style.display = 'block';
    geiSendBar.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest'
    });
  }
  // Hide the generate button so user can't double-submit
  const geiSendBtn = document.getElementById('gei-send-btn');
  if (geiSendBtn) geiSendBtn.style.display = 'none';
}
function _geiCopyShareLink(btn) {
  const url = _proposalShareData().url;
  if (!url) return;
  navigator.clipboard.writeText(url).catch(() => {});
  if (btn) {
    btn.textContent = '✓ Copied!';
    setTimeout(() => btn.textContent = '📋 Copy link', 2000);
  }
}

// ─── Industrial Equipment Estimate ──────────────────────────────────────────
let _indPieces = [],
  _indTier = 'appearance',
  _indClientId = null,
  _indBidId = null,
  _indClient = null;
function openIndustrialEquipEstimate(c, bidId) {
  _indClient = c || null;
  _indClientId = c?.id || null;
  _indBidId = bidId || null;
  _indPieces = [];
  _indTier = 'appearance';
  if (bidId) {
    const b = bids.find(x => x.id === bidId);
    if (b) {
      _indPieces = JSON.parse(JSON.stringify(b.indPieces || []));
      _indTier = b.indTier || 'appearance';
    }
  }
  const ov = document.createElement('div');
  ov.className = 'zmodal-overlay';
  ov.id = 'ind-equip-ov';
  const box = document.createElement('div');
  box.style.cssText = 'background:var(--bg);border-radius:var(--rl) var(--rl) 0 0;width:100%;max-width:520px;max-height:92vh;overflow-y:auto;padding-bottom:24px';
  box.id = 'ind-equip-box';
  ov.appendChild(box);
  document.body.appendChild(ov);
  ov.addEventListener('click', e => {
    if (e.target === ov) ov.remove();
  });
  _renderIndModal();
}
function _renderIndModal() {
  const box = document.getElementById('ind-equip-box');
  if (!box) return;
  const c = _indClient;
  const tierHtml = Object.keys(IND_TIERS).map(k => {
    const t = IND_TIERS[k];
    const sel = k === _indTier;
    return '<button onclick="_setIndTier(\'' + k + '\')" style="padding:10px 8px;border-radius:var(--r);border:2px solid ' + (sel ? 'var(--blue)' : 'var(--border2)') + ';background:' + (sel ? 'var(--blue-lt)' : 'var(--bg2)') + ';cursor:pointer;font-family:inherit;text-align:left;width:100%">' + '<div style="font-size:12px;font-weight:700;color:' + (sel ? 'var(--blue-dk)' : 'var(--text)') + '">' + (sel ? '✓ ' : '') + t.badge + ' ' + t.name + '</div>' + '<div style="font-size:10px;color:var(--text3);margin-top:2px;line-height:1.4">' + t.desc + '</div></button>';
  }).join('');
  const typeOpts = Object.keys(IND_EQUIP_TYPES).map(k => '<option value="' + k + '">' + IND_EQUIP_TYPES[k].name + '</option>').join('');
  const existingBid = _indBidId ? bids.find(x => x.id === _indBidId) : null;
  const savedColor = existingBid?.indColor || '';
  const savedPrimer = existingBid?.indPrimerColor || '';
  const savedFinish = existingBid?.indFinish || 'Gloss';
  const savedColorNotes = existingBid?.indColorNotes || '';
  box.innerHTML = '<div style="position:sticky;top:0;background:var(--bg);z-index:10;padding:16px 16px 12px;border-bottom:1px solid var(--border)">' + '<div style="display:flex;align-items:center;justify-content:space-between">' + '<div><div style="font-size:17px;font-weight:800">🏗️ Industrial Equipment</div>' + '<div style="font-size:12px;color:var(--text3);margin-top:2px">' + (c ? escHtml(c.name) : 'No client') + '</div></div>' + '<button onclick="document.getElementById(\'ind-equip-ov\').remove()" style="width:30px;height:30px;border-radius:50%;border:none;background:var(--bg2);color:var(--text2);font-size:18px;cursor:pointer;font-family:inherit">×</button>' + '</div>' + '</div>' + '<div style="padding:14px 16px 0">' +
  // ── AI Scope Helper ──
  '<div style="margin-bottom:14px;padding:12px;background:linear-gradient(135deg,#fffbeb,#fff7ed);border-radius:var(--r);border:1.5px solid #fed7aa">' + '<div style="font-size:11px;font-weight:800;color:#c2410c;margin-bottom:8px;display:flex;align-items:center;gap:6px">' + '<span>✨</span> AI Scope Helper' + '<span style="font-size:10px;font-weight:500;color:#9a3412;margin-left:4px">— describe what you see, we\'ll suggest the equipment</span>' + '</div>' + '<textarea id="ind-desc-inp" rows="2" placeholder="e.g. Two small drum dryers, a baghouse, and the control house — heavy rust on dryers, last painted 5+ years ago" style="width:100%;box-sizing:border-box;padding:9px 10px;border:1.5px solid #fed7aa;border-radius:var(--r);background:#fff;color:var(--text);font-size:12px;font-family:inherit;resize:vertical;margin-bottom:8px"></textarea>' + '<div style="display:flex;align-items:center;gap:8px">' + '<button onclick="_indAiSuggest()" style="padding:8px 14px;border-radius:var(--r);border:none;background:#c2410c;color:#fff;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;flex-shrink:0">Find equipment →</button>' + '<div id="ind-desc-suggestions" style="flex:1;font-size:11px;color:var(--text3)">Describe the job and tap Find →</div>' + '</div>' + '</div>' +
  // ── Coating Tier ──
  '<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);margin-bottom:8px">Coating Tier</div>' + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px;margin-bottom:10px">' + tierHtml + '</div>' + '<div style="font-size:10px;color:var(--text3);margin-bottom:14px;padding:7px 10px;background:var(--bg2);border-radius:var(--r)">' + '<strong style="color:var(--text2)">Products:</strong> ' + IND_TIERS[_indTier].products + '</div>' +
  // ── Equipment picker ──
  '<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);margin-bottom:8px">Add Equipment Pieces</div>' + '<div style="display:grid;grid-template-columns:1fr 60px auto;gap:8px;align-items:center;margin-bottom:6px">' + '<select id="ind-type-sel" onchange="_indTypeChange()" style="padding:9px 8px;border:1.5px solid var(--border2);border-radius:var(--r);background:var(--bg2);color:var(--text);font-size:12px;font-family:inherit">' + typeOpts + '</select>' + '<input id="ind-qty" type="number" value="1" min="1" max="99" style="padding:9px 6px;border:1.5px solid var(--border2);border-radius:var(--r);background:var(--bg2);color:var(--text);font-size:13px;font-family:inherit;text-align:center">' + '<button onclick="_addIndPiece()" style="padding:9px 12px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap">+ Add</button>' + '</div>' + '<div id="ind-custom-sqft-row" style="display:none;margin-bottom:8px">' + '<input id="ind-custom-sqft" type="number" placeholder="Enter square footage for this piece" min="1" style="width:100%;box-sizing:border-box;padding:9px 10px;border:1.5px solid var(--border2);border-radius:var(--r);background:var(--bg2);color:var(--text);font-size:13px;font-family:inherit">' + '</div>' + '<div id="ind-pieces-list" style="margin-bottom:14px"></div>' + '<div id="ind-result-card"></div>' +
  // ── Notes ──
  '<div style="margin-top:14px">' + '<div style="font-size:10px;font-weight:700;color:var(--text3);margin-bottom:5px;text-transform:uppercase;letter-spacing:.06em">Notes / Access concerns</div>' + '<textarea id="ind-notes" rows="2" placeholder="e.g. Equipment in use until Friday, man-lift already on site" style="width:100%;box-sizing:border-box;padding:9px 10px;border:1.5px solid var(--border2);border-radius:var(--r);background:var(--bg2);color:var(--text);font-size:13px;font-family:inherit;resize:vertical"></textarea>' + '</div>' +
  // ── Paint & Color Specs ──
  '<div style="margin-top:14px;padding:12px;background:var(--bg2);border-radius:var(--r);border:1px solid var(--border2)">' + '<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);margin-bottom:10px">🎨 Paint & Color Specs</div>' + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">' + '<div>' + '<div style="font-size:11px;font-weight:600;color:var(--text2);margin-bottom:4px">Topcoat color</div>' + '<input id="ind-color" value="' + escHtml(savedColor) + '" placeholder="e.g. Bettis Red, Black, RAL 7016" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid var(--border2);border-radius:var(--r);background:var(--bg);color:var(--text);font-size:12px;font-family:inherit">' + '</div>' + '<div>' + '<div style="font-size:11px;font-weight:600;color:var(--text2);margin-bottom:4px">Finish</div>' + '<select id="ind-finish" style="width:100%;padding:8px 8px;border:1.5px solid var(--border2);border-radius:var(--r);background:var(--bg);color:var(--text);font-size:12px;font-family:inherit">' + ['Gloss', 'Semi-Gloss', 'Satin', 'Flat/Matte', 'Industrial Gloss'].map(f => '<option' + (f === savedFinish ? ' selected' : '') + '>' + f + '</option>').join('') + '</select>' + '</div>' + '</div>' + '<div style="margin-bottom:10px">' + '<div style="font-size:11px;font-weight:600;color:var(--text2);margin-bottom:4px">Primer / base coat</div>' + '<input id="ind-primer-color" value="' + escHtml(savedPrimer) + '" placeholder="' + escHtml(IND_TIERS[_indTier].products.split('→')[0]?.trim() || 'Per spec') + '" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid var(--border2);border-radius:var(--r);background:var(--bg);color:var(--text);font-size:12px;font-family:inherit">' + '</div>' + '<div>' + '<div style="font-size:11px;font-weight:600;color:var(--text2);margin-bottom:4px">Color matching / special notes</div>' + '<input id="ind-color-notes" value="' + escHtml(savedColorNotes) + '" placeholder="e.g. Match fleet color, client providing color sample" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid var(--border2);border-radius:var(--r);background:var(--bg);color:var(--text);font-size:12px;font-family:inherit">' + '</div>' + '</div>' +
  // ── Actions ──
  '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px">' + '<button onclick="_saveIndBid()" style="padding:14px;border-radius:var(--r);border:1.5px solid var(--border2);background:var(--bg2);color:var(--text2);font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">💾 Save Draft</button>' + '<button onclick="_sendIndProposal()" style="padding:14px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">🔗 Save & Send to Client</button>' + '</div>' + '</div>';
  _renderIndPieces();
  _renderIndResult();
}
function _indAiSuggest() {
  const text = (document.getElementById('ind-desc-inp')?.value || '').toLowerCase();
  const suggEl = document.getElementById('ind-desc-suggestions');
  if (!suggEl) return;
  if (text.trim().length < 5) {
    suggEl.innerHTML = '<span style="color:var(--text3)">Add more detail and try again</span>';
    return;
  }
  const found = [];
  for (const [typeKey, words] of Object.entries(IND_KEYWORDS)) {
    if (words.some(w => text.includes(w))) found.push(typeKey);
  }
  if (!found.length) {
    suggEl.innerHTML = '<span style="color:var(--text3)">No matches — try: drum dryer, silo, baghouse, conveyor, crane, tank…</span>';
    return;
  }
  suggEl.innerHTML = '<div style="font-size:10px;color:var(--text3);margin-bottom:6px">Tap to add:</div>' + found.map(k => '<button onclick="_addIndFromSuggest(\'' + k + '\')" style="padding:5px 10px;border-radius:20px;border:1.5px solid #c2410c;background:#fff7ed;color:#c2410c;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;margin:2px 3px 2px 0">+' + escHtml(IND_EQUIP_TYPES[k].name) + '</button>').join('');
}
function _addIndFromSuggest(typeKey) {
  const typ = IND_EQUIP_TYPES[typeKey];
  if (!typ) return;
  let sqft = typ.sqft;
  if (!sqft) {
    sqft = parseInt(prompt('Square footage for ' + typ.name + ' (estimate OK):') || '0');
    if (!sqft) return;
  }
  _indPieces.push({
    typeKey,
    qty: 1,
    sqft,
    name: typ.name,
    lift: typ.lift,
    note: typ.note
  });
  _renderIndPieces();
  _renderIndResult();
}
function _indTypeChange() {
  const sel = document.getElementById('ind-type-sel');
  if (!sel) return;
  const typ = IND_EQUIP_TYPES[sel.value];
  const row = document.getElementById('ind-custom-sqft-row');
  if (row) row.style.display = typ && typ.sqft === 0 ? '' : 'none';
}
function _setIndTier(k) {
  _indTier = k;
  _renderIndModal();
}
function _addIndPiece() {
  const sel = document.getElementById('ind-type-sel');
  if (!sel) return;
  const typeKey = sel.value;
  const typ = IND_EQUIP_TYPES[typeKey];
  if (!typ) return;
  const qty = Math.max(1, parseInt(document.getElementById('ind-qty')?.value) || 1);
  let sqft = typ.sqft;
  if (sqft === 0) {
    sqft = parseInt(document.getElementById('ind-custom-sqft')?.value) || 0;
    if (!sqft) {
      showToast('Enter square footage for this piece', '⚠️');
      return;
    }
  }
  _indPieces.push({
    typeKey,
    qty,
    sqft,
    name: typ.name,
    lift: typ.lift,
    note: typ.note
  });
  _renderIndPieces();
  _renderIndResult();
}
function _removeIndPiece(i) {
  _indPieces.splice(i, 1);
  _renderIndPieces();
  _renderIndResult();
}
function _renderIndPieces() {
  const el = document.getElementById('ind-pieces-list');
  if (!el) return;
  if (!_indPieces.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--text3);padding:8px 0;text-align:center;border:1.5px dashed var(--border2);border-radius:var(--r)">No equipment added yet — use the helper above or select a type</div>';
    return;
  }
  el.innerHTML = '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:6px">Equipment list</div>' + _indPieces.map((p, i) => {
    const totalSqft = p.qty * p.sqft;
    return '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:var(--bg2);border-radius:var(--r);margin-bottom:5px;border:1px solid var(--border)">' + '<div style="min-width:0;flex:1">' + '<div style="font-size:12px;font-weight:700;color:var(--text)">' + (p.qty > 1 ? p.qty + '× ' : '') + p.name + '</div>' + '<div style="font-size:10px;color:var(--text3);margin-top:1px">' + (totalSqft ? '~' + totalSqft.toLocaleString() + ' sq ft' : 'custom sq ft') + (p.lift ? ' · <span style="color:#c2410c;font-weight:600">⚠️ Lift needed</span>' : '') + (p.note ? ' · ' + escHtml(p.note) : '') + '</div>' + '</div>' + '<button onclick="_removeIndPiece(' + i + ')" style="flex-shrink:0;margin-left:10px;background:none;border:none;color:var(--text3);font-size:18px;cursor:pointer;font-family:inherit;padding:0 4px">×</button>' + '</div>';
  }).join('');
}
function _calcInd() {
  const tier = IND_TIERS[_indTier];
  const totalSqft = _indPieces.reduce((s, p) => s + p.qty * p.sqft, 0);
  if (!totalSqft) return null;
  const prepSqft = _indPieces.reduce((s, p) => s + p.qty * p.sqft * (IND_EQUIP_TYPES[p.typeKey]?.prepRatio || 0.4), 0);
  const prepManDays = prepSqft / tier.prepRate;
  const paintManDays = totalSqft * tier.coats / tier.paintRate;
  const totalManDays = prepManDays + paintManDays;
  let crew = 1;
  if (totalManDays > 3) crew = 2;
  if (totalManDays > 8) crew = 3;
  if (totalManDays > 18) crew = 4;
  const calDays = Math.ceil(totalManDays / crew);
  const matCost = Math.round(totalSqft * tier.matPerSqft);
  const laborCost = Math.round(totalManDays * tier.laborRate);
  const totalMid = matCost + laborCost;
  const liftNeeded = _indPieces.some(p => p.lift);
  const flags = [..._indPieces.reduce((s, p) => {
    if (p.note) s.add(p.note);
    return s;
  }, new Set())];
  return {
    totalSqft,
    prepManDays,
    paintManDays,
    totalManDays,
    crew,
    calDays,
    matCost,
    laborCost,
    totalLow: Math.round(totalMid * 0.90),
    totalHigh: Math.round(totalMid * 1.15),
    liftNeeded,
    flags
  };
}
function _renderIndResult() {
  const el = document.getElementById('ind-result-card');
  if (!el) return;
  const r = _calcInd();
  if (!r) {
    el.innerHTML = '<div style="padding:14px;background:var(--bg2);border-radius:var(--r);text-align:center;font-size:12px;color:var(--text3)">Add equipment above to see the estimate</div>';
    return;
  }
  const crewLabel = r.crew === 1 ? 'Solo — you handle it' : r.crew === 2 ? 'You + 1 helper needed' : r.crew === 3 ? '3-person crew needed' : 'Full 4-person crew';
  const crewColor = r.crew === 1 ? '#16a34a' : r.crew === 2 ? '#2563eb' : r.crew >= 3 ? '#d97706' : '#1a1a1a';
  const liftLine = r.liftNeeded ? '<div style="margin-top:6px;padding:7px 10px;background:#fff7ed;border-radius:var(--r);font-size:11px;color:#c2410c;font-weight:600">⚠️ Man-lift rental likely needed (~$350/day) — add as line item if not on site</div>' : '';
  const scaffLine = r.flags.some(f => f && f.includes('Scaffolding')) ? '<div style="margin-top:6px;padding:7px 10px;background:#fef9c3;border-radius:var(--r);font-size:11px;color:#854d0e;font-weight:600">🏗️ Scaffolding may be needed on one or more pieces — verify on-site</div>' : '';
  el.innerHTML = '<div style="background:linear-gradient(135deg,#1a365d 0%,#2a4a7f 100%);border-radius:var(--r);padding:16px;color:#fff">' + '<div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;opacity:.7;margin-bottom:10px">Estimate Summary</div>' + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">' + '<div><div style="font-size:10px;opacity:.65">Surface area</div><div style="font-size:20px;font-weight:800">' + r.totalSqft.toLocaleString() + '<span style="font-size:11px;font-weight:400;opacity:.8"> sq ft</span></div></div>' + '<div><div style="font-size:10px;opacity:.65">Duration</div><div style="font-size:20px;font-weight:800">' + r.calDays + '–' + (r.calDays + 1) + '<span style="font-size:11px;font-weight:400;opacity:.8"> days</span></div></div>' + '<div><div style="font-size:10px;opacity:.65">Materials</div><div style="font-size:15px;font-weight:700">' + fmt(r.matCost) + '</div></div>' + '<div><div style="font-size:10px;opacity:.65">Labor</div><div style="font-size:15px;font-weight:700">' + fmt(r.laborCost) + '</div></div>' + '</div>' + '<div style="border-top:1px solid rgba(255,255,255,.2);padding-top:10px;margin-bottom:10px">' + '<div style="font-size:10px;opacity:.65;margin-bottom:3px">Crew</div>' + '<div style="font-size:14px;font-weight:800">' + crewLabel + '</div>' + '</div>' + '<div style="border-top:1px solid rgba(255,255,255,.2);padding-top:12px">' + '<div style="font-size:10px;opacity:.65;margin-bottom:4px">Bid range</div>' + '<div style="font-size:24px;font-weight:800">' + fmt(r.totalLow) + ' – ' + fmt(r.totalHigh) + '</div>' + '<div style="font-size:10px;opacity:.55;margin-top:2px">25% deposit = ' + fmt(Math.round((r.totalLow + r.totalHigh) / 2 * 0.25)) + '</div>' + '</div>' + '</div>' + liftLine + scaffLine;
}
function _indReadColorFields() {
  return {
    color: (document.getElementById('ind-color')?.value || '').trim(),
    primerColor: (document.getElementById('ind-primer-color')?.value || '').trim(),
    finish: document.getElementById('ind-finish')?.value || 'Gloss',
    colorNotes: (document.getElementById('ind-color-notes')?.value || '').trim(),
    notes: (document.getElementById('ind-notes')?.value || '').trim()
  };
}
function _saveIndBid(silent) {
  if (!_indPieces.length) {
    if (!silent) showToast('Add at least one piece of equipment', '⚠️');
    return false;
  }
  const r = _calcInd();
  if (!r) return false;
  const c = getClientById(_indClientId);
  const {
    color,
    primerColor,
    finish,
    colorNotes,
    notes
  } = _indReadColorFields();
  const midPrice = Math.round((r.totalLow + r.totalHigh) / 2);
  const bidData = {
    id: _indBidId || _newBidId(),
    client_id: _indClientId,
    client_name: c?.name || '',
    bid_date: todayKey(),
    amount: midPrice,
    deposit: Math.round(midPrice * 0.25),
    type: 'Industrial Equipment Coating',
    trade_type: 'painting',
    status: 'Pending',
    draft: true,
    notes,
    indPieces: _indPieces,
    indTier: _indTier,
    indResult: r,
    indColor: color,
    indPrimerColor: primerColor,
    indFinish: finish,
    indColorNotes: colorNotes
  };
  if (_indBidId) {
    const idx = bids.findIndex(x => x.id === _indBidId);
    if (idx >= 0) bids[idx] = {
      ...bids[idx],
      ...bidData
    };
  } else {
    bids.unshift(bidData);
    _indBidId = bidData.id;
  }
  saveAll();
  if (!silent) {
    document.getElementById('ind-equip-ov')?.remove();
    showToast('Industrial bid saved', '💾');
    if (document.getElementById('cdt-bids-content')?.style.display !== 'none') setTimeout(() => renderCDBids(), 100);
  }
  return true;
}
async function _sendIndProposal() {
  if (!_saveIndBid(true)) return; // save first, bail if no pieces
  if (!navigator.onLine) {
    zAlert('You\'re offline — the proposal link can\'t be activated right now.\n\nYour estimate is saved. Once you\'re back online, open this bid and tap Send to send the link to your client.', {
      title: 'No internet connection'
    });
    return;
  }
  if (!supaEnabled() || !_supaUser) {
    zAlert('Sign in to send client links.');
    return;
  }
  const r = _calcInd();
  const c = _indClient;
  const {
    color,
    primerColor,
    finish,
    colorNotes,
    notes
  } = _indReadColorFields();
  const tier = IND_TIERS[_indTier];
  const bname = escHtml(S.bname || getBusinessName() || '');
  const bphone = escHtml(S.bphone || '');
  const blic = escHtml(S.blic || '');
  const clientName = escHtml(c?.name || '');
  const clientAddr = escHtml(c?.addr || '');
  const dateStr = new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
  const estNum = String(_indBidId).slice(-6);
  const midPrice = Math.round((r.totalLow + r.totalHigh) / 2);
  const totalFmt = '$' + midPrice.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  const depositFmt = '$' + Math.round(midPrice * 0.25).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  const rangeStr = '$' + r.totalLow.toLocaleString() + ' – $' + r.totalHigh.toLocaleString();
  const crewLabel = r.crew === 1 ? 'Solo' : r.crew === 2 ? '2-Person' : r.crew === 3 ? '3-Person' : '4-Person';
  const resolvedPrimer = primerColor || tier.products.split('→')[0]?.trim() || 'Per spec';
  const resolvedTopcoat = color || tier.products.split('→')[1]?.trim() || 'Per spec';
  const equipRows = _indPieces.map(p => {
    const totalSqft = p.qty * p.sqft;
    return `<tr style="border-bottom:1px solid #e2e8f0"><td style="padding:9px 14px;font-size:12px;font-weight:600;color:#2d3748">${escHtml(p.name)}</td><td style="padding:9px 8px;text-align:center;font-size:12px;color:#64748b">${p.qty}</td><td style="padding:9px 8px;text-align:right;font-size:12px;color:#64748b">${totalSqft ? totalSqft.toLocaleString() : '-'}</td><td style="padding:9px 14px;font-size:11px;color:#94a3b8">${escHtml(p.note || '')}${p.lift ? ' ⚠️ Lift' : ''}${p.note && p.lift ? ' / ' : ''}</td></tr>`;
  }).join('');
  const liftWarning = r.liftNeeded ? '<div style="padding:10px 18px;background:#fff7ed;border-bottom:1px solid #fed7aa;font-size:11px;color:#c2410c;font-weight:600">⚠️ Man-lift rental likely required (~$350/day) — verify availability before scheduling</div>' : '';
  const notesSection = notes ? `<div style="padding:14px 24px;border-top:1px solid #e2e8f0;font-size:12px;color:#4a5568;line-height:1.6"><strong style="color:#7c2d12">Site Notes:</strong> ${escHtml(notes)}</div>` : '';
  const proposalHtml = `<div style="background:#fff;color:#1a1a1a;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 4px 24px rgba(0,0,0,.10)"><div style="background:linear-gradient(135deg,#7c2d12 0%,#c2410c 100%);color:#fff;padding:20px 24px;display:flex;justify-content:space-between;align-items:flex-start"><div><div style="font-size:18px;font-weight:800">${bname}</div>${bphone ? `<div style="font-size:12px;opacity:.7;margin-top:3px">${bphone}</div>` : ''}${blic ? `<div style="font-size:11px;opacity:.6;margin-top:2px">Lic# ${blic}</div>` : ''}</div><div style="text-align:right"><div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.12em;opacity:.9">🏗️ Industrial Coating Estimate</div><div style="font-size:11px;opacity:.6;margin-top:6px"># ${estNum}</div><div style="font-size:11px;opacity:.6">Date: ${dateStr}</div></div></div><div style="display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid #e2e8f0"><div style="padding:14px 18px;border-right:1px solid #e2e8f0"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;margin-bottom:6px">Customer</div><div style="font-size:14px;font-weight:700;color:#7c2d12">${clientName}</div>${clientAddr ? `<div style="font-size:12px;color:#4a5568;margin-top:4px">${clientAddr}</div>` : ''}</div><div style="padding:14px 18px"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;margin-bottom:6px">Project</div><div style="font-size:13px;font-weight:600;color:#7c2d12">Industrial Equipment Coating</div><div style="font-size:11px;color:#718096;margin-top:3px">${tier.badge} ${tier.name} Specification</div><div style="font-size:11px;color:#718096;margin-top:2px">Valid 30 days from date above</div></div></div><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:#f1f5f9;border-bottom:2px solid #e2e8f0"><th style="padding:8px 14px;text-align:left;font-weight:800;text-transform:uppercase;color:#64748b;font-size:9px;letter-spacing:.08em">Equipment</th><th style="padding:8px 8px;text-align:center;font-weight:800;text-transform:uppercase;color:#64748b;font-size:9px;width:40px">Qty</th><th style="padding:8px 8px;text-align:right;font-weight:800;text-transform:uppercase;color:#64748b;font-size:9px;width:72px">~Sq Ft</th><th style="padding:8px 14px;text-align:left;font-weight:800;text-transform:uppercase;color:#64748b;font-size:9px">Notes</th></tr></thead><tbody>${equipRows}</tbody></table><div style="padding:14px 18px;border-top:1px solid #e2e8f0;background:#fafafa"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#7c2d12;margin-bottom:8px">Coating Specification</div><div style="font-size:12px;color:#374151;line-height:1.9"><div><strong>Prep method:</strong> ${escHtml(tier.desc)}</div><div><strong>Primer:</strong> ${escHtml(resolvedPrimer)}</div><div><strong>Topcoat:</strong> ${escHtml(resolvedTopcoat)}</div><div><strong>Finish:</strong> ${escHtml(finish)}</div>${colorNotes ? `<div><strong>Color notes:</strong> ${escHtml(colorNotes)}</div>` : ''}</div></div><div style="display:grid;grid-template-columns:1fr 1fr 1fr;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0"><div style="padding:12px 14px;border-right:1px solid #e2e8f0"><div style="font-size:10px;color:#94a3b8;margin-bottom:3px">Surface Area</div><div style="font-size:16px;font-weight:800;color:#374151">${r.totalSqft.toLocaleString()} sqft</div></div><div style="padding:12px 14px;border-right:1px solid #e2e8f0"><div style="font-size:10px;color:#94a3b8;margin-bottom:3px">Duration</div><div style="font-size:16px;font-weight:800;color:#374151">${r.calDays}–${r.calDays + 1} days</div></div><div style="padding:12px 14px"><div style="font-size:10px;color:#94a3b8;margin-bottom:3px">Crew</div><div style="font-size:16px;font-weight:800;color:#374151">${crewLabel}</div></div></div>${liftWarning}<table style="width:100%;border-collapse:collapse"><tr style="background:#7c2d12;color:#fff"><td style="padding:12px 18px;font-weight:800;font-size:13px">ESTIMATE RANGE</td><td style="padding:12px 18px;text-align:right;font-weight:800;font-size:14px">${rangeStr}</td></tr><tr style="background:#c2410c;color:rgba(255,255,255,.88)"><td style="padding:7px 18px;font-size:12px;font-weight:800">MIDPOINT BID</td><td style="padding:7px 18px;text-align:right;font-size:13px;font-weight:800">${totalFmt}</td></tr><tr style="background:#9a3412;color:rgba(255,255,255,.85)"><td style="padding:6px 18px;font-size:11px;font-weight:600">25% Deposit Due Before Work Begins</td><td style="padding:6px 18px;text-align:right;font-size:12px;font-weight:700">${depositFmt}</td></tr></table>${notesSection}<div style="padding:18px 24px;border-top:2px solid #e2e8f0;background:#f8fafc"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#7c2d12;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #e2e8f0">Payment Terms</div><div style="font-size:11px;color:#2d3748;line-height:2"><div>1. <strong>Deposit:</strong> 25% due before work begins.</div><div>2. <strong>Balance:</strong> Remainder due upon completion.</div><div>3. <strong>Warranty:</strong> All workmanship warranted for 1 year.</div></div></div></div>`;
  const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const proposalKey = `proposals/${_supaUser.id}/${_indBidId}_${token}.json`;
  const proposalData = {
    id: _indBidId,
    token,
    clientName: c?.name || '',
    businessName: S.bname || getBusinessName(),
    contractorUserId: _supaUser.id,
    contractorEmail: _supaUser.email,
    proposalHtml,
    clientAddr: c?.addr || '',
    amount: midPrice,
    deposit: Math.round(midPrice * 0.25),
    createdAt: new Date().toISOString(),
    status: 'pending',
    notifyEmail: _supaUser.email,
    businessPhone: S.bphone || '',
    stripeConnectEnabled: _stripeConnectStatus ? _stripeConnectStatus.charges_enabled ? true : false : false,
    trade_type: 'painting'
  };
  showToast('Uploading proposal…', '⏳');
  await _supa.storage.from('proposals').upload(proposalKey, JSON.stringify(proposalData), {
    contentType: 'application/json',
    upsert: true
  }).catch(e => console.error('[ind proposal upload]', e));
  const b = bids.find(x => x.id === _indBidId);
  if (b) {
    b.signingToken = token;
    b.proposalKey = proposalKey;
    b.proposalHtml = proposalHtml;
    saveAll();
  }
  const baseUrl = _clientBaseUrl();
  const signingUrl = baseUrl + 'sign.html?t=' + token + '&u=' + _supaUser.id + '&b=' + _indBidId;
  const shortUrl = await shortenUrl(signingUrl).catch(() => null);
  const shareUrl = shortUrl || signingUrl;
  try {
    await navigator.clipboard.writeText(shareUrl);
  } catch (e) {}
  document.getElementById('ind-equip-ov')?.remove();
  showToast('Proposal link copied to clipboard — text or email it to the client', '🔗');
  if (typeof renderCDBids === 'function') setTimeout(renderCDBids, 120);
}
// ─── End Industrial Equipment Estimate ───────────────────────────────────────
})(); } catch (e) { __ds_ns.__errors.push({ path: "js/generic-estimate.js", error: String((e && e.message) || e) }); }

// js/mileage.js
try { (() => {
function _showOdometerModal(tasks, hardBlock) {
  document.getElementById('_odo-modal-ov')?.remove();
  let taskIdx = 0;
  function renderTask() {
    if (taskIdx >= tasks.length) {
      _odoFinish();
      return;
    }
    const t = tasks[taskIdx];
    const vLabel = getVehicleLabel(t.veh);
    const isStart = t.type === 'start';
    const existing = (S.vehicleOdoLog || {})[t.year]?.[_vehKey(t.veh)] || {};
    const otherReading = isStart ? existing.end : existing.start;

    // Calculate logged miles for this vehicle+year for context
    const yrStr = String(t.year);
    const loggedMi = mileage.filter(m => m.date && m.date.startsWith(yrStr) && (!m.vehicle || m.vehicle.toLowerCase().includes((t.veh.nickname || t.veh.name || '').split(' ')[0].toLowerCase()))).reduce((s, m) => s + (m.miles || 0), 0);
    ov.innerHTML = `
    <div style="background:var(--bg);border-radius:var(--rl);width:100%;max-width:440px;padding:24px 20px 28px;box-sizing:border-box">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
        <div style="width:38px;height:38px;border-radius:50%;background:#dbeafe;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">🚗</div>
        <div>
          <div style="font-size:16px;font-weight:800;color:var(--text)">${isStart ? t.midYear ? t.year + ' Opening Odometer' : t.year + ' Start Odometer' : 'Year-End Odometer'}</div>
          <div style="font-size:12px;color:var(--text3)">${vLabel} · ${isStart ? t.midYear ? 'First business use, ' + t.year : 'Jan 1, ' + t.year : 'Dec 31, ' + t.year}</div>
        </div>
      </div>
      <div style="background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:var(--r);padding:10px 12px;margin:14px 0 16px;font-size:12px;color:#1e40af;line-height:1.5">
        <strong>IRS Pub. 463 requires annual odometer records.</strong> ${t.midYear ? 'You joined mid-year — enter the odometer reading from when you first started using this vehicle for business, or your best Jan 1 estimate. An estimate is far better than no record.' : 'Recording Jan 1 &amp; Dec 31 readings proves your business-use % and makes your mileage deduction bulletproof — even in a field audit.'}
        ${loggedMi > 0 ? `<div style="margin-top:6px">📍 You logged <strong>${loggedMi.toFixed(1)} mi</strong> in ${t.year} for this vehicle in TradeDesk.</div>` : ''}
        ${otherReading ? `<div style="margin-top:4px">${isStart ? 'Dec 31' : 'Jan 1'} reading on file: <strong>${otherReading.toLocaleString()} mi</strong></div>` : ''}
        ${(() => {
      const prevEnd = (S.vehicleOdoLog || {})[t.year - 1]?.[_vehKey(t.veh)]?.end || 0;
      return isStart && prevEnd && !existing.start ? `<div style="margin-top:4px">✅ Carried forward from Dec 31, ${t.year - 1}: <strong>${prevEnd.toLocaleString()} mi</strong></div>` : '';
    })()}
      </div>
      <div style="font-size:13px;font-weight:700;color:var(--text2);margin-bottom:6px">${isStart ? t.midYear ? t.year + ' opening odometer (best estimate)' : 'Jan 1, ' + t.year + ' odometer reading' : 'Dec 31, ' + t.year + ' odometer reading'}</div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <input id="_odo-val" type="number" min="0" inputmode="numeric" placeholder="e.g. 48,250" value="${(() => {
      const pv = isStart ? existing.start || (S.vehicleOdoLog || {})[t.year - 1]?.[_vehKey(t.veh)]?.end || 0 : existing.end || 0;
      return pv || '';
    })()}" style="flex:1;padding:12px 14px;border-radius:var(--r);border:2px solid var(--blue);font-size:20px;font-weight:700;font-family:inherit;background:var(--bg2);color:var(--text);outline:none;box-sizing:border-box">
        <span style="font-size:13px;color:var(--text3);font-weight:600">miles</span>
      </div>
      <div id="_odo-err" style="color:#A32D2D;font-size:12px;min-height:16px;margin-bottom:10px"></div>
      ${tasks.length > 1 ? `<div style="font-size:11px;color:var(--text3);margin-bottom:12px;text-align:center">${taskIdx + 1} of ${tasks.length} vehicles</div>` : ''}
      <button onclick="_odoSaveStep()" style="width:100%;padding:14px;border-radius:var(--rl);border:none;background:var(--blue);color:#fff;font-size:15px;font-weight:800;cursor:pointer;font-family:inherit;margin-bottom:10px">Save &amp; continue →</button>
      ${hardBlock ? `<div style="font-size:11px;color:var(--text3);text-align:center">This record is required for IRS compliance. Enter your best estimate if unsure of the exact number.</div>` : `<button onclick="_odoSnooze()" style="width:100%;padding:10px;border:none;background:none;color:var(--text3);font-size:13px;cursor:pointer;font-family:inherit">Remind me in 24 hours (${3 - (S._odoSnoozeCount || 0)} snoozes left)</button>`}
    </div>`;
    setTimeout(() => document.getElementById('_odo-val')?.focus(), 100);
  }
  function _odoSaveStep() {
    const raw = parseFloat(document.getElementById('_odo-val')?.value) || 0;
    const err = document.getElementById('_odo-err');
    if (!raw || raw < 1) {
      if (err) err.textContent = 'Enter a valid odometer reading.';
      return;
    }
    const t = tasks[taskIdx];
    const key = _vehKey(t.veh);
    if (!S.vehicleOdoLog) S.vehicleOdoLog = {};
    if (!S.vehicleOdoLog[t.year]) S.vehicleOdoLog[t.year] = {};
    if (!S.vehicleOdoLog[t.year][key]) S.vehicleOdoLog[t.year][key] = {};
    const existing = S.vehicleOdoLog[t.year][key];
    if (t.type === 'start') {
      if (existing.end && raw >= existing.end) {
        if (err) err.textContent = 'Start odometer must be less than end odometer (' + existing.end.toLocaleString() + ' mi).';
        return;
      }
      existing.start = raw;
      existing.startDate = todayKey();
    } else {
      if (existing.start && raw <= existing.start) {
        if (err) err.textContent = 'End odometer must be greater than start odometer (' + existing.start.toLocaleString() + ' mi).';
        return;
      }
      existing.end = raw;
      existing.endDate = todayKey();
      // Cross-check: logged miles vs total miles
      const yrStr = String(t.year);
      const totalDriven = raw - (existing.start || 0);
      const logged = mileage.filter(m => m.date && m.date.startsWith(yrStr)).reduce((s, m) => s + (m.miles || 0), 0);
      if (totalDriven > 0) {
        const bizPct = Math.min(100, Math.round(logged / totalDriven * 100));
        const vehs = getVehicles();
        const vi = vehs.findIndex(v => _vehKey(v) === key);
        if (vi >= 0) {
          vehs[vi].bizUse = bizPct;
          S.vehicles = vehs;
        }
        existing.bizUsePct = bizPct;
        existing.loggedMi = Math.round(logged);
        existing.totalMi = totalDriven;
        if (logged > totalDriven) {
          existing.mileageFlag = true;
        }
      }
      // Auto-seed next year's Jan 1 start from this Dec 31 reading — user never has to enter year-start again
      const ny = t.year + 1;
      if (!S.vehicleOdoLog[ny]) S.vehicleOdoLog[ny] = {};
      if (!S.vehicleOdoLog[ny][key]) S.vehicleOdoLog[ny][key] = {};
      S.vehicleOdoLog[ny][key].start = raw;
      S.vehicleOdoLog[ny][key].startDate = todayKey();
    }
    S._odoSnoozeCount = 0;
    saveAll();
    _flushSaveNow();
    taskIdx++;
    renderTask();
  }
  window._odoSaveStep = _odoSaveStep;
  const ov = document.createElement('div');
  ov.id = '_odo-modal-ov';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,' + (hardBlock ? '.85' : '.6') + ');z-index:99990;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';
  if (!hardBlock) ov.addEventListener('click', e => {
    if (e.target === ov) _odoSnooze();
  });
  document.body.appendChild(ov);
  renderTask();
  function _odoFinish() {
    ov.remove();
    showToast('Odometer records saved — mileage deduction verified ✓', '📋');
  }
}
function _odoSnooze() {
  S._odoSnoozedUntil = Date.now() + 86400000; // 24 hours
  S._odoSnoozeCount = (S._odoSnoozeCount || 0) + 1;
  saveAll();
  document.getElementById('_odo-modal-ov')?.remove();
  showToast('Odometer reminder set for tomorrow', '⏰');
}
window._odoSnooze = _odoSnooze;
function _getVehicleOdoSummary(veh, year) {
  const key = _vehKey(veh);
  const log = (S.vehicleOdoLog || {})[year]?.[key] || {};
  return log;
}
function updateVehicleBizUse(idx, val) {
  const vehs = getVehicles();
  if (vehs[idx]) {
    vehs[idx].bizUse = Math.max(1, Math.min(100, parseFloat(val) || 100));
    S.vehicles = vehs;
    saveAll();
  }
}
function getAvgVehicleBizUse() {
  const vehs = getVehicles();
  if (!vehs.length) return 1;
  return vehs.reduce((s, v) => s + (v.bizUse || 100), 0) / vehs.length / 100;
}
function setTripPurpose(purpose, btn) {
  gps.purpose = purpose;
  document.querySelectorAll('#cd-purpose-chips .surf-type-btn').forEach(b => b.classList.remove('active-surf-btn'));
  if (btn) btn.classList.add('active-surf-btn');
  // Show job picker for supply runs so mileage ties to correct job
  const jobPicker = document.getElementById('cd-supply-job-picker');
  if (jobPicker) {
    if (purpose === 'Supply run') {
      const activeJobs = bids.filter(b => b.status === 'Closed Won');
      if (activeJobs.length) {
        jobPicker.style.display = 'block';
        jobPicker.innerHTML = '<label style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text3);display:block;margin-bottom:6px">Which job? <span style="font-weight:400;opacity:.7">(optional)</span></label>' + '<select id="cd-supply-job-sel" style="width:100%;font-size:13px;padding:8px 10px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text)" onchange="gps.supplyJobId=this.value">' + '<option value="">— Select job —</option>' + activeJobs.map(b => {
          const c = getClientById(b.client_id);
          return '<option value="' + b.id + '">' + (c ? c.name : 'Client') + ' — ' + fmt(b.amount) + '</option>';
        }).join('') + '</select>';
      } else {
        jobPicker.style.display = 'none';
      }
    } else {
      jobPicker.style.display = 'none';
      gps.supplyJobId = null;
    }
  }
  checkTripReady();
}
function selectDriveVehicle(idx) {
  const vehs = getVehicles();
  gps.vehicle = vehs[idx] ? vehs[idx].name : '';
  renderDriveVehicleChips();
  checkTripReady();
}
function renderDriveVehicleChips() {
  // Now uses dropdown — this just populates the select
  const sel = document.getElementById('cd-vehicle-sel');
  const noVeh = document.getElementById('cd-no-vehicles');
  const vehs = getVehicles();
  if (!vehs.length) {
    if (sel) sel.style.display = 'none';
    if (noVeh) noVeh.style.display = 'block';
    const btn = document.getElementById('cd-start-trip-btn');
    if (btn) {
      btn.disabled = true;
      btn.style.background = 'var(--border2)';
      btn.style.cursor = 'not-allowed';
    }
    return;
  }
  if (noVeh) noVeh.style.display = 'none';
  if (sel) {
    sel.style.display = 'block';
    sel.innerHTML = '<option value="">— Select vehicle —</option>' + vehs.map(v => {
      const label = getVehicleLabel(v);
      const full = getVehicleFullLabel(v);
      return '<option value="' + v.name + '"' + (gps.vehicle === v.name ? ' selected' : '') + '>' + full + '</option>';
    }).join('');
    // Auto-select if only one vehicle
    if (vehs.length === 1 && !gps.vehicle) {
      gps.vehicle = vehs[0].name;
      sel.value = vehs[0].name;
      checkTripReady();
    }
  }
}
function selectDriveVehicleByName(name) {
  gps.vehicle = name;
  checkTripReady();
}
function checkTripReady() {
  const hasVeh = !!gps.vehicle;
  const hasPurpose = !!gps.purpose;
  const btn = document.getElementById('cd-start-trip-btn');
  if (!btn) return;
  const ready = hasVeh && hasPurpose;
  btn.disabled = !ready;
  btn.style.background = ready ? 'var(--green)' : 'var(--border2)';
  btn.style.color = ready ? '#fff' : 'var(--text3)';
  btn.style.borderColor = ready ? 'var(--green)' : 'var(--border2)';
  btn.style.cursor = ready ? 'pointer' : 'not-allowed';
}
function resetDriveUI() {
  document.getElementById('cd-drive-idle').style.display = 'none';
  document.getElementById('cd-drive-active').style.display = 'none';
  document.getElementById('cd-drive-end').style.display = 'none';
}
function cancelStartDrive() {
  document.getElementById('cd-drive-idle').style.display = 'none';
  gps.vehicle = '';
  gps.purpose = '';
  document.querySelectorAll('#cd-purpose-chips .surf-type-btn').forEach(b => b.classList.remove('active-surf-btn'));
  checkTripReady();
}
function confirmStartDrive() {
  if (gps.active) {
    zConfirm('A drive is already running for ' + ((getClientById(gps.clientId) || {}).name || 'a client') + '. End it first.', () => {
      showEndDrive();
    }, {
      title: 'Drive already active',
      yes: 'End current trip'
    });
    return;
  }
  const vehs = getVehicles();
  if (!gps.vehicle) {
    const sel = document.getElementById('cd-vehicle-sel');
    if (sel && sel.value) gps.vehicle = sel.value;
  }
  if (!gps.vehicle) {
    const msg = document.getElementById('cd-vehicle-required-msg');
    if (msg) msg.style.display = 'block';
    if (!vehs.length) return zAlert('Add a vehicle in Settings before logging a trip.');
    return zAlert('Select a vehicle to continue.');
  }
  if (!gps.purpose) {
    const ps = document.getElementById('cd-purpose-sel');
    if (ps && ps.value) gps.purpose = ps.value;
  }
  gps.active = true;
  gps.clientId = currentClientId;
  // Capture GPS coords at trip start
  geoIfGranted(p => {
    gps.startCoords = {
      lat: p.coords.latitude,
      lon: p.coords.longitude
    };
  });
  const c = getClientById(currentClientId);
  gps.clientName = c ? c.name : 'Client';
  gps.startTime = Date.now();
  const _ds = document.getElementById('cd-drive-start');
  if (_ds) _ds.style.display = 'none';
  document.getElementById('cd-drive-active').style.display = 'block';
  const ap = document.getElementById('cd-active-purpose');
  if (ap) ap.textContent = gps.purpose || 'Work drive';
  const av = document.getElementById('cd-active-vehicle');
  if (av) av.textContent = gps.vehicle || '';
  clearInterval(gps.timerInt);
  gps.timerInt = setInterval(updateDriveTimer, 1000);
  window._wakeLockRequest && window._wakeLockRequest();
  if (c && c.phone) {
    const phone = c.phone.replace(/\D/g, '');
    const msg = 'Hi ' + c.name.split(' ')[0] + ', this is ' + (S.bname || 'TradeDesk') + ' — I\'m on my way! I\'ll be there shortly.';
    const smsLink = 'sms:' + phone + '&body=' + encodeURIComponent(msg);
    window.location.href = smsLink;
  }
  showDriveBanner();
  renderTodayLegs();
}
function showEndDrive() {
  const c = getClientById(gps.clientId);
  const elapsed = gps.startTime ? Math.floor((Date.now() - gps.startTime) / 1000) : 0;
  const m = Math.floor(elapsed / 60),
    s = elapsed % 60;
  const overlay = document.createElement('div');
  overlay.className = 'zmodal-overlay';
  const box = document.createElement('div');
  box.className = 'zmodal';
  // Estimate miles from elapsed time at ~25mph average urban driving
  const estMiles = elapsed > 0 ? Math.round(elapsed / 3600 * 25 * 10) / 10 : 0;
  box.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' + '<div style="font-size:17px;font-weight:800">End Drive</div>' + '<button onclick="closeTopModal()" style="border:none;background:none;font-size:22px;cursor:pointer;color:var(--text3)">✕</button>' + '</div>' + '<div style="background:var(--blue-lt);border-radius:var(--r);padding:8px 12px;margin-bottom:14px;font-size:12px;color:var(--blue-dk)">' + '<strong>' + (c ? c.name : 'Client') + '</strong> · ' + gps.purpose + ' · ' + m + 'm ' + s + 's' + '</div>' + '<div class="f" style="margin-bottom:6px">' + '<label style="font-size:11px;font-weight:700;color:var(--text3)">Miles driven <span style="color:#A32D2D">*</span></label>' + '<input type="number" id="end-miles-modal" placeholder="e.g. 12.4" inputmode="decimal" step="0.1" min="0"' + ' style="font-size:26px;font-weight:800;padding:12px;border:2px solid var(--blue);background:var(--bg2);border-radius:var(--r);width:100%;box-sizing:border-box;color:var(--text);font-family:inherit;text-align:center"' + ' value="' + (estMiles > 0 ? estMiles : '') + '" oninput="updateMilesPreview()">' + '<div id="end-miles-preview" style="font-size:12px;color:var(--green-mid);font-weight:700;margin-top:6px;min-height:16px">' + (estMiles > 0 ? estMiles.toFixed(1) + ' mi · ' + fmt(estMiles * IRS()) + ' deduction (estimated)' : '') + '</div>' + '</div>' + '<div style="font-size:10px;color:var(--text3);margin-bottom:14px">GPS start captured · adjust if needed</div>' + '<button onclick="saveEndDriveModal()" style="width:100%;padding:14px;border-radius:var(--r);border:none;background:var(--green);color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit">Save trip</button>';
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.remove();
  });
  setTimeout(() => {
    const i = document.getElementById('end-miles-modal');
    if (i) {
      i.focus();
      i.select();
    }
  }, 100);
}
function updateMilesPreview() {
  const miles = parseFloat(document.getElementById('end-miles-modal')?.value) || 0;
  const prev = document.getElementById('end-miles-preview');
  if (!prev) return;
  if (miles > 0) {
    prev.textContent = miles.toFixed(1) + ' mi · ' + fmt(miles * IRS()) + ' deduction';
    prev.style.color = 'var(--green-mid)';
  } else {
    prev.textContent = '';
  }
}
function saveEndDriveModal() {
  const miles = parseFloat(document.getElementById('end-miles-modal')?.value) || 0;
  if (!miles || miles <= 0) {
    zAlert('Enter the miles driven.', {
      title: 'Required'
    });
    return;
  }
  if (miles > 500) {
    if (!confirm('That\'s ' + miles + ' miles — does that look right?')) return;
  }
  const c = getClientById(gps.clientId);
  mileage.unshift({
    id: Date.now(),
    date: todayKey(),
    vehicle: gps.vehicle,
    purpose: gps.purpose,
    miles: Math.round(miles * 10) / 10,
    client_id: gps.clientId,
    client_name: c ? c.name : '',
    start_coords: gps.startCoords || null,
    calc_method: 'gps_time'
  });
  gps.active = false;
  gps.startTime = null;
  gps.startCoords = null;
  clearInterval(gps.timerInt);
  window._wakeLockRelease && window._wakeLockRelease();
  saveAll();
  // Mileage is the most-lost data because users immediately switch apps after
  // saving a trip — flush to Supabase NOW instead of waiting for the 2s debounce.
  _flushSaveNow();
  closeTopModal();
  hideDriveBanner();
  renderDash();
  showToast(miles.toFixed(1) + ' mi logged · ' + fmt(miles * IRS()) + ' deduction', '🚗');
}
function updateDriveTimer() {
  if (!gps.startTime) return;
  const elapsed = Math.floor((Date.now() - gps.startTime) / 1000);
  const m = Math.floor(elapsed / 60),
    s = elapsed % 60;
  const timeStr = m + ':' + (s < 10 ? '0' : '') + s;
  const el = document.getElementById('cd-timer');
  if (el) el.textContent = timeStr;
  const bt = document.getElementById('banner-timer');
  if (bt) bt.textContent = 'Tap to return · ' + timeStr;
}
function jumpToDriveClient() {
  if (gps.clientId) {
    openClientDetail(gps.clientId);
  }
}
function showDriveBanner() {
  const banner = document.getElementById('drive-banner');
  if (!banner) return;
  const bc = document.getElementById('banner-client');
  if (bc) bc.textContent = gps.clientName || 'Driving...';
  banner.style.display = 'flex';
  if (document.body && document.body.classList) document.body.classList.add('drive-active');
}
function hideDriveBanner() {
  const banner = document.getElementById('drive-banner');
  if (banner) banner.style.display = 'none';
  if (document.body && document.body.classList) document.body.classList.remove('drive-active');
}
function openDriveModal(opts) {
  opts = opts || {};
  const tk = todayKey();
  // Build today's scheduled stops as quick-pick suggestion chips
  const suggestions = [];
  jobs.forEach(j => {
    if (j.status === 'canceled') return;
    const c = getClientById(j.client_id);
    if (!c || !c.addr) return;
    const d = parseInt(j.days) || 1;
    for (let i = 0; i < d; i++) {
      if (addDays(j.start, i) === tk && !suggestions.find(x => x.clientId === c.id)) {
        suggestions.push({
          label: c.name,
          addr: c.addr,
          clientId: c.id,
          purpose: j.eventType === 'estimate' ? 'Estimate' : 'Job site',
          icon: j.eventType === 'estimate' ? '📋' : '🔨'
        });
      }
    }
  });
  openLogTripModal(Object.assign({}, opts, {
    suggestions
  }));
}
let _milFilter = 'all';
let _lmCoords = {
  from: null,
  to: null
};
let _tripSearchTimers = {};
let _tripDestTimer = null;
let _tripGpsCoords = null; // cached GPS fix for search bias
let _fromBiasCache = {
  val: null,
  coords: null
}; // MapKit-geocoded From coords for To-field bias

// ── Shared geocoding — Mapbox (with key) or Photon+Census parallel ───────────
const _MAPKIT_TOKEN = 'eyJhbGciOiJFUzI1NiIsImtpZCI6IjU1TjkyUTVQWkQiLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJSVjI2NDRSTkdTIiwiaWF0IjoxNzc4MDc2NTgxLCJleHAiOjE4NDExNDg1ODF9.PgQ2btzlf0EH-QJg_fX8dcsw2eR1yyx-o0K7Kckvn3D_bzdEI2hUMuz3iH2c9t2DtUY2fTtP08r7aEQCsYvQ3w';
let _mapkitReady = false;
function _initMapKit() {
  if (typeof mapkit === 'undefined') return;
  mapkit.init({
    authorizationCallback: done => done(_MAPKIT_TOKEN),
    language: 'en-US'
  });
  _mapkitReady = true;
  _retryPendingTrips();
}
async function _retryPendingTrips() {
  const pending = mileage.filter(m => m.calc_method === 'pending' && m.from && m.to);
  if (!pending.length) return;
  for (const rec of pending) {
    try {
      const fc = await _resolveCoords(rec.from);
      const tc = await _resolveCoords(rec.to);
      if (!fc || !tc) continue;
      const {
        miles
      } = await _routeDistance(fc, tc);
      rec.miles = Math.round(miles * 10) / 10;
      rec.calc_method = 'address';
    } catch (e) {}
  }
  saveAll();
  if (document.getElementById('mil-table')) renderAllMileage();
  renderDash();
}
function _photonGeocode(addr) {
  const bias = S.weatherLat && S.weatherLon ? '&lat=' + S.weatherLat + '&lon=' + S.weatherLon : '&lat=37.6922&lon=-97.3375';
  return fetch('https://photon.komoot.io/api/?q=' + encodeURIComponent(addr) + '&limit=1' + bias + '&lang=en').then(r => r.json()).then(d => {
    if (!d || !d.features || !d.features.length) throw new Error('Address not found: "' + addr + '"');
    const [lon, lat] = d.features[0].geometry.coordinates;
    return {
      lat,
      lng: lon
    };
  }).catch(() => null);
}
async function _resolveCoords(addrText) {
  try {
    const r = await _geocodeAddress(addrText, 1);
    if (r.length) return {
      lat: r[0].lat,
      lng: r[0].lon
    };
  } catch (e) {}
  return _photonGeocode(addrText);
}
function _haversineMiles(c1, c2) {
  const R = 3958.8,
    toR = Math.PI / 180;
  const dLat = (c2.lat - c1.lat) * toR,
    dLon = (c2.lng - c1.lng) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(c1.lat * toR) * Math.cos(c2.lat * toR) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
async function _routeDistance(fromCoords, toCoords) {
  // MapKit Directions — primary
  if (_mapkitReady) {
    try {
      return await new Promise((resolve, reject) => {
        const d = new mapkit.Directions();
        d.route({
          origin: new mapkit.Coordinate(fromCoords.lat, fromCoords.lng),
          destination: new mapkit.Coordinate(toCoords.lat, toCoords.lng),
          transportType: mapkit.Directions.Transport.Automobile,
          requestsAlternateRoutes: false
        }, (err, data) => {
          if (err || !data?.routes?.[0]) {
            reject(new Error('mapkit'));
            return;
          }
          const r = data.routes[0];
          resolve({
            miles: Math.round(r.distance / 1609.344 * 10) / 10,
            mins: Math.round(r.expectedTravelTime / 60)
          });
        });
      });
    } catch (e) {}
  }
  // Fallback: Valhalla + OSRM in parallel
  const body = {
    locations: [{
      lon: fromCoords.lng,
      lat: fromCoords.lat
    }, {
      lon: toCoords.lng,
      lat: toCoords.lat
    }],
    costing: 'auto',
    directions_options: {
      units: 'miles'
    }
  };
  const valhallaP = fetch('https://valhalla1.openstreetmap.de/route', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000)
  }).then(r => r.json()).then(d => {
    if (d?.trip) return {
      miles: Math.round(d.trip.summary.length * 10) / 10,
      mins: Math.round(d.trip.summary.time / 60)
    };
    throw new Error('valhalla');
  });
  const osrmP = fetch(`https://router.project-osrm.org/route/v1/driving/${fromCoords.lng},${fromCoords.lat};${toCoords.lng},${toCoords.lat}?overview=false`, {
    signal: AbortSignal.timeout(10000)
  }).then(r => r.json()).then(d => {
    if (d?.code === 'Ok' && d.routes?.[0]) return {
      miles: Math.round(d.routes[0].distance / 1609.344 * 10) / 10,
      mins: Math.round(d.routes[0].duration / 60)
    };
    throw new Error('osrm');
  });
  return Promise.any([valhallaP, osrmP]);
}
// Keep _valhallaRoute as alias so any existing saved references still work
const _valhallaRoute = _routeDistance;
function startDriveToClient() {
  const c = getClientById(currentClientId);
  if (!c) return;
  const hasWon = bids.some(b => b.client_id === currentClientId && b.status === 'Closed Won');
  const hasPending = bids.some(b => b.client_id === currentClientId && b.status === 'Pending');
  const purpose = hasWon ? 'Job site' : hasPending ? 'Estimate' : 'Estimate';
  openDriveModal({
    toAddress: c.addr || '',
    clientName: c.name,
    clientId: c.id,
    purpose
  });
}
async function _geocodeAddress(val, limit, biasLat, biasLon) {
  limit = limit || 5;
  // MapKit JS — Apple Maps database, every US address (primary)
  if (_mapkitReady) {
    return new Promise(resolve => {
      const _mkLat = biasLat || S.weatherLat || 39.5,
        _mkLon = biasLon || S.weatherLon || -98.35;
      const _hasLoc = !!(biasLat || S.weatherLat);
      const search = new mapkit.Search({
        language: 'en-US',
        region: new mapkit.CoordinateRegion(new mapkit.Coordinate(_mkLat, _mkLon), new mapkit.CoordinateSpan(_hasLoc ? 3 : 25, _hasLoc ? 5 : 60))
      });
      search.search(val, (err, data) => {
        if (err || !data || !data.places) {
          resolve([]);
          return;
        }
        const us = data.places.filter(p => p.countryCode === 'US');
        resolve(us.slice(0, limit).map(p => ({
          name: p.name || '',
          line1: p.fullThoroughfare || [p.subThoroughfare, p.thoroughfare].filter(Boolean).join(' ') || p.name || '',
          line2: [p.locality, p.administrativeAreaCode, p.postCode].filter(Boolean).join(', '),
          street: p.fullThoroughfare || [p.subThoroughfare, p.thoroughfare].filter(Boolean).join(' ') || '',
          city: p.locality || '',
          state: p.administrativeAreaCode || '',
          zip: p.postCode || '',
          lat: p.coordinate?.latitude || 0,
          lon: p.coordinate?.longitude || 0
        })));
      });
    });
  }
  if (S.mapboxKey) {
    const _mbProx = biasLat && biasLon ? biasLon + ',' + biasLat : 'ip';
    const r = await fetch('https://api.mapbox.com/geocoding/v5/mapbox.places/' + encodeURIComponent(val) + '.json?access_token=' + S.mapboxKey + '&country=US&types=address&limit=' + limit + '&proximity=' + _mbProx);
    const d = await r.json();
    return (d.features || []).map(f => {
      const ctx = f.context || [];
      const zip = (ctx.find(c => c.id.startsWith('postcode')) || {}).text || '';
      const city = (ctx.find(c => c.id.startsWith('place')) || {}).text || '';
      const stateRaw = (ctx.find(c => c.id.startsWith('region')) || {}).short_code || '';
      const state = stateRaw.replace('US-', '');
      const street = (f.address ? f.address + ' ' : '') + f.text;
      const [lon, lat] = f.center;
      const name = f.place_type?.includes('poi') ? f.text : '';
      return {
        name,
        line1: street,
        line2: [city, state, zip].filter(Boolean).join(', '),
        street,
        city,
        state,
        zip,
        lat,
        lon
      };
    });
  }
  // No Mapbox key — Photon + Census in parallel
  const _bLat = biasLat || S?.weatherLat || 37.6922,
    _bLon = biasLon || S?.weatherLon || -97.3375;
  const bias = '&lat=' + _bLat + '&lon=' + _bLon;
  const photonP = fetch('https://photon.komoot.io/api/?q=' + encodeURIComponent(val) + '&limit=' + (limit + 1) + bias + '&lang=en').then(r => r.json()).catch(() => null);
  const censusP = fetch('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=' + encodeURIComponent(val) + '&benchmark=Public_AR_Current&format=json').then(r => r.json()).catch(() => null);
  const pd = await photonP;
  const pf = (pd?.features || []).filter(f => {
    const p = f.properties || {};
    return p.street && (p.city || p.town || p.village);
  }).slice(0, limit);
  if (pf.length > 0) {
    return pf.map(f => {
      const p = f.properties || {};
      const street = (p.housenumber ? p.housenumber + ' ' : '') + p.street;
      const city = p.city || p.town || p.village || '';
      const state = _STATE_ABBR[p.state] || p.state || '';
      const zip = p.postcode || '';
      const [lon, lat] = f.geometry.coordinates;
      return {
        name: p.name || '',
        line1: street,
        line2: [city, state, zip].filter(Boolean).join(', '),
        street,
        city,
        state,
        zip,
        lat,
        lon
      };
    });
  }
  const cd = await censusP;
  return (cd?.result?.addressMatches || []).slice(0, limit).map(m => {
    const parts = (m.matchedAddress || '').split(', ');
    return {
      name: '',
      line1: parts[0] || '',
      line2: [parts[1], parts[2], parts[3]].filter(Boolean).join(' '),
      street: parts[0] || '',
      city: parts[1] || '',
      state: parts[2] || '',
      zip: parts[3] || '',
      lat: m.coordinates?.y || 0,
      lon: m.coordinates?.x || 0
    };
  });
}
// ── Shared address autocomplete (Photon) ─────────────────────────────────────
const _STATE_ABBR = {
  'Alabama': 'AL',
  'Alaska': 'AK',
  'Arizona': 'AZ',
  'Arkansas': 'AR',
  'California': 'CA',
  'Colorado': 'CO',
  'Connecticut': 'CT',
  'Delaware': 'DE',
  'Florida': 'FL',
  'Georgia': 'GA',
  'Hawaii': 'HI',
  'Idaho': 'ID',
  'Illinois': 'IL',
  'Indiana': 'IN',
  'Iowa': 'IA',
  'Kansas': 'KS',
  'Kentucky': 'KY',
  'Louisiana': 'LA',
  'Maine': 'ME',
  'Maryland': 'MD',
  'Massachusetts': 'MA',
  'Michigan': 'MI',
  'Minnesota': 'MN',
  'Mississippi': 'MS',
  'Missouri': 'MO',
  'Montana': 'MT',
  'Nebraska': 'NE',
  'Nevada': 'NV',
  'New Hampshire': 'NH',
  'New Jersey': 'NJ',
  'New Mexico': 'NM',
  'New York': 'NY',
  'North Carolina': 'NC',
  'North Dakota': 'ND',
  'Ohio': 'OH',
  'Oklahoma': 'OK',
  'Oregon': 'OR',
  'Pennsylvania': 'PA',
  'Rhode Island': 'RI',
  'South Carolina': 'SC',
  'South Dakota': 'SD',
  'Tennessee': 'TN',
  'Texas': 'TX',
  'Utah': 'UT',
  'Vermont': 'VT',
  'Virginia': 'VA',
  'Washington': 'WA',
  'West Virginia': 'WV',
  'Wisconsin': 'WI',
  'Wyoming': 'WY',
  'District of Columbia': 'DC'
};
let _addrSugTimer = null;
let _addrSugGen = 0;
function _addrSugSearch(val, suggId, streetId, cityId, stateId, zipId) {
  clearTimeout(_addrSugTimer);
  const box = document.getElementById(suggId);
  if (!box) return;
  if (val.length < 3) {
    box.style.display = 'none';
    return;
  }
  _addrSugTimer = setTimeout(async () => {
    const gen = ++_addrSugGen;
    try {
      const results = await _geocodeAddress(val, 5);
      if (gen !== _addrSugGen) return;
      if (!results.length) {
        box.style.display = 'none';
        return;
      }
      box.innerHTML = results.map(res => {
        const s1 = res.street.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const s2 = res.city.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const s3 = res.state.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const s4 = res.zip.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        return '<div onmousedown="event.preventDefault()" onclick="_addrSugSelect(\'' + suggId + '\',\'' + streetId + '\',\'' + cityId + '\',\'' + stateId + '\',\'' + zipId + '\',\'' + s1 + '\',\'' + s2 + '\',\'' + s3 + '\',\'' + s4 + '\')" style="padding:10px 14px;border-bottom:1px solid var(--border);cursor:pointer">' + '<div style="font-size:13px;font-weight:600;color:var(--text)">' + escHtml(res.line1) + '</div>' + '<div style="font-size:11px;color:var(--text3);margin-top:1px">' + escHtml(res.line2) + '</div>' + '</div>';
      }).join('');
      box.style.display = 'block';
    } catch (e) {
      if (box) box.style.display = 'none';
    }
  }, 220);
}
function _addrSugSelect(suggId, streetId, cityId, stateId, zipId, street, city, state, zip) {
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = v;
  };
  set(streetId, street);
  set(cityId, city);
  set(stateId, state);
  set(zipId, zip);
  const box = document.getElementById(suggId);
  if (box) box.style.display = 'none';
  document.getElementById(streetId)?.dispatchEvent(new Event('input', {
    bubbles: true
  }));
  // For existing clients, fire lookup immediately on address selection
  if (editClientId && street && city) _lookupPropertyData(editClientId, {
    street,
    city,
    state,
    zip
  });
}
function _getRecentFromAddresses(limit = 8) {
  const seen = new Map();
  for (let i = 0; i < mileage.length; i++) {
    const addr = (mileage[i].to || '').trim();
    if (!addr) continue;
    const key = addr.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, {
        addr,
        poi_name: mileage[i].to_name || '',
        client_name: mileage[i].client_name || ''
      });
    } else if (!seen.get(key).poi_name && mileage[i].to_name) {
      seen.get(key).poi_name = mileage[i].to_name;
    }
    if (seen.size >= limit) break;
  }
  return [...seen.values()];
}
function _showRecentFromAddresses() {
  const sugg = document.getElementById('lm-from-sugg');
  if (!sugg) return;
  const recents = _getRecentFromAddresses();
  if (!recents.length) {
    sugg.style.display = 'none';
    sugg.innerHTML = '';
    return;
  }
  sugg.innerHTML = '<div style="padding:4px 10px 2px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3)">Recent</div>' + recents.map(r => {
    const sa = r.addr.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const sp = (r.poi_name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return '<div onclick="_selectRecentFrom(\'' + sa + '\',\'' + sp + '\')" style="padding:9px 14px;cursor:pointer;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--border)" onmouseenter="this.style.background=\'var(--bg2)\'" onmouseleave="this.style.background=\'\'">' + '<span style="font-size:16px;color:var(--text3)">🕐</span>' + '<div>' + (r.poi_name ? '<div style="font-size:13px;font-weight:700;color:var(--text)">' + escHtml(r.poi_name) + '</div><div style="font-size:11px;color:var(--text3)">' + escHtml(r.addr) + '</div>' : '<div style="font-size:13px;color:var(--text)">' + escHtml(r.addr) + '</div>') + (r.client_name ? '<div style="font-size:11px;color:var(--text3)">' + escHtml(r.client_name) + '</div>' : '') + '</div></div>';
  }).join('');
  sugg.style.display = 'block';
}
function _selectRecentFrom(addr, poiName = '') {
  const inp = document.getElementById('lm-from');
  if (!inp) return;
  inp.value = addr;
  _lmCoords.from = null;
  const nameInp = document.getElementById('lm-from-name');
  if (nameInp) nameInp.value = poiName || '';
  const sugg = document.getElementById('lm-from-sugg');
  if (sugg) {
    sugg.innerHTML = '';
    sugg.style.display = 'none';
  }
  const chip = document.getElementById('lm-from-chip');
  const chipTxt = document.getElementById('lm-from-chip-txt');
  if (chip && chipTxt) {
    chipTxt.textContent = poiName || addr;
    chip.style.display = 'inline-flex';
  }
  if (addr) _photonGeocode(addr).then(c => {
    if (c) _lmCoords.from = c;
  }).catch(() => {});
  const toVal = (document.getElementById('lm-to')?.value || '').trim();
  if (addr && toVal) _previewRoute(addr, toVal);
}
function _getRecentDestinations(limit = 10) {
  const seen = new Map();
  for (let i = 0; i < mileage.length; i++) {
    const addr = (mileage[i].to || '').trim();
    if (!addr) continue;
    const key = addr.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, {
        addr,
        poi_name: mileage[i].to_name || '',
        client_name: mileage[i].client_name || ''
      });
    } else if (!seen.get(key).poi_name && mileage[i].to_name) {
      seen.get(key).poi_name = mileage[i].to_name;
    }
    if (seen.size >= limit) break;
  }
  return [...seen.values()];
}
function _showRecentDestinations() {
  const sugg = document.getElementById('lm-to-sugg');
  if (!sugg) return;
  const recents = _getRecentDestinations();
  if (!recents.length) {
    sugg.style.display = 'none';
    sugg.innerHTML = '';
    return;
  }
  sugg.innerHTML = '<div style="padding:4px 10px 2px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3)">Recent</div>' + recents.map(r => {
    const sa = r.addr.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const sp = (r.poi_name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return '<div onclick="_selectRecentDest(\'' + sa + '\',\'' + sp + '\')" style="padding:9px 14px;cursor:pointer;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--border)" onmouseenter="this.style.background=\'var(--bg2)\'" onmouseleave="this.style.background=\'\'">' + '<span style="font-size:16px;color:var(--text3)">🕐</span>' + '<div>' + (r.poi_name ? '<div style="font-size:13px;font-weight:700;color:var(--text)">' + escHtml(r.poi_name) + '</div><div style="font-size:11px;color:var(--text3)">' + escHtml(r.addr) + '</div>' : '<div style="font-size:13px;color:var(--text)">' + escHtml(r.addr) + '</div>') + (r.client_name ? '<div style="font-size:11px;color:var(--text3)">' + escHtml(r.client_name) + '</div>' : '') + '</div></div>';
  }).join('');
  sugg.style.display = 'block';
}
function _selectRecentDest(addr, poiName = '') {
  const inp = document.getElementById('lm-to');
  if (!inp) return;
  inp.value = addr;
  _lmCoords.to = null;
  const nameInp = document.getElementById('lm-to-name');
  if (nameInp) nameInp.value = poiName || '';
  const sugg = document.getElementById('lm-to-sugg');
  if (sugg) {
    sugg.innerHTML = '';
    sugg.style.display = 'none';
  }
  const chip = document.getElementById('lm-to-chip');
  if (chip) {
    chip.textContent = poiName || addr;
    chip.style.display = 'inline-block';
  }
  if (addr) _photonGeocode(addr).then(c => {
    if (c) _lmCoords.to = c;
  }).catch(() => {});
  const fromVal = (document.getElementById('lm-from')?.value || '').trim();
  if (fromVal && addr) _previewRoute(fromVal, addr);
}
async function _previewRoute(fromAddr, toAddr) {
  try {
    let fc = _lmCoords.from,
      tc = _lmCoords.to;
    if (!fc) fc = await _resolveCoords(fromAddr);
    if (!tc) tc = await _resolveCoords(toAddr);
    const {
      miles,
      mins
    } = await _routeDistance(fc, tc);
    const mv = document.getElementById('lm-miles-val');
    if (mv) mv.value = miles;
    const md = document.getElementById('lm-miles-display');
    if (md) md.textContent = miles.toFixed(1) + ' miles';
    const td = document.getElementById('lm-time-display');
    if (td) td.textContent = '~' + mins + ' min drive · IRS deduction: ' + fmt(miles * IRS());
    const rr = document.getElementById('lm-route-result');
    if (rr) rr.style.display = 'block';
    const rc = document.getElementById('lm-recalc-row');
    if (rc) rc.style.display = 'block';
  } catch (e) {}
}
function _tripDestSearch(val) {
  clearTimeout(_tripDestTimer);
  const box = document.getElementById('lm-to-sugg');
  if (!box) return;
  const chip = document.getElementById('lm-to-chip');
  if (chip) chip.style.display = 'none';
  _lmCoords.to = null;
  if (!val || val.length < 2) {
    _showRecentDestinations();
    return;
  }
  const clientMatches = clients.filter(c => c.name && c.name.toLowerCase().includes(val.toLowerCase()) && c.addr).slice(0, 4);
  _tripDestTimer = setTimeout(async () => {
    let html = clientMatches.map(c => '<div onclick="_selectTripClient(' + c.id + ')" style="padding:10px 14px;border-bottom:1px solid var(--border);cursor:pointer">' + '<div style="font-size:13px;font-weight:700;color:var(--text)">👤 ' + escHtml(c.name) + '</div>' + '<div style="font-size:11px;color:var(--text3);margin-top:1px">' + escHtml(c.addr || '') + '</div>' + '</div>').join('');
    try {
      // Resolve From-field bias: prefer already-geocoded coords, then GPS cache,
      // then geocode the From input text via MapKit so bias always tracks the actual starting location
      let _fromBias = _lmCoords.from || _tripGpsCoords || null;
      if (!_fromBias) {
        const fromVal = (document.getElementById('lm-from')?.value || '').trim();
        if (fromVal) {
          if (_fromBiasCache.val === fromVal && _fromBiasCache.coords) {
            _fromBias = _fromBiasCache.coords;
          } else if (fromVal.length > 4) {
            try {
              const fr = await _geocodeAddress(fromVal, 1);
              if (fr.length) {
                _fromBias = {
                  lat: fr[0].lat,
                  lng: fr[0].lon
                };
                _fromBiasCache = {
                  val: fromVal,
                  coords: _fromBias
                };
              }
            } catch (e) {}
          }
        }
      }
      let results = await _geocodeAddress(val, 5, _fromBias?.lat || null, _fromBias?.lng || null);
      // Bias may cut off distant locations (e.g. MT address when starting from KS) — retry unbiased
      if (!results.length && _fromBias) results = await _geocodeAddress(val, 5);
      results.forEach(res => {
        const safeL1 = res.line1.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const safeL2 = res.line2.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const safeName = (res.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const isPoi = res.name && res.name.toLowerCase() !== res.line1.toLowerCase();
        html += '<div onclick="selectTripPlace(\'lm-to\',\'lm-to-sugg\',\'to\',\'' + safeL1 + '\',\'' + safeL2 + '\',' + res.lat + ',' + res.lon + ',\'' + safeName + '\')" style="padding:10px 14px;border-bottom:1px solid var(--border);cursor:pointer">' + (isPoi ? '<div style="font-size:13px;font-weight:700;color:var(--text)">📍 ' + escHtml(res.name) + '</div>' + '<div style="font-size:11px;color:var(--text3);margin-top:1px">' + escHtml(res.line1) + (res.line2 ? ', ' + escHtml(res.line2) : '') + '</div>' : '<div style="font-size:13px;font-weight:600;color:var(--text)">' + escHtml(res.line1) + '</div>' + (res.line2 ? '<div style="font-size:11px;color:var(--text3);margin-top:1px">' + escHtml(res.line2) + '</div>' : '')) + '</div>';
      });
    } catch (e) {}
    if (html) {
      box.innerHTML = html;
      box.style.display = 'block';
    } else {
      box.style.display = 'none';
    }
  }, 200);
}
async function _selectTripClient(clientId) {
  const c = clients.find(x => x.id === clientId);
  if (!c) return;
  const inp = document.getElementById('lm-to');
  if (inp) inp.value = c.addr || '';
  const box = document.getElementById('lm-to-sugg');
  if (box) box.style.display = 'none';
  _lmCoords.to = null;
  const chip = document.getElementById('lm-to-chip');
  const chipTxt = document.getElementById('lm-to-chip-txt');
  if (chip && chipTxt) {
    chipTxt.textContent = c.name + (c.addr ? ' · ' + c.addr : '');
    chip.style.display = 'inline-flex';
  }
  const h = document.getElementById('lm-client');
  if (h) h.value = c.id;
  const mv = document.getElementById('lm-miles-val');
  if (mv) mv.value = '0';
  const rr = document.getElementById('lm-route-result');
  if (rr) rr.style.display = 'none';
  // Geocode address now so calculateAndShowRoute has coordinates ready
  if (c.addr) {
    try {
      const results = await _geocodeAddress(c.addr, 1);
      if (results.length) _lmCoords.to = {
        lat: results[0].lat,
        lng: results[0].lon
      };
    } catch (e) {}
  }
  if ((document.getElementById('lm-from')?.value || '').trim()) setTimeout(calculateAndShowRoute, 100);
}
function tripPlaceSearch(fieldId, suggId, val) {
  clearTimeout(_tripSearchTimers[fieldId]);
  const box = document.getElementById(suggId);
  if (!box) return;
  const chipId = fieldId === 'lm-from' ? 'lm-from-chip' : 'lm-to-chip';
  const chip = document.getElementById(chipId);
  if (chip) chip.style.display = 'none';
  if (fieldId === 'lm-from') _fromBiasCache = {
    val: null,
    coords: null
  }; // clear stale bias when From changes
  const ckey = fieldId === 'lm-from' ? 'from' : 'to';
  _lmCoords[ckey] = null;
  if (val.length < 2) {
    if (fieldId === 'lm-from') _showRecentFromAddresses();else box.style.display = 'none';
    return;
  }
  _tripSearchTimers[fieldId] = setTimeout(async () => {
    try {
      const whichKey = fieldId === 'lm-from' ? 'from' : 'to';
      const _searchBias = _tripGpsCoords || (whichKey === 'to' ? _lmCoords.from || null : null);
      const results = await _geocodeAddress(val, 6, _searchBias?.lat || null, _searchBias?.lng || null);
      if (!results.length) {
        box.style.display = 'none';
        return;
      }
      box.innerHTML = results.map(res => {
        const safeL1 = res.line1.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const safeL2 = res.line2.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const safeName = (res.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const isPoi = res.name && res.name.toLowerCase() !== res.line1.toLowerCase();
        return '<div onclick="selectTripPlace(\'' + fieldId + '\',\'' + suggId + '\',\'' + whichKey + '\',\'' + safeL1 + '\',\'' + safeL2 + '\',' + res.lat + ',' + res.lon + ',\'' + safeName + '\')" style="padding:10px 14px;border-bottom:1px solid var(--border);cursor:pointer">' + (isPoi ? '<div style="font-size:13px;font-weight:700;color:var(--text)">📍 ' + escHtml(res.name) + '</div>' + '<div style="font-size:11px;color:var(--text3);margin-top:1px">' + escHtml(res.line1) + (res.line2 ? ', ' + escHtml(res.line2) : '') + '</div>' : '<div style="font-size:13px;font-weight:600;color:var(--text)">' + escHtml(res.line1) + '</div>' + (res.line2 ? '<div style="font-size:11px;color:var(--text3);margin-top:1px">' + escHtml(res.line2) + '</div>' : '')) + '</div>';
      }).join('');
      box.style.display = 'block';
    } catch (e) {
      if (box) box.style.display = 'none';
    }
  }, 200);
}
function selectTripPlace(fieldId, suggId, coordKey, line1, line2, lat, lng, name) {
  const full = line2 ? line1 + ', ' + line2 : line1;
  const inp = document.getElementById(fieldId);
  if (inp) inp.value = full;
  _lmCoords[coordKey] = {
    lat,
    lng
  };
  const box = document.getElementById(suggId);
  if (box) box.style.display = 'none';
  const mv = document.getElementById('lm-miles-val');
  if (mv) mv.value = '0';
  const rr = document.getElementById('lm-route-result');
  if (rr) rr.style.display = 'none';
  // Show verified address chip — prefer business name when available
  const chipId = fieldId === 'lm-from' ? 'lm-from-chip' : 'lm-to-chip';
  const chip = document.getElementById(chipId);
  const chipTxt = document.getElementById(chipId + '-txt');
  const isPoi = name && name.toLowerCase() !== line1.toLowerCase();
  const displayName = isPoi ? name : full;
  if (chip && chipTxt) {
    chipTxt.textContent = displayName;
    chip.style.display = 'inline-flex';
  }
  // Store POI name for saving with mileage record
  const nameInputId = fieldId === 'lm-from' ? 'lm-from-name' : 'lm-to-name';
  const nameInp = document.getElementById(nameInputId);
  if (nameInp) nameInp.value = isPoi ? name : '';
  if (coordKey === 'to' && (document.getElementById('lm-from')?.value || '').trim()) setTimeout(calculateAndShowRoute, 100);
}
function fillTripSuggestion(clientId, addr, purpose) {
  const toInp = document.getElementById('lm-to');
  if (toInp && addr) {
    toInp.value = addr;
    _lmCoords.to = null;
  }
  if (clientId) {
    const sel = document.getElementById('lm-client');
    if (sel) sel.value = String(clientId);
  }
  if (purpose) {
    document.getElementById('lm-purpose').value = purpose;
    const sel = document.getElementById('lm-trip-type-sel');
    if (sel) sel.value = purpose;
  }
  const mv = document.getElementById('lm-miles-val');
  if (mv) mv.value = '0';
  const rr = document.getElementById('lm-route-result');
  if (rr) rr.style.display = 'none';
}
function openLogTripModal(opts) {
  opts = opts || {};
  const today = todayKey();
  const vehs = getVehicles();
  const selVeh = opts.vehicle || (vehs.length === 1 ? vehs[0].name : '');
  const vehOpts = vehs.length ? vehs.map(v => '<option value="' + v.name + '"' + (selVeh === v.name ? ' selected' : '') + '>' + getVehicleFullLabel(v) + '</option>').join('') : '<option value="">— Add vehicle in Settings —</option>';
  const clientOpts = '<option value="">— None —</option>' + clients.map(c => '<option value="' + c.id + '">' + c.name + '</option>').join('');
  const prefill = opts.purpose || '';
  const purposeOpts = '<option value="" disabled' + (prefill ? '' : ' selected') + '>— Select type —</option>' + MILE_PURPOSES.map(p => '<option value="' + p + '"' + (p === prefill ? ' selected' : '') + '>' + p + '</option>').join('');
  // Optional quick-select chips for today's scheduled jobs/estimates (skip in edit mode)
  const suggList = !opts.editId && opts.suggestions && opts.suggestions.length ? opts.suggestions : [];
  const suggHtml = suggList.length ? '<div style="margin-bottom:14px">' + '<div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text3);margin-bottom:6px">Scheduled today — tap to fill</div>' + '<div style="display:flex;flex-wrap:wrap;gap:6px">' + suggList.map(s => {
    const safeLabel = (s.label || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const safeAddr = (s.addr || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const safePurpose = (s.purpose || '').replace(/'/g, "\\'");
    return '<button type="button" onclick="fillTripSuggestion(' + s.clientId + ',\'' + safeAddr + '\',\'' + safePurpose + '\')" style="display:flex;align-items:center;gap:5px;padding:7px 10px;border-radius:20px;border:1.5px solid var(--border2);background:var(--bg2);font-size:12px;font-weight:600;cursor:pointer;color:var(--text)">' + (s.icon || '📍') + ' <span>' + safeLabel + '</span>' + '</button>';
  }).join('') + '</div>' + '</div>' : '';
  _lmCoords = {
    from: null,
    to: null
  };
  const overlay = document.createElement('div');
  overlay.className = 'zmodal-overlay';
  overlay.innerHTML = '<div style="background:var(--bg);border-radius:var(--rl);padding:20px;width:100%;max-width:480px;max-height:90vh;overflow-y:auto">' + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">' + '<div style="font-size:17px;font-weight:800">' + (opts.editId ? '✏️ Edit trip' : '🚗 Log a trip') + '</div>' + '<button onclick="this.closest(\'.zmodal-overlay\').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--text3);padding:0 4px;line-height:1">×</button>' + '</div>' + suggHtml + '<input type="hidden" id="lm-purpose" value="' + prefill + '">' + '<input type="hidden" id="lm-miles-val" value="0">' + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">' + '<div class="f" style="margin:0"><label>Date</label><input type="date" id="lm-date" value="' + (opts.date || today) + '"></div>' + '<div class="f" style="margin:0"><label>Vehicle</label><select id="lm-vehicle" style="width:100%">' + vehOpts + '</select></div>' + '</div>' + '<div class="f" style="margin-bottom:12px"><label>Trip type</label>' + '<select id="lm-trip-type-sel" style="width:100%" onchange="document.getElementById(\'lm-purpose\').value=this.value">' + purposeOpts + '</select>' + '</div>' + '<input type="hidden" id="lm-client" value="">' + '<input type="hidden" id="lm-from-name" value="">' + '<input type="hidden" id="lm-to-name" value="">' + '<div class="f" style="margin-bottom:12px"><label>Starting from</label>' + '<div style="display:flex;gap:8px">' + '<input id="lm-from" placeholder="Your address or last job" style="flex:1" value="' + (opts.fromAddress || '') + '" onfocus="_showRecentFromAddresses()" oninput="tripPlaceSearch(\'lm-from\',\'lm-from-sugg\',this.value)" autocomplete="off">' + '<button type="button" onclick="grabMyLocation(true)" class="btn btn-sm" id="lm-gps-btn" style="white-space:nowrap;flex-shrink:0;min-height:44px">📍 GPS</button>' + '</div>' + '<div id="lm-from-sugg" style="display:none;background:var(--bg);border:1px solid var(--border2);border-radius:var(--r);margin-top:2px;overflow:hidden;max-height:200px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,.12)"></div>' + '<div id="lm-from-chip" style="display:none;margin-top:5px;font-size:11px;color:var(--green-mid);background:var(--green-lt);border:1px solid var(--green-mid);border-radius:20px;padding:3px 10px;align-items:center;gap:4px"><span>📍</span><span id="lm-from-chip-txt"></span><span style="color:var(--green-mid);font-weight:700">✓</span></div>' + '</div>' + '<div class="f" style="margin-bottom:4px"><label>Driving to — client name or address</label>' + '<input id="lm-to" placeholder="Type client name or any address" value="' + (opts.toAddress || '') + '" onfocus="_showRecentDestinations()" oninput="_tripDestSearch(this.value)" autocomplete="off">' + '<div id="lm-to-sugg" style="display:none;background:var(--bg);border:1px solid var(--border2);border-radius:var(--r);margin-top:2px;overflow:hidden;max-height:200px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,.12)"></div>' + '<div id="lm-to-chip" style="display:none;margin-top:5px;font-size:11px;color:var(--green-mid);background:var(--green-lt);border:1px solid var(--green-mid);border-radius:20px;padding:3px 10px;align-items:center;gap:4px"><span>📍</span><span id="lm-to-chip-txt"></span><span style="color:var(--green-mid);font-weight:700">✓</span></div>' + '</div>' + '<div id="lm-route-result" style="display:none;background:var(--blue-lt);border:1px solid var(--blue);border-radius:var(--r);padding:14px;margin-bottom:6px;text-align:center">' + '<div id="lm-miles-display" style="font-size:32px;font-weight:800;color:var(--blue-dk)"></div>' + '<div id="lm-time-display" style="font-size:13px;color:var(--text2);margin-top:4px"></div>' + '</div>' + '<div id="lm-recalc-row" style="display:none;text-align:right;margin-bottom:12px">' + '<button type="button" onclick="calculateAndShowRoute()" style="background:none;border:none;color:var(--blue);font-size:12px;font-weight:600;cursor:pointer;padding:0">↺ Recalculate</button>' + '</div>' + '<input type="hidden" id="lm-map-app" value="">' + (!opts.editId ? '<div class="f" style="margin-bottom:14px">' + '<label style="margin-bottom:6px;display:block">Open in maps after saving <span style="font-weight:400;font-size:10px;color:var(--text3)">(optional)</span></label>' + '<div style="display:flex;gap:8px">' + '<button type="button" id="lm-map-apple" onclick="_selectTripMapApp(\'apple\')" class="btn" style="flex:1;font-size:13px;font-weight:600;min-height:42px"> Apple Maps</button>' + '<button type="button" id="lm-map-google" onclick="_selectTripMapApp(\'google\')" class="btn" style="flex:1;font-size:13px;font-weight:600;min-height:42px"> Google Maps</button>' + '<button type="button" id="lm-map-none" onclick="_selectTripMapApp(\'\')" class="btn" style="flex:1;font-size:13px;min-height:42px;color:var(--text3)">None</button>' + '</div>' + '</div>' : '') + '<div class="f" style="margin-bottom:14px"><label>Notes <span style="font-weight:400;font-size:10px;color:var(--text3)">(optional)</span></label>' + '<input id="lm-notes" placeholder="e.g. Supply stop at Sherwin-Williams" value="' + (opts.notes || '') + '"></div>' + (opts.editId ? '<button onclick="zConfirm(\'Delete this trip?\',function(){delMileage(' + opts.editId + ');closeTopModal();},{yes:\'Delete\',danger:true})" class="btn" style="width:100%;margin-bottom:8px;color:#dc2626;border-color:#fca5a5;background:#fff5f5;font-weight:700">🗑 Delete trip</button>' : '') + '<div style="display:flex;gap:8px">' + '<button onclick="this.closest(\'.zmodal-overlay\').remove()" class="btn" style="flex:1">Cancel</button>' + (opts.editId ? '<button onclick="updateLoggedTrip(' + opts.editId + ')" class="btn btn-p" style="flex:2;min-height:48px;font-size:15px;font-weight:700">✓ Save changes</button>' : '<button onclick="saveLoggedTrip()" class="btn btn-p" style="flex:2;min-height:48px;font-size:15px;font-weight:700">✓ Save trip</button>') + '</div>' + '</div>';
  document.body.appendChild(overlay);
  // Auto-select map app based on device (skip in edit mode)
  if (!opts.editId) {
    const _ua = navigator.userAgent || '';
    const _defMap = /iPhone|iPad|iPod/i.test(_ua) ? 'apple' : /Android/i.test(_ua) ? 'google' : '';
    if (_defMap) setTimeout(() => _selectTripMapApp(_defMap), 50);
    // Auto-grab GPS for starting location if not pre-filled
    if (!opts.fromAddress) setTimeout(() => grabMyLocation(false), 300);
  }
  // Pre-link client if provided
  if (opts.clientId) {
    const h = document.getElementById('lm-client');
    if (h) h.value = opts.clientId;
  } else if (opts.clientName) {
    const c = clients.find(x => x.name === opts.clientName);
    if (c) {
      const h = document.getElementById('lm-client');
      if (h) h.value = c.id;
    }
  }
  // Show existing miles in edit mode
  if (opts.editId && opts.miles > 0) {
    setTimeout(() => {
      const mv = document.getElementById('lm-miles-val');
      if (mv) mv.value = opts.miles;
      const md = document.getElementById('lm-miles-display');
      if (md) md.textContent = (+opts.miles).toFixed(1) + ' miles';
      const td = document.getElementById('lm-time-display');
      if (td) td.textContent = 'IRS deduction: ' + fmt(+opts.miles * IRS());
      const rr = document.getElementById('lm-route-result');
      if (rr) rr.style.display = 'block';
      const rc = document.getElementById('lm-recalc-row');
      if (rc) rc.style.display = 'block';
    }, 50);
  }
}
async function _nominatimReverse(lat, lon) {
  try {
    const r = await fetch('https://nominatim.openstreetmap.org/reverse?lat=' + lat + '&lon=' + lon + '&format=json', {
      headers: {
        'Accept-Language': 'en-US'
      }
    });
    const d = await r.json();
    const a = d.address || {};
    const parts = [];
    if (a.house_number && a.road) parts.push(a.house_number + ' ' + a.road);else if (a.road) parts.push(a.road);
    if (a.city || a.town || a.village) parts.push(a.city || a.town || a.village);
    if (a.state) parts.push(a.state);
    if (a.postcode) parts.push(a.postcode);
    return parts.join(', ') || d.display_name || null;
  } catch (e) {
    return null;
  }
}
async function getCurrentLocAddress() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('GPS not available'));
      return;
    }
    const doGet = () => navigator.geolocation.getCurrentPosition(async pos => {
      const {
        latitude: lat,
        longitude: lon
      } = pos.coords;
      _tripGpsCoords = {
        lat,
        lng: lon
      };
      if (_mapkitReady) {
        const gc = new mapkit.Geocoder({
          language: 'en-US'
        });
        gc.reverseLookup(new mapkit.Coordinate(lat, lon), async (err, data) => {
          if (!err && data?.results?.[0]) {
            const p = data.results[0];
            const parts = [];
            if (p.fullThoroughfare) parts.push(p.fullThoroughfare);else if (p.thoroughfare) parts.push([p.subThoroughfare, p.thoroughfare].filter(Boolean).join(' '));
            if (p.locality) parts.push(p.locality);
            if (p.administrativeAreaCode) parts.push(p.administrativeAreaCode);
            if (p.postCode) parts.push(p.postCode);
            const addr = parts.join(', ') || p.formattedAddress || '';
            if (addr) {
              resolve(addr);
              return;
            }
            console.warn('[MapKit reverse] empty result for', lat, lon, '→ falling back to Nominatim');
          } else if (err) {
            console.warn('[MapKit reverse] error:', err);
          }
          const nom = await _nominatimReverse(lat, lon);
          resolve(nom || lat.toFixed(4) + ', ' + lon.toFixed(4));
        });
        return;
      }
      const nom = await _nominatimReverse(lat, lon);
      resolve(nom || lat.toFixed(4) + ', ' + lon.toFixed(4));
    }, err => reject(err), {
      timeout: 8000,
      enableHighAccuracy: false,
      maximumAge: 300000
    });
    if (S.locationGranted) {
      doGet();
      return;
    }
    if (typeof requestLocationPermission === 'function') {
      requestLocationPermission(doGet, () => reject(new Error('Location denied')));
    } else {
      doGet();
    }
  });
}
async function grabMyLocation(showErr) {
  const btn = document.getElementById('lm-gps-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Locating...';
  }
  try {
    const addr = await getCurrentLocAddress();
    const inp = document.getElementById('lm-from');
    if (inp) inp.value = addr;
  } catch (e) {
    if (showErr) zAlert('Could not get your location. Check that location access is enabled for Safari.', {
      title: 'GPS unavailable'
    });
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '📍 GPS';
    }
  }
}
async function calculateAndShowRoute() {
  const fromVal = (document.getElementById('lm-from')?.value || '').trim();
  const toVal = (document.getElementById('lm-to')?.value || '').trim();
  if (!fromVal || !toVal) {
    zAlert('Enter both a starting point and a destination.');
    return;
  }
  const btn = document.getElementById('lm-calc-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Calculating...';
  }
  try {
    let fromCoords = _lmCoords.from;
    let toCoords = _lmCoords.to;
    if (!fromCoords) fromCoords = await _resolveCoords(fromVal);
    if (!toCoords) toCoords = await _resolveCoords(toVal);
    const {
      miles,
      mins
    } = await _routeDistance(fromCoords, toCoords);
    document.getElementById('lm-miles-val').value = miles;
    document.getElementById('lm-miles-display').textContent = miles.toFixed(1) + ' miles';
    document.getElementById('lm-time-display').textContent = '~' + mins + ' min drive · IRS deduction: ' + fmt(miles * IRS());
    document.getElementById('lm-route-result').style.display = 'block';
    const _rcr = document.getElementById('lm-recalc-row');
    if (_rcr) _rcr.style.display = 'block';
  } catch (e) {
    zAlert(e.message + '\n\nTip: Try typing the city and state, or pick from the search suggestions.', {
      title: 'Could not calculate route'
    });
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🗺 Calculate miles';
    }
  }
}
function openTripInMaps(which, from, to) {
  if (!to || !which) return;
  const enc = s => encodeURIComponent(s);
  if (which === 'apple') {
    window.location.href = 'maps://?daddr=' + enc(to) + '&dirflg=d';
  } else if (which === 'google') {
    window.open('https://www.google.com/maps/dir/?api=1' + (from ? '&origin=' + enc(from) : '') + '&destination=' + enc(to) + '&travelmode=driving', '_blank');
  }
}
function _selectTripMapApp(which) {
  ['apple', 'google', 'none'].forEach(k => {
    const btn = document.getElementById('lm-map-' + k);
    if (!btn) return;
    const active = which === k || which === '' && k === 'none';
    btn.style.background = active ? 'var(--blue)' : '';
    btn.style.color = active ? '#fff' : '';
    btn.style.borderColor = active ? 'var(--blue)' : '';
  });
  const inp = document.getElementById('lm-map-app');
  if (inp) inp.value = which;
}
function saveLoggedTrip() {
  const to = (document.getElementById('lm-to')?.value || '').trim();
  if (!to) {
    zAlert('Enter a destination first.', {
      title: 'Destination needed'
    });
    return;
  }
  const purpose = document.getElementById('lm-purpose')?.value || '';
  if (!purpose) {
    const sel = document.getElementById('lm-trip-type-sel');
    if (sel) {
      sel.style.borderColor = '#A32D2D';
      sel.style.background = 'var(--red-lt)';
      sel.focus();
    }
    zAlert('Select a trip type.', {
      title: 'Required'
    });
    return;
  }
  const date = document.getElementById('lm-date')?.value || todayKey();
  const vehicle = document.getElementById('lm-vehicle')?.value || '';
  const from = document.getElementById('lm-from')?.value || '';
  const from_name = document.getElementById('lm-from-name')?.value || '';
  const to_name = document.getElementById('lm-to-name')?.value || '';
  const notes = document.getElementById('lm-notes')?.value || '';
  const mapApp = document.getElementById('lm-map-app')?.value || '';
  const cid = parseInt(document.getElementById('lm-client')?.value) || null;
  const c = cid ? getClientById(cid) : null;
  // Save immediately with 0 miles — background route calc will update
  const rec = {
    id: Date.now(),
    date,
    vehicle,
    from,
    from_name,
    to,
    to_name,
    start: 0,
    end: 0,
    miles: 0,
    purpose,
    client_id: cid,
    client_name: c ? c.name : '',
    notes,
    created_at: new Date().toISOString(),
    calc_method: 'pending'
  };
  if (_isEmployee) {
    rec.logged_by_id = _supaUser.id;
    rec.logged_by_name = _employeeRecord?.name || _supaUser.email;
  }
  mileage.unshift(rec);
  if (cid) autoLogContact(cid, 'drive');
  emitEvent('drive_logged', cid, {
    to,
    miles: 0,
    purpose
  });
  saveAll();
  closeTopModal();
  showToast('Trip saved — calculating mileage…', '🚗');
  if (mapApp && to) {
    // iOS will suspend the PWA when we hand off to Apple/Google Maps — the 2s
    // debounce in saveAll() dies before firing. Push to Supabase NOW so the
    // in-flight fetch survives the app switch.
    _flushSaveNow();
    openTripInMaps(mapApp, from, to);
  }
  renderDash();
  if (document.getElementById('mil-table')) renderAllMileage();
  if (document.getElementById('cd-mile-list') && currentClientId) renderCDMileage();
  // Background: geocode if needed, get real route, update record
  (async () => {
    try {
      const fc = _lmCoords.from || (from ? await _resolveCoords(from) : null);
      const tc = _lmCoords.to || (to ? await _resolveCoords(to) : null);
      if (!fc || !tc) return;
      const {
        miles
      } = await _routeDistance(fc, tc);
      const saved = mileage.find(m => m.id === rec.id);
      if (!saved) return;
      saved.miles = Math.round(miles * 10) / 10;
      saved.calc_method = 'address';
      saveAll();
      renderDash();
      if (document.getElementById('mil-table')) renderAllMileage();
      if (document.getElementById('cd-mile-list') && currentClientId) renderCDMileage();
      showToast(saved.miles.toFixed(1) + ' mi logged · ' + fmt(saved.miles * IRS()) + ' deduction', '✅');
    } catch (e) {
      showToast('Could not calculate mileage — tap Edit to add miles manually', '⚠️');
    }
  })();
}
function renderAllMileage() {
  const yr = String(trackerYear || new Date().getFullYear());
  const _mileSrc = _isEmployee ? mileage.filter(m => !m.logged_by_id || m.logged_by_id === _supaUser?.id) : mileage;
  const filtered = _mileSrc.filter(m => m.date && m.date.startsWith(yr));
  const irsRate = IRS();
  const tot = filtered.reduce((s, r) => s + (r.miles || 0), 0);
  const deduction = tot * irsRate;
  const unclassified = filtered.filter(m => !m.purpose);

  // ── Hero ──
  const heroEl = document.getElementById('mil-hero-wrap');
  if (heroEl) {
    const vehs = getVehicles();
    if (!vehs.length) {
      heroEl.innerHTML = '<div style="background:var(--bg2);border-radius:var(--r);padding:20px;text-align:center;margin-bottom:12px">' + '<div style="font-size:28px;margin-bottom:8px">🚛</div>' + '<div style="font-size:15px;font-weight:800;color:var(--text);margin-bottom:4px">Add a vehicle to start logging</div>' + '<div style="font-size:12px;color:var(--text3);margin-bottom:14px;line-height:1.5">The IRS requires a vehicle description on every mileage entry. You\'re one tap away from tracking deductible trips.</div>' + '<button class="btn btn-p" onclick="goPg(\'pg-team\');setFleetTab(\'fleet\')" style="font-size:14px;padding:11px 22px">+ Add vehicle in Fleet</button>' + '</div>';
      return;
    }
    const pVeh = vehs[0] || null;
    const odoLog = (S.vehicleOdoLog || {})[yr] || {};
    const pKey = pVeh ? _vehKey(pVeh) : 'default';
    const odoRec = odoLog[pKey] || {};
    const startOdo = odoRec.start || 0;
    const endOdo = odoRec.end || 0;
    const totalDriven = endOdo > startOdo ? endOdo - startOdo : 0;
    const bizPct = totalDriven > 0 ? Math.min(100, Math.round(tot / totalDriven * 100)) : 0;
    const personalMi = Math.max(0, totalDriven - tot);
    const vehLabel = pVeh ? getVehicleLabel(pVeh) || 'Vehicle' : 'Vehicle';
    heroEl.innerHTML = '<div class="mil-hero">' + '<div class="mil-hero-l">' + '<div class="td-micro" style="color:rgba(255,255,255,.55);margin-bottom:8px">Mileage deduction · ' + yr + '</div>' + '<div class="mil-deduction">' + fmt(deduction) + '</div>' + '<div class="mil-meta">' + '<span><b style="color:#fff">' + tot.toFixed(1) + '</b> business miles</span>' + '<span>·</span>' + '<span>IRS $' + irsRate.toFixed(3) + '/mi</span>' + '<span>·</span>' + '<span>' + filtered.length + ' trip' + (filtered.length !== 1 ? 's' : '') + ' logged</span>' + '</div>' + (totalDriven > 0 ? '<div class="mil-bar">' + '<div class="mil-bar-seg mil-bar-business" style="flex:' + Math.max(tot, 0.1) + '"><span>Business ' + bizPct + '%</span></div>' + '<div class="mil-bar-seg mil-bar-personal" style="flex:' + Math.max(personalMi, 0.1) + '"><span>' + (100 - bizPct) + '% personal</span></div>' + '</div>' + '<div class="mil-bar-foot">' + (startOdo ? '<span>' + startOdo.toLocaleString() + ' mi · Jan 1</span>' : '<span>Set opening odometer below</span>') + (endOdo ? '<span>' + endOdo.toLocaleString() + ' mi today · ' + totalDriven.toLocaleString() + ' mi driven</span>' : '') + '</div>' : '<div class="mil-bar"><div class="mil-bar-seg mil-bar-business" style="flex:1"><span>Log trips to track business %</span></div></div>') + '</div>' + '<div class="mil-hero-r">' + '<button class="mil-action mil-action-go" onclick="openDriveModal()">' + '<div class="mil-action-icon">📍</div>' + '<div class="mil-action-body"><div class="mil-action-label">Log a trip</div><div class="mil-action-sub">Manual · type addresses + miles</div></div>' + '</button>' + '<button class="mil-action" onclick="checkOdometerEntries(true)">' + '<div class="mil-action-icon">🔢</div>' + '<div class="mil-action-body"><div class="mil-action-label">Update odometer</div><div class="mil-action-sub">' + vehLabel + (startOdo ? ' · ' + startOdo.toLocaleString() + ' mi' : '') + ' </div></div>' + '</button>' + '<button class="mil-action" onclick="openExportPanel()">' + '<div class="mil-action-icon">📊</div>' + '<div class="mil-action-body"><div class="mil-action-label">Export IRS report</div><div class="mil-action-sub">Schedule C · Form 4562</div></div>' + '</button>' + '</div>' + '</div>';
  }

  // ── Vehicle worksheet ──
  _milRenderVehicleWorksheet(yr, tot, irsRate);

  // ── Classify card ──
  _milRenderClassifyCard(unclassified);

  // ── Filter bar ──
  const fbEl = document.getElementById('mil-filter-bar');
  if (fbEl) {
    const classified = filtered.filter(m => m.purpose);
    fbEl.innerHTML = '<div class="fbar">' + '<button id="mil-fb-all" class="fb' + (_milFilter === 'all' ? ' active' : '') + '" onclick="setMilFilter(\'all\')">All trips<span class="fb-count">' + filtered.length + '</span></button>' + '<button id="mil-fb-unclassified" class="fb' + (_milFilter === 'unclassified' ? ' active' : '') + '" onclick="setMilFilter(\'unclassified\')">Needs purpose<span class="fb-count">' + unclassified.length + '</span></button>' + '<button id="mil-fb-classified" class="fb' + (_milFilter === 'classified' ? ' active' : '') + '" onclick="setMilFilter(\'classified\')">Categorized<span class="fb-count">' + classified.length + '</span></button>' + '</div>';
  }

  // ── Trip list ──
  const shown = _milFilter === 'unclassified' ? unclassified : _milFilter === 'classified' ? filtered.filter(m => m.purpose) : filtered;
  _milRenderTripList(shown, yr);

  // ── Summary ──
  _milRenderSummary(filtered, tot, irsRate);

  // ── Home office tip ──
  const metsEl = document.getElementById('tr-mile-mets');
  if (metsEl) {
    metsEl.innerHTML = S.homeOffice ? '<div class="tip" style="margin-top:4px"><span style="font-size:18px">✅</span><div><b>Home office active</b> — your drives from home to job sites count as deductible business miles.</div></div>' : '<div class="tip" style="margin-top:4px"><span style="font-size:18px">💡</span><div><b>Home office tip:</b> Set up a home office in Settings to make drives from home to your first job site deductible.</div></div>';
  }
}
function setMilFilter(f) {
  _milFilter = f;
  ['all', 'unclassified', 'classified'].forEach(id => {
    const el = document.getElementById('mil-fb-' + id);
    if (el) el.className = 'fb' + (f === id ? ' active' : '');
  });
  const yr = String(trackerYear || new Date().getFullYear());
  const _mileSrc = _isEmployee ? mileage.filter(m => !m.logged_by_id || m.logged_by_id === _supaUser?.id) : mileage;
  const filtered = _mileSrc.filter(m => m.date && m.date.startsWith(yr));
  const unclassified = filtered.filter(m => !m.purpose);
  const shown = f === 'unclassified' ? unclassified : f === 'classified' ? filtered.filter(m => m.purpose) : filtered;
  _milRenderTripList(shown, yr);
}
function _milSetOdo(vehKey, field, val) {
  const yr = String(trackerYear || new Date().getFullYear());
  if (!S.vehicleOdoLog) S.vehicleOdoLog = {};
  if (!S.vehicleOdoLog[yr]) S.vehicleOdoLog[yr] = {};
  if (!S.vehicleOdoLog[yr][vehKey]) S.vehicleOdoLog[yr][vehKey] = {};
  const n = parseFloat(String(val).replace(/[^0-9.]/g, '')) || 0;
  S.vehicleOdoLog[yr][vehKey][field] = n;
  saveAll();
  _flushSaveNow();
  renderAllMileage();
}
function _milRenderVehicleWorksheet(yr, tot, irsRate) {
  const el = document.getElementById('mil-vehicle-wrap');
  if (!el) return;
  const vehs = getVehicles();
  if (!vehs.length) {
    el.innerHTML = '';
    return;
  }
  const odoLog = (S.vehicleOdoLog || {})[yr] || {};
  const veh = vehs[0];
  const pKey = _vehKey(veh);
  const odoRec = odoLog[pKey] || {};
  const startOdo = odoRec.start || 0;
  const endOdo = odoRec.end || 0;
  const totalDriven = endOdo > startOdo ? endOdo - startOdo : 0;
  const bizPct = totalDriven > 0 ? Math.min(100, Math.round(tot / totalDriven * 100)) : 0;
  const personalMi = Math.max(0, totalDriven - tot);
  const deduction = tot * irsRate;
  const vehLabel = veh.year ? veh.year + ' ' + veh.name : veh.name || 'Vehicle';
  const vehPlate = veh.plate || veh.license_plate || '';
  el.innerHTML = '<div class="card card-pad-0" style="margin-bottom:14px">' + '<div class="card-hd">' + '<div><div class="card-hd-title">Vehicle &amp; odometer worksheet</div>' + '<div class="card-hd-sub" style="font-size:11px;color:var(--text-3);font-weight:500;margin-top:2px">Business-use % is calculated from year-start and year-end readings</div></div>' + '<button class="btn btn-sm" onclick="checkOdometerEntries(true)">Update readings</button>' + '</div>' + '<div class="mil-vehicle">' + '<div class="mil-vehicle-l">' + '<div class="mil-vehicle-icon">🛻</div>' + '<div>' + '<div class="mil-vehicle-name">' + escHtml(vehLabel) + '</div>' + (vehPlate ? '<div class="mil-vehicle-plate">' + escHtml(vehPlate) + ' · primary work vehicle</div>' : '<div class="mil-vehicle-plate">Primary work vehicle</div>') + '</div>' + '</div>' + '<div class="mil-vehicle-grid">' + '<div class="mil-odo">' + '<div class="td-micro">Odometer · year start</div>' + '<div class="mil-odo-input">' + '<input type="number" value="' + (startOdo || '') + '" placeholder="0" min="0"' + ' onblur="_milSetOdo(\'' + escHtml(pKey) + '\',\'start\',this.value)"' + ' style="font-size:15px;font-weight:800">' + '<span class="mil-odo-suffix">mi</span>' + '</div>' + '<div class="mil-odo-meta">As of Jan 1, ' + yr + '</div>' + '</div>' + '<div class="mil-odo-arrow">→</div>' + '<div class="mil-odo">' + '<div class="td-micro">Odometer · year end</div>' + '<div class="mil-odo-input">' + '<input type="number" value="' + (endOdo || '') + '" placeholder="0" min="0"' + ' onblur="_milSetOdo(\'' + escHtml(pKey) + '\',\'end\',this.value)"' + ' style="font-size:15px;font-weight:800">' + '<span class="mil-odo-suffix">mi</span>' + '</div>' + '<div class="mil-odo-meta">Update at year-end for Schedule C</div>' + '</div>' + '<div class="mil-odo-result">' + '<div class="td-micro">Total miles driven YTD</div>' + '<div class="mil-odo-big">' + (totalDriven ? totalDriven.toLocaleString() : '—') + '<span style="font-size:14px;color:var(--text-3);margin-left:4px;font-weight:600"> mi</span></div>' + '</div>' + '</div>' + '<div class="mil-calc">' + '<div class="mil-calc-row"><div class="mil-calc-label">Total miles driven</div><div class="mil-calc-eq">=</div><div class="mil-calc-v">' + (totalDriven ? totalDriven.toLocaleString() + ' mi' : '—') + '</div></div>' + '<div class="mil-calc-row"><div class="mil-calc-label">Business miles logged · YTD</div><div class="mil-calc-eq">−</div><div class="mil-calc-v" style="color:var(--c-green)">' + tot.toFixed(1) + ' mi</div></div>' + '<div class="mil-calc-row"><div class="mil-calc-label">Personal miles (everything else)</div><div class="mil-calc-eq">=</div><div class="mil-calc-v">' + personalMi.toFixed(1) + ' mi</div></div>' + '<div class="mil-calc-row mil-calc-pct"><div class="mil-calc-label">Business-use percentage</div><div class="mil-calc-eq">→</div><div class="mil-calc-v">' + (totalDriven ? bizPct + '%' : '—') + '</div></div>' + '<div class="mil-calc-row mil-calc-final"><div class="mil-calc-label">Deduction · ' + tot.toFixed(1) + ' mi × $' + irsRate.toFixed(3) + '/mi</div><div class="mil-calc-eq">=</div><div class="mil-calc-v">' + fmt(deduction) + '</div></div>' + '</div>' + '</div>' + '</div>';
}
function _milRenderClassifyCard(unclassified) {
  const el = document.getElementById('mil-classify-wrap');
  if (!el) return;
  if (!unclassified.length) {
    el.innerHTML = '';
    return;
  }
  const next = unclassified[0];
  const fromShort = (next.from_name || next.from || '').split(',')[0].trim() || 'Start';
  const toShort = (next.to_name || next.to || '').split(',')[0].trim() || 'Destination';
  const dateStr = next.date ? new Date(next.date + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  }) : '';
  el.innerHTML = '<div class="mil-classify-card">' + '<div class="mil-classify-left">' + '<div class="mil-classify-tag">Needs a purpose · ' + unclassified.length + ' trip' + (unclassified.length === 1 ? '' : 's') + '</div>' + '<div class="mil-classify-title">' + escHtml(fromShort) + ' → ' + escHtml(toShort) + '</div>' + '<div class="mil-classify-meta">' + (dateStr ? dateStr + ' · ' : '') + (next.miles || 0).toFixed(1) + ' mi</div>' + '</div>' + '<div class="mil-classify-actions">' + '<button class="mil-class-btn" onclick="_milSkipClassify(' + next.id + ')">Skip</button>' + '<button class="mil-class-btn mil-class-business" onclick="openMileageEdit(' + next.id + ')">💼 Add purpose →</button>' + '</div>' + '</div>';
}
function _milSkipClassify(id) {
  const m = mileage.find(x => x.id === id);
  if (!m) return;
  m.purpose = m.purpose || 'Other';
  saveAll();
  _flushSaveNow();
  renderAllMileage();
}
function _milRenderTripList(shown, yr) {
  const el = document.getElementById('mil-table');
  if (!el) return;
  if (!mileage.length) {
    el.innerHTML = '<div class="empty">No trips yet.<br>Tap <strong>Log a trip</strong> above to get started.</div>';
    return;
  }
  if (!shown.length) {
    el.innerHTML = '<div class="empty">No trips match this filter.</div>';
    return;
  }
  const _hasMultiDriver = !_isEmployee && mileage.some(m => m.logged_by_name);
  const irsRate = IRS();
  const byDay = {};
  [...shown].sort((a, b) => (b.date || '').localeCompare(a.date || '')).forEach(r => {
    if (!byDay[r.date]) byDay[r.date] = [];
    byDay[r.date].push(r);
  });
  const days = Object.entries(byDay).sort((a, b) => b[0].localeCompare(a[0]));
  // Purpose breakdown strip
  const purpTotals = {};
  shown.forEach(r => {
    const p = r.purpose || '';
    if (p) {
      purpTotals[p] = (purpTotals[p] || 0) + (r.miles || 0);
    }
  });
  const purpChips = Object.entries(purpTotals).sort((a, b) => b[1] - a[1]).map(([p, mi]) => {
    const _pc = MILE_PURPOSE_COLORS[p] || MILE_PURPOSE_COLORS['Other'];
    return '<div class="mil-purp-chip">' + '<div class="mil-purp-dot" style="background:' + _pc.text + '"></div>' + '<div class="mil-purp-name">' + escHtml(p) + '</div>' + '<div class="mil-purp-mi">' + mi.toFixed(1) + ' mi</div>' + '</div>';
  }).join('');
  const purpRow = purpChips ? '<div class="mil-purp-row">' + purpChips + '</div>' : '';
  el.innerHTML = '<div class="mil-list">' + purpRow + days.map(([date, trips], dayIdx) => {
    const dayMi = trips.reduce((s, t) => s + (t.miles || 0), 0);
    const dayDed = trips.reduce((s, t) => s + (t.miles || 0) * irsRate, 0);
    const needsCount = trips.filter(t => !t.purpose).length;
    const [y, mo, d] = date.split('-').map(Number);
    const dateObj = new Date(y, mo - 1, d);
    const dow = dateObj.toLocaleDateString('en-US', {
      weekday: 'short'
    }).toUpperCase().slice(0, 3);
    const monthShort = dateObj.toLocaleDateString('en-US', {
      month: 'short'
    }).toUpperCase();
    const openClass = dayIdx === 0 ? ' open' : '';
    const reviewClass = needsCount ? ' has-review' : '';
    const _sorted = trips.slice().sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    const tripRows = _sorted.map((r, i) => {
      const fromName = r.from_name || '';
      const fromAddr = r.from || '';
      const toName = r.to_name || '';
      const toAddr = r.to || (r.client_id ? getClientById(r.client_id)?.addr || '' : '');
      const _loc = (name, addr) => {
        if (!name && !addr) return '';
        if (name && addr && name !== addr) return escHtml(name) + '<div style="font-size:12px;color:var(--text3);font-weight:400;margin-top:1px">' + escHtml(addr) + '</div>';
        return escHtml(name || addr);
      };
      const fromHtml = _loc(fromName, fromAddr) || '<span style="color:var(--text-3);font-style:italic">Start not recorded</span>';
      const toHtml = _loc(toName, toAddr) || '<span style="color:var(--text-3);font-style:italic">End not recorded</span>';
      const needsClass = r.purpose ? '' : ' needs';
      const tripNum = trips.length - i;
      return '<div class="mil-day-trip' + needsClass + '" data-lp-id="' + r.id + '" data-lp-type="mileage" data-lp-label="' + escHtml((r.from_name || r.from || 'Start') + ' → ' + (r.to_name || r.to || 'End') + ' · ' + (r.miles || 0).toFixed(1) + ' mi') + '">' + '<div class="mil-day-trip-route">' + '<div class="mil-route-spine"><div class="mil-route-pin-s"></div><div class="mil-route-spine-line"></div><div class="mil-route-pin-e"></div></div>' + '<div class="mil-route-addrs">' + '<div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Trip ' + tripNum + '</div>' + '<div class="mil-day-trip-from">' + fromHtml + '</div>' + '<div class="mil-day-trip-to">' + toHtml + '</div>' + (_hasMultiDriver && r.logged_by_name ? '<div style="font-size:10px;color:var(--text3);font-weight:500;margin-top:2px">Driver: ' + escHtml(r.logged_by_name) + '</div>' : '') + '</div>' + '</div>' + '<div class="mil-trip-side">' + (r.miles ? '<div class="mil-trip-mi">' + (+r.miles).toFixed(1) + ' mi</div>' : '') + '<button class="mil-trip-edit" onclick="openMileageEdit(' + r.id + ')">Edit</button>' + '</div>' + '</div>';
    }).join('');
    return '<div id="mil-day-' + date + '" class="mil-day' + openClass + reviewClass + '">' + '<button class="mil-day-hd" onclick="_milTogDay(\'' + date + '\')">' + '<div class="mil-day-l">' + '<div class="mil-day-date">' + '<div class="mil-day-dow">' + dow + '</div>' + '<div class="mil-day-num">' + d + '</div>' + '<div class="mil-day-month">' + monthShort + '</div>' + '</div>' + '<div>' + '<div class="mil-day-title">' + dateObj.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    }) + '</div>' + '<div class="mil-day-sub">' + trips.length + ' trip' + (trips.length !== 1 ? 's' : '') + ' · ' + dayMi.toFixed(1) + ' mi total' + (needsCount ? ' · <span style="color:#F59E0B;font-weight:800">' + needsCount + ' need' + (needsCount === 1 ? '' : 's') + ' a purpose</span>' : '') + '</div>' + '</div>' + '</div>' + '<div class="mil-day-r">' + '<div class="mil-day-stats">' + '<div class="mil-day-miles">' + dayMi.toFixed(1) + '<span style="font-size:11px;color:var(--text-3);font-weight:600"> mi</span></div>' + '<div class="mil-day-ded">+' + fmt(dayDed) + '</div>' + '</div>' + '<div class="mil-day-chev">▸</div>' + '</div>' + '</button>' + '<div class="mil-day-body"' + (!openClass ? ' style="display:none"' : '') + '>' + tripRows + '</div>' + '</div>';
  }).join('') + '</div>';
}
function _milTogDay(date) {
  const el = document.getElementById('mil-day-' + date);
  if (!el) return;
  const open = el.classList.toggle('open');
  const body = el.querySelector('.mil-day-body');
  if (body) body.style.display = open ? '' : 'none';
}
function _milRenderSummary(filtered, tot, irsRate) {
  const el = document.getElementById('mil-summary-wrap');
  if (!el || !filtered.length) {
    if (el) el.innerHTML = '';
    return;
  }
  const classified = filtered.filter(m => m.purpose);
  const avgTrip = classified.length ? tot / classified.length : 0;
  const byPurpose = {};
  classified.forEach(m => {
    const p = m.purpose || 'Other';
    byPurpose[p] = (byPurpose[p] || 0) + (m.miles || 0);
  });
  const topPurpose = Object.entries(byPurpose).sort((a, b) => b[1] - a[1])[0];
  const yr = String(trackerYear || new Date().getFullYear());
  const odoLog = (S.vehicleOdoLog || {})[yr] || {};
  const vehs = getVehicles();
  const pVeh = vehs[0] || null;
  const pKey = pVeh ? _vehKey(pVeh) : 'default';
  const odoRec = odoLog[pKey] || {};
  const totalDriven = (odoRec.end || 0) > (odoRec.start || 0) ? odoRec.end - odoRec.start : 0;
  const bizPct = totalDriven > 0 ? Math.min(100, Math.round(tot / totalDriven * 100)) : null;
  el.innerHTML = '<div class="mil-summary">' + '<div class="mil-summary-cell">' + '<div class="td-micro">Business-use %</div>' + '<div class="mil-summary-v" style="color:var(--c-green)">' + (bizPct !== null ? bizPct + '%' : '—') + '</div>' + '<div class="mil-summary-sub">' + tot.toFixed(1) + (totalDriven ? ' of ' + totalDriven.toLocaleString() : '') + ' mi</div>' + '</div>' + '<div class="mil-summary-cell">' + '<div class="td-micro">Avg trip length</div>' + '<div class="mil-summary-v">' + avgTrip.toFixed(1) + '<span style="font-size:12px;color:var(--text-3);font-weight:600"> mi</span></div>' + '<div class="mil-summary-sub">' + filtered.length + ' trips this period</div>' + '</div>' + '<div class="mil-summary-cell">' + '<div class="td-micro">Top purpose</div>' + '<div class="mil-summary-v" style="font-size:16px">' + (topPurpose ? escHtml(topPurpose[0]) : '—') + '</div>' + '<div class="mil-summary-sub">' + (topPurpose && tot > 0 ? Math.round(topPurpose[1] / tot * 100) + '% of business miles' : 'No categorized trips') + '</div>' + '</div>' + '<div class="mil-summary-cell">' + '<div class="td-micro">Audit-ready</div>' + '<div class="mil-summary-v" style="color:var(--c-green)">' + (filtered.every(m => m.purpose) ? '✓' : '⚠️') + '</div>' + '<div class="mil-summary-sub">' + (filtered.every(m => m.purpose) ? 'IRS Pub. 463 compliant' : filtered.filter(m => !m.purpose).length + ' trips need purpose') + '</div>' + '</div>' + '</div>';
}
function _togMileTrip(id) {
  const det = document.getElementById('mile-det-' + id);
  const chv = document.getElementById('mile-det-chv-' + id);
  if (!det) return;
  const open = det.style.display !== 'none';
  det.style.display = open ? 'none' : '';
  if (chv) chv.style.transform = open ? 'rotate(-90deg)' : 'rotate(0deg)';
}
function toggleMileAddr(id) {
  _togMileTrip(id);
} // legacy alias
function delMileage(id) {
  mileage = mileage.filter(x => x.id !== id);
  saveAll();
  _flushSaveNow();
  if (currentClientId) {
    const el = document.getElementById('cd-mile-list');
    if (el) renderCDMileage();
  }
  renderAllMileage();
}
function editMilePurpose(id, val) {
  const m = mileage.find(x => x.id === id);
  if (!m) return;
  m.purpose = val;
  saveAll();
  _flushSaveNow();
}
function openMileageEdit(id) {
  const r = mileage.find(x => x.id === id);
  if (!r) return;
  openLogTripModal({
    editId: id,
    fromAddress: r.from || '',
    toAddress: r.to || '',
    purpose: r.purpose || '',
    clientId: r.client_id,
    clientName: r.client_name || '',
    vehicle: r.vehicle || '',
    date: r.date || '',
    notes: r.notes || '',
    miles: r.miles || 0
  });
}
function updateLoggedTrip(id) {
  const r = mileage.find(x => x.id === id);
  if (!r) return;
  const to = (document.getElementById('lm-to')?.value || '').trim();
  if (!to) {
    zAlert('Enter a destination first.', {
      title: 'Destination needed'
    });
    return;
  }
  const purpose = document.getElementById('lm-purpose')?.value || '';
  if (!purpose) {
    const sel = document.getElementById('lm-trip-type-sel');
    if (sel) {
      sel.style.borderColor = '#A32D2D';
      sel.style.background = 'var(--red-lt)';
      sel.focus();
    }
    zAlert('Select a trip type.', {
      title: 'Required'
    });
    return;
  }
  r.date = document.getElementById('lm-date')?.value || r.date;
  r.vehicle = document.getElementById('lm-vehicle')?.value || '';
  r.from = (document.getElementById('lm-from')?.value || '').trim();
  r.to = to;
  r.purpose = purpose;
  r.notes = document.getElementById('lm-notes')?.value || '';
  const miles = parseFloat(document.getElementById('lm-miles-val')?.value) || 0;
  if (miles > 0) r.miles = miles;
  const cid = parseInt(document.getElementById('lm-client')?.value) || null;
  const c = cid ? getClientById(cid) : null;
  r.client_id = cid;
  if (c) r.client_name = c.name;
  saveAll();
  _flushSaveNow();
  closeTopModal();
  showToast('Trip updated', '✓');
  if (document.getElementById('mil-table')) renderAllMileage();
  if (document.getElementById('cd-mile-list') && currentClientId) renderCDMileage();
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "js/mileage.js", error: String((e && e.message) || e) }); }

// js/navigation.js
try { (() => {
function openMobileMore() {
  const ov = document.getElementById('mobile-more-ov');
  if (ov) ov.style.display = 'block';
}
function closeMobileMore() {
  const ov = document.getElementById('mobile-more-ov');
  if (ov) ov.style.display = 'none';
}
function mobileNavTo(pg) {
  closeMobileMore();
  goPg(pg);
}
function goPg(id) {
  // Redirect employees away from restricted pages
  if (_isEmployee && ['pg-leads', 'pg-taxes', 'pg-tracker', 'pg-team', 'pg-settings', 'pg-checklist'].includes(id)) id = 'pg-dash';
  // Preserve currentClientId across navigation — only clear on explicit new client selection
  if (id === 'pg-dash') window._fromDash = false;
  if (id !== 'pg-est') hideNotesFab();
  document.querySelectorAll('.pg').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nb').forEach(b => b.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  const nb = document.getElementById({
    'pg-leads': 'nb-leads',
    'pg-jobs': 'nb-jobs',
    'pg-money': 'nb-money',
    'pg-schedule': 'nb-jobs',
    'pg-clients': 'nb-clients',
    'pg-cal': 'nb-cal',
    'pg-tracker': 'nb-tracker',
    'pg-gallery': 'nb-gallery',
    'pg-team': 'nb-team',
    'pg-licensing': 'nb-licensing',
    'pg-taxes': 'nb-taxes',
    'pg-settings': 'nb-settings',
    'pg-checklist': 'nb-settings',
    'pg-client-detail': window._clientDetailOrigin === 'leads' ? 'nb-leads' : 'nb-clients'
  }[id] || 'nb-' + id.replace('pg-', ''));
  if (nb) nb.classList.add('active');
  // Sync mobile bottom tab bar
  const _mtbMap = {
    'pg-dash': 'mtb-dash',
    'pg-leads': 'mtb-leads',
    'pg-clients': 'mtb-clients',
    'pg-jobs': 'mtb-jobs',
    'pg-client-detail': window._clientDetailOrigin === 'leads' ? 'mtb-leads' : 'mtb-clients'
  };
  document.querySelectorAll('.mtb').forEach(b => b.classList.remove('active'));
  const _mtb = document.getElementById(_mtbMap[id] || '');
  if (_mtb) _mtb.classList.add('active');else {
    const _mm = document.getElementById('mtb-more');
    if (_mm) _mm.classList.add('active');
  }
  document.querySelectorAll('.mmi').forEach(b => b.classList.remove('active-pg'));
  const _mmiKey = {
    'pg-money': 'mmi-money',
    'pg-cal': 'mmi-cal',
    'pg-tracker': 'mmi-tracker',
    'pg-team': 'mmi-team',
    'pg-taxes': 'mmi-taxes',
    'pg-leads': 'mmi-leads',
    'pg-settings': 'mmi-settings',
    'pg-checklist': 'mmi-settings',
    'pg-schedule': 'mmi-cal',
    'pg-licensing': 'mmi-licensing'
  }[id];
  if (_mmiKey) {
    const _mi = document.getElementById(_mmiKey);
    if (_mi) _mi.classList.add('active-pg');
  }
  window.scrollTo({
    top: 0,
    left: 0,
    behavior: "instant"
  });
  document.body.scrollTop = 0;
  document.documentElement.scrollTop = 0;
  if (id === 'pg-dash') renderDash();
  if (id === 'pg-clients') {
    const CLIENT_FILTER_TABS = ['all', 'won', 'active', 'collect', 'closed'];
    const cf = CLIENT_FILTER_TABS.includes(clientFilter) ? clientFilter : 'all';
    setCF(cf, document.getElementById('cft-' + cf));
  }
  if (id === 'pg-cal') renderCalendar();
  if (id === 'pg-schedule') {
    populateSchedSelect();
    buildColorRow();
    const _jt = document.getElementById('sched-tab-job');
    if (_jt) _jt.style.display = '';
    try {
      setSchedType(schedType, document.getElementById(schedType === 'estimate' ? 'sched-tab-est' : 'sched-tab-job'));
    } catch (e) {}
    setTimeout(validateEstimateTime, 100);
  }
  if (id === 'pg-tracker') {
    renderTrackerTab();
    populateExpJobSel();
  }
  if (id === 'pg-taxes') calcTax();
  if (id === 'pg-settings') {
    buildScopeDefaultsUI();
    loadSettingsForm();
    renderVehicleSettings();
    updateLocationBtn();
    renderTeam();
    loadStripeConnectStatus();
    _renderSettingsTradeSections();
    _renderDevTradeCard();
    renderSettingsTrades();
    if (window._scrollToVehicles) {
      window._scrollToVehicles = false;
      setTimeout(() => {
        const el = document.getElementById('settings-vehicles-section');
        if (el) el.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
        const inp = document.getElementById('set-new-veh');
        if (inp) {
          inp.focus();
          inp.style.borderColor = 'var(--blue)';
          inp.style.boxShadow = '0 0 0 3px rgba(24,95,165,.2)';
          setTimeout(() => {
            inp.style.borderColor = '';
            inp.style.boxShadow = '';
          }, 2500);
        }
      }, 150);
    }
  }
  if (id === 'pg-team') renderTeam();
  if (id === 'pg-licensing') renderLicensing();
  if (id === 'pg-checklist') renderChecklist();
  if (id === 'pg-leads') renderLeadsPage();
  if (id === 'pg-jobs') renderJobsPage();
  if (id === 'pg-money') renderMoneyPage();
  if (id === 'pg-est') {
    buildScopeGrid();
    showNotesFab();
  }
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "js/navigation.js", error: String((e && e.message) || e) }); }

// js/settings.js
try { (() => {
// ── Settings index / detail panel navigation ────────────────────────────────

function _openSetDetail(key) {
  document.querySelectorAll('.set-detail').forEach(d => d.classList.remove('active'));
  const el = document.getElementById('setd-' + key);
  if (el) el.classList.add('active');
  const iv = document.getElementById('set-index-view');
  if (iv) iv.classList.add('hidden');
  window.scrollTo({
    top: 0,
    behavior: 'instant'
  });
  document.body.scrollTop = 0;
  document.documentElement.scrollTop = 0;
  _renderSetIndex();
  if (key === 'integrations') _renderIntegrations();
  if (key === 'branding') _renderBrandSwatches(S.brandColor || '#2D5DA8');
}
function _closeSetDetail() {
  document.querySelectorAll('.set-detail').forEach(d => d.classList.remove('active'));
  const iv = document.getElementById('set-index-view');
  if (iv) iv.classList.remove('hidden');
  window.scrollTo({
    top: 0,
    behavior: 'instant'
  });
  document.body.scrollTop = 0;
  document.documentElement.scrollTop = 0;
  _renderSetIndex();
}
function _renderSetIndex() {
  // Business info meta
  const bizMeta = document.getElementById('set-meta-biz');
  if (bizMeta) {
    const name = S.bname || getOwnerName() || '';
    const city = S.bcity || '';
    const state = S.state || '';
    const loc = [city, state].filter(Boolean).join(', ');
    bizMeta.innerHTML = name ? `<strong>${name}</strong>${loc ? '<br>' + loc : ''}` : '';
  }
  // Branding meta
  const brandMeta = document.getElementById('set-meta-branding');
  if (brandMeta) {
    const color = S.brandColor || '#2D5DA8';
    const colorName = _brandColorName(color);
    const hasLogo = !!S.logoData;
    brandMeta.innerHTML = `<strong style="color:${color}">●</strong> ${colorName}${hasLogo ? '<br>Logo set' : ''}`;
  }
  // Rates meta
  const ratesMeta = document.getElementById('set-meta-rates');
  if (ratesMeta) {
    const lr = S.laborRate || S.p1 || '';
    const dep = S.mm || '';
    ratesMeta.innerHTML = lr ? `<strong>$${lr}/hr</strong>${dep ? '<br>' + dep + '% deposit' : ''}` : '';
  }
  // Legal & terms meta
  const legalMeta = document.getElementById('set-meta-legal');
  if (legalMeta) legalMeta.innerHTML = '';
  // Taxes meta
  const taxMeta = document.getElementById('set-meta-taxes');
  if (taxMeta) {
    const state = S.state || '';
    const status = {
      single: 'Single',
      mfj: 'MFJ',
      mfs: 'MFS',
      hoh: 'HOH',
      qss: 'QSS'
    }[S.txStatus || 'single'] || '';
    taxMeta.innerHTML = state ? `<strong>${state}</strong>${status ? '<br>' + status : ''}` : '';
  }
  // Cloud sync meta
  const cloudMeta = document.getElementById('set-meta-cloud');
  if (cloudMeta) {
    const synced = typeof supaEnabled === 'function' && supaEnabled() && typeof _supaUser !== 'undefined' && _supaUser;
    cloudMeta.innerHTML = synced ? '<strong style="color:var(--green)">● Synced</strong>' : '<span style="color:var(--text3)">Not synced</span>';
  }
  // Notifications meta (count SMS templates that have content)
  const notifMeta = document.getElementById('set-meta-notifications');
  if (notifMeta) {
    const templates = [S.smsHub, S.smsFollowup, S.smsReminder, S.smsSecond, S.smsIntent].filter(Boolean).length;
    notifMeta.innerHTML = templates ? `<strong>${templates} of 5</strong><br>on` : '';
  }
  // Integrations meta (count connected services)
  const intMeta = document.getElementById('set-meta-integrations');
  if (intMeta) {
    const stripeOk = typeof _stripeConnectStatus !== 'undefined' && _stripeConnectStatus?.connected;
    const count = stripeOk ? 1 : 0;
    intMeta.innerHTML = count ? `<strong>Stripe</strong><br>connected` : '';
  }
  // Header meta
  const headerMeta = document.getElementById('set-index-meta');
  if (headerMeta) {
    const rawName = getOwnerName() || S.bname || '';
    const name = rawName && !rawName.includes('@') ? rawName : S.bname || '';
    headerMeta.textContent = name ? name + ' · TradeDesk Pro' : 'TradeDesk Pro';
  }
  // About version
  const verEl = document.getElementById('set-about-ver');
  if (verEl && typeof APP_VERSION !== 'undefined') verEl.textContent = APP_VERSION;
  const verSub = document.getElementById('set-about-version-sub');
  if (verSub && typeof APP_VERSION !== 'undefined') verSub.textContent = 'v' + APP_VERSION;
  // Dev row visibility
  const devRow = document.getElementById('set-idx-row-dev');
  if (devRow) devRow.style.display = _config?.is_dev ? 'flex' : 'none';
}
const _BRAND_SWATCHES = ['#2D5DA8', '#166534', '#92400e', '#991b1b', '#6d28d9', '#18181b'];
const _BRAND_SWATCH_NAMES = {
  '#2d5da8': 'Denim',
  '#166534': 'Forest',
  '#92400e': 'Amber',
  '#991b1b': 'Crimson',
  '#6d28d9': 'Violet',
  '#18181b': 'Charcoal'
};
function _brandColorName(hex) {
  return _BRAND_SWATCH_NAMES[(hex || '').toLowerCase()] || 'Custom';
}
function _renderBrandSwatches(selected) {
  const container = document.getElementById('set-brand-swatches');
  if (!container) return;
  const cur = (selected || document.getElementById('set-brandcolor')?.value || '#2D5DA8').toLowerCase();
  const isPreset = _BRAND_SWATCHES.some(c => c.toLowerCase() === cur);
  container.innerHTML = _BRAND_SWATCHES.map(c => {
    const active = c.toLowerCase() === cur;
    return `<button class="set-swatch${active ? ' active' : ''}" style="background:${c}" onclick="_pickedBrandColor('${c}')" title="${c}">${active ? '<span style="font-size:18px;color:#fff;line-height:1">✓</span>' : ''}</button>`;
  }).join('') + `<button class="set-swatch${!isPreset ? ' active' : ''}" style="background:${!isPreset ? cur : 'var(--bg2)'};border:2px dashed var(--border2)" onclick="document.getElementById('set-brandcolor').click()" title="Custom color"><span style="font-size:18px;${!isPreset ? 'color:#fff' : 'color:var(--text3)'};line-height:1">${!isPreset ? '✓' : '+'}</span></button>`;
  const selEl = document.getElementById('set-brand-selected');
  if (selEl) selEl.textContent = 'Selected · ' + (selected || '#2D5DA8').toUpperCase();
}
function _pickedBrandColor(hex) {
  const inp = document.getElementById('set-brandcolor');
  if (inp) inp.value = hex;
  _renderBrandSwatches(hex);
  _updateBootPreview();
}
function _checkSubdomain(val) {
  const el = document.getElementById('set-subdomain-status');
  if (!el) return;
  if (!val) {
    el.textContent = '';
    return;
  }
  if (/^[a-z0-9-]{3,30}$/.test(val)) {
    el.innerHTML = '<span style="color:var(--green)">✓ Available</span>';
  } else {
    el.innerHTML = '<span style="color:var(--text3)">Use lowercase letters, numbers, hyphens (3–30 chars)</span>';
  }
}
function _manageSubscription() {
  // Will trigger iOS in-app purchase sheet when native wrapper is added
  zAlert('Subscription management will be available in the TradeDesk iOS app.', {
    title: 'Manage plan'
  });
}
function _renderIntegrations() {
  const el = document.getElementById('integrations-list');
  if (!el) return;
  const stripeOk = typeof _stripeConnectStatus !== 'undefined' && _stripeConnectStatus?.connected && _stripeConnectStatus?.charges_enabled;
  const stripeAcct = _stripeConnectStatus?.stripe_account_id || '';
  const rows = [{
    icon: '<span style="font-size:16px;font-weight:900;color:#fff">$</span>',
    iconBg: '#635BFF',
    name: 'Stripe',
    badge: stripeOk ? 'ok' : 'off',
    badgeText: stripeOk ? 'Connected' : 'Not connected',
    desc: stripeOk ? `Card + ACH payments · ${stripeAcct ? stripeAcct.slice(0, 12) + '…' : ''}` : 'Accept card + ACH payments from clients',
    action: stripeOk ? 'Manage' : 'Connect',
    onclick: `_openStripeConnect()`
  }];
  el.innerHTML = rows.map(r => `
    <div class="set-int-row">
      <div class="set-int-icon" style="background:${r.iconBg}">${r.icon}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:800;color:var(--text)">${r.name}<span class="set-int-badge ${r.badge}">${r.badgeText}</span></div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.desc}</div>
      </div>
      <button class="btn btn-sm" onclick="${r.onclick}" style="flex-shrink:0;font-size:12px">${r.action}</button>
    </div>`).join('');
  // Show Stripe surcharge wrap when Stripe is connected
  const sw = document.getElementById('stripe-surcharge-wrap');
  if (sw) sw.style.display = stripeOk ? 'block' : 'none';
}
function _openStripeConnect() {
  const el = document.getElementById('stripe-connect-status-ui');
  if (el) {
    el.style.display = 'block';
    el.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest'
    });
  }
  if (typeof _renderStripeConnectUI === 'function') _renderStripeConnectUI();
}
function _filterSetRows(q) {
  const rows = document.querySelectorAll('#set-index-view .set-idx-row');
  const term = q.toLowerCase().trim();
  rows.forEach(r => {
    const text = (r.dataset.search || '') + ' ' + (r.textContent || '');
    r.style.display = !term || text.toLowerCase().includes(term) ? '' : 'none';
  });
}

// ── Licensing & Compliance ──────────────────────────────────────────────────

function _licDaysUntil(lic) {
  if (!lic.expiryDate) return null;
  return Math.ceil((new Date(lic.expiryDate + 'T12:00') - new Date()) / 86400000);
}
function _licStatus(lic) {
  if (lic.typeId === 'hepa_vacuum') return 'equipment';
  const d = _licDaysUntil(lic);
  if (d === null) return 'noexpiry';
  if (d < 0) return 'expired';
  if (d <= 30) return 'soon';
  return 'current';
}
function _licStatusBadge(lic) {
  const st = _licStatus(lic);
  const d = _licDaysUntil(lic);
  if (st === 'expired') return '<span style="display:inline-block;font-size:10px;font-weight:800;text-transform:uppercase;padding:2px 7px;border-radius:10px;background:#fef2f2;color:#991b1b;border:1px solid #fecaca">Expired</span>';
  if (st === 'soon') return '<span style="display:inline-block;font-size:10px;font-weight:800;text-transform:uppercase;padding:2px 7px;border-radius:10px;background:#fffbeb;color:#92400e;border:1px solid #fde68a">' + d + 'd left</span>';
  if (st === 'current') return '<span style="display:inline-block;font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0">Current</span>';
  if (st === 'noexpiry') return '<span style="display:inline-block;font-size:10px;color:var(--text3);padding:2px 7px">No expiry set</span>';
  return '';
}
let _licFilter = 'all';
function renderLicensing() {
  const body = document.getElementById('lic-page-body');
  if (!body) return;
  const expired = licenses.filter(l => _licStatus(l) === 'expired').length;
  const soon = licenses.filter(l => _licStatus(l) === 'soon').length;
  let html = '';
  // Summary bar
  if (expired || soon) {
    html += '<div style="background:' + (expired ? '#fef2f2' : '#fffbeb') + ';border:1px solid ' + (expired ? '#fecaca' : '#fde68a') + ';border-radius:var(--r);padding:10px 14px;margin:10px 0 14px;font-size:13px;font-weight:700;color:' + (expired ? '#991b1b' : '#92400e') + '">' + (expired ? '⚠️ ' + expired + ' expired' : '') + (expired && soon ? ' · ' : '') + (soon ? '🟡 ' + soon + ' expiring within 30 days' : '') + '</div>';
  }
  // Filter tabs
  const cats = ['all', ...LIC_CAT_ORDER.filter(c => licenses.some(l => l.cat === c))];
  if (cats.length > 1) {
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">';
    cats.forEach(c => {
      const active = _licFilter === c;
      html += '<button onclick="setLicFilter(\'' + c + '\')" style="padding:5px 12px;border-radius:20px;border:1px solid ' + (active ? 'var(--blue)' : 'var(--border)') + ';background:' + (active ? 'var(--blue)' : 'var(--bg)') + ';color:' + (active ? '#fff' : 'var(--text)') + ';font-size:12px;font-weight:600;font-family:inherit;cursor:pointer">' + (c === 'all' ? 'All' : LIC_CAT_LABELS[c]) + '</button>';
    });
    html += '</div>';
  }
  if (!licenses.length) {
    html += '<div style="text-align:center;padding:40px 20px;color:var(--text3)"><div style="font-size:40px;margin-bottom:12px">📋</div><div style="font-size:15px;font-weight:700;margin-bottom:6px">No records yet</div><div style="font-size:13px">Add your business licenses, insurance policies, EPA certifications, and more.</div><button onclick="openAddLicense()" class="btn btn-p" style="margin-top:16px">+ Add first record</button></div>';
    body.innerHTML = html;
    return;
  }
  // Group by category
  const visLics = _licFilter === 'all' ? licenses : licenses.filter(l => l.cat === _licFilter);
  const byCat = {};
  visLics.forEach(l => {
    if (!byCat[l.cat]) byCat[l.cat] = [];
    byCat[l.cat].push(l);
  });
  LIC_CAT_ORDER.forEach(cat => {
    if (!byCat[cat]) return;
    html += '<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);margin:16px 0 8px">' + LIC_CAT_LABELS[cat] + '</div>';
    byCat[cat].forEach(l => {
      const st = _licStatus(l);
      const t = LIC_TYPES.find(x => x.id === l.typeId) || {};
      const borderColor = st === 'expired' ? '#fecaca' : st === 'soon' ? '#fde68a' : 'var(--border)';
      const isEquip = t.isEquip;
      const logCount = (l.equipmentLog || []).length;
      const lastLog = logCount ? l.equipmentLog[logCount - 1] : '';
      html += '<div style="background:var(--bg2);border:1px solid ' + borderColor + ';border-radius:var(--r);padding:14px;margin-bottom:10px">';
      html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px">';
      html += '<div style="font-size:14px;font-weight:700;color:var(--text);line-height:1.3">' + escHtml(l.label || t.label || 'Record') + '</div>';
      html += _licStatusBadge(l);
      html += '</div>';
      if (l.holderName) html += '<div style="font-size:12px;color:var(--text3);margin-bottom:4px">👤 ' + escHtml(l.holderName) + '</div>';
      if (l.licenseNumber) html += '<div style="font-size:12px;color:var(--text3);margin-bottom:4px">🔢 ' + escHtml(l.licenseNumber) + '</div>';
      if (isEquip) {
        if (l.make || l.model || l.serial) html += '<div style="font-size:12px;color:var(--text3);margin-bottom:4px">' + [l.make, l.model, l.serial ? 'SN: ' + l.serial : ''].filter(Boolean).join(' · ') + '</div>';
        if (lastLog) html += '<div style="font-size:12px;color:var(--text3);margin-bottom:8px">Last entry: ' + fmtDateShort(lastLog.date) + ' — ' + escHtml(lastLog.type) + '</div>';
        html += '<div style="display:flex;gap:8px;margin-top:8px"><button onclick="openHepaLog(' + l.id + ')" class="btn btn-sm" style="font-size:11px">📋 Log (' + logCount + ')</button><button onclick="openEditLicense(' + l.id + ')" class="btn btn-sm" style="font-size:11px">Edit</button><button onclick="deleteLicense(' + l.id + ')" class="btn btn-sm" style="font-size:11px;color:var(--text3)">Delete</button></div>';
      } else {
        if (l.issueDate || l.expiryDate) {
          html += '<div style="font-size:12px;color:var(--text3);margin-bottom:4px">';
          if (l.issueDate) html += 'Issued: ' + fmtDateShort(l.issueDate);
          if (l.issueDate && l.expiryDate) html += ' · ';
          if (l.expiryDate) html += 'Expires: ' + fmtDateShort(l.expiryDate);
          html += '</div>';
        }
        if (l.notes) html += '<div style="font-size:11px;color:var(--text3);margin-top:4px">' + escHtml(l.notes) + '</div>';
        html += '<div style="display:flex;gap:8px;margin-top:10px"><button onclick="openEditLicense(' + l.id + ')" class="btn btn-sm" style="font-size:11px">Edit</button><button onclick="deleteLicense(' + l.id + ')" class="btn btn-sm" style="font-size:11px;color:var(--text3)">Delete</button></div>';
      }
      html += '</div>';
    });
  });
  body.innerHTML = html;
}
function setLicFilter(cat) {
  _licFilter = cat;
  renderLicensing();
}
function _licDateDisp(iso) {
  if (!iso) return '';
  try {
    const [y, m, d] = iso.split('-');
    return m + '/' + d + '/' + y;
  } catch (e) {
    return iso;
  }
}
function _licDateParse(s) {
  if (!s || !s.trim()) return '';
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m1 = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m1) return m1[3] + '-' + m1[1].padStart(2, '0') + '-' + m1[2].padStart(2, '0');
  const m2 = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (m2) return (parseInt(m2[3]) > 50 ? '19' : '20') + m2[3] + '-' + m2[1].padStart(2, '0') + '-' + m2[2].padStart(2, '0');
  return '';
}
let _editingLicId = null;
function openAddLicense() {
  _editingLicId = null;
  _showLicModal(null);
}
function openEditLicense(id) {
  _editingLicId = id;
  _showLicModal(licenses.find(l => l.id === id));
}
function _showLicModal(lic) {
  document.getElementById('_lic-modal-ov')?.remove();
  const ov = document.createElement('div');
  ov.className = 'zmodal-overlay';
  ov.id = '_lic-modal-ov';
  const isEquip = lic ? LIC_TYPES.find(x => x.id === lic?.typeId)?.isEquip : false;
  // Build type options grouped by category
  let typeOpts = '<option value="">— Select type —</option>';
  LIC_CAT_ORDER.forEach(cat => {
    const items = LIC_TYPES.filter(t => t.cat === cat);
    typeOpts += '<optgroup label="' + LIC_CAT_LABELS[cat] + '">';
    items.forEach(t => {
      typeOpts += '<option value="' + t.id + '"' + (lic?.typeId === t.id ? ' selected' : '') + '>' + t.label + '</option>';
    });
    typeOpts += '</optgroup>';
  });
  // Employee options
  let empOpts = '<option value="">Company / Firm</option>';
  (S.employees || []).forEach(e => {
    empOpts += '<option value="' + escHtml(e.name || '') + '"' + (lic?.holderId === e.id ? ' selected' : '') + '>' + escHtml(e.name || '') + '</option>';
  });
  const box = document.createElement('div');
  box.className = 'zmodal';
  box.innerHTML = '<div style="font-size:17px;font-weight:800;margin-bottom:16px">' + (lic ? 'Edit Record' : 'Add Record') + '</div>' + '<div class="f"><label>Type</label><select id="_lic-type-sel" onchange="_licTypeChanged(this)">' + typeOpts + '</select></div>' + '<div class="f" id="_lic-holder-wrap"><label>Assigned to</label><select id="_lic-holder-sel">' + empOpts + '</select></div>' + '<div class="f" id="_lic-num-wrap"><label>Certificate / License #</label><input id="_lic-num" value="' + escHtml(lic?.licenseNumber || '') + '" placeholder="e.g. R-12345"></div>' + '<div id="_lic-equip-fields" style="display:' + (isEquip ? 'block' : 'none') + '">' + '<div class="f"><label>Make / Brand</label><input id="_lic-make" value="' + escHtml(lic?.make || '') + '" placeholder="e.g. Ridgid"></div>' + '<div class="f"><label>Model</label><input id="_lic-model" value="' + escHtml(lic?.model || '') + '" placeholder="e.g. WD4870"></div>' + '<div class="f"><label>Serial Number</label><input id="_lic-serial" value="' + escHtml(lic?.serial || '') + '" placeholder="Optional"></div>' + '</div>' + '<div id="_lic-date-fields" style="display:' + (isEquip ? 'none' : 'block') + '">' + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' + '<div class="f"><label>Issue date</label><input type="text" id="_lic-issue" placeholder="MM/DD/YYYY" maxlength="10" oninput="_fmtExpDate(this)" value="' + _ymdToMdY(lic?.issueDate || '') + '"></div>' + '<div class="f"><label>Expiry date</label><input type="text" id="_lic-expiry" placeholder="MM/DD/YYYY" maxlength="10" oninput="_fmtExpDate(this)" value="' + _ymdToMdY(lic?.expiryDate || '') + '"></div>' + '</div>' + '</div>' + '<div class="f"><label>Notes</label><input id="_lic-notes" value="' + escHtml(lic?.notes || '') + '" placeholder="Optional"></div>' + '<button class="btn btn-p btn-full" style="margin-top:6px" onclick="saveLicenseModal()">Save</button>' + '<button class="btn btn-sec btn-full" style="margin-top:8px" onclick="document.getElementById(\'_lic-modal-ov\').remove()">Cancel</button>';
  ov.appendChild(box);
  document.body.appendChild(ov);
  // Set holder visibility
  const selEl = document.getElementById('_lic-type-sel');
  if (selEl && lic) _licTypeChanged(selEl);
}
function _licTypeChanged(sel) {
  const t = LIC_TYPES.find(x => x.id === sel.value);
  if (!t) return;
  const holderWrap = document.getElementById('_lic-holder-wrap');
  const numWrap = document.getElementById('_lic-num-wrap');
  const equipFields = document.getElementById('_lic-equip-fields');
  const dateFields = document.getElementById('_lic-date-fields');
  if (holderWrap) holderWrap.style.display = t.holder === 'employee' ? 'block' : 'none';
  if (numWrap) numWrap.style.display = t.noNum || t.isEquip ? 'none' : 'block';
  if (equipFields) equipFields.style.display = t.isEquip ? 'block' : 'none';
  if (dateFields) dateFields.style.display = t.isEquip ? 'none' : 'block';
}
function saveLicenseModal() {
  const typeId = document.getElementById('_lic-type-sel')?.value;
  if (!typeId) {
    zAlert('Select a record type.');
    return;
  }
  const t = LIC_TYPES.find(x => x.id === typeId);
  const holderRaw = document.getElementById('_lic-holder-sel')?.value || '';
  const holderName = holderRaw || S.bname || getBusinessName() || 'Company';
  const _issueRaw = _licDateParse(document.getElementById('_lic-issue')?.value || '');
  const _expiryRaw = _licDateParse(document.getElementById('_lic-expiry')?.value || '');
  if (_issueRaw && document.getElementById('_lic-issue')?.value && !_issueRaw) {
    zAlert('Issue date format not recognized. Use MM/DD/YYYY.');
    return;
  }
  if (_expiryRaw && document.getElementById('_lic-expiry')?.value && !_expiryRaw) {
    zAlert('Expiry date format not recognized. Use MM/DD/YYYY.');
    return;
  }
  if (_issueRaw && _expiryRaw && _issueRaw >= _expiryRaw) {
    zAlert('Issue date must be before expiry date.', {
      title: 'Invalid dates'
    });
    return;
  }
  const _recCat = t ? t.cat || 'business' : 'business';
  const _recLabel = t ? t.label || typeId : typeId;
  const _recHolder = t ? t.holder || '' : '';
  const _recHolderName = _recHolder === 'employee' ? holderName : S.bname || getBusinessName() || 'Company';
  const _recNumEl = document.getElementById('_lic-num');
  const _recIssueEl = document.getElementById('_lic-issue');
  const _recExpiryEl = document.getElementById('_lic-expiry');
  const _recNotesEl = document.getElementById('_lic-notes');
  const _recMakeEl = document.getElementById('_lic-make');
  const _recModelEl = document.getElementById('_lic-model');
  const _recSerialEl = document.getElementById('_lic-serial');
  const _recExistingLic = _editingLicId ? licenses.find(l => l.id === _editingLicId) : null;
  const rec = {
    id: _editingLicId || Date.now() * 1000 + Math.floor(Math.random() * 999),
    typeId,
    cat: _recCat,
    label: _recLabel,
    holderName: _recHolderName,
    holderId: null,
    licenseNumber: (_recNumEl ? _recNumEl.value || '' : '').trim(),
    issueDate: _mdYToYmd(_recIssueEl ? _recIssueEl.value || '' : ''),
    expiryDate: _mdYToYmd(_recExpiryEl ? _recExpiryEl.value || '' : ''),
    notes: (_recNotesEl ? _recNotesEl.value || '' : '').trim(),
    make: (_recMakeEl ? _recMakeEl.value || '' : '').trim(),
    model: (_recModelEl ? _recModelEl.value || '' : '').trim(),
    serial: (_recSerialEl ? _recSerialEl.value || '' : '').trim(),
    equipmentLog: _editingLicId ? _recExistingLic ? _recExistingLic.equipmentLog || [] : [] : []
  };
  if (_editingLicId) {
    const idx = licenses.findIndex(l => l.id === _editingLicId);
    if (idx > -1) licenses[idx] = rec;else licenses.push(rec);
  } else {
    licenses.push(rec);
  }
  saveAll();
  document.getElementById('_lic-modal-ov')?.remove();
  renderLicensing();
}
function deleteLicense(id) {
  zConfirm('Delete this record?', () => {
    licenses = licenses.filter(l => l.id !== id);
    saveAll();
    renderLicensing();
  }, {
    title: 'Delete record',
    yes: 'Delete',
    danger: true
  });
}

// ── HEPA Equipment Log ──
function openHepaLog(id) {
  const lic = licenses.find(l => l.id === id);
  if (!lic) return;
  document.getElementById('_hepa-modal-ov')?.remove();
  const ov = document.createElement('div');
  ov.className = 'zmodal-overlay';
  ov.id = '_hepa-modal-ov';
  const box = document.createElement('div');
  box.className = 'zmodal';
  function renderLog() {
    const entries = (lic.equipmentLog || []).slice().reverse();
    return entries.length ? entries.map(e => '<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:9px 0;border-bottom:1px solid var(--border)">' + '<div><div style="font-size:13px;font-weight:700">' + escHtml(e.type) + '</div>' + (e.who ? '<div style="font-size:11px;color:var(--text3)">' + escHtml(e.who) + '</div>' : '') + (e.notes ? '<div style="font-size:11px;color:var(--text3)">' + escHtml(e.notes) + '</div>' : '') + '</div>' + '<div style="text-align:right;flex-shrink:0;margin-left:10px">' + '<div style="font-size:12px;color:var(--text3)">' + fmtDateShort(e.date) + '</div>' + '<button onclick="_delHepaEntry(' + id + ',\'' + e.id + '\')" style="background:none;border:none;color:var(--text3);font-size:11px;cursor:pointer;padding:2px 0;font-family:inherit">Remove</button>' + '</div></div>').join('') : '<div style="text-align:center;padding:20px;color:var(--text3);font-size:13px">No log entries yet</div>';
  }
  const name = [lic.make, lic.model].filter(Boolean).join(' ') || 'HEPA Vacuum';
  box.innerHTML = '<div style="font-size:17px;font-weight:800;margin-bottom:4px">' + escHtml(name) + '</div>' + (lic.serial ? '<div style="font-size:12px;color:var(--text3);margin-bottom:14px">SN: ' + escHtml(lic.serial) + '</div>' : '') + '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:8px">Maintenance Log</div>' + '<div id="_hepa-log-entries">' + renderLog() + '</div>' + '<div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border)">' + '<div style="font-size:12px;font-weight:700;margin-bottom:8px">Add entry</div>' + '<select id="_hepa-type-sel" style="width:100%;margin-bottom:8px;padding:8px;border:1px solid var(--border);border-radius:var(--r);background:var(--bg);color:var(--text);font-family:inherit;font-size:13px">' + '<option>Filter Change</option><option>Pre-Job Inspection</option><option>Post-Job Cleaning</option><option>Annual Maintenance</option><option>Filter Disposal (lead debris)</option><option>Repair</option>' + '</select>' + '<input id="_hepa-who" placeholder="Who (optional)" style="width:100%;margin-bottom:8px;padding:8px;border:1px solid var(--border);border-radius:var(--r);background:var(--bg);color:var(--text);font-family:inherit;font-size:13px;box-sizing:border-box">' + '<input id="_hepa-notes" placeholder="Notes (optional)" style="width:100%;margin-bottom:10px;padding:8px;border:1px solid var(--border);border-radius:var(--r);background:var(--bg);color:var(--text);font-family:inherit;font-size:13px;box-sizing:border-box">' + '<input id="_hepa-date" placeholder="MM/DD/YYYY" value="' + _licDateDisp(todayKey()) + '" style="width:100%;margin-bottom:10px;padding:8px;border:1px solid var(--border);border-radius:var(--r);background:var(--bg);color:var(--text);font-family:inherit;font-size:13px;box-sizing:border-box">' + '<button class="btn btn-p btn-full" onclick="_addHepaEntry(' + id + ')">+ Add Entry</button>' + '</div>' + '<button class="btn btn-sec btn-full" style="margin-top:10px" onclick="document.getElementById(\'_hepa-modal-ov\').remove()">Close</button>';
  ov.appendChild(box);
  document.body.appendChild(ov);
}
function _addHepaEntry(licId) {
  const lic = licenses.find(l => l.id === licId);
  if (!lic) return;
  if (!lic.equipmentLog) lic.equipmentLog = [];
  const _hepaDateEl = document.getElementById('_hepa-date');
  const _hepaTypeEl = document.getElementById('_hepa-type-sel');
  const _hepaWhoEl = document.getElementById('_hepa-who');
  const _hepaNotesEl2 = document.getElementById('_hepa-notes');
  const _hepaDateVal = _hepaDateEl ? _hepaDateEl.value || '' : '';
  const _hepaTypeVal = _hepaTypeEl ? _hepaTypeEl.value || 'Filter Change' : 'Filter Change';
  const _hepaWhoVal = (_hepaWhoEl ? _hepaWhoEl.value || '' : '').trim();
  const _hepaNotesVal2 = (_hepaNotesEl2 ? _hepaNotesEl2.value || '' : '').trim();
  lic.equipmentLog.push({
    id: Date.now().toString(36),
    date: _licDateParse(_hepaDateVal) || todayKey(),
    type: _hepaTypeVal,
    who: _hepaWhoVal,
    notes: _hepaNotesVal2
  });
  saveAll();
  // Refresh just the log entries in the modal
  const el = document.getElementById('_hepa-log-entries');
  const entries = (lic.equipmentLog || []).slice().reverse();
  if (el) el.innerHTML = entries.map(e => '<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:9px 0;border-bottom:1px solid var(--border)">' + '<div><div style="font-size:13px;font-weight:700">' + escHtml(e.type) + '</div>' + (e.who ? '<div style="font-size:11px;color:var(--text3)">' + escHtml(e.who) + '</div>' : '') + (e.notes ? '<div style="font-size:11px;color:var(--text3)">' + escHtml(e.notes) + '</div>' : '') + '</div><div style="text-align:right;flex-shrink:0;margin-left:10px">' + '<div style="font-size:12px;color:var(--text3)">' + fmtDateShort(e.date) + '</div>' + '<button onclick="_delHepaEntry(' + licId + ',\'' + e.id + '\')" style="background:none;border:none;color:var(--text3);font-size:11px;cursor:pointer;padding:2px 0;font-family:inherit">Remove</button>' + '</div></div>').join('');
  const who = document.getElementById('_hepa-who');
  const notes = document.getElementById('_hepa-notes');
  if (who) who.value = '';
  if (notes) notes.value = '';
  renderLicensing();
}
function _delHepaEntry(licId, entryId) {
  const lic = licenses.find(l => l.id === licId);
  if (!lic) return;
  lic.equipmentLog = (lic.equipmentLog || []).filter(e => e.id !== entryId);
  saveAll();
  openHepaLog(licId);
}

// ── Expiry alerts in dashboard (call from renderDash or renderTodayFeed) ──
function getLicenseAlerts() {
  return licenses.filter(l => {
    const st = _licStatus(l);
    return st === 'expired' || st === 'soon';
  });
}

// Returns the actual working calendar dates for a job, skipping weekends (unless job.allowWeekend)
function getJobWorkDays(job) {
  const allowWknd = !!job.allowWeekend;
  const numDays = parseInt(job.days) || 1;
  const days = [];
  let cur = job.start;
  let count = 0;
  while (count < numDays) {
    const dow = parseD(cur).getDay();
    if (allowWknd || dow !== 0 && dow !== 6) {
      days.push(cur);
      count++;
    }
    if (count < numDays) cur = addDays(cur, 1);
  }
  return days;
}
function getTimeOffDays() {
  const days = new Set();
  (S.timeOff || []).forEach(block => {
    let cur = block.start;
    while (cur <= block.end) {
      days.add(cur);
      cur = addDays(cur, 1);
    }
  });
  return days;
}
function addTimeOff(start, end, label) {
  if (!S.timeOff) S.timeOff = [];
  S.timeOff.push({
    start,
    end,
    label: label || ''
  });
  S.timeOff.sort((a, b) => a.start.localeCompare(b.start));
  saveSettings();
  refreshAvail();
  renderCalendar && renderCalendar();
}
function removeTimeOff(idx) {
  if (!S.timeOff) return;
  S.timeOff.splice(idx, 1);
  saveSettings();
  refreshAvail();
  renderCalendar && renderCalendar();
}
function openTimeOffModal() {
  const existing = document.getElementById('timeoff-modal-overlay');
  if (existing) {
    existing.remove();
    return;
  }
  const ov = document.createElement('div');
  ov.id = 'timeoff-modal-overlay';
  ov.className = 'zmodal-overlay';
  const box = document.createElement('div');
  box.className = 'zmodal';
  const render = () => {
    const blocks = S.timeOff || [];
    box.innerHTML = '<div style="font-size:17px;font-weight:800;margin-bottom:4px">🏖 Time off</div>' + '<div style="font-size:12px;color:var(--text3);margin-bottom:14px">Block dates from scheduling</div>' + (blocks.length ? '<div style="margin-bottom:12px">' + blocks.map((b, i) => '<div style="display:flex;justify-content:space-between;align-items:center;background:var(--amber-lt);border:1px solid #D97706;border-radius:var(--r);padding:8px 10px;margin-bottom:6px">' + '<div>' + '<div style="font-size:12px;font-weight:700;color:#92400E">' + (b.label || 'Time off') + '</div>' + '<div style="font-size:11px;color:var(--text3)">' + b.start + (b.start !== b.end ? ' → ' + b.end : '') + '</div>' + '</div>' + '<button onclick="removeTimeOff(' + i + ');document.getElementById(\'timeoff-modal-overlay\').remove();openTimeOffModal()" style="border:none;background:#A32D2D;color:#fff;border-radius:6px;padding:4px 8px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit">Remove</button>' + '</div>').join('') + '</div>' : '<div style="font-size:12px;color:var(--text3);margin-bottom:12px;text-align:center;padding:10px">No time off blocked</div>') + '<div style="background:var(--bg2);border-radius:var(--r);padding:12px;border:1px solid var(--border);margin-bottom:12px">' + '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:8px">Add block</div>' + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">' + '<div><label style="font-size:12px;font-weight:700;color:var(--text2);display:block;margin-bottom:4px">Start</label><input type="date" id="to-start" style="width:100%;padding:13px 10px;border-radius:var(--r);border:1.5px solid var(--border2);background:var(--bg2);font-size:16px;font-family:inherit;box-sizing:border-box;color:var(--text)"></div>' + '<div><label style="font-size:12px;font-weight:700;color:var(--text2);display:block;margin-bottom:4px">End</label><input type="date" id="to-end" style="width:100%;padding:13px 10px;border-radius:var(--r);border:1.5px solid var(--border2);background:var(--bg2);font-size:16px;font-family:inherit;box-sizing:border-box;color:var(--text)"></div>' + '</div>' + '<input type="text" id="to-label" placeholder="Label (optional — Vacation, Holiday...)" style="width:100%;padding:8px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg);font-size:13px;font-family:inherit;margin-bottom:8px;box-sizing:border-box">' + '<button onclick="_toAdd()" style="width:100%;padding:10px;border-radius:var(--r);border:none;background:var(--blue);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">+ Add time off</button>' + '</div>' + '<button onclick="document.getElementById(\'timeoff-modal-overlay\').remove()" style="width:100%;padding:10px;border-radius:var(--r);border:1px solid var(--border2);background:none;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;color:var(--text3)">Close</button>';
    window._toAdd = () => {
      const s = document.getElementById('to-start')?.value;
      const e = document.getElementById('to-end')?.value || s;
      if (!s) {
        zAlert('Pick a start date.');
        return;
      }
      if (e < s) {
        zAlert('End date must be on or after start date.');
        return;
      }
      addTimeOff(s, e, document.getElementById('to-label')?.value || '');
      document.getElementById('timeoff-modal-overlay').remove();
      openTimeOffModal();
    };
  };
  render();
  ov.appendChild(box);
  document.body.appendChild(ov);
  ov.addEventListener('click', e => {
    if (e.target === ov) ov.remove();
  });
}
function getBookedDays() {
  const booked = new Set(),
    buf = new Set();
  // Include time-off blocks as booked
  getTimeOffDays().forEach(d => booked.add(d));
  jobs.forEach(j => {
    // Estimates never block a day — Zach can book multiple estimates on the same day
    // at different times (morning, afternoon, evening). Only paint jobs block days.
    if (j.eventType === 'estimate') return;
    const workDays = getJobWorkDays(j);
    workDays.forEach(d => booked.add(d));
    const lastDay = workDays.length ? workDays[workDays.length - 1] : j.start;
    const b = parseInt(j.buffer) || 0;
    for (let i = 1; i <= b; i++) buf.add(addDays(lastDay, i));
  });
  return {
    booked,
    buf
  };
}
function getNextAvail() {
  const {
    booked,
    buf
  } = getBookedDays();
  const all = new Set([...booked, ...buf]);
  const allowWknd = document.getElementById('s-allow-weekend')?.checked || false;
  let d = todayKey();
  for (let i = 0; i < 180; i++) {
    const dow = parseD(d).getDay();
    const isWknd = dow === 0 || dow === 6;
    if (!all.has(d) && (allowWknd || !isWknd)) {
      const dt = parseD(d);
      return {
        key: d,
        label: dt.toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric'
        })
      };
    }
    d = addDays(d, 1);
  }
  return {
    key: todayKey(),
    label: 'Check calendar'
  };
}
// Standalone next-avail that doesn't need DOM — used for scheduling suggestions
function getNextAvailForBid(bid) {
  const {
    booked,
    buf
  } = getBookedDays();
  const all = new Set([...booked, ...buf]);
  const allowWknd = !!(bid && bid.allowWeekend);
  // Start from tomorrow at earliest
  let d = addDays(todayKey(), 1);
  for (let i = 0; i < 180; i++) {
    const dow = parseD(d).getDay();
    const isWknd = dow === 0 || dow === 6;
    if (!all.has(d) && (allowWknd || !isWknd)) return d;
    d = addDays(d, 1);
  }
  return addDays(todayKey(), 1);
}
function _jobEndDate(startKey, numDays, allowWknd) {
  let count = 0,
    cur = startKey;
  while (count < numDays) {
    const dow = parseD(cur).getDay();
    if (allowWknd || dow !== 0 && dow !== 6) count++;
    if (count < numDays) cur = addDays(cur, 1);
  }
  return cur;
}
function buildScopeDefaultsUI() {
  const el = document.getElementById('set-scope-defaults');
  if (!el) return;
  const defaults = S.defaultScope || {};
  el.innerHTML = SCOPE_ITEMS.map(s => '<label style="display:flex;align-items:center;gap:8px;font-size:13px;padding:6px;background:var(--bg2);border-radius:var(--r);cursor:pointer">' + '<input type="checkbox" id="ssd-' + s.id + '"' + (defaults[s.id] ? ' checked' : '') + ' onchange="saveScopeDefault(\'' + s.id + '\',this.checked)" style="width:16px;height:16px;cursor:pointer">' + s.label + '</label>').join('');
}
function saveScopeDefault(id, checked) {
  if (!S.defaultScope) S.defaultScope = {};
  S.defaultScope[id] = checked;
  saveSettings();
}
function applyDefaultScope() {
  const defaults = S.defaultScope || {};
  SCOPE_ITEMS.forEach(s => {
    scopeActiveMap[s.id] = !!defaults[s.id];
  });
  buildScopeGrid();
  checkStep2Ready();
}
function _getSmsDefaults() {
  return {
    hub: `Hi {name}, here's your project hub from {business}: {url}`,
    followup: `Hey {name}!\n\nJust following up — your proposal is still ready to go. Tap the link below to review and sign:\n\n{url}\n\nAny questions, just reply!\n\n— {business}`,
    reminder: `Hi {name}, this is {business}. Just a friendly reminder that a balance of {amount} is outstanding for the work at {address}. Please let us know when you're ready to take care of this. Thank you!`,
    second: `Hi {name}, this is a second notice from {business}. A balance of {amount} remains outstanding for work completed at {address}. Please respond within 5 business days to arrange payment and avoid further collection steps.`,
    intent: `{name}, this is formal written notice from {business} of our intent to file a Mechanic's Lien against the property at {address} for unpaid services totaling {amount}. You have 7 days to remit full payment before we proceed with filing. Please contact us immediately.`
  };
}
function _smsApply(template, vars) {
  return template.replace(/\{name\}/g, vars.name || '').replace(/\{business\}/g, vars.business || '').replace(/\{url\}/g, vars.url || '').replace(/\{amount\}/g, vars.amount || '').replace(/\{address\}/g, vars.address || '');
}
function _resetSmsTemplate(id) {
  const defaults = _getSmsDefaults();
  const map = {
    'set-sms-hub': 'hub',
    'set-sms-followup': 'followup',
    'set-sms-reminder': 'reminder',
    'set-sms-second': 'second',
    'set-sms-intent': 'intent'
  };
  const el = document.getElementById(id);
  if (el && map[id]) el.value = defaults[map[id]];
}
function applySettings() {
  FED_BRACKETS.single = [[S.b10, .10], [S.b12, .12], [S.b22, .22], [S.b24, .24], [S.b32, .32], [S.b35, .35], [Infinity, .37]];
  FED_BRACKETS.mfj = [[S.b10 * 2, .10], [S.b12 * 2, .12], [S.b22 * 2, .22], [S.b24 * 2, .24], [S.b32 * 2, .32], [S.b35 * 2, .35], [Infinity, .37]];
  FED_BRACKETS.mfs = [[S.b10, .10], [S.b12, .12], [S.b22, .22], [S.b24, .24], [S.b32, .32], [S.b35 * .6, .35], [Infinity, .37]];
  FED_BRACKETS.hoh = [[16550, .10], [63100, .12], [S.b22, .22], [S.b24, .24], [S.b32, .32], [S.b35, .35], [Infinity, .37]];
  FED_BRACKETS.qss = FED_BRACKETS.mfj;
  STD_DED = {
    single: S.fedSingle || 15000,
    mfj: S.fedMFJ || 30000,
    mfs: S.fedMFS || 15000,
    hoh: S.fedHOH || 22500,
    qss: S.fedMFJ || 30000
  };
  const _sd = _getActiveStateData();
  KS_BRACKETS.single = _buildStateBrackets(_sd, 'single');
  KS_BRACKETS.mfj = _buildStateBrackets(_sd, 'mfj');
  KS_BRACKETS.mfs = _buildStateBrackets(_sd, 'mfs');
  KS_BRACKETS.hoh = _buildStateBrackets(_sd, 'hoh');
  KS_BRACKETS.qss = KS_BRACKETS.mfj;
  KS_STD = {
    single: _sd.stdS || 0,
    mfj: _sd.stdM || 0,
    mfs: _sd.stdS || 0,
    hoh: _sd.stdS || 0,
    qss: _sd.stdM || 0
  };
}
function loadSettingsForm() {
  const sf = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  };
  const sd = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  const fmt$ = n => '$' + (n || 0).toLocaleString();
  sf('set-irs', S.irsRate);
  sf('set-year', new Date().getFullYear());
  sf('set-fs', S.fedSingle);
  sf('set-fm', S.fedMFJ);
  sf('set-fms', S.fedMFS);
  sf('set-fh', S.fedHOH);
  sf('set-b10', S.b10);
  sf('set-b12', S.b12);
  sf('set-b22', S.b22);
  sf('set-b24', S.b24);
  sf('set-b32', S.b32);
  sf('set-b35', S.b35);
  sf('set-ksl', S.ksLow);
  sf('set-kst', S.ksTop);
  sf('set-ksh', S.ksHigh);
  sf('set-kss', S.ksStdS);
  sf('set-ksm', S.ksStdM);
  // Stamp current year into header note
  const _byn = document.getElementById('set-bracket-yr-note');
  if (_byn) _byn.textContent = '· ' + (S.taxYear || new Date().getFullYear()) + ' IRS values · auto-updated each January';
  // Display-only bracket spans
  sd('set-fs-disp', fmt$(S.fedSingle || 15000));
  sd('set-fm-disp', fmt$(S.fedMFJ || 30000));
  sd('set-fms-disp', fmt$(S.fedMFS || 15000));
  sd('set-fh-disp', fmt$(S.fedHOH || 22500));
  sd('set-b10-disp', fmt$(S.b10 || 11925));
  sd('set-b12-disp', fmt$(S.b12 || 48475));
  sd('set-b22-disp', fmt$(S.b22 || 103350));
  sd('set-b24-disp', fmt$(S.b24 || 197300));
  sd('set-b32-disp', fmt$(S.b32 || 250525));
  sd('set-b35-disp', fmt$(S.b35 || 626350));
  sd('set-ksl-disp', (S.ksLow || 3.1) + '%');
  sd('set-ksh-disp', (S.ksHigh || 5.7) + '%');
  sd('set-kst-disp', fmt$(S.ksTop || 33000));
  sd('set-kss-disp', fmt$(S.ksStdS || 3500));
  sd('set-ksm-disp', fmt$(S.ksStdM || 8000));
  sf('set-txstatus', S.txStatus || 'single');
  sf('set-goal-monthly', S.goalMonthly || '');
  sf('set-labor-rate', S.laborRate || 45);
  sf('set-owner-name', getOwnerName() || '');
  sf('set-bname', S.bname);
  sf('set-state', S.state || 'KS');
  _renderLogoPreview();
  if (S.state) {
    const lbl = document.getElementById('set-state-label');
    const info = STATE_TAX[S.state];
    if (lbl && info) lbl.textContent = info.name + ' tax rates';
  }
  sf('set-subdomain', S.subdomain || '');
  sf('set-bphone', S.bphone);
  sf('set-blic', S.blic);
  sf('set-byears', S.byears || '');
  sf('set-bemail', S.bemail || '');
  sf('set-veh', S.veh);
  sf('set-margin', S.margin);
  sf('set-cov', S.cov);
  sf('set-mm', S.mm);
  sf('set-supplies-rate', S.suppliesRate || 0.12);
  sf('set-r-walls', S.rWalls || 1.30);
  sf('set-r-ceil', S.rCeil || 1.00);
  sf('set-r-trim', S.rTrim || 4.00);
  sf('set-r-door', S.rDoor || 95);
  sf('set-r-win', S.rWin || 50);
  sf('set-r-ext', S.rExt || 1.10);
  sf('set-r-deck', S.rDeck || 1.00);
  sf('set-review-url', S.reviewUrl || '');
  const brandColor = S.brandColor || '#2D5DA8';
  sf('set-brandcolor', brandColor);
  _renderBrandSwatches(brandColor);
  sf('set-baddr', S.baddr || '');
  sf('set-bcity', S.bcity || '');
  sf('set-bzip', S.bzip || '');
  const bstateEl = document.getElementById('set-bstate-display');
  if (bstateEl) bstateEl.value = S.state || 'KS';
  const powEl = document.getElementById('set-powered-by');
  if (powEl) powEl.checked = S.poweredBy !== false;
  const ctEl = document.getElementById('set-custom-terms');
  if (ctEl) ctEl.value = S.customTerms || '';
  const coEl = document.getElementById('set-co-terms');
  if (coEl) coEl.value = S.coTerms || '';
  const _smsDefaults = _getSmsDefaults();
  sf('set-sms-hub', S.smsHub || _smsDefaults.hub);
  sf('set-sms-followup', S.smsFollowup || _smsDefaults.followup);
  sf('set-sms-reminder', S.smsReminder || _smsDefaults.reminder);
  sf('set-sms-second', S.smsSecond || _smsDefaults.second);
  sf('set-sms-intent', S.smsIntent || _smsDefaults.intent);
  _updateBootPreview();
  sf('set-bwebsite', S.bwebsite || '');
  const hoEl = document.getElementById('set-home-office');
  if (hoEl) hoEl.checked = !!S.homeOffice;
  const ccEl = document.getElementById('set-cc-surcharge-enabled');
  if (ccEl) {
    ccEl.checked = !!S.ccSurchargeEnabled;
    const pctWrap = document.getElementById('set-cc-surcharge-pct-wrap');
    if (pctWrap) pctWrap.style.display = S.ccSurchargeEnabled ? 'block' : 'none';
  }
  const ccPctEl = document.getElementById('set-cc-surcharge-pct');
  if (ccPctEl) ccPctEl.value = S.ccSurchargePct || 3;
  _renderLogoPreviewBiz();
  _renderSetIndex();
}
function saveSettings() {
  const gf = id => parseFloat(v(id)) || 0,
    gs = id => v(id);
  setOwnerName(gs('set-owner-name') || getOwnerName() || '');
  const _smsD = _getSmsDefaults();
  S = {
    ...S,
    smsHub: gs('set-sms-hub') || _smsD.hub,
    smsFollowup: gs('set-sms-followup') || _smsD.followup,
    smsReminder: gs('set-sms-reminder') || _smsD.reminder,
    smsSecond: gs('set-sms-second') || _smsD.second,
    smsIntent: gs('set-sms-intent') || _smsD.intent,
    txStatus: gs('set-txstatus') || 'single',
    goalMonthly: gf('set-goal-monthly') || 0,
    irsRate: gf('set-irs') || .700,
    taxYear: parseInt(v('set-year')) || 2026,
    fedSingle: gf('set-fs') || 15000,
    fedMFJ: gf('set-fm') || 30000,
    fedMFS: gf('set-fms') || 15000,
    fedHOH: gf('set-fh') || 22500,
    b10: gf('set-b10') || 11925,
    b12: gf('set-b12') || 48475,
    b22: gf('set-b22') || 103350,
    b24: gf('set-b24') || 197300,
    b32: gf('set-b32') || 250525,
    b35: gf('set-b35') || 626350,
    ksLow: gf('set-ksl') || 3.1,
    ksTop: gf('set-kst') || 33000,
    ksHigh: gf('set-ksh') || 5.7,
    ksStdS: gf('set-kss') || 3500,
    ksStdM: gf('set-ksm') || 8000,
    laborRate: gf('set-labor-rate') || 45,
    bname: gs('set-bname'),
    bphone: gs('set-bphone'),
    blic: gs('set-blic'),
    state: gs('set-state') || S.state || '',
    bemail: gs('set-bemail'),
    veh: gs('set-veh'),
    bitlyKey: S.bitlyKey || '',
    mapboxKey: S.mapboxKey || '',
    subdomain: gs('set-subdomain') || '',
    vehicles: S.vehicles || [],
    margin: gf('set-margin') || 25,
    cov: gf('set-cov') || 350,
    mm: gf('set-mm') || 20,
    suppliesRate: gf('set-supplies-rate') || 0.40,
    rWalls: gf('set-r-walls') || 1.30,
    rCeil: gf('set-r-ceil') || 1.00,
    rTrim: gf('set-r-trim') || 3.25,
    rDoor: gf('set-r-door') || 95,
    rWin: gf('set-r-win') || 50,
    rExt: gf('set-r-ext') || 1.10,
    rDeck: gf('set-r-deck') || 1.00,
    byears: parseInt(gs('set-byears')) || 0,
    reviewUrl: gs('set-review-url') || '',
    brandColor: gs('set-brandcolor') || '',
    bwebsite: gs('set-bwebsite') || '',
    baddr: gs('set-baddr') || '',
    bcity: gs('set-bcity') || '',
    bzip: gs('set-bzip') || '',
    state: gs('set-bstate-display') || gs('set-state') || S.state || '',
    poweredBy: document.getElementById('set-powered-by')?.checked !== false,
    customTerms: gs('set-custom-terms') || '',
    coTerms: gs('set-co-terms') || '',
    ccSurchargeEnabled: !!(document.getElementById('set-cc-surcharge-enabled') ? document.getElementById('set-cc-surcharge-enabled').checked : false),
    ccSurchargePct: parseFloat((document.getElementById('set-cc-surcharge-pct') ? document.getElementById('set-cc-surcharge-pct').value : '3') || '3') || 3
  };
  applySettings();
  saveAll();
  // Refresh the nav user card so a freshly entered name shows immediately
  // (applyPermissions owns the nav-user-name/avatar/role render).
  if (typeof applyPermissions === 'function') applyPermissions();
  const el = document.getElementById('set-saved');
  if (el) {
    el.style.display = 'block';
    setTimeout(() => el.style.display = 'none', 3000);
  }
  // Propagate branding/settings to all live client hubs in the background
  if (supaEnabled() && _supaUser) clients.filter(c => c.clientToken).forEach(c => {
    _uploadClientHub(c.id).catch(() => {});
  });
}
function _renderLogoPreview() {
  const el = document.getElementById('set-logo-preview');
  if (!el) return;
  const src = S.logoData || '';
  el.innerHTML = src ? '<img src="' + src + '" style="height:48px;max-width:180px;object-fit:contain;display:block" alt="Logo preview">' : '<span style="font-size:11px;color:rgba(255,255,255,.5)">No logo</span>';
  _renderLogoPreviewBiz();
}
function _renderLogoPreviewBiz() {
  const el = document.getElementById('set-logo-preview-biz');
  if (!el) return;
  const fn = document.getElementById('set-logo-filename');
  const btn = document.getElementById('set-logo-btn');
  const src = S.logoData || '';
  if (src) {
    el.innerHTML = '<img src="' + src + '" style="width:100%;height:100%;object-fit:contain;display:block" alt="Logo">';
    if (fn) fn.textContent = 'Logo uploaded';
    if (btn) btn.textContent = 'Replace';
  } else {
    el.innerHTML = '<span style="font-size:12px;font-weight:800;color:rgba(255,255,255,.5)">' + (S.bname || 'SP').split(' ').map(w => w[0] || '').slice(0, 2).join('') + '</span>';
    if (fn) fn.textContent = '';
    if (btn) btn.textContent = 'Upload image';
  }
}
function applyBrandLogo() {
  document.querySelectorAll('.brand-logo-slot').forEach(el => {
    if (S.logoData) {
      el.innerHTML = '<img src="' + S.logoData + '" style="height:32px;max-width:140px;object-fit:contain;display:block" alt="' + escHtml(S.bname || 'Logo') + '">';
    } else {
      el.textContent = S.bname || 'TradeDesk';
    }
  });
}
function _updateBootPreview() {
  const color = (document.getElementById('set-brandcolor') || {}).value || S.brandColor || '';
  const logo = S.logoData || '';
  const bname = S.bname || '';
  const bg = document.getElementById('boot-preview-bg');
  const bar = document.getElementById('boot-preview-bar');
  const wordmark = document.getElementById('boot-preview-wordmark');
  const pro = document.getElementById('boot-preview-pro');
  const logoEl = document.getElementById('boot-preview-logo');
  if (!bg) return;
  if (color) {
    bg.style.background = color;
    if (bar) {
      const hex = color.replace('#', '');
      const r = parseInt(hex.substr(0, 2), 16) || 0,
        g = parseInt(hex.substr(2, 2), 16) || 0,
        b = parseInt(hex.substr(4, 2), 16) || 0;
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      bar.style.background = lum > 0.5 ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.6)';
    }
  } else {
    bg.style.background = 'radial-gradient(120% 80% at 0% 100%,rgba(45,93,168,.36) 0%,transparent 55%),linear-gradient(155deg,#1B1612 0%,#1F2230 100%)';
    if (bar) bar.style.background = '#2D5DA8';
  }
  if (logoEl) {
    if (logo) {
      logoEl.innerHTML = '<img src="' + logo + '" style="max-height:36px;max-width:120px;object-fit:contain">';
    } else if (bname) {
      logoEl.innerHTML = '<span style="font-family:Geist,sans-serif;font-weight:900;font-size:22px;color:#fff;letter-spacing:-1px">' + bname.replace(/</g, '&lt;') + '</span>';
    } else {
      logoEl.innerHTML = '<span id="boot-preview-wordmark" style="font-family:Geist,sans-serif;font-weight:900;font-size:22px;color:#fff;letter-spacing:-1px">TradeDesk</span><span id="boot-preview-pro" style="font-size:8px;font-weight:800;color:#5C8FD4;background:rgba(45,93,168,.18);border:1px solid rgba(45,93,168,.36);padding:2px 5px;border-radius:4px;text-transform:uppercase;letter-spacing:.06em;margin-left:5px;vertical-align:4px">Pro</span>';
    }
  }
}
function handleLogoUpload(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (!file.type.match(/^image\/(png|jpeg|svg\+xml)$/)) {
    zAlert('Please upload a PNG, JPG, or SVG file.');
    input.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    S.logoData = e.target.result;
    saveAll();
    _renderLogoPreview();
    applyBrandLogo();
    _updateBootPreview();
    showToast('Logo saved — proposals will use your logo', '🎨');
  };
  reader.readAsDataURL(file);
}
function clearLogoSetting() {
  S.logoData = '';
  saveAll();
  _renderLogoPreview();
  _updateBootPreview();
  showToast('Logo removed — proposals will show business name', '✓');
}
function clearAllData() {
  zConfirm('This will permanently delete ALL clients, bids, jobs, income, expenses, and mileage. This cannot be undone.', () => {
    zConfirm('Last chance — are you absolutely sure you want to delete everything?', () => {
      clients = [];
      bids = [];
      jobs = [];
      income = [];
      expenses = [];
      mileage = [];
      payments = [];
      liens = [];
      timeEntries = [];
      S.employees = [];
      S.vehicles = [];
      estSurfaces = [];
      estSurfId = 0;
      estLinkedClientId = null;
      editingBidId = null;
      gps = {
        active: false,
        startCoords: null,
        startTime: null,
        clientId: null,
        clientName: '',
        timerInt: null,
        vehicle: '',
        purpose: ''
      };
      if (_activeTimer) {
        clearInterval(_activeTimer.timerInterval);
        _activeTimer = null;
        hideClockBanner();
      }
      hideDriveBanner();
      clearSurfDraft();
      saveAll();
      renderDash();
      zAlert('All data cleared. Starting fresh!', {
        title: 'Done'
      });
      goPg('pg-dash');
    }, {
      title: 'Last chance',
      yes: 'Delete everything',
      danger: true
    });
  }, {
    title: 'Clear all data',
    yes: 'Yes, clear everything',
    danger: true
  });
}
function clearMileageOnly() {
  zConfirm('Delete all mileage records? This cannot be undone.', () => {
    mileage = [];
    saveAll();
    _flushSaveNow();
    renderAllMileage();
    renderDash();
    zAlert('Mileage cleared.', {
      title: 'Done'
    });
  }, {
    title: 'Clear mileage',
    yes: 'Delete mileage',
    danger: true
  });
}
function clearClientsOnly() {
  zConfirm('Delete all clients, bids, jobs, and payments? This cannot be undone.', () => {
    clients = [];
    bids = [];
    jobs = [];
    income = [];
    payments = [];
    liens = [];
    estSurfaces = [];
    estSurfId = 0;
    estLinkedClientId = null;
    editingBidId = null;
    saveAll();
    renderDash();
    zAlert('Clients and all related records cleared.', {
      title: 'Done'
    });
  }, {
    title: 'Clear clients',
    yes: 'Delete clients',
    danger: true
  });
}
function clearExpensesOnly() {
  zConfirm('Delete all expense records? This cannot be undone.', () => {
    expenses = [];
    saveAll();
    renderDash();
    zAlert('Expenses cleared.', {
      title: 'Done'
    });
  }, {
    title: 'Clear expenses',
    yes: 'Delete expenses',
    danger: true
  });
}
function resetSettings() {
  zConfirm('Reset all settings to defaults?', () => {
    S = {
      irsRate: .700,
      taxYear: 2026,
      fedSingle: 15000,
      fedMFJ: 30000,
      fedMFS: 15000,
      fedHOH: 22500,
      b10: 11925,
      b12: 48475,
      b22: 103350,
      b24: 197300,
      b32: 250525,
      b35: 626350,
      ksLow: 3.1,
      ksTop: 33000,
      ksHigh: 5.7,
      ksStdS: 3500,
      ksStdM: 8000,
      bname: '',
      bphone: '',
      blic: 'Licensed & Insured',
      veh: '',
      margin: 40,
      cov: 350,
      p1: 83,
      p2: 65,
      p3: 95,
      mm: 15,
      rWalls: 1.30,
      rCeil: 1.00,
      rTrim: 3.25,
      rDoor: 95,
      rWin: 50,
      rExt: 1.10,
      rDeck: 1.00
    };
    applySettings();
    loadSettingsForm();
  }, {
    title: 'Reset settings',
    yes: 'Reset',
    danger: false
  });
}
function resetLocationPermission() {
  delete S.weatherLat;
  delete S.weatherLon;
  S.locationDenied = false;
  S.locationGranted = false;
  _weatherCache = null;
  saveAll();
  updateLocationBtn();
  requestLocationPermission(() => {
    updateLocationBtn();
    zAlert('Location access granted. Weather and GPS drive are now enabled.', {
      title: '✓ Location enabled'
    });
  }, () => {
    updateLocationBtn();
    zAlert('Location not allowed. You can try again any time from Settings.', {
      title: 'Location blocked'
    });
  });
}
function updateLocationBtn() {
  const btn = document.getElementById('location-settings-btn');
  if (!btn) return;
  if (S.locationDenied) {
    btn.textContent = '📍 Location: Off — tap to enable';
    btn.style.color = 'var(--text3)';
  } else if (S.weatherLat) {
    btn.textContent = '📍 Location: On ✓';
    btn.style.color = 'var(--green-mid)';
  } else {
    btn.textContent = '📍 Location access';
    btn.style.color = '';
  }
}
function getVehicles() {
  let vehs = S.vehicles || [];
  if (!vehs.length && S.veh && S.veh.trim()) {
    vehs = [S.veh.trim()];
  }
  // Migrate legacy string array to object array
  return vehs.map(v => typeof v === 'string' ? {
    name: v,
    nickname: ''
  } : v);
}
function getVehicleLabel(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  return v.nickname && v.nickname.trim() || v.name || '';
}
function getVehicleFullLabel(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  const nick = v.nickname && v.nickname.trim();
  return nick ? nick + ' (' + v.name + ')' : v.name || '';
}

// ══════════════════════════════════════════════════════════════════
// ANNUAL ODOMETER CHECK — IRS Publication 463 compliance
// Records Jan 1 start + Dec 31 end odometer per vehicle per year.
// Calculates true business-use % = logged miles / total miles driven.
// ══════════════════════════════════════════════════════════════════
function _checkOdometerPrompt() {
  const vehs = getVehicles();
  if (!vehs.length || _isEmployee || _devSupportMode) return;
  const cy = new Date().getFullYear();
  const mo = new Date().getMonth(); // 0=Jan
  const log = S.vehicleOdoLog || {};
  const snoozed = S._odoSnoozedUntil || 0;
  if (Date.now() < snoozed) return;

  // Tasks needed:
  const tasks = [];
  // 1. Current year start — always check regardless of month (mid-year signups need this too)
  vehs.forEach(v => {
    const key = _vehKey(v);
    if (!(log[cy] && log[cy][key] && log[cy][key].start)) {
      // midYear=true when past April — modal shows "best estimate" language instead of "Jan 1"
      tasks.push({
        year: cy,
        type: 'start',
        veh: v,
        midYear: mo > 3
      });
    }
  });
  // 2. End of previous year — prompt Jan through Mar only (after that, prior year is filed)
  if (mo <= 2) {
    const ly = cy - 1;
    vehs.forEach(v => {
      const key = _vehKey(v);
      if (!(log[ly] && log[ly][key] && log[ly][key].end)) {
        tasks.push({
          year: ly,
          type: 'end',
          veh: v
        });
      }
    });
  }
  if (!tasks.length) return;

  // Count how many times snoozed — after 3 snoozes, hard block
  const snoozeCount = S._odoSnoozeCount || 0;
  _showOdometerModal(tasks, snoozeCount >= 3);
}
function _vehKey(v) {
  return (typeof v === 'string' ? v : v.name || 'vehicle').toLowerCase().replace(/\s+/g, '_');
}

// Public entry point called from "Update readings" button and the mileage action card
function checkOdometerEntries(manual) {
  if (_isEmployee || _devSupportMode) return;
  if (!manual) {
    _checkOdometerPrompt();
    return;
  }
  // Manual: build tasks for current year (start + end) regardless of whether they exist, so user can correct values
  const vehs = getVehicles();
  if (!vehs.length) return;
  const cy = new Date().getFullYear();
  const mo = new Date().getMonth();
  const log = S.vehicleOdoLog || {};
  const tasks = [];
  vehs.forEach(v => {
    const key = _vehKey(v);
    const rec = log[cy]?.[key] || {};
    tasks.push({
      year: cy,
      type: 'start',
      veh: v,
      midYear: mo > 3,
      manual: true
    });
    // Show year-end slot if past June or if a reading already exists to correct
    if (mo >= 6 || rec.end) {
      tasks.push({
        year: cy,
        type: 'end',
        veh: v,
        manual: true
      });
    }
  });
  // Jan–Mar: also allow correcting prior year's end
  if (mo <= 2) {
    const ly = cy - 1;
    vehs.forEach(v => {
      tasks.push({
        year: ly,
        type: 'end',
        veh: v,
        manual: true
      });
    });
  }
  if (!tasks.length) return;
  _showOdometerModal(tasks, false);
}
window.checkOdometerEntries = checkOdometerEntries;

// ── Stripe Connect ─────────────────────────────────────────────────────────

function renderSettingsTrades() {
  const el = document.getElementById('set-trades-content');
  const sub = document.getElementById('set-idx-trades-sub');
  if (!el) return;
  const lines = _getTradeLines();
  if (sub) sub.textContent = lines.map(t => TRADE_META[t]?.label || t).join(', ');
  const allTrades = Object.keys(TRADE_META);
  const available = allTrades.filter(t => !lines.includes(t));
  el.innerHTML = (isLifetimeAccount() ? '<div style="display:inline-flex;align-items:center;gap:6px;background:#D1FAE5;border:1px solid var(--green-mid);border-radius:20px;padding:5px 12px;font-size:12px;font-weight:700;color:var(--green-mid);margin-bottom:12px">⭐ Lifetime access — no subscription ever</div><br>' : '') + '<div style="font-size:12px;color:var(--text2);margin-bottom:12px;line-height:1.5">Your active trade lines. Each gets its own estimate form and pipeline view.</div>' + '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">' + lines.map(t => {
    const m = TRADE_META[t] || {
      icon: '🔧',
      label: t
    };
    return '<div style="display:inline-flex;align-items:center;gap:5px;background:var(--blue-lt);border:1px solid var(--blue);border-radius:20px;padding:5px 10px 5px 10px;font-size:13px;font-weight:600;color:var(--blue-dk)">' + m.icon + ' ' + m.label + (lines.length > 1 ? '<button onclick="removeTradeFromSettings(\'' + t + '\')" style="background:none;border:none;cursor:pointer;color:var(--blue-dk);font-size:15px;line-height:1;padding:0 0 0 4px;font-family:inherit;opacity:.6">×</button>' : '') + '</div>';
  }).join('') + '</div>' + (available.length ? '<div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:8px">Add a trade</div>' + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">' + available.map(t => {
    const m = TRADE_META[t] || {
      icon: '🔧',
      label: t
    };
    return '<button onclick="addTradeFromSettings(\'' + t + '\')" style="padding:10px 6px;border-radius:var(--r);border:1.5px solid var(--border2);background:var(--bg2);cursor:pointer;font-family:inherit;text-align:center;font-size:12px"><div style="font-size:18px;margin-bottom:2px">' + m.icon + '</div>' + m.label + '</button>';
  }).join('') + '</div>' : '<div style="font-size:11px;color:var(--text3)">All trades active.</div>');
}
async function addTradeFromSettings(trade) {
  if (!_config?.account_id) return;
  const cur = _getTradeLines();
  const newLines = [...new Set([...cur, trade])];
  const lineStr = newLines.join(',');
  if (supaEnabled()) {
    const {
      error
    } = await _supa.from('account_config').update({
      trade_lines: lineStr
    }).eq('account_id', _config.account_id);
    if (error) {
      showToast('SQL migration needed — see notes', '⚠️');
      console.error(error);
      return;
    }
  }
  _config = {
    ..._config,
    trade_lines: lineStr
  };
  renderSettingsTrades();
  _renderNavTradeSwitcher();
  _renderSettingsTradeSections();
  showToast('Added ' + (TRADE_META[trade]?.label || trade), '✓');
}
async function removeTradeFromSettings(trade) {
  if (!_config?.account_id) return;
  const cur = _getTradeLines();
  const newLines = cur.filter(t => t !== trade);
  if (!newLines.length) {
    showToast('Cannot remove your only trade', '⚠️');
    return;
  }
  const lineStr = newLines.join(',');
  if (supaEnabled()) {
    const {
      error
    } = await _supa.from('account_config').update({
      trade_lines: lineStr
    }).eq('account_id', _config.account_id);
    if (error) {
      showToast('SQL migration needed — see notes', '⚠️');
      console.error(error);
      return;
    }
  }
  _config = {
    ..._config,
    trade_lines: lineStr
  };
  if (_activeTrade === trade) _activeTrade = newLines[0];
  renderSettingsTrades();
  _renderNavTradeSwitcher();
  _renderSettingsTradeSections();
  showToast('Removed ' + (TRADE_META[trade]?.label || trade), '✓');
}
function _renderSettingsTradeSections() {
  const trade = getActiveTrade();
  const isPainting = trade === 'painting';
  const sw = document.getElementById('set-rates-sw');
  const lp = document.getElementById('set-rates-lp');
  const lg = document.getElementById('set-rates-lg');
  const lgTitle = document.getElementById('set-rates-lg-title');
  if (sw) sw.style.display = isPainting ? '' : 'none';
  if (lp) lp.style.display = isPainting ? '' : 'none';
  if (lg) {
    lg.style.display = isPainting ? 'none' : '';
    if (lgTitle) {
      const meta = TRADE_META[trade] || {
        icon: '🔧',
        label: 'Trade'
      };
      lgTitle.textContent = (meta.icon + ' ' + meta.label + ' Labor Rates').trim();
    }
  }
}
function _renderDevTradeCard() {
  if (!_config?.is_dev) return;
  const current = _config?.business_type || 'painting';
  const trades = [{
    id: 'painting',
    icon: '🎨',
    label: 'Painting'
  }, {
    id: 'plumbing',
    icon: '🔧',
    label: 'Plumbing'
  }, {
    id: 'electrical',
    icon: '⚡',
    label: 'Electrical'
  }, {
    id: 'hvac',
    icon: '❄️',
    label: 'HVAC'
  }, {
    id: 'roofing',
    icon: '🏠',
    label: 'Roofing'
  }, {
    id: 'landscaping',
    icon: '🌿',
    label: 'Landscaping'
  }, {
    id: 'general',
    icon: '🔨',
    label: 'General'
  }, {
    id: 'other',
    icon: '🛠',
    label: 'Other'
  }];
  const grid = document.getElementById('dev-trade-grid');
  if (!grid) return;
  grid.innerHTML = trades.map(t => `<button onclick="devSwitchTrade('${t.id}')" style="padding:10px 6px;border-radius:var(--r);border:2px solid ${t.id === current ? 'var(--blue)' : 'var(--border2)'};background:${t.id === current ? 'var(--blue-lt)' : 'var(--bg2)'};cursor:pointer;font-family:inherit;text-align:center;font-size:12px;font-weight:${t.id === current ? '700' : '400'}"><div style="font-size:18px">${t.icon}</div>${t.label}</button>`).join('');
  const sup = document.getElementById('dev-support-section');
  if (sup) sup.innerHTML = `
<div style="padding-top:12px;border-top:1px solid var(--border2)">
  <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);margin-bottom:8px">Support View</div>
  <button onclick="_devLoadUserAccount('zach')" style="width:100%;padding:9px;border-radius:var(--r);border:1px solid var(--blue);background:var(--blue-lt);color:var(--blue-dk);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">👁 View Zach's account</button>

  ${_devSupportMode ? `<div style="margin-top:8px;padding:8px 10px;background:var(--amber-lt);border-radius:var(--r);font-size:11px;color:#856404;display:flex;justify-content:space-between;align-items:center"><span>👁 Viewing: ${escHtml(_devSupportName)}</span><button onclick="_devExitSupportMode()" style="font-size:10px;padding:3px 8px;border:1px solid #856404;border-radius:4px;background:none;color:#856404;cursor:pointer;font-family:inherit">Exit</button></div>` : ''}
  ${_devRenderSnapshots('zach')}
</div>`;
  // Init legal inspector with current state and today's date
  const _lsEl = document.getElementById('dev-legal-state');
  const _ldEl = document.getElementById('dev-legal-date');
  if (_lsEl) {
    _lsEl.value = S?.state || 'KS';
  }
  if (_ldEl && !_ldEl.value) {
    _ldEl.value = new Date().toISOString().slice(0, 10);
  }
  if (typeof renderLegalInspector === 'function') renderLegalInspector();
}
async function devSwitchTrade(type) {
  if (!_config?.is_dev || !_config?.account_id) return;
  const cfg = BUSINESS_CONFIGS[type] || BUSINESS_CONFIGS.other;
  _config = {
    ..._config,
    ...cfg,
    business_type: type
  };
  await _supa.from('account_config').update({
    business_type: type
  }).eq('account_id', _config.account_id);
  _activeTrade = type;
  _renderDevTradeCard();
  _renderNavTradeSwitcher();
  _renderSettingsTradeSections();
  showToast('Trade switched to ' + type, '🛠');
}

// ── Onboarding ────────────────────────────────────────────────────────
let _ob = {
  step: 1,
  name: '',
  email: '',
  password: '',
  businessType: '',
  tradeLines: [],
  businessName: '',
  phone: '',
  address: '',
  state: '',
  licenseInfo: '',
  role: 'owner',
  vehicles: [],
  team: [],
  stripeKey: ''
};
async function showOnboarding() {
  _removeBootOverlay();
  const ov = document.createElement('div');
  ov.id = 'onboarding-overlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:var(--bg);overflow-y:auto;padding:0';
  document.body.appendChild(ov);
  renderObStep();
}
function renderObStep() {
  const ov = document.getElementById('onboarding-overlay');
  if (!ov) return;
  const steps = [{
    icon: '🔨',
    title: 'Welcome',
    sub: 'Get set up in minutes'
  }, {
    icon: '👤',
    title: 'Your account',
    sub: 'Name, email and password'
  }, {
    icon: '🎨',
    title: 'Your trade',
    sub: 'We configure your workflow'
  }, {
    icon: '🏢',
    title: 'Business info',
    sub: 'Appears on proposals'
  }, {
    icon: '🖼️',
    title: 'Your brand',
    sub: 'Logo and company look'
  }, {
    icon: '⚡',
    title: 'Your role',
    sub: 'Controls what you can see'
  }, {
    icon: '🚗',
    title: 'Vehicles',
    sub: 'For mileage tracking'
  }, {
    icon: '👥',
    title: 'Your team',
    sub: 'Add crew members'
  }, {
    icon: '✓',
    title: 'All set',
    sub: 'Review and create'
  }];
  const pct = Math.round(_ob.step / 9 * 100);
  const cur = steps[_ob.step - 1];
  ov.innerHTML = '<div style="display:flex;min-height:100vh;min-height:100dvh">' +
  // Left panel — brand + step context
  '<div id="ob-left" style="width:340px;flex-shrink:0;background:#0D1117;padding:40px 32px;flex-direction:column;justify-content:space-between" id="ob-left">' + '<div>' + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:48px">' + '<div style="width:36px;height:36px;background:rgba(255,255,255,.15);border-radius:9px;display:flex;align-items:center;justify-content:center">' + '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" stroke-width="2.5"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>' + '</div>' + '<span class="brand-logo-slot" style="font-size:18px;font-weight:800;color:#fff;letter-spacing:-.02em">TradeDesk</span>' + '</div>' +
  // Step list
  '<div style="display:flex;flex-direction:column;gap:4px">' + steps.map((s, i) => {
    const done = i + 1 < _ob.step;
    const active = i + 1 === _ob.step;
    return '<div style="display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:10px;background:' + (active ? 'rgba(255,255,255,.15)' : done ? 'rgba(255,255,255,.06)' : 'transparent') + ';transition:background .2s">' + '<div style="width:28px;height:28px;border-radius:50%;background:' + (done ? '#63B841' : active ? '#fff' : 'rgba(255,255,255,.2)') + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:' + (done ? '13' : '14') + 'px;font-weight:700;color:' + (done ? '#fff' : active ? 'var(--blue)' : 'rgba(255,255,255,.5)') + '">' + (done ? '✓' : '' + (i + 1)) + '</div>' + '<div>' + '<div style="font-size:13px;font-weight:' + (active ? '700' : '600') + ';color:' + (active || done ? '#fff' : 'rgba(255,255,255,.5)') + '">' + s.title + '</div>' + (active ? '<div style="font-size:11px;color:rgba(255,255,255,.65);margin-top:1px">' + s.sub + '</div>' : '') + '</div>' + '</div>';
  }).join('') + '</div>' + '</div>' + '<div style="font-size:11px;color:rgba(255,255,255,.4)">© 2025 TradeDesk</div>' + '</div>' +
  // Right panel — form content
  '<div style="flex:1;display:flex;flex-direction:column;background:#fff;min-height:100%;overflow-y:auto">' +
  // Mobile header
  '<div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border)" id="ob-mobile-hdr">' + '<div style="display:flex;align-items:center;gap:8px">' + '<div style="width:28px;height:28px;background:var(--blue);border-radius:7px;display:flex;align-items:center;justify-content:center">' + '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#fff" stroke-width="2.5"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>' + '</div>' + '<span class="brand-logo-slot" style="font-size:15px;font-weight:800;color:var(--text)">TradeDesk</span>' + '</div>' + '<span style="font-size:12px;color:var(--text3);font-weight:600">' + _ob.step + ' of 9</span>' + '</div>' +
  // Progress bar
  '<div style="height:3px;background:var(--border)"><div style="height:100%;width:' + pct + '%;background:var(--blue);transition:width .4s ease"></div></div>' +
  // Step content
  '<div style="flex:1;padding:32px 28px;max-width:520px;width:100%;margin:0 auto;box-sizing:border-box" id="ob-body"></div>' + '</div>' + '</div>';

  // Left panel visible on wider screens, hidden on mobile
  const left = document.getElementById('ob-left');
  if (left) left.style.display = window.innerWidth >= 640 ? 'flex' : 'none';
  const body = document.getElementById('ob-body');
  if (_ob.step === 1) obStep1(body);else if (_ob.step === 2) obStep2(body);else if (_ob.step === 3) obStep3(body);else if (_ob.step === 4) obStep4(body);else if (_ob.step === 5) obStepBrand(body);else if (_ob.step === 6) obStep5(body);else if (_ob.step === 7) obStep6(body);else if (_ob.step === 8) obStep7(body);else if (_ob.step === 9) obStep8(body);else if (_ob.step === 10) obStep9(body);
}
function obBtn(label, onclick, secondary) {
  return '<button onclick="' + onclick + '" style="width:100%;padding:13px 18px;border-radius:9px;border:' + (secondary ? '1.5px solid #e0dfd8' : 'none') + ';background:' + (secondary ? '#fff' : '#0D1117') + ';color:' + (secondary ? '#5f5e5a' : '#fff') + ';font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;margin-top:8px;letter-spacing:-.01em;box-shadow:' + (secondary ? 'none' : '0 2px 8px rgba(0,0,0,.15)') + ';transition:opacity .15s" onmousedown="this.style.opacity=\'.85\'" onmouseup="this.style.opacity=\'1\'">' + label + '</button>';
}
function obInput(id, label, placeholder, type, value) {
  return '<div style="margin-bottom:18px">' + '<label style="display:block;font-size:12px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">' + label + '</label>' + '<input type="' + (type || 'text') + '" id="' + id + '" placeholder="' + placeholder + '" value="' + (value || '') + '" style="font-size:15px;padding:11px 14px;border-radius:9px;border:1.5px solid var(--border2);background:var(--bg2);color:var(--text);width:100%;box-sizing:border-box;outline:none;transition:border-color .15s;font-family:inherit" onfocus="this.style.borderColor=\'var(--blue)\'" onblur="this.style.borderColor=\'var(--border2)\'">' + '</div>';
}
function obStep1(el) {
  el.innerHTML = '<div style="padding-top:20px">' + '<div style="font-size:40px;margin-bottom:20px">🔨</div>' + '<div style="font-size:30px;font-weight:800;line-height:1.2;margin-bottom:12px;letter-spacing:-.02em">Run your business<br>from one place.</div>' + '<div style="font-size:15px;color:var(--text3);line-height:1.7;margin-bottom:32px">Estimates, jobs, payments, mileage — everything a contractor needs, built for the field.</div>' + '<div style="display:grid;gap:10px;margin-bottom:36px">' + ['📋 Estimates & proposals in minutes', '💰 Collect payments on the spot', '📍 Mileage & expense tracking', '📊 Taxes and business analytics'].map(f => '<div style="display:flex;align-items:center;gap:10px;font-size:14px;font-weight:500;color:var(--text2)"><span>' + f + '</span></div>').join('') + '</div>' + obBtn("Get started — it's free", "_ob.step=2;renderObStep()") + '</div>';
}
function obStep2(el) {
  el.innerHTML = '<div style="margin-bottom:28px"><div style="font-size:28px;margin-bottom:10px">👤</div><div style="font-size:22px;font-weight:800;letter-spacing:-.02em;margin-bottom:4px">Create your account</div><div style="font-size:14px;color:var(--text3)">Your email and password to sign in</div></div>' + obInput('ob-name', 'Your full name', 'John Smith', 'text', _ob.name) + obInput('ob-email', 'Email', 'you@yourbusiness.com', 'email', _ob.email) + obInput('ob-pass', 'Password (min 6 chars)', '••••••••', 'password', '') + '<div id="ob-err" style="color:#A32D2D;font-size:12px;min-height:16px;margin-bottom:8px"></div>' + '<div style="border:1px solid var(--border);border-radius:var(--r);margin-bottom:14px;overflow:hidden">' + '<div style="padding:8px 12px;background:var(--bg2);border-bottom:1px solid var(--border);font-size:11px;font-weight:700;color:var(--text2)">Terms of Service — Please read</div>' + '<div style="padding:10px 12px;max-height:160px;overflow-y:auto;font-size:11px;color:var(--text3);line-height:1.7">' + '<strong style="color:var(--text2)">1. Not a Tax Service.</strong> TradeDesk provides mileage tracking, expense logging, and financial summaries as organizational tools for your own record-keeping. Nothing in this app constitutes tax advice, tax preparation, or accounting services. Consult a qualified tax professional or CPA regarding your tax obligations.<br><br>' + '<strong style="color:var(--text2)">2. Not Legal Advice — Mechanic\'s Liens.</strong> Mechanic\'s lien laws, notice requirements, and deadlines vary significantly by state and project type. The lien tracking and notice features in TradeDesk are organizational tools only and do not constitute legal advice. Filing an improper lien can expose you to liability. Consult a licensed attorney in your state before filing any lien or taking legal action against a client.<br><br>' + '<strong style="color:var(--text2)">3. Not Financial or Insurance Advice.</strong> Estimates, bids, and payment tracking are tools to help run your business. TradeDesk makes no representations about pricing, profitability, or business outcomes. Consult appropriate professionals for financial and insurance guidance.<br><br>' + '<strong style="color:var(--text2)">4. Your Client\'s Data.</strong> You are responsible for ensuring you have appropriate authorization to store information about your clients within TradeDesk. Do not enter sensitive personal information beyond what is necessary to manage your business relationships.<br><br>' + '<strong style="color:var(--text2)">5. Developer & Support Access.</strong> TradeDesk and its authorized developers may access your account data solely for troubleshooting, technical support, and service improvement purposes.<br><br>' + '<strong style="color:var(--text2)">6. Data Storage.</strong> Your business data is stored securely via Supabase. TradeDesk is not liable for data loss due to circumstances outside our control. We recommend keeping your own backups of critical business records.<br><br>' + '<strong style="color:var(--text2)">7. No Warranty.</strong> TradeDesk is provided "as is" without warranty of any kind. We are not liable for any business decisions made based on information displayed in the app.<br><br>' + 'By tapping Continue, you confirm you have read and agree to these terms.' + '</div>' + '</div>' + obBtn('Continue', 'obNext2()');
}
function obNext2() {
  const name = document.getElementById('ob-name')?.value.trim();
  const email = document.getElementById('ob-email')?.value.trim();
  const pass = document.getElementById('ob-pass')?.value;
  const err = document.getElementById('ob-err');
  if (!name) {
    if (err) err.textContent = 'Enter your name.';
    return;
  }
  if (!email || !email.includes('@')) {
    if (err) err.textContent = 'Enter a valid email.';
    return;
  }
  if (!pass || pass.length < 6) {
    if (err) err.textContent = 'Password must be at least 6 characters.';
    return;
  }
  _ob.name = name;
  _ob.email = email;
  _ob.password = pass;
  _ob.step = 3;
  renderObStep();
}
function obStep3(el) {
  const types = [{
    id: 'painting',
    icon: '🎨',
    label: 'Painting'
  }, {
    id: 'roofing',
    icon: '🏠',
    label: 'Roofing'
  }, {
    id: 'plumbing',
    icon: '🔧',
    label: 'Plumbing'
  }, {
    id: 'electrical',
    icon: '⚡',
    label: 'Electrical'
  }, {
    id: 'hvac',
    icon: '❄️',
    label: 'HVAC'
  }, {
    id: 'landscaping',
    icon: '🌿',
    label: 'Landscaping'
  }, {
    id: 'general',
    icon: '🔨',
    label: 'General Contractor'
  }, {
    id: 'other',
    icon: '🛠️',
    label: 'Other'
  }];
  el.innerHTML = '<div style="margin-bottom:24px"><div style="font-size:28px;margin-bottom:10px">🔧</div><div style="font-size:22px;font-weight:800;letter-spacing:-.02em;margin-bottom:4px">What trades do you work?</div><div style="font-size:14px;color:var(--text3)">Select all that apply — tap to toggle. First selected = primary trade.</div></div>' + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px">' + types.map(t => {
    const sel = _ob.tradeLines.includes(t.id);
    const isPrimary = _ob.tradeLines[0] === t.id;
    return '<button onclick="obSelectType(\'' + t.id + '\')" id="obtype-' + t.id + '" style="padding:16px 12px;border-radius:var(--r);border:2px solid ' + (sel ? 'var(--blue)' : 'var(--border2)') + ';background:' + (sel ? 'var(--blue-lt)' : 'var(--bg2)') + ';cursor:pointer;font-family:inherit;text-align:center;position:relative">' + (isPrimary ? '<div style="position:absolute;top:6px;right:6px;background:var(--blue);color:#fff;font-size:9px;font-weight:700;border-radius:3px;padding:1px 4px">PRIMARY</div>' : '') + (sel && !isPrimary ? '<div style="position:absolute;top:6px;right:6px;font-size:14px">✓</div>' : '') + '<div style="font-size:24px;margin-bottom:4px">' + t.icon + '</div>' + '<div style="font-size:13px;font-weight:700;color:var(--text)">' + t.label + '</div>' + '</button>';
  }).join('') + '</div>' + '<div id="ob-err" style="color:#A32D2D;font-size:12px;min-height:16px;margin-bottom:8px"></div>' + obBtn('Continue', 'obNext3()') + obBtn('Back', '_ob.step=2;renderObStep()', true);
}
function obSelectType(t) {
  const idx = _ob.tradeLines.indexOf(t);
  if (idx === -1) {
    _ob.tradeLines.push(t);
  } else {
    _ob.tradeLines.splice(idx, 1);
  }
  _ob.businessType = _ob.tradeLines[0] || '';
  // Re-render just the grid buttons
  const types = ['painting', 'roofing', 'plumbing', 'electrical', 'hvac', 'landscaping', 'general', 'other'];
  types.forEach(id => {
    const btn = document.getElementById('obtype-' + id);
    if (!btn) return;
    const sel = _ob.tradeLines.includes(id);
    const isPrimary = _ob.tradeLines[0] === id;
    btn.style.borderColor = sel ? 'var(--blue)' : 'var(--border2)';
    btn.style.background = sel ? 'var(--blue-lt)' : 'var(--bg2)';
    // Update badge
    let badge = btn.querySelector('.ob-primary-badge');
    let check = btn.querySelector('.ob-check-badge');
    if (isPrimary) {
      if (!badge) {
        badge = document.createElement('div');
        badge.className = 'ob-primary-badge';
        badge.style.cssText = 'position:absolute;top:6px;right:6px;background:var(--blue);color:#fff;font-size:9px;font-weight:700;border-radius:3px;padding:1px 4px';
        btn.appendChild(badge);
      }
      badge.textContent = 'PRIMARY';
      if (check) check.remove();
    } else if (sel) {
      if (badge) badge.remove();
      if (!check) {
        check = document.createElement('div');
        check.className = 'ob-check-badge';
        check.style.cssText = 'position:absolute;top:6px;right:6px;font-size:14px';
        btn.appendChild(check);
      }
      check.textContent = '✓';
    } else {
      if (badge) badge.remove();
      if (check) check.remove();
    }
  });
}
function obNext3() {
  const err = document.getElementById('ob-err');
  if (!_ob.tradeLines.length) {
    if (err) err.textContent = 'Select at least one trade.';
    return;
  }
  _ob.businessType = _ob.tradeLines[0];
  _ob.step = 4;
  renderObStep();
}
function obStep4(el) {
  el.innerHTML = '<div style="margin-bottom:28px"><div style="font-size:28px;margin-bottom:10px">🏢</div><div style="font-size:22px;font-weight:800;letter-spacing:-.02em;margin-bottom:4px">Business info</div><div style="font-size:14px;color:var(--text3)">Appears on your proposals and estimates</div></div>' + obInput('ob-bname', 'Business name', 'Your Business Name', 'text', _ob.businessName) + '<div class="f" style="margin-bottom:14px"><label>Phone number</label>' + '<input type="tel" id="ob-bphone" placeholder="316-555-0100" value="' + (_ob.phone || '') + '" maxlength="12" oninput="this.value=this.value.replace(/[^0-9]/g,\'\').slice(0,10).replace(/^(\\d{3})(\\d{3})(\\d{1,4})$/,\'$1-$2-$3\').replace(/^(\\d{3})(\\d{1,3})$/,\'$1-$2\')" style="font-size:16px;padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);width:100%;box-sizing:border-box"></div>' + obInput('ob-baddr', 'Business address (optional)', '1234 Main St, Wichita KS', 'text', _ob.address) + '<div class="f" style="margin-bottom:14px"><label>State <span style="color:#A32D2D">*</span></label><select id="ob-state" style="font-size:15px;padding:12px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);width:100%;box-sizing:border-box"><option value="">— Select your state —</option><option value="AL">AL</option><option value="AK">AK</option><option value="AZ">AZ</option><option value="AR">AR</option><option value="CA">CA</option><option value="CO">CO</option><option value="CT">CT</option><option value="DE">DE</option><option value="FL">FL</option><option value="GA">GA</option><option value="HI">HI</option><option value="ID">ID</option><option value="IL">IL</option><option value="IN">IN</option><option value="IA">IA</option><option value="KS">KS</option><option value="KY">KY</option><option value="LA">LA</option><option value="ME">ME</option><option value="MD">MD</option><option value="MA">MA</option><option value="MI">MI</option><option value="MN">MN</option><option value="MS">MS</option><option value="MO">MO</option><option value="MT">MT</option><option value="NE">NE</option><option value="NV">NV</option><option value="NH">NH</option><option value="NJ">NJ</option><option value="NM">NM</option><option value="NY">NY</option><option value="NC">NC</option><option value="ND">ND</option><option value="OH">OH</option><option value="OK">OK</option><option value="OR">OR</option><option value="PA">PA</option><option value="RI">RI</option><option value="SC">SC</option><option value="SD">SD</option><option value="TN">TN</option><option value="TX">TX</option><option value="UT">UT</option><option value="VT">VT</option><option value="VA">VA</option><option value="WA">WA</option><option value="WV">WV</option><option value="WI">WI</option><option value="WY">WY</option></select></div>' + obInput('ob-blic', 'License / insurance info (optional)', 'Licensed & Insured · KS #12345', 'text', _ob.licenseInfo) + '<div id="ob-err" style="color:#A32D2D;font-size:12px;min-height:16px;margin-bottom:8px"></div>' + obBtn('Continue', 'obNext4()') + obBtn('Back', '_ob.step=3;renderObStep()', true);
}
function obNext4() {
  const bname = document.getElementById('ob-bname')?.value.trim();
  const phone = document.getElementById('ob-bphone')?.value.trim();
  const err = document.getElementById('ob-err');
  if (!bname) {
    if (err) err.textContent = 'Enter your business name.';
    return;
  }
  if (!phone) {
    if (err) err.textContent = 'Enter a phone number.';
    return;
  }
  _ob.businessName = bname;
  _ob.phone = phone;
  _ob.address = document.getElementById('ob-baddr')?.value.trim() || '';
  _ob.state = document.getElementById('ob-state')?.value || '';
  if (!_ob.state) {
    if (err) err.textContent = 'Please select your state.';
    return;
  }
  _ob.licenseInfo = document.getElementById('ob-blic')?.value.trim() || '';
  _ob.step = 5;
  renderObStep();
}
function obStepBrand(el) {
  el.innerHTML = '<div style="margin-bottom:28px"><div style="font-size:28px;margin-bottom:10px">🖼️</div><div style="font-size:22px;font-weight:800;letter-spacing:-.02em;margin-bottom:4px">Your brand</div><div style="font-size:14px;color:var(--text3)">Add a logo to appear on every proposal</div></div>' + '<div style="margin-bottom:20px">' + '<div style="width:120px;height:120px;border:2px dashed var(--border2);border-radius:var(--rl);display:flex;align-items:center;justify-content:center;margin-bottom:10px;background:var(--bg2);cursor:pointer" onclick="document.getElementById(\'set-logo-file\').click()" id="set-logo-preview">' + (S.logoData ? '<img src="' + S.logoData + '" style="max-width:100%;max-height:100%;object-fit:contain">' : '<span style="font-size:32px">🖼️</span>') + '</div>' + '<button onclick="document.getElementById(\'set-logo-file\').click()" style="padding:9px 16px;border-radius:8px;border:1.5px solid var(--border2);background:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;margin-right:8px">Upload PNG logo</button>' + (S.logoData ? '<button onclick="S.logoData=\'\';saveAll();applyBrandLogo();_renderLogoPreview();" style="padding:9px 16px;border-radius:8px;border:1.5px solid var(--border2);background:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;color:var(--text3)">Remove</button>' : '') + '</div>' + '<div style="font-size:12px;color:var(--text3);margin-bottom:24px">PNG only. Appears on all proposals and the app header. You can change this later in Settings.</div>' + obBtn('Continue', '_ob.step=6;renderObStep()') + obBtn('Skip for now', '_ob.step=6;renderObStep()', true) + obBtn('Back', '_ob.step=4;renderObStep()', true);
}
function obHandleLogo(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    S.logoData = e.target.result;
    saveAll();
    applyBrandLogo();
    const prev = document.getElementById('ob-logo-preview');
    if (prev) prev.innerHTML = '<img src="' + S.logoData + '" style="max-width:100%;max-height:100%;object-fit:contain">';
  };
  reader.readAsDataURL(file);
}
function obStep5(el) {
  const roles = [{
    id: 'owner',
    icon: '👤',
    label: 'Owner',
    desc: 'Full access to everything'
  }, {
    id: 'estimator',
    icon: '📋',
    label: 'Estimator',
    desc: 'Bids and proposals, no financials'
  }, {
    id: 'technician',
    icon: '🔧',
    label: 'Technician',
    desc: 'Jobs and schedule only'
  }, {
    id: 'apprentice',
    icon: '🛠️',
    label: 'Apprentice',
    desc: 'Limited view'
  }];
  el.innerHTML = '<div style="margin-bottom:28px"><div style="font-size:28px;margin-bottom:10px">⚡</div><div style="font-size:22px;font-weight:800;letter-spacing:-.02em;margin-bottom:4px">Your role</div><div style="font-size:14px;color:var(--text3)">Controls what you can see and do in TradeDesk</div></div>' + '<div style="display:grid;gap:10px;margin-bottom:20px">' + roles.map(r => '<button onclick="obSelectRole(\'' + r.id + '\')" id="obrole-' + r.id + '" style="text-align:left;padding:14px;border-radius:var(--r);border:2px solid ' + (_ob.role === r.id ? 'var(--blue)' : 'var(--border2)') + ';background:' + (_ob.role === r.id ? 'var(--blue-lt)' : 'var(--bg2)') + ';cursor:pointer;font-family:inherit;display:flex;gap:12px;align-items:center">' + '<div style="font-size:24px">' + r.icon + '</div>' + '<div><div style="font-size:14px;font-weight:700;color:var(--text)">' + r.label + '</div>' + '<div style="font-size:11px;color:var(--text3)">' + r.desc + '</div></div>' + '</button>').join('') + '</div>' + obBtn('Continue', '_ob.step=7;renderObStep()') + obBtn('Back', '_ob.step=5;renderObStep()', true);
}
function obSelectRole(r) {
  _ob.role = r;
  document.querySelectorAll('[id^=obrole-]').forEach(b => {
    const sel = b.id === 'obrole-' + r;
    b.style.borderColor = sel ? 'var(--blue)' : 'var(--border2)';
    b.style.background = sel ? 'var(--blue-lt)' : 'var(--bg2)';
  });
}
function obStep6(el) {
  el.innerHTML = '<div style="margin-bottom:28px"><div style="font-size:28px;margin-bottom:10px">🚗</div><div style="font-size:22px;font-weight:800;letter-spacing:-.02em;margin-bottom:4px">Your vehicles</div><div style="font-size:14px;color:var(--text3)">At least one required for mileage tracking</div></div>' + '<div id="ob-veh-list">' + (_ob.vehicles.length ? _ob.vehicles.map((v, i) => obVehRow(v, i)).join('') : '') + '</div>' + '<button onclick="obAddVehicle()" style="width:100%;padding:12px;border-radius:var(--r);border:2px dashed var(--border2);background:var(--bg2);cursor:pointer;font-family:inherit;font-size:14px;color:var(--blue);font-weight:700;margin-bottom:14px">+ Add vehicle</button>' + '<div id="ob-err" style="color:#A32D2D;font-size:12px;min-height:16px;margin-bottom:8px"></div>' + obBtn('Continue', 'obNext6()') + obBtn('Back', '_ob.step=6;renderObStep()', true);
}
function obVehRow(v, i) {
  const needVin = _ob.vehicles.length > 1;
  return '<div style="border:1px solid var(--border2);border-radius:var(--r);padding:12px;margin-bottom:10px">' + '<div style="display:flex;justify-content:space-between;margin-bottom:8px">' + '<div style="font-size:13px;font-weight:700">Vehicle ' + (i + 1) + '</div>' + '<button onclick="_ob.vehicles.splice(' + i + ',1);obStep6(document.getElementById(\'ob-body\'))" style="border:none;background:none;color:#A32D2D;cursor:pointer;font-size:18px;padding:0">×</button>' + '</div>' + '<input placeholder="Name (e.g. White F-150)" value="' + (v.name || '') + '" oninput="_ob.vehicles[' + i + '].name=this.value" style="width:100%;box-sizing:border-box;margin-bottom:8px;padding:8px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-size:14px;font-family:inherit">' + '<select oninput="_ob.vehicles[' + i + '].type=this.value" style="width:100%;box-sizing:border-box;' + (needVin ? 'margin-bottom:8px;' : '') + 'padding:8px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-size:14px;font-family:inherit">' + ['Truck', 'Van', 'SUV', 'Car', 'Trailer'].map(t => '<option' + (v.type === t ? ' selected' : '') + '>' + t + '</option>').join('') + '</select>' + (needVin ? '<input placeholder="VIN — exactly 17 characters" maxlength="17" value="' + (v.vin || '') + '" oninput="_ob.vehicles[' + i + '].vin=this.value.toUpperCase().slice(0,17);this.value=this.value.toUpperCase().slice(0,17)" style="width:100%;box-sizing:border-box;padding:8px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-size:14px;font-family:inherit;letter-spacing:.05em">' : '') + '</div>';
}
function obAddVehicle() {
  _ob.vehicles.push({
    name: '',
    type: 'Truck',
    vin: ''
  });
  obStep6(document.getElementById('ob-body'));
}
function obNext6() {
  const err = document.getElementById('ob-err');
  if (!_ob.vehicles.length) {
    if (err) err.textContent = 'Add at least one vehicle.';
    return;
  }
  for (const v of _ob.vehicles) {
    if (!v.name.trim()) {
      if (err) err.textContent = 'Enter a name for each vehicle.';
      return;
    }
  }
  if (_ob.vehicles.length > 1) {
    for (const v of _ob.vehicles) {
      const vin = (v.vin || '').trim();
      if (!vin) {
        if (err) err.textContent = 'VIN required when you have more than one vehicle.';
        return;
      }
      if (vin.length !== 17) {
        if (err) err.textContent = 'VIN must be exactly 17 characters (' + vin.length + ' entered).';
        return;
      }
    }
  }
  _ob.step = 8;
  renderObStep();
}
function obStep7(el) {
  el.innerHTML = '<div style="margin-bottom:28px"><div style="font-size:28px;margin-bottom:10px">👥</div><div style="font-size:22px;font-weight:800;letter-spacing:-.02em;margin-bottom:4px">Add your team</div><div style="font-size:14px;color:var(--text3)">Optional — you can add crew later in Settings</div></div>' + '<div id="ob-team-list">' + (_ob.team.length ? _ob.team.map((m, i) => obTeamRow(m, i)).join('') : '') + '</div>' + '<button onclick="obAddTeam()" style="width:100%;padding:12px;border-radius:var(--r);border:2px dashed var(--border2);background:var(--bg2);cursor:pointer;font-family:inherit;font-size:14px;color:var(--blue);font-weight:700;margin-bottom:14px">+ Add team member</button>' + obBtn('Continue', '_ob.step=9;renderObStep()') + obBtn('Back', '_ob.step=7;renderObStep()', true);
}
function obTeamRow(m, i) {
  return '<div style="border:1px solid var(--border2);border-radius:var(--r);padding:12px;margin-bottom:10px">' + '<div style="display:flex;justify-content:space-between;margin-bottom:8px">' + '<div style="font-size:13px;font-weight:700">Member ' + (i + 1) + '</div>' + '<button onclick="_ob.team.splice(' + i + ',1);obStep7(document.getElementById(\'ob-body\'))" style="border:none;background:none;color:#A32D2D;cursor:pointer;font-size:18px;padding:0">×</button>' + '</div>' + '<input placeholder="Name" value="' + (m.name || '') + '" oninput="_ob.team[' + i + '].name=this.value" style="width:100%;box-sizing:border-box;margin-bottom:8px;padding:8px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-size:14px;font-family:inherit">' + '<input placeholder="Phone or email (optional)" value="' + (m.contact || '') + '" oninput="_ob.team[' + i + '].contact=this.value" style="width:100%;box-sizing:border-box;margin-bottom:8px;padding:8px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-size:14px;font-family:inherit">' + '<select oninput="_ob.team[' + i + '].role=this.value" style="width:100%;box-sizing:border-box;padding:8px;border-radius:var(--r);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-size:14px;font-family:inherit">' + ['estimator', 'technician', 'apprentice'].map(r => '<option' + (m.role === r ? ' selected' : '') + '>' + r + '</option>').join('') + '</select>' + '</div>';
}
function obAddTeam() {
  _ob.team.push({
    name: '',
    role: 'technician',
    contact: ''
  });
  obStep7(document.getElementById('ob-body'));
}
function obStep8(el) {
  el.innerHTML = '<div style="margin-bottom:28px"><div style="font-size:28px;margin-bottom:10px">💳</div>' + '<div style="font-size:22px;font-weight:800;letter-spacing:-.02em;margin-bottom:4px">Accept card payments</div>' + '<div style="font-size:14px;color:var(--text3)">Optional — clients can always pay cash if you skip this</div></div>' + '<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:var(--r);padding:14px;margin-bottom:16px;font-size:13px;color:#166534;line-height:1.7">' + '<strong>How it works:</strong> Clients pay their deposit directly to your bank via Stripe. Card payments include a 2.9% + $0.30 fee — auto-logged as a tax deductible expense.' + '</div>' + '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:14px;margin-bottom:16px;font-size:13px;color:var(--text2);line-height:1.6">' + 'After signing up, go to <strong>Settings → Stripe Connect</strong> and tap <strong>"Connect Stripe Account"</strong> to link your bank. No keys to copy — takes about 2 minutes.' + '</div>' + '<div id="ob-err" style="color:#A32D2D;font-size:12px;min-height:16px;margin-bottom:8px"></div>' + obBtn('Got it — continue', '_ob.step=10;renderObStep()') + obBtn('Back', '_ob.step=8;renderObStep()', true);
}
function obStep9(el) {
  el.innerHTML = '<div style="margin-bottom:28px"><div style="font-size:28px;margin-bottom:10px">✓</div><div style="font-size:22px;font-weight:800;letter-spacing:-.02em;margin-bottom:4px">You\'re all set</div><div style="font-size:14px;color:var(--text3)">Review your details before creating your account</div></div>' + '<div style="background:var(--bg2);border-radius:var(--r);padding:14px;margin-bottom:16px">' + '<div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:13px"><span style="color:var(--text2)">Name</span><strong>' + _ob.name + '</strong></div>' + '<div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:13px"><span style="color:var(--text2)">Email</span><strong>' + _ob.email + '</strong></div>' + '<div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:13px"><span style="color:var(--text2)">Business</span><strong>' + _ob.businessName + '</strong></div>' + '<div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:13px"><span style="color:var(--text2)">Trades</span><strong>' + (_ob.tradeLines.length ? _ob.tradeLines.join(', ') : _ob.businessType) + '</strong></div>' + '<div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:13px"><span style="color:var(--text2)">Role</span><strong>' + _ob.role + '</strong></div>' + '<div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:var(--text2)">Vehicles</span><strong>' + _ob.vehicles.length + '</strong></div>' + '</div>' + '<div id="ob-err" style="color:#A32D2D;font-size:12px;min-height:16px;margin-bottom:8px"></div>' + '<div id="ob-progress" style="display:none;font-size:12px;color:var(--text3);text-align:center;margin-bottom:8px"></div>' + obBtn('Create my account', 'obSubmit()') + obBtn('Back', '_ob.step=9;renderObStep()', true);
}
async function obSubmit() {
  const err = document.getElementById('ob-err');
  const prog = document.getElementById('ob-progress');
  if (err) err.textContent = '';
  function setProgress(msg) {
    if (prog) {
      prog.style.display = '';
      prog.textContent = msg;
    }
  }
  window._obInProgress = true;
  try {
    setProgress('Creating your account...');
    const {
      data: authData,
      error: authErr
    } = await _supa.auth.signUp({
      email: _ob.email,
      password: _ob.password
    });
    if (authErr) {
      if (authErr.message?.toLowerCase().includes('already registered') || authErr.status === 422) {
        document.getElementById('onboarding-overlay')?.remove();
        supaShowLogin();
        setTimeout(() => {
          const el = document.getElementById('supa-login-err');
          if (el) {
            el.textContent = 'Account already exists — sign in below.';
            el.style.color = 'var(--blue)';
          }
        }, 150);
        return;
      }
      throw authErr;
    }
    // Sign in immediately to get a live session so RLS works for inserts
    const {
      data: signInData,
      error: signInErr
    } = await _supa.auth.signInWithPassword({
      email: _ob.email,
      password: _ob.password
    });
    if (signInErr) throw new Error('Account created — please sign in to continue.');
    const uid = signInData.user?.id;
    if (!uid) throw new Error('Could not get user ID');
    _supaUser = signInData.user;
    setProgress('Setting up your business...');
    const {
      data: acct,
      error: acctErr
    } = await _supa.from('accounts').insert({
      business_name: _ob.businessName,
      phone: _ob.phone,
      email: _ob.email,
      address: _ob.address,
      license_info: _ob.licenseInfo,
      owner_id: uid,
      state: _ob.state
    }).select().maybeSingle();
    if (acctErr) throw acctErr;
    _account = acct;
    setProgress('Creating your profile...');
    await _supa.from('users').insert({
      id: uid,
      email: _ob.email,
      name: _ob.name,
      role: _ob.role,
      account_id: acct.id,
      business_type: _ob.businessType
    });
    await _supa.from('account_users').insert({
      account_id: acct.id,
      user_id: uid,
      role: _ob.role
    });
    setProgress('Adding vehicles...');
    if (_ob.vehicles.length) {
      await _supa.from('vehicles').insert(_ob.vehicles.map(v => ({
        account_id: acct.id,
        name: v.name,
        type: v.type,
        vin: v.vin || null
      })));
    }
    setProgress('Configuring your workflow...');
    const _obTradeLines = _ob.tradeLines.length > 1 ? _ob.tradeLines.join(',') : null;
    const cfg = {
      ...(BUSINESS_CONFIGS[_ob.businessType] || BUSINESS_CONFIGS.other),
      account_id: acct.id,
      business_type: _ob.businessType,
      state: _ob.state,
      ...(_obTradeLines ? {
        trade_lines: _obTradeLines
      } : {})
    };
    const {
      data: cfgData
    } = await _supa.from('account_config').insert(cfg).select().maybeSingle();
    _config = cfgData;
    await _supa.from('zj_data').insert({
      user_id: uid,
      account_id: acct.id
    });
    S.bname = _ob.businessName;
    S.bphone = _ob.phone;
    S.blic = _ob.licenseInfo;
    S.state = _ob.state || 'KS';
    _user = {
      id: uid,
      email: _ob.email,
      name: _ob.name,
      role: _ob.role,
      account_id: acct.id
    };
    setOwnerName(_ob.name);
    saveAll();
    _vehicles = _ob.vehicles;
    setProgress('All done! Loading TradeDesk...');
    await new Promise(r => setTimeout(r, 600));
    document.getElementById('onboarding-overlay')?.remove();
    window._obInProgress = false;
    saveAll();
    applyPermissions();
    renderDash();
    buildScopeGrid();
    goPg('pg-dash');
  } catch (e) {
    window._obInProgress = false;
    console.error('Onboarding failed:', e);
    if (err) err.textContent = e.message || 'Something went wrong. Try again.';
    if (prog) prog.style.display = 'none';
  }
}
function getDashGreeting() {
  const hr = new Date().getHours();
  const time = hr < 12 ? 'Good Morning' : hr < 17 ? 'Good Afternoon' : 'Good Evening';
  const name = getUserName() || '';
  return name ? time + ', ' + name.split(' ')[0] + '!' : time + '!';
}

// ── Global search ────────────────────────────────────────────────────
function openSearch() {
  if (document.getElementById('global-search-overlay')) return;
  const ov = document.createElement('div');
  ov.id = 'global-search-overlay';
  ov.className = 'search-overlay';
  ov.onclick = e => {
    if (e.target === ov) closeSearch();
  };
  ov.innerHTML = '<div class="search-box">' + '<div class="search-input-wrap">' + '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>' + '<input id="global-search-input" placeholder="Search clients, bids, expenses, jobs…" autocomplete="off" oninput="runSearch(this.value)">' + '<button onclick="closeSearch()" style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:20px;padding:0;line-height:1">×</button>' + '</div>' + '<div class="search-results" id="search-results"><div class="search-empty">Start typing to search...</div></div>' + '</div>';
  document.body.appendChild(ov);
  setTimeout(() => document.getElementById('global-search-input')?.focus(), 100);
  document.addEventListener('keydown', searchEsc);
}
function searchEsc(e) {
  if (e.key === 'Escape') closeSearch();
}
function closeSearch() {
  document.getElementById('global-search-overlay')?.remove();
  document.removeEventListener('keydown', searchEsc);
}
function runSearch(q) {
  const el = document.getElementById('search-results');
  if (!el) return;
  q = (q || '').toLowerCase().trim();
  if (!q) {
    el.innerHTML = '<div class="search-empty">Start typing to search...</div>';
    return;
  }
  const results = [];

  // Clients
  (clients || []).forEach(c => {
    if ([c.name, c.addr, c.phone, c.email].some(f => f?.toLowerCase().includes(q))) {
      const st = getClientStage(c.id);
      results.push({
        type: 'client',
        icon: '👤',
        bg: 'var(--blue-lt)',
        name: c.name,
        meta: c.addr?.split(',')[0] || c.phone || '',
        sub: st.label,
        action: () => {
          closeSearch();
          openClientDetail(c.id);
        }
      });
    }
  });

  // Bids
  (bids || []).forEach(b => {
    if ([b.client_name, b.name, b.notes, b.addr, b.type].some(f => f?.toLowerCase().includes(q))) {
      results.push({
        type: 'bid',
        icon: '📋',
        bg: 'var(--amber-lt)',
        name: b.client_name || b.name,
        meta: 'Bid · ' + fmt(b.amount || 0),
        sub: b.status || 'Pending',
        action: () => {
          closeSearch();
          goPg('pg-leads');
        }
      });
    }
  });

  // Expenses — the main event for "Sherwin Williams" etc.
  (expenses || []).forEach(e => {
    if ([e.vendor, e.notes, e.catLabel, e.job_name].some(f => f?.toLowerCase().includes(q))) {
      const dateStr = e.date ? fmtDateShort(e.date) : '';
      results.push({
        type: 'expense',
        icon: '🧾',
        bg: '#FEF2F2',
        name: e.vendor || 'Expense',
        meta: fmt(e.amount || 0) + (dateStr ? ' · ' + dateStr : ''),
        sub: e.catLabel || e.cat || '',
        action: () => {
          closeSearch();
          goPg('pg-tracker');
          setTimeout(() => {
            const b = document.getElementById('tr-t-expenses');
            if (b) b.click();
          }, 200);
        }
      });
    }
  });

  // Jobs
  (jobs || []).filter(j => j.eventType !== 'task').forEach(j => {
    if ([j.name, j.addr, j.notes].some(f => f?.toLowerCase().includes(q))) {
      const dateStr = j.start ? new Date(j.start + 'T12:00').toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
      }) : '';
      results.push({
        type: 'job',
        icon: '🔨',
        bg: 'var(--green-lt)',
        name: j.name,
        meta: fmt(j.value || 0) + (dateStr ? ' · ' + dateStr : ''),
        sub: j.status || '',
        action: () => {
          closeSearch();
          goPg('pg-jobs');
        }
      });
    }
  });

  // Mileage
  (mileage || []).forEach(m => {
    if ([m.purpose, m.client_name, m.to, m.from, m.to_name].some(f => f?.toLowerCase().includes(q))) {
      const dateStr = m.date ? fmtDateShort(m.date) : '';
      results.push({
        type: 'mileage',
        icon: '🚗',
        bg: 'var(--bg2)',
        name: m.purpose || m.client_name || 'Trip',
        meta: (m.miles || 0).toFixed(1) + ' mi' + (dateStr ? ' · ' + dateStr : ''),
        sub: m.client_name || '',
        action: () => {
          closeSearch();
          goPg('pg-tracker');
          setTimeout(() => {
            const b = document.getElementById('tr-t-mileage');
            if (b) b.click();
          }, 200);
        }
      });
    }
  });

  // Income + payments
  [...(income || []), ...(payments || [])].forEach(r => {
    if ([r.client_name, r.type, r.notes, r.method].some(f => f?.toLowerCase().includes(q))) {
      const dateStr = r.date ? fmtDateShort(r.date) : '';
      results.push({
        type: 'income',
        icon: '💰',
        bg: 'var(--green-lt)',
        name: r.client_name || 'Payment',
        meta: fmt(r.amount || 0) + (dateStr ? ' · ' + dateStr : ''),
        sub: r.type || r.method || '',
        action: () => {
          closeSearch();
          goPg('pg-tracker');
          setTimeout(() => {
            const b = document.getElementById('tr-t-income');
            if (b) b.click();
          }, 200);
        }
      });
    }
  });

  // Amount search across bids and expenses
  if (/^\$?[\d,.]+$/.test(q.replace(/\s/g, ''))) {
    const amt = parseFloat(q.replace(/[$,]/g, ''));
    (expenses || []).filter(e => Math.abs((e.amount || 0) - amt) < 1 && !results.find(r => r.type === 'expense' && r.name === (e.vendor || '') && r.meta.startsWith(fmt(e.amount)))).forEach(e => {
      results.push({
        type: 'expense',
        icon: '🧾',
        bg: '#FEF2F2',
        name: e.vendor || 'Expense',
        meta: fmt(e.amount) + (e.date ? ' · ' + fmtDateShort(e.date) : ''),
        sub: e.catLabel || '',
        action: () => {
          closeSearch();
          goPg('pg-tracker');
          setTimeout(() => {
            const b = document.getElementById('tr-t-expenses');
            if (b) b.click();
          }, 200);
        }
      });
    });
  }
  if (!results.length) {
    el.innerHTML = '<div class="search-empty">No results for "' + escHtml(q.slice(0, 30)) + '"</div>';
    return;
  }

  // Group by type with section headers
  const TYPE_ORDER = ['client', 'bid', 'expense', 'job', 'income', 'mileage'];
  const TYPE_LABEL = {
    client: 'Clients',
    bid: 'Bids',
    expense: 'Expenses',
    job: 'Jobs',
    income: 'Payments',
    mileage: 'Mileage'
  };
  const MAX_PER = 10;
  const byType = {};
  results.forEach(r => {
    (byType[r.type] = byType[r.type] || []).push(r);
  });
  window._searchResults = [];
  let html = '',
    flatIdx = 0;
  TYPE_ORDER.filter(t => byType[t]).forEach(t => {
    const grp = byType[t];
    html += `<div style="font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);padding:8px 18px 4px;background:var(--bg2)">${TYPE_LABEL[t]} (${grp.length})</div>`;
    grp.slice(0, MAX_PER).forEach(r => {
      window._searchResults.push(r);
      html += `<div class="search-result-item" onclick="_searchResults[${flatIdx}].action()">
        <div class="search-result-icon" style="background:${r.bg}">${r.icon}</div>
        <div style="min-width:0;flex:1">
          <div class="search-result-name">${escHtml(r.name || '')}</div>
          <div class="search-result-meta">${escHtml(r.meta || '')}${r.sub ? ' · ' + escHtml(r.sub) : ''}</div>
        </div>
      </div>`;
      flatIdx++;
    });
    if (grp.length > MAX_PER) html += `<div style="font-size:11px;color:var(--text3);padding:5px 18px 8px;font-style:italic">…and ${grp.length - MAX_PER} more</div>`;
  });
  el.innerHTML = html;
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "js/settings.js", error: String((e && e.message) || e) }); }

// js/utils.js
try { (() => {
const fmt = n => '$' + Number(n || 0).toLocaleString('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
const fmtShort = n => {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1000000) return '$' + (v / 1000000).toLocaleString('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  }) + 'M';
  if (Math.abs(v) >= 1000) return '$' + (v / 1000).toLocaleString('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  }) + 'K';
  return '$' + v.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });
};
function formatPhoneDisplay(val) {
  let d = (val || '').replace(/\D/g, '').slice(0, 10);
  if (d.length >= 7) return d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
  if (d.length >= 4) return d.slice(0, 3) + '-' + d.slice(3);
  return d;
}
function fmtPhone(input) {
  let d = input.value.replace(/\D/g, '');
  if (d.length > 10) d = d.slice(0, 10);
  if (d.length >= 7) d = d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);else if (d.length >= 4) d = d.slice(0, 3) + '-' + d.slice(3);
  input.value = d;
}
const fmt2 = n => '$' + (Math.ceil((n || 0) / 5) * 5).toLocaleString();
const fmtD = n => '$' + parseFloat(n || 0).toLocaleString('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
const dateKey = d => {
  const y = d.getFullYear(),
    m = String(d.getMonth() + 1).padStart(2, '0'),
    day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
};
const todayKey = () => dateKey(new Date());
const parseD = s => new Date(s + 'T12:00:00');
const addDays = (s, n) => {
  const d = parseD(s);
  d.setDate(d.getDate() + n);
  return dateKey(d);
};
const v = id => (document.getElementById(id) || {}).value || '';
const nv = id => parseFloat(v(id)) || 0;
const IRS = () => S.irsRate || .725;
function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return h12 + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
}
const COVERAGE = () => S.cov || 350;
const MARGIN = () => (S.margin || 25) / 100;
const MATMARK = () => 1 + (S.mm || 20) / 100;
const LABOR_RATES = () => ({
  walls: S.rWalls || 1.30,
  ceiling: S.rCeil || 1.00,
  trim: S.rTrim || 4.00,
  doors: S.rDoor || 95,
  windows: S.rWin || 50,
  cabinets: S.rCabinets || 38,
  ext_walls: S.rExt || 1.10,
  ext_trim: S.rTrim || 4.00,
  deck: S.rDeck || 1.00,
  fence: S.rFence || 1.25,
  epoxy: S.rEpoxy || 1.75
});
function initials(name) {
  const p = (name || '?').trim().split(' ');
  return p.length >= 2 ? (p[0][0] + p[p.length - 1][0]).toUpperCase() : (name || '?').substring(0, 2).toUpperCase();
}
function stageAvatar(stage) {
  const m = {
    new: 'background:var(--blue-lt);color:var(--blue-dk)',
    est_scheduled: 'background:var(--blue-lt);color:var(--blue-dk)',
    bid_out: 'background:var(--blue-lt);color:var(--blue-dk)',
    bid_urgent: 'background:#FEF3C7;color:#92400E',
    abandoned: 'background:#FEF3C7;color:#92400E',
    signed: 'background:var(--green-lt);color:#2D5A14',
    scheduled: 'background:var(--green-lt);color:#2D5A14',
    active: 'background:var(--green-lt);color:#2D5A14',
    balance_due: 'background:#FEE8E8;color:#A32D2D',
    paid: 'background:var(--bg2);color:var(--text3)'
  };
  return m[stage] || 'background:var(--blue-lt);color:var(--blue-dk)';
}
function lighten(hex) {
  try {
    const r = parseInt(hex.slice(1, 3), 16),
      g = parseInt(hex.slice(3, 5), 16),
      b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},0.15)`;
  } catch (e) {
    return '#eee';
  }
}
function barChart(label, val, total, color) {
  const pct = Math.round(val / total * 100);
  return `<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px"><span>${label}</span><span style="font-weight:700">${fmt(val)}</span></div><div class="prog-bar"><div class="prog-fill" style="width:${pct}%;background:${color}"></div></div></div>`;
}
function calcBrackets(inc, brackets) {
  let tax = 0,
    prev = 0;
  for (const [lim, rate] of brackets) {
    if (inc <= prev) break;
    tax += Math.max(0, Math.min(inc, lim) - prev) * rate;
    prev = lim;
    if (lim === Infinity || inc <= lim) break;
  }
  return tax;
}
function fmtDateShort(d) {
  if (!d) return '';
  try {
    const dt = new Date(d + 'T12:00');
    return dt.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  } catch (e) {
    return d;
  }
}
function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function closeTopModal() {
  const o = document.querySelector('.zmodal-overlay');
  if (o && typeof o.remove === 'function') o.remove();else if (o && o.parentNode) o.parentNode.removeChild(o);
}
function zConfirm(msg, onYes, opts = {}) {
  const title = opts.title || 'Are you sure?';
  const yesLabel = opts.yes || 'Yes';
  const noLabel = opts.no || 'Cancel';
  const danger = opts.danger !== false;
  const onNo = opts.onNo || null; // optional callback when user taps No/Cancel
  const overlay = document.createElement('div');
  overlay.className = 'zmodal-overlay';
  overlay.innerHTML = '<div class="zmodal">' + '<div class="zmodal-title">' + title + '</div>' + '<div class="zmodal-msg">' + msg + '</div>' + '<div class="zmodal-btns">' + '<button class="btn zmodal-cancel" style="font-size:14px;padding:10px 16px">' + noLabel + '</button>' + '<button id="zmodal-yes" class="btn" style="font-size:14px;padding:10px 16px;background:' + (danger ? '#A32D2D' : 'var(--blue)') + ';color:#fff;border-color:' + (danger ? '#A32D2D' : 'var(--blue)') + '">' + yesLabel + '</button>' + '</div>' + '</div>';
  document.body.appendChild(overlay);
  const cancelBtns = overlay.querySelectorAll('.zmodal-cancel');
  cancelBtns.forEach(b => b.onclick = () => {
    overlay.remove();
    if (onNo) onNo();
  });
  overlay.querySelector('#zmodal-yes').onclick = () => {
    overlay.remove();
    onYes();
  };
  overlay.addEventListener('click', e => {
    if (e.target === overlay) {
      overlay.remove();
      if (onNo) onNo();
    }
  });
}
function zAlert(msg, opts = {}) {
  const title = opts.title || 'Notice';
  const overlay = document.createElement('div');
  overlay.className = 'zmodal-overlay';
  overlay.innerHTML = '<div class="zmodal">' + '<div class="zmodal-title">' + title + '</div>' + '<div class="zmodal-msg">' + msg + '</div>' + '<div class="zmodal-btns">' + '<button class="btn btn-p zmodal-ok" style="font-size:14px;padding:10px 20px">OK</button>' + '</div>' + '</div>';
  document.body.appendChild(overlay);
  overlay.querySelectorAll('.zmodal-ok,.zmodal-cancel').forEach(b => b.onclick = () => overlay.remove());
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.remove();
  });
}
function showToast(msg, icon, duration) {
  icon = icon || '✓';
  duration = duration || 3500;
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = '<span class="toast-icon">' + icon + '</span><span style="flex:1">' + msg + '</span><button class="toast-close" onclick="this.parentElement.remove()">×</button>';
  document.body.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'scale(.9) translateY(8px)';
    t.style.transition = 'all .3s';
    setTimeout(() => t.remove(), 300);
  }, duration);
}
function _fmtExpDate(el) {
  let v = el.value.replace(/\D/g, '');
  if (v.length > 2) v = v.slice(0, 2) + '/' + v.slice(2);
  if (v.length > 5) v = v.slice(0, 5) + '/' + v.slice(5, 9);
  el.value = v;
}
function _ymdToMdY(s) {
  if (!s || !s.includes('-')) return s || '';
  const [y, m, d] = s.split('-');
  return m + '/' + d + '/' + y;
}
function _mdYToYmd(s) {
  if (!s || !s.includes('/')) return s || '';
  const p = s.split('/');
  if (p.length !== 3 || p[2].length !== 4) return '';
  return p[2] + '-' + p[0].padStart(2, '0') + '-' + p[1].padStart(2, '0');
}

// ── Supabase cloud sync ───────────────────────────────────────────────
})(); } catch (e) { __ds_ns.__errors.push({ path: "js/utils.js", error: String((e && e.message) || e) }); }

// ui_kits/app/Books.jsx
try { (() => {
/* Books.jsx · clean rewrite — income / expenses / Everlance-style mileage */
const {
  useState: useBooksState
} = React;
function Books({
  data
}) {
  const [tab, setTab] = useBooksState("income");
  const tabs = [{
    id: "income",
    label: "Income",
    count: data.income.length
  }, {
    id: "expenses",
    label: "Expenses",
    count: data.expenses.length
  }, {
    id: "mileage",
    label: "Mileage",
    count: data.mileage.length
  }];
  const totalIncome = data.income.reduce((s, r) => s + r.amt, 0);
  const totalExpenses = data.expenses.reduce((s, r) => s + r.amt, 0);
  const totalMiles = data.mileage.reduce((s, r) => s + r.miles, 0);
  const irsRate = 0.70;
  const mileDeduction = Math.round(totalMiles * irsRate);
  return /*#__PURE__*/React.createElement("div", {
    className: "pg"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tbar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tbar-l"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tbar-eyebrow"
  }, "Tracked since Jan 1 \xB7 IRS Schedule C ready"), /*#__PURE__*/React.createElement("div", {
    className: "tbar-title"
  }, "Books"), /*#__PURE__*/React.createElement("div", {
    className: "tbar-sub"
  }, "Every payment, receipt, and mile. Categories follow IRS Schedule C buckets so taxes are one tap.")), /*#__PURE__*/React.createElement("div", {
    className: "tbar-r"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn"
  }, "\uD83D\uDCF7 Scan receipt"), /*#__PURE__*/React.createElement("button", {
    className: "btn"
  }, "\uD83D\uDCCD Log trip"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-p"
  }, "+ Add entry"))), /*#__PURE__*/React.createElement("div", {
    className: "mets"
  }, /*#__PURE__*/React.createElement("div", {
    className: "met"
  }, /*#__PURE__*/React.createElement("div", {
    className: "met-l"
  }, "Income YTD"), /*#__PURE__*/React.createElement("div", {
    className: "met-v",
    style: {
      color: 'var(--c-green)'
    }
  }, "$", (totalIncome / 1000).toFixed(1), "k"), /*#__PURE__*/React.createElement("div", {
    className: "met-s up"
  }, "+12% vs LY")), /*#__PURE__*/React.createElement("div", {
    className: "met"
  }, /*#__PURE__*/React.createElement("div", {
    className: "met-l"
  }, "Expenses YTD"), /*#__PURE__*/React.createElement("div", {
    className: "met-v",
    style: {
      color: 'var(--c-red)'
    }
  }, "$", (totalExpenses / 1000).toFixed(2), "k"), /*#__PURE__*/React.createElement("div", {
    className: "met-s"
  }, data.expenses.length, " receipts logged")), /*#__PURE__*/React.createElement("div", {
    className: "met"
  }, /*#__PURE__*/React.createElement("div", {
    className: "met-l"
  }, "Miles YTD"), /*#__PURE__*/React.createElement("div", {
    className: "met-v"
  }, totalMiles.toFixed(1), /*#__PURE__*/React.createElement("span", {
    className: "unit"
  }, "mi")), /*#__PURE__*/React.createElement("div", {
    className: "met-s"
  }, "deduction $", mileDeduction.toLocaleString(), " @ $", irsRate, "/mi")), /*#__PURE__*/React.createElement("div", {
    className: "met"
  }, /*#__PURE__*/React.createElement("div", {
    className: "met-l"
  }, "Net profit"), /*#__PURE__*/React.createElement("div", {
    className: "met-v",
    style: {
      color: 'var(--c-green)'
    }
  }, "$", ((totalIncome - totalExpenses - mileDeduction) / 1000).toFixed(1), "k"), /*#__PURE__*/React.createElement("div", {
    className: "met-s"
  }, "before tax"))), /*#__PURE__*/React.createElement("div", {
    className: "fbar"
  }, tabs.map(t => /*#__PURE__*/React.createElement("button", {
    key: t.id,
    className: "fb" + (tab === t.id ? " active" : ""),
    onClick: () => setTab(t.id)
  }, t.label, /*#__PURE__*/React.createElement("span", {
    className: "fb-count"
  }, t.count)))), tab === "income" && /*#__PURE__*/React.createElement("div", {
    className: "card card-pad-0"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd-title"
  }, "Income entries"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-sm"
  }, "Export CSV")), /*#__PURE__*/React.createElement("table", {
    className: "tbl"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Date"), /*#__PURE__*/React.createElement("th", null, "Client"), /*#__PURE__*/React.createElement("th", null, "Type"), /*#__PURE__*/React.createElement("th", null, "Method"), /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'right'
    }
  }, "Amount"))), /*#__PURE__*/React.createElement("tbody", null, data.income.map((r, i) => /*#__PURE__*/React.createElement("tr", {
    key: i
  }, /*#__PURE__*/React.createElement("td", {
    className: "muted"
  }, r.date), /*#__PURE__*/React.createElement("td", {
    style: {
      fontWeight: 700
    }
  }, r.who), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
    className: "bdg-soft sf-paid"
  }, r.label)), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
    className: "chip"
  }, r.method)), /*#__PURE__*/React.createElement("td", {
    className: "num green"
  }, "+$", r.amt.toLocaleString())))))), tab === "expenses" && /*#__PURE__*/React.createElement("div", {
    className: "card card-pad-0"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd-title"
  }, "Expenses \xB7 Schedule C buckets"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-sm"
  }, "Export CSV")), /*#__PURE__*/React.createElement("table", {
    className: "tbl"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Date"), /*#__PURE__*/React.createElement("th", null, "Vendor"), /*#__PURE__*/React.createElement("th", null, "Category"), /*#__PURE__*/React.createElement("th", null, "Receipt"), /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'right'
    }
  }, "Amount"))), /*#__PURE__*/React.createElement("tbody", null, data.expenses.map((r, i) => /*#__PURE__*/React.createElement("tr", {
    key: i
  }, /*#__PURE__*/React.createElement("td", {
    className: "muted"
  }, r.date), /*#__PURE__*/React.createElement("td", {
    style: {
      fontWeight: 700
    }
  }, r.vendor), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
    className: "chip"
  }, r.cat)), /*#__PURE__*/React.createElement("td", null, r.recpt ? /*#__PURE__*/React.createElement("span", {
    className: "bdg-soft sf-won"
  }, "\uD83D\uDCCE Attached") : /*#__PURE__*/React.createElement("span", {
    className: "bdg-soft sf-pending"
  }, "Missing")), /*#__PURE__*/React.createElement("td", {
    className: "num red"
  }, "-$", r.amt.toLocaleString())))))), tab === "mileage" && /*#__PURE__*/React.createElement(MileageView, {
    irsRate: irsRate
  }), (tab === "income" || tab === "expenses") && /*#__PURE__*/React.createElement("div", {
    className: "tip t-s",
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 18
    }
  }, "\uD83D\uDCA1"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", null, "Receipt scanner \xB7 "), "Photograph a receipt and Claude reads the vendor, amount, date, and category. Tap \"Scan receipt\" up top.")));
}

/* ─── Mileage · vehicle odometer + day-group accordion ─── */
function MileageView({
  irsRate
}) {
  const [vehicle, setVehicle] = useBooksState({
    label: "Ford F-150 · 2018",
    plate: "KS · 482-NRM",
    startOdo: 142810,
    endOdo: 149650,
    yearStart: "Jan 1, 2026"
  });
  const totalMilesYTD = vehicle.endOdo - vehicle.startOdo;
  const trips = [{
    id: 1,
    date: "May 12 · 9:42 AM",
    from: "Office · 1042 Saint Francis",
    to: "Hendrickson · 2418 Riverside Dr",
    fromTime: "9:42 AM",
    toTime: "10:03 AM",
    miles: 9.2,
    dur: "21m",
    purpose: null,
    needsReview: true,
    vehicle: "F-150"
  }, {
    id: 2,
    date: "May 11 · 7:18 AM",
    from: "Office",
    to: "Hendrickson",
    fromTime: "7:18 AM",
    toTime: "7:39 AM",
    miles: 9.2,
    dur: "21m",
    purpose: "Customer visit",
    needsReview: false,
    vehicle: "F-150"
  }, {
    id: 3,
    date: "May 11 · 4:12 PM",
    from: "Hendrickson",
    to: "Sherwin-Williams · 31st & Webb",
    fromTime: "4:12 PM",
    toTime: "4:31 PM",
    miles: 5.8,
    dur: "19m",
    purpose: "Supplier run",
    needsReview: false,
    vehicle: "F-150"
  }, {
    id: 4,
    date: "May 10 · 8:04 AM",
    from: "Office",
    to: "Whitlock · 12 Cedar Ridge",
    fromTime: "8:04 AM",
    toTime: "8:34 AM",
    miles: 14.4,
    dur: "30m",
    purpose: "Estimate visit",
    needsReview: false,
    vehicle: "F-150"
  }, {
    id: 5,
    date: "May 8 · 8:30 AM",
    from: "Office",
    to: "Calle · 17 Bluegrass · Andover",
    fromTime: "8:30 AM",
    toTime: "9:01 AM",
    miles: 18.1,
    dur: "31m",
    purpose: null,
    needsReview: true,
    vehicle: "F-150"
  }, {
    id: 6,
    date: "May 7 · 10:15 AM",
    from: "Hendrickson",
    to: "Home Depot · West",
    fromTime: "10:15 AM",
    toTime: "10:32 AM",
    miles: 6.4,
    dur: "17m",
    purpose: "Supplier run",
    needsReview: false,
    vehicle: "F-150"
  }];
  const [filter, setFilter] = useBooksState("all");
  const filters = [{
    id: "all",
    label: "All trips",
    count: trips.length
  }, {
    id: "unclassified",
    label: "Needs purpose",
    count: trips.filter(t => t.needsReview).length
  }, {
    id: "classified",
    label: "Categorized",
    count: trips.filter(t => !t.needsReview).length
  }];
  const filtered = filter === "all" ? trips : filter === "unclassified" ? trips.filter(t => t.needsReview) : trips.filter(t => !t.needsReview);
  const businessMiles = trips.filter(t => !t.needsReview).reduce((s, t) => s + t.miles, 0);
  const personalMiles = Math.max(0, totalMilesYTD - businessMiles);
  const businessPct = totalMilesYTD > 0 ? Math.round(businessMiles / totalMilesYTD * 100) : 0;
  const deduction = businessMiles * irsRate;
  const next = trips.find(t => t.needsReview);

  // Group trips by day
  const dayMap = new Map();
  filtered.forEach(t => {
    const day = t.date.split('·')[0].trim();
    if (!dayMap.has(day)) dayMap.set(day, {
      label: day,
      trips: [],
      dow: "",
      dayNum: "",
      monthShort: ""
    });
    dayMap.get(day).trips.push(t);
  });
  const dowMap = {
    "May 12": "Tue",
    "May 11": "Mon",
    "May 10": "Sun",
    "May 9": "Sat",
    "May 8": "Fri",
    "May 7": "Thu"
  };
  const days = Array.from(dayMap.values()).map(d => {
    const [m, n] = d.label.split(' ');
    d.monthShort = m;
    d.dayNum = n;
    d.dow = dowMap[d.label] || "—";
    return d;
  });
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "mil-hero"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mil-hero-l"
  }, /*#__PURE__*/React.createElement("div", {
    className: "td-micro",
    style: {
      color: 'rgba(255,255,255,.55)',
      marginBottom: 8
    }
  }, "Mileage deduction \xB7 year-to-date"), /*#__PURE__*/React.createElement("div", {
    className: "mil-deduction"
  }, "$", deduction.toFixed(2)), /*#__PURE__*/React.createElement("div", {
    className: "mil-meta"
  }, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", {
    style: {
      color: '#fff'
    }
  }, businessMiles.toFixed(1)), " business miles"), /*#__PURE__*/React.createElement("span", null, "\xB7"), /*#__PURE__*/React.createElement("span", null, "IRS rate $", irsRate, "/mi"), /*#__PURE__*/React.createElement("span", null, "\xB7"), /*#__PURE__*/React.createElement("span", null, trips.length, " trips logged")), /*#__PURE__*/React.createElement("div", {
    className: "mil-bar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mil-bar-seg mil-bar-business",
    style: {
      flex: Math.max(businessMiles, 1)
    }
  }, /*#__PURE__*/React.createElement("span", null, "Business ", businessPct, "%")), /*#__PURE__*/React.createElement("div", {
    className: "mil-bar-seg mil-bar-personal",
    style: {
      flex: Math.max(personalMiles, 1)
    }
  }, /*#__PURE__*/React.createElement("span", null, "Personal ", 100 - businessPct, "%"))), /*#__PURE__*/React.createElement("div", {
    className: "mil-bar-foot"
  }, /*#__PURE__*/React.createElement("span", null, vehicle.startOdo.toLocaleString(), " mi at ", vehicle.yearStart), /*#__PURE__*/React.createElement("span", null, vehicle.endOdo.toLocaleString(), " mi today \xB7 ", totalMilesYTD.toLocaleString(), " mi driven"))), /*#__PURE__*/React.createElement("div", {
    className: "mil-hero-r"
  }, /*#__PURE__*/React.createElement("button", {
    className: "mil-action mil-action-go"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mil-action-icon"
  }, "\uD83D\uDCCD"), /*#__PURE__*/React.createElement("div", {
    className: "mil-action-body"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mil-action-label"
  }, "Log a trip"), /*#__PURE__*/React.createElement("div", {
    className: "mil-action-sub"
  }, "Manual \xB7 type addresses + miles"))), /*#__PURE__*/React.createElement("button", {
    className: "mil-action"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mil-action-icon"
  }, "\uD83D\uDCD2"), /*#__PURE__*/React.createElement("div", {
    className: "mil-action-body"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mil-action-label"
  }, "Update odometer"), /*#__PURE__*/React.createElement("div", {
    className: "mil-action-sub"
  }, "Beginning & end-of-year readings"))), /*#__PURE__*/React.createElement("button", {
    className: "mil-action"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mil-action-icon"
  }, "\uD83D\uDCE4"), /*#__PURE__*/React.createElement("div", {
    className: "mil-action-body"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mil-action-label"
  }, "Export IRS report"), /*#__PURE__*/React.createElement("div", {
    className: "mil-action-sub"
  }, "Schedule C \xB7 Form 4562 \xB7 PDF + CSV"))))), /*#__PURE__*/React.createElement("div", {
    className: "card card-pad-0",
    style: {
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "card-hd-title"
  }, "Vehicle & odometer worksheet"), /*#__PURE__*/React.createElement("div", {
    className: "card-hd-sub"
  }, "Business use % is calculated from year-start and year-end readings")), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-sm"
  }, "+ Add vehicle")), /*#__PURE__*/React.createElement("div", {
    className: "mil-vehicle"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mil-vehicle-l"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mil-vehicle-icon"
  }, "\uD83D\uDEFB"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "mil-vehicle-name"
  }, vehicle.label), /*#__PURE__*/React.createElement("div", {
    className: "mil-vehicle-plate"
  }, "Plate ", vehicle.plate, " \xB7 primary work truck"))), /*#__PURE__*/React.createElement("div", {
    className: "mil-vehicle-grid"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mil-odo"
  }, /*#__PURE__*/React.createElement("div", {
    className: "td-micro"
  }, "Odometer \xB7 year start"), /*#__PURE__*/React.createElement("div", {
    className: "mil-odo-input"
  }, /*#__PURE__*/React.createElement("input", {
    value: vehicle.startOdo.toLocaleString(),
    onChange: e => setVehicle({
      ...vehicle,
      startOdo: +e.target.value.replace(/[^0-9]/g, '') || 0
    })
  }), /*#__PURE__*/React.createElement("span", {
    className: "mil-odo-suffix"
  }, "mi")), /*#__PURE__*/React.createElement("div", {
    className: "mil-odo-meta"
  }, "As of ", vehicle.yearStart)), /*#__PURE__*/React.createElement("div", {
    className: "mil-odo-arrow"
  }, "\u2192"), /*#__PURE__*/React.createElement("div", {
    className: "mil-odo"
  }, /*#__PURE__*/React.createElement("div", {
    className: "td-micro"
  }, "Odometer \xB7 today"), /*#__PURE__*/React.createElement("div", {
    className: "mil-odo-input"
  }, /*#__PURE__*/React.createElement("input", {
    value: vehicle.endOdo.toLocaleString(),
    onChange: e => setVehicle({
      ...vehicle,
      endOdo: +e.target.value.replace(/[^0-9]/g, '') || 0
    })
  }), /*#__PURE__*/React.createElement("span", {
    className: "mil-odo-suffix"
  }, "mi")), /*#__PURE__*/React.createElement("div", {
    className: "mil-odo-meta"
  }, "Update at year-end for Schedule C")), /*#__PURE__*/React.createElement("div", {
    className: "mil-odo-result"
  }, /*#__PURE__*/React.createElement("div", {
    className: "td-micro"
  }, "Total miles driven YTD"), /*#__PURE__*/React.createElement("div", {
    className: "mil-odo-big"
  }, totalMilesYTD.toLocaleString(), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14,
      color: 'var(--text-3)',
      marginLeft: 4,
      fontFamily: 'var(--font-ui)',
      fontWeight: 600
    }
  }, "mi")))), /*#__PURE__*/React.createElement("div", {
    className: "mil-calc"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mil-calc-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mil-calc-label"
  }, "Total miles driven"), /*#__PURE__*/React.createElement("div", {
    className: "mil-calc-eq"
  }, "="), /*#__PURE__*/React.createElement("div", {
    className: "mil-calc-v"
  }, totalMilesYTD.toLocaleString(), " mi")), /*#__PURE__*/React.createElement("div", {
    className: "mil-calc-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mil-calc-label"
  }, "Business miles logged \xB7 YTD"), /*#__PURE__*/React.createElement("div", {
    className: "mil-calc-eq"
  }, "\u2212"), /*#__PURE__*/React.createElement("div", {
    className: "mil-calc-v",
    style: {
      color: 'var(--c-green)'
    }
  }, businessMiles.toFixed(1), " mi")), /*#__PURE__*/React.createElement("div", {
    className: "mil-calc-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mil-calc-label"
  }, "Personal miles (everything else)"), /*#__PURE__*/React.createElement("div", {
    className: "mil-calc-eq"
  }, "="), /*#__PURE__*/React.createElement("div", {
    className: "mil-calc-v"
  }, personalMiles.toFixed(1), " mi")), /*#__PURE__*/React.createElement("div", {
    className: "mil-calc-row mil-calc-pct"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mil-calc-label"
  }, "Business-use percentage"), /*#__PURE__*/React.createElement("div", {
    className: "mil-calc-eq"
  }, "\u2192"), /*#__PURE__*/React.createElement("div", {
    className: "mil-calc-v"
  }, businessPct, "%")), /*#__PURE__*/React.createElement("div", {
    className: "mil-calc-row mil-calc-final"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mil-calc-label"
  }, "Deduction \xB7 ", businessMiles.toFixed(1), " mi \xD7 $", irsRate, "/mi"), /*#__PURE__*/React.createElement("div", {
    className: "mil-calc-eq"
  }, "="), /*#__PURE__*/React.createElement("div", {
    className: "mil-calc-v"
  }, "$", deduction.toFixed(2)))))), next && /*#__PURE__*/React.createElement("div", {
    className: "mil-classify-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mil-classify-left"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mil-classify-tag"
  }, "NEEDS A PURPOSE \xB7 ", trips.filter(t => t.needsReview).length, " trip", trips.filter(t => t.needsReview).length === 1 ? "" : "s"), /*#__PURE__*/React.createElement("div", {
    className: "mil-classify-title"
  }, next.from.split('·')[0].trim(), " \u2192 ", next.to.split('·')[0].trim()), /*#__PURE__*/React.createElement("div", {
    className: "mil-classify-meta"
  }, next.date, " \xB7 ", next.miles, " mi \xB7 ", next.dur)), /*#__PURE__*/React.createElement("div", {
    className: "mil-classify-actions"
  }, /*#__PURE__*/React.createElement("button", {
    className: "mil-class-btn"
  }, "Skip"), /*#__PURE__*/React.createElement("button", {
    className: "mil-class-btn mil-class-business"
  }, "\uD83D\uDCBC Add purpose \u2192"))), /*#__PURE__*/React.createElement("div", {
    className: "fbar",
    style: {
      marginTop: 14,
      marginBottom: 12
    }
  }, filters.map(f => /*#__PURE__*/React.createElement("button", {
    key: f.id,
    className: "fb" + (filter === f.id ? " active" : ""),
    onClick: () => setFilter(f.id)
  }, f.label, /*#__PURE__*/React.createElement("span", {
    className: "fb-count"
  }, f.count))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "seg"
  }, /*#__PURE__*/React.createElement("button", {
    className: "seg-btn on"
  }, "Trips"), /*#__PURE__*/React.createElement("button", {
    className: "seg-btn"
  }, "Calendar"))), /*#__PURE__*/React.createElement("div", {
    className: "mil-list"
  }, days.map((d, i) => /*#__PURE__*/React.createElement(MilDayGroup, {
    key: d.label,
    d: d,
    irsRate: irsRate,
    defaultOpen: i === 0
  }))), /*#__PURE__*/React.createElement("div", {
    className: "mil-summary"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mil-summary-cell"
  }, /*#__PURE__*/React.createElement("div", {
    className: "td-micro"
  }, "Business-use %"), /*#__PURE__*/React.createElement("div", {
    className: "mil-summary-v",
    style: {
      color: 'var(--c-green)'
    }
  }, businessPct, "%"), /*#__PURE__*/React.createElement("div", {
    className: "mil-summary-sub"
  }, businessMiles.toFixed(1), " of ", totalMilesYTD.toLocaleString(), " mi")), /*#__PURE__*/React.createElement("div", {
    className: "mil-summary-cell"
  }, /*#__PURE__*/React.createElement("div", {
    className: "td-micro"
  }, "Avg trip length"), /*#__PURE__*/React.createElement("div", {
    className: "mil-summary-v"
  }, (businessMiles / Math.max(trips.filter(t => !t.needsReview).length, 1)).toFixed(1), /*#__PURE__*/React.createElement("span", {
    className: "unit"
  }, " mi")), /*#__PURE__*/React.createElement("div", {
    className: "mil-summary-sub"
  }, trips.length, " trips this period")), /*#__PURE__*/React.createElement("div", {
    className: "mil-summary-cell"
  }, /*#__PURE__*/React.createElement("div", {
    className: "td-micro"
  }, "Highest purpose"), /*#__PURE__*/React.createElement("div", {
    className: "mil-summary-v",
    style: {
      fontSize: 16
    }
  }, "Customer visits"), /*#__PURE__*/React.createElement("div", {
    className: "mil-summary-sub"
  }, "42% of business miles")), /*#__PURE__*/React.createElement("div", {
    className: "mil-summary-cell"
  }, /*#__PURE__*/React.createElement("div", {
    className: "td-micro"
  }, "Audit-ready"), /*#__PURE__*/React.createElement("div", {
    className: "mil-summary-v",
    style: {
      color: 'var(--c-green)'
    }
  }, "\u2713"), /*#__PURE__*/React.createElement("div", {
    className: "mil-summary-sub"
  }, "IRS Pub. 463 compliant"))), /*#__PURE__*/React.createElement("div", {
    className: "tip",
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 18
    }
  }, "\uD83D\uDCD2"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", null, "How the math works. "), "The IRS wants total miles (year-end odo \u2212 year-start odo) and business miles. Personal is the rest \u2014 you don't have to log every personal trip. Update both odometer readings at year-end for an audit-clean Schedule C.")));
}
function MilDayGroup({
  d,
  irsRate,
  defaultOpen
}) {
  const [open, setOpen] = useBooksState(!!defaultOpen);
  const totalMiles = d.trips.reduce((s, t) => s + t.miles, 0);
  const deduction = d.trips.filter(t => !t.needsReview).reduce((s, t) => s + t.miles * irsRate, 0);
  const needs = d.trips.filter(t => t.needsReview).length;
  return /*#__PURE__*/React.createElement("div", {
    className: "mil-day" + (open ? " open" : "") + (needs ? " has-review" : "")
  }, /*#__PURE__*/React.createElement("button", {
    className: "mil-day-hd",
    onClick: () => setOpen(!open)
  }, /*#__PURE__*/React.createElement("div", {
    className: "mil-day-l"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mil-day-date"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mil-day-dow"
  }, d.dow), /*#__PURE__*/React.createElement("div", {
    className: "mil-day-num"
  }, d.dayNum), /*#__PURE__*/React.createElement("div", {
    className: "mil-day-month"
  }, d.monthShort)), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "mil-day-title"
  }, d.label), /*#__PURE__*/React.createElement("div", {
    className: "mil-day-sub"
  }, d.trips.length, " trip", d.trips.length === 1 ? "" : "s", " \xB7", " ", totalMiles.toFixed(1), " mi total", needs > 0 && /*#__PURE__*/React.createElement(React.Fragment, null, " \xB7 ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--c-amber)',
      fontWeight: 800
    }
  }, needs, " need", needs === 1 ? "s" : "", " a purpose"))))), /*#__PURE__*/React.createElement("div", {
    className: "mil-day-r"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mil-day-stats"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mil-day-miles"
  }, totalMiles.toFixed(1), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: 'var(--text-3)',
      fontWeight: 600
    }
  }, " mi")), /*#__PURE__*/React.createElement("div", {
    className: "mil-day-ded"
  }, "+$", deduction.toFixed(2))), /*#__PURE__*/React.createElement("div", {
    className: "mil-day-chev"
  }, open ? "▾" : "▸"))), open && /*#__PURE__*/React.createElement("div", {
    className: "mil-day-body"
  }, d.trips.map(t => /*#__PURE__*/React.createElement("div", {
    key: t.id,
    className: "mil-day-trip" + (t.needsReview ? " needs" : "")
  }, /*#__PURE__*/React.createElement("div", {
    className: "mil-day-trip-time"
  }, t.fromTime, /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement("span", {
    className: "mil-day-arrow"
  }, "\u2193"), /*#__PURE__*/React.createElement("br", null), t.toTime), /*#__PURE__*/React.createElement("div", {
    className: "mil-day-trip-route"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mil-day-trip-from"
  }, t.from), /*#__PURE__*/React.createElement("div", {
    className: "mil-day-trip-to"
  }, t.to)), /*#__PURE__*/React.createElement("div", {
    className: "mil-day-trip-stats"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mil-day-trip-miles"
  }, t.miles, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      color: 'var(--text-3)',
      fontWeight: 600
    }
  }, " mi")), /*#__PURE__*/React.createElement("div", {
    className: "mil-day-trip-dur"
  }, t.dur, " \xB7 ", t.vehicle)), /*#__PURE__*/React.createElement("div", {
    className: "mil-day-trip-purpose"
  }, t.needsReview ? /*#__PURE__*/React.createElement("span", {
    className: "bdg-soft sf-pending"
  }, "\u23F3 ADD PURPOSE") : /*#__PURE__*/React.createElement("span", {
    className: "bdg-soft sf-active"
  }, "\uD83D\uDCBC ", t.purpose.toUpperCase())), /*#__PURE__*/React.createElement("div", {
    className: "mil-day-trip-ded"
  }, !t.needsReview ? `+$${(t.miles * irsRate).toFixed(2)}` : "—")))));
}
window.Books = Books;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/Books.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/Calendar.jsx
try { (() => {
/* Calendar.jsx — month view with bookings */

function Calendar({
  data
}) {
  // Build a calendar grid for May 2026 (Friday start = day 1)
  const month = data.calendar.month;
  const today = data.calendar.today;
  const bookings = data.calendar.bookings;
  const daysInMonth = 31;
  const firstDow = 5; // May 1, 2026 is Friday (idx 5 if Sun=0)
  // Previous month tail
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push({
    other: true
  });
  for (let d = 1; d <= daysInMonth; d++) cells.push({
    day: d
  });
  while (cells.length % 7 !== 0) cells.push({
    other: true
  });
  return /*#__PURE__*/React.createElement("div", {
    className: "pg"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tbar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tbar-l"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tbar-eyebrow"
  }, "9 bookings \xB7 2 estimates \xB7 1 conflict"), /*#__PURE__*/React.createElement("div", {
    className: "tbar-title"
  }, "Calendar"), /*#__PURE__*/React.createElement("div", {
    className: "tbar-sub"
  }, "Color tells you the stage. Green is on the meter; blue is upcoming; amber is an estimate visit.")), /*#__PURE__*/React.createElement("div", {
    className: "tbar-r"
  }, /*#__PURE__*/React.createElement("div", {
    className: "seg"
  }, /*#__PURE__*/React.createElement("button", {
    className: "seg-btn"
  }, "Day"), /*#__PURE__*/React.createElement("button", {
    className: "seg-btn"
  }, "Week"), /*#__PURE__*/React.createElement("button", {
    className: "seg-btn on"
  }, "Month")), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-p"
  }, "+ Block time"))), /*#__PURE__*/React.createElement("div", {
    className: "cal-wrap"
  }, /*#__PURE__*/React.createElement("div", {
    className: "cal-nav"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn btn-sm btn-icon"
  }, "\u2039"), /*#__PURE__*/React.createElement("div", {
    className: "cal-month"
  }, month), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-sm btn-icon"
  }, "\u203A"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-sm",
    style: {
      marginLeft: 8
    }
  }, "Today")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      fontSize: 11,
      color: 'var(--text-3)',
      fontWeight: 600
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 10,
      height: 10,
      borderRadius: 3,
      background: 'var(--c-green)'
    }
  }), "Active"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 10,
      height: 10,
      borderRadius: 3,
      background: 'var(--denim)'
    }
  }), "Upcoming"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 10,
      height: 10,
      borderRadius: 3,
      background: 'var(--c-amber)'
    }
  }), "Estimate"))), /*#__PURE__*/React.createElement("div", {
    className: "cal-grid"
  }, ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map(d => /*#__PURE__*/React.createElement("div", {
    key: d,
    className: "cal-dh"
  }, d)), cells.map((c, i) => {
    const isToday = c.day === today;
    const dayBookings = c.day && bookings[c.day] ? bookings[c.day] : [];
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      className: "cal-cell" + (c.other ? " other" : "") + (isToday ? " today" : "")
    }, c.day && /*#__PURE__*/React.createElement("div", {
      className: "cdn"
    }, c.day), dayBookings.map((b, j) => /*#__PURE__*/React.createElement("div", {
      key: j,
      className: "cjob " + b.tone
    }, b.label)));
  }))), /*#__PURE__*/React.createElement("div", {
    className: "split-2-eq",
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "card card-pad-0"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd-title"
  }, "Conflicts"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-sm"
  }, "Resolve")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 12,
      padding: '10px',
      background: 'var(--c-amber-soft)',
      borderRadius: 8,
      border: '1px solid var(--c-amber-edge)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 18
    }
  }, "\u26A0\uFE0F"), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      fontWeight: 800,
      color: 'var(--c-amber-deep)'
    }
  }, "May 18 \xB7 two starts on the same day"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: 'var(--c-amber)',
      marginTop: 2,
      fontWeight: 500
    }
  }, "Calle (exterior) and Marshfield (estimate visit) overlap 9am"))))), /*#__PURE__*/React.createElement("div", {
    className: "card card-pad-0"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd-title"
  }, "Availability this week")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 14,
      display: 'grid',
      gridTemplateColumns: 'repeat(7,1fr)',
      gap: 6
    }
  }, [{
    d: "Sun",
    l: "M 11",
    full: false
  }, {
    d: "Mon",
    l: "M 12",
    full: true
  }, {
    d: "Tue",
    l: "M 13",
    full: true
  }, {
    d: "Wed",
    l: "M 14",
    full: true
  }, {
    d: "Thu",
    l: "M 15",
    full: true
  }, {
    d: "Fri",
    l: "M 16",
    full: false
  }, {
    d: "Sat",
    l: "M 17",
    full: false
  }].map((d, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      background: d.full ? 'var(--c-red-soft)' : 'var(--c-green-soft)',
      border: '1px solid ' + (d.full ? 'var(--c-red-edge)' : 'var(--c-green-edge)'),
      borderRadius: 6,
      padding: 8,
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      fontWeight: 800,
      textTransform: 'uppercase',
      letterSpacing: '.08em',
      color: d.full ? 'var(--c-red)' : 'var(--c-green)'
    }
  }, d.d), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 700,
      marginTop: 3,
      color: d.full ? 'var(--c-red)' : 'var(--c-green)'
    }
  }, d.full ? 'Full' : 'Open')))))));
}
window.Calendar = Calendar;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/Calendar.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/ClientDetail.jsx
try { (() => {
/* ClientDetail.jsx · v2 — branded hero + summary + timeline + bids */

function ClientDetail({
  client,
  onBack,
  onOpenEstimate,
  onOpenProposal,
  onOpenHub
}) {
  if (!client) return null;
  const balanceColor = client.balance > 0 ? 'var(--c-red)' : 'var(--c-green)';
  return /*#__PURE__*/React.createElement("div", {
    className: "pg"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn btn-sm btn-ghost",
    onClick: onBack,
    style: {
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("polyline", {
    points: "15 18 9 12 15 6"
  })), "Clients"), /*#__PURE__*/React.createElement("div", {
    className: "detail-hdr"
  }, /*#__PURE__*/React.createElement("div", {
    className: "detail-eyebrow"
  }, "Tier ", client.tier, " \xB7 ", client.source, " \xB7 LTV $", (client.lifetimeValue / 1000).toFixed(1), "k"), /*#__PURE__*/React.createElement("div", {
    className: "detail-name"
  }, client.name), /*#__PURE__*/React.createElement("div", {
    className: "detail-addr"
  }, client.address, " \xB7 ", client.city, ", ", client.state, " ", client.zip), /*#__PURE__*/React.createElement("div", {
    className: "detail-actions"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn"
  }, "\uD83D\uDCDE Call"), /*#__PURE__*/React.createElement("button", {
    className: "btn"
  }, "\uD83D\uDCAC SMS"), /*#__PURE__*/React.createElement("button", {
    className: "btn"
  }, "\uD83D\uDE97 Drive there"), /*#__PURE__*/React.createElement("button", {
    className: "btn",
    onClick: () => onOpenProposal && onOpenProposal(client.id)
  }, "\uD83D\uDCE8 View proposal"), /*#__PURE__*/React.createElement("button", {
    className: "btn",
    onClick: () => onOpenHub && onOpenHub(client.id)
  }, "\uD83C\uDFE0 Open client portal"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-p",
    onClick: () => onOpenEstimate(client.id)
  }, "+ New estimate"))), /*#__PURE__*/React.createElement("div", {
    className: "split-3-eq",
    style: {
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "met"
  }, /*#__PURE__*/React.createElement("div", {
    className: "met-l"
  }, "Lifetime value"), /*#__PURE__*/React.createElement("div", {
    className: "met-v"
  }, "$", (client.lifetimeValue / 1000).toFixed(1), "k"), /*#__PURE__*/React.createElement("div", {
    className: "met-s"
  }, "3 jobs \xB7 1 active")), /*#__PURE__*/React.createElement("div", {
    className: "met"
  }, /*#__PURE__*/React.createElement("div", {
    className: "met-l"
  }, "Open balance"), /*#__PURE__*/React.createElement("div", {
    className: "met-v",
    style: {
      color: balanceColor
    }
  }, client.balance ? `$${client.balance.toLocaleString()}` : '$0'), /*#__PURE__*/React.createElement("div", {
    className: "met-s",
    style: {
      color: client.daysSinceComplete > 14 ? 'var(--c-red)' : 'var(--text-3)'
    }
  }, client.daysSinceComplete ? `${client.daysSinceComplete}d past completion` : 'No outstanding balance')), /*#__PURE__*/React.createElement("div", {
    className: "met"
  }, /*#__PURE__*/React.createElement("div", {
    className: "met-l"
  }, "Last contact"), /*#__PURE__*/React.createElement("div", {
    className: "met-v",
    style: {
      fontSize: 16
    }
  }, "3d ago"), /*#__PURE__*/React.createElement("div", {
    className: "met-s"
  }, "SMS \xB7 \"Sent the proposal\""))), client.yearBuilt < 1978 && /*#__PURE__*/React.createElement("div", {
    className: "tip t-w"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 18
    }
  }, "\u26A0\uFE0F"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", null, "Pre-1978 property (built ", client.yearBuilt, "). "), "EPA lead-paint pamphlet required at signing. Attach before the estimate goes out.")), /*#__PURE__*/React.createElement("div", {
    className: "split-2-wide"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card card-pad-0"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd-title"
  }, "Timeline"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-sm"
  }, "+ Add note")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '16px 22px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "timeline"
  }, client.timeline.map((t, i) => /*#__PURE__*/React.createElement("div", {
    className: "tl-item",
    key: i
  }, /*#__PURE__*/React.createElement("div", {
    className: "tl-dot " + t.kind
  }), /*#__PURE__*/React.createElement("div", {
    className: "tl-label"
  }, t.label), /*#__PURE__*/React.createElement("div", {
    className: "tl-meta"
  }, t.meta)))))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "card card-pad-0",
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd-title"
  }, "Client info")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '14px 18px',
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(Detail, {
    label: "Phone",
    value: client.phone
  }), /*#__PURE__*/React.createElement(Detail, {
    label: "Email",
    value: client.email
  }), /*#__PURE__*/React.createElement(Detail, {
    label: "Source",
    value: client.source
  }), /*#__PURE__*/React.createElement(Detail, {
    label: "Property",
    value: client.ptype
  }), /*#__PURE__*/React.createElement(Detail, {
    label: "Year built",
    value: String(client.yearBuilt)
  }), /*#__PURE__*/React.createElement(Detail, {
    label: "Tier",
    value: client.tier
  }))), /*#__PURE__*/React.createElement("div", {
    className: "card card-pad-0"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd-title"
  }, "SMS templates")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '8px 14px 14px'
    }
  }, /*#__PURE__*/React.createElement(SmsRow, {
    label: "Soft follow-up \xB7 7 day",
    tone: "amber"
  }), /*#__PURE__*/React.createElement(SmsRow, {
    label: "Firm follow-up \xB7 14 day",
    tone: "amber"
  }), /*#__PURE__*/React.createElement(SmsRow, {
    label: "Collections \xB7 21 day",
    tone: "red"
  }), /*#__PURE__*/React.createElement(SmsRow, {
    label: "Lien warning \xB7 30 day",
    tone: "red"
  }))))));
}
function Detail({
  label,
  value
}) {
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "td-micro",
    style: {
      marginBottom: 4
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 700,
      color: 'var(--text)',
      letterSpacing: '-.1px'
    }
  }, value));
}
function SmsRow({
  label,
  tone
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '10px 12px',
      background: 'var(--cream)',
      borderRadius: 8,
      fontSize: 12,
      marginBottom: 6,
      border: '1px solid var(--line)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600
    }
  }, label), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-sm"
  }, "Send \u2192"));
}
window.ClientDetail = ClientDetail;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/ClientDetail.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/ClientHub.jsx
try { (() => {
/* ClientHub.jsx · v3 — full customer portal
   Tabs: Overview · Project · Payments · Documents · Messages
*/
const {
  useState: useHubState
} = React;
function ClientHub({
  data,
  onExit
}) {
  const biz = data.business;
  const client = data.clients[0];
  const est = data.estimate;
  const [tab, setTab] = useHubState("overview");
  const firstName = client.firstName || client.name.split(',')[0];
  const lineSubtotal = est.lineItems.reduce((s, it) => s + it.total, 0);
  const total = lineSubtotal;
  const paid = 1500;
  const balance = total - paid;
  const pct = Math.round(paid / total * 100);
  return /*#__PURE__*/React.createElement("div", {
    className: "hub-shell"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hub-topbar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hub-brand"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hub-mark"
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24",
    width: "16",
    height: "16",
    stroke: "#FFF",
    fill: "none",
    strokeWidth: "2.4",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"
  }))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "hub-brand-name"
  }, biz.name), /*#__PURE__*/React.createElement("div", {
    className: "hub-brand-tag"
  }, "Project hub \xB7 ", firstName))), /*#__PURE__*/React.createElement("div", {
    className: "hub-topbar-r"
  }, /*#__PURE__*/React.createElement("button", {
    className: "hub-icon-btn",
    title: "Notifications"
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24",
    width: "16",
    height: "16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M13.73 21a2 2 0 01-3.46 0"
  })), /*#__PURE__*/React.createElement("span", {
    className: "hub-icon-dot"
  })), /*#__PURE__*/React.createElement("button", {
    className: "hub-icon-btn",
    title: "Help"
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24",
    width: "16",
    height: "16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "10"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "12",
    y1: "17",
    x2: "12.01",
    y2: "17"
  }))), /*#__PURE__*/React.createElement("div", {
    className: "hub-account"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hub-account-avatar"
  }, client.initials), /*#__PURE__*/React.createElement("div", {
    className: "hub-account-meta"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hub-account-name"
  }, firstName), /*#__PURE__*/React.createElement("div", {
    className: "hub-account-sub"
  }, "Sign out"))))), /*#__PURE__*/React.createElement("div", {
    className: "hub-hero"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hub-hero-inner"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hub-hero-l"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hub-eyebrow"
  }, "Welcome back"), /*#__PURE__*/React.createElement("div", {
    className: "hub-greeting"
  }, "Hi, ", firstName, "."), /*#__PURE__*/React.createElement("div", {
    className: "hub-greeting-sub"
  }, "Your interior project is ", /*#__PURE__*/React.createElement("b", {
    style: {
      color: '#fff'
    }
  }, "60% complete"), " \xB7 day 7 of 10. Crew on-site tomorrow at 8 AM."), /*#__PURE__*/React.createElement("div", {
    className: "hub-progress"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hub-progress-track"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hub-progress-fill",
    style: {
      width: '60%'
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: "hub-progress-meta"
  }, /*#__PURE__*/React.createElement("span", null, "Started May 4"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: '#fff',
      fontWeight: 800
    }
  }, "60% \xB7 day 7 of 10"), /*#__PURE__*/React.createElement("span", null, "Finish \xB7 May 24")))), /*#__PURE__*/React.createElement("div", {
    className: "hub-hero-r"
  }, /*#__PURE__*/React.createElement(HubMini, {
    label: "Balance",
    value: `$${balance.toLocaleString()}`,
    sub: `of $${total.toLocaleString()} · ${pct}% paid`,
    accent: "warn"
  }), /*#__PURE__*/React.createElement(HubMini, {
    label: "Next milestone",
    value: "Kitchen done",
    sub: "ETA tomorrow",
    accent: "info"
  }), /*#__PURE__*/React.createElement(HubMini, {
    label: "Days remaining",
    value: "3",
    sub: "weather permitting",
    accent: "neutral"
  }))), /*#__PURE__*/React.createElement("div", {
    className: "hub-tabs"
  }, [{
    id: "overview",
    label: "Overview"
  }, {
    id: "project",
    label: "Project & photos"
  }, {
    id: "payments",
    label: "Payments",
    badge: "$2.7k due"
  }, {
    id: "documents",
    label: "Documents"
  }, {
    id: "messages",
    label: "Messages",
    badge: "2"
  }].map(t => /*#__PURE__*/React.createElement("button", {
    key: t.id,
    className: "hub-tab" + (tab === t.id ? " on" : ""),
    onClick: () => setTab(t.id)
  }, t.label, t.badge && /*#__PURE__*/React.createElement("span", {
    className: "hub-tab-badge"
  }, t.badge))))), /*#__PURE__*/React.createElement("div", {
    className: "hub-body"
  }, tab === "overview" && /*#__PURE__*/React.createElement(HubOverview, {
    client: client,
    biz: biz,
    balance: balance
  }), tab === "project" && /*#__PURE__*/React.createElement(HubProject, {
    client: client
  }), tab === "payments" && /*#__PURE__*/React.createElement(HubPayments, {
    total: total,
    paid: paid,
    balance: balance,
    est: est
  }), tab === "documents" && /*#__PURE__*/React.createElement(HubDocuments, {
    biz: biz
  }), tab === "messages" && /*#__PURE__*/React.createElement(HubMessages, {
    biz: biz,
    client: client
  })), /*#__PURE__*/React.createElement("div", {
    className: "hub-footer"
  }, /*#__PURE__*/React.createElement("span", null, "Need help? Logan answers within 1 business day."), /*#__PURE__*/React.createElement("span", null, "Powered by ", /*#__PURE__*/React.createElement("b", {
    style: {
      fontFamily: 'var(--font-display)',
      color: 'var(--text-2)',
      letterSpacing: '-.2px'
    }
  }, "TradeDesk Pro"))));
}
function HubMini({
  label,
  value,
  sub,
  accent
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "hub-mini hub-mini-" + (accent || "neutral")
  }, /*#__PURE__*/React.createElement("div", {
    className: "hub-mini-l"
  }, label), /*#__PURE__*/React.createElement("div", {
    className: "hub-mini-v"
  }, value), /*#__PURE__*/React.createElement("div", {
    className: "hub-mini-s"
  }, sub));
}

/* ── Overview tab ── */
function HubOverview({
  client,
  biz,
  balance
}) {
  return /*#__PURE__*/React.createElement(React.Fragment, null, balance > 0 && /*#__PURE__*/React.createElement("div", {
    className: "hub-cta-banner"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "hub-cta-eyebrow"
  }, "Action requested \xB7 pay milestone 2"), /*#__PURE__*/React.createElement("div", {
    className: "hub-cta-title"
  }, "Pay $", balance.toLocaleString(), " balance"), /*#__PURE__*/React.createElement("div", {
    className: "hub-cta-sub"
  }, "Stripe link expires May 28 \xB7 ACH, card, or Apple Pay")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn btn-d btn-xl"
  }, "\uD83D\uDCB3 Pay now"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-xl"
  }, "Schedule a call"))), /*#__PURE__*/React.createElement("div", {
    className: "hub-row-2"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card card-pad-0"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd-title"
  }, "What's happening today"), /*#__PURE__*/React.createElement("div", {
    className: "card-hd-sub"
  }, "Tue, May 12 \xB7 8 AM \u2013 4 PM")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '14px 18px 18px'
    }
  }, /*#__PURE__*/React.createElement(FeedItem, {
    when: "Today, 11:42 AM",
    who: biz.owner,
    body: "Wrapped the living room \u2014 second coat looks great. Moving to the kitchen tomorrow.",
    photos: 3
  }), /*#__PURE__*/React.createElement(FeedItem, {
    when: "Yesterday, 4:18 PM",
    who: biz.owner,
    body: "Done with prep. Patched a few nail pops in the hallway, primed all the trim.",
    photos: 2
  }), /*#__PURE__*/React.createElement(FeedItem, {
    when: "May 4, 8:02 AM",
    who: biz.owner,
    body: "Crew on site! Drop cloths down, furniture covered. Will keep you posted.",
    photos: 1
  }))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "td-h4",
    style: {
      marginBottom: 10
    }
  }, "Need to reach ", biz.owner.split(' ')[0], "?"), /*#__PURE__*/React.createElement("div", {
    className: "hub-contact-grid"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn btn-full",
    style: {
      justifyContent: 'flex-start'
    }
  }, "\uD83D\uDCDE Call \xB7 ", biz.phone), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-full",
    style: {
      justifyContent: 'flex-start'
    }
  }, "\uD83D\uDCAC Text"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-full",
    style: {
      justifyContent: 'flex-start'
    }
  }, "\uD83D\uDCE7 Email"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-full",
    style: {
      justifyContent: 'flex-start'
    }
  }, "\uD83D\uDCC5 Schedule a call"))), /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "td-h4",
    style: {
      marginBottom: 10
    }
  }, "Your approvals"), /*#__PURE__*/React.createElement("div", {
    className: "hub-approval"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "hub-approval-title"
  }, "Color: Trim accent"), /*#__PURE__*/React.createElement("div", {
    className: "hub-approval-sub"
  }, "Pick one for the kitchen trim")), /*#__PURE__*/React.createElement("div", {
    className: "hub-color-row"
  }, /*#__PURE__*/React.createElement("button", {
    className: "hub-color",
    style: {
      background: '#F0EFEA'
    }
  }), /*#__PURE__*/React.createElement("button", {
    className: "hub-color hub-color-sel",
    style: {
      background: '#1B3F7A'
    }
  }), /*#__PURE__*/React.createElement("button", {
    className: "hub-color",
    style: {
      background: '#2C2A26'
    }
  }))), /*#__PURE__*/React.createElement("div", {
    className: "hub-approval"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "hub-approval-title"
  }, "Change order #1"), /*#__PURE__*/React.createElement("div", {
    className: "hub-approval-sub"
  }, "+$240 \xB7 add second coat on bedroom ceiling")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn btn-sm"
  }, "Decline"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-sm btn-g"
  }, "Approve")))))), /*#__PURE__*/React.createElement("div", {
    className: "card card-pad-0"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd-title"
  }, "Your job timeline")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '14px 24px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "timeline"
  }, /*#__PURE__*/React.createElement(TLItem, {
    kind: "payment",
    label: "Final payment due",
    meta: "May 24, 2026 \xB7 $2,750 remaining"
  }), /*#__PURE__*/React.createElement(TLItem, {
    kind: "upcoming",
    label: "Final walkthrough",
    meta: "May 23 \xB7 4 PM"
  }), /*#__PURE__*/React.createElement(TLItem, {
    kind: "upcoming",
    label: "Touch-ups + cleanup",
    meta: "May 22"
  }), /*#__PURE__*/React.createElement(TLItem, {
    kind: "active",
    label: "Kitchen + master \xB7 in progress",
    meta: "May 13\u201315"
  }), /*#__PURE__*/React.createElement(TLItem, {
    kind: "complete",
    label: "Living room complete",
    meta: "May 12"
  }), /*#__PURE__*/React.createElement(TLItem, {
    kind: "complete",
    label: "Prep + masking complete",
    meta: "May 5"
  }), /*#__PURE__*/React.createElement(TLItem, {
    kind: "payment",
    label: "Deposit received \xB7 $1,500",
    meta: "May 2 \xB7 stripe"
  }), /*#__PURE__*/React.createElement(TLItem, {
    kind: "bid",
    label: "Proposal signed \xB7 $4,250",
    meta: "Apr 28"
  })))));
}
function TLItem({
  kind,
  label,
  meta
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "tl-item"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tl-dot " + kind
  }), /*#__PURE__*/React.createElement("div", {
    className: "tl-label"
  }, label), /*#__PURE__*/React.createElement("div", {
    className: "tl-meta"
  }, meta));
}

/* ── Project tab — photos + daily logs ── */
function HubProject({
  client
}) {
  const days = [{
    date: "May 12 · Tue · Day 7",
    title: "Living room finished",
    body: "Second coat on the south wall, baseboards back on. Color came out beautiful in the afternoon light.",
    photos: 4
  }, {
    date: "May 11 · Mon · Day 6",
    title: "Living room · first coat",
    body: "First coat down across the living room and dining area. Some patches will need a third pass.",
    photos: 3
  }, {
    date: "May 10 · Sun · Off",
    title: "No work — Sunday",
    body: "",
    photos: 0
  }, {
    date: "May 9 · Sat · Day 5",
    title: "Hallway repaint",
    body: "Hallway is done — including the high section above the stairs. Used the extension pole.",
    photos: 2
  }];
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "card card-pad-0",
    style: {
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd-title"
  }, "Job photos"), /*#__PURE__*/React.createElement("div", {
    className: "card-hd-sub"
  }, "Posted by ", biz.owner.split(' ')[0], " \xB7 sorted newest first")), /*#__PURE__*/React.createElement("div", {
    className: "hub-photo-grid"
  }, [{
    tag: "Today · 11:42",
    tone: "primary"
  }, {
    tag: "Today · 11:40",
    tone: "primary"
  }, {
    tag: "Today · 09:18",
    tone: "secondary"
  }, {
    tag: "Today · 09:15",
    tone: "secondary"
  }, {
    tag: "Yesterday · 4:18",
    tone: "tertiary"
  }, {
    tag: "Yesterday · 4:14",
    tone: "tertiary"
  }, {
    tag: "May 9 · 2:30",
    tone: "quaternary"
  }, {
    tag: "May 5 · 8:02",
    tone: "quinary"
  }].map((p, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "hub-photo hub-photo-" + p.tone
  }, /*#__PURE__*/React.createElement("div", {
    className: "hub-photo-icon"
  }, "\uD83D\uDCF7"), /*#__PURE__*/React.createElement("div", {
    className: "hub-photo-tag"
  }, p.tag))))), /*#__PURE__*/React.createElement("div", {
    className: "card card-pad-0"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd-title"
  }, "Daily logs")), /*#__PURE__*/React.createElement("div", {
    className: "hub-log-list"
  }, days.map((d, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "hub-log-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hub-log-date"
  }, d.date), /*#__PURE__*/React.createElement("div", {
    className: "hub-log-body"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hub-log-title"
  }, d.title), d.body && /*#__PURE__*/React.createElement("div", {
    className: "hub-log-text"
  }, d.body), d.photos > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      marginTop: 8
    }
  }, Array.from({
    length: d.photos
  }).map((_, j) => /*#__PURE__*/React.createElement("div", {
    key: j,
    style: {
      width: 44,
      height: 44,
      borderRadius: 6,
      background: 'var(--denim-soft)',
      border: '1px solid var(--line)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 14,
      color: 'var(--text-3)'
    }
  }, "\uD83D\uDCF7")))))))));
}

/* ── Payments tab ── */
function HubPayments({
  total,
  paid,
  balance,
  est
}) {
  const milestones = [{
    label: "Deposit · 30%",
    amount: Math.round(total * 0.3),
    paid: true,
    date: "May 2",
    ref: "stripe ch_5N2Hxv"
  }, {
    label: "Milestone 2 · 40%",
    amount: Math.round(total * 0.4),
    paid: false,
    date: "Due May 15"
  }, {
    label: "Final · 30%",
    amount: total - Math.round(total * 0.3) - Math.round(total * 0.4),
    paid: false,
    date: "Due on completion"
  }];
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "hub-pay-cards"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hub-pay-card hub-pay-balance"
  }, /*#__PURE__*/React.createElement("div", {
    className: "td-micro"
  }, "Balance remaining"), /*#__PURE__*/React.createElement("div", {
    className: "td-display",
    style: {
      fontSize: 42,
      color: '#fff',
      marginTop: 6
    }
  }, "$", balance.toLocaleString()), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      opacity: .7,
      marginTop: 4,
      color: '#fff'
    }
  }, "of $", total.toLocaleString(), " \xB7 ", Math.round(paid / total * 100), "% paid"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-d btn-xl btn-full",
    style: {
      marginTop: 14,
      background: '#fff',
      color: 'var(--ink)'
    }
  }, "\uD83D\uDCB3 Pay milestone 2 \xB7 $", Math.round(total * 0.4).toLocaleString()), /*#__PURE__*/React.createElement("div", {
    className: "hub-pay-methods"
  }, /*#__PURE__*/React.createElement("span", null, "Pay with"), /*#__PURE__*/React.createElement("span", {
    className: "chip"
  }, "\uD83D\uDCB3 Card"), /*#__PURE__*/React.createElement("span", {
    className: "chip"
  }, "\uD83C\uDFE6 ACH"), /*#__PURE__*/React.createElement("span", {
    className: "chip"
  }, "\uD83D\uDCF1 Apple Pay"), /*#__PURE__*/React.createElement("span", {
    className: "chip"
  }, "G Pay"))), /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "td-h4",
    style: {
      marginBottom: 10
    }
  }, "Payment schedule"), milestones.map((m, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "hub-milestone" + (m.paid ? " paid" : "") + (!m.paid && i === 1 ? " due" : "")
  }, /*#__PURE__*/React.createElement("div", {
    className: "hub-milestone-dot " + (m.paid ? "paid" : i === 1 ? "due" : "future")
  }, m.paid ? "✓" : i + 1), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "hub-milestone-label"
  }, m.label), /*#__PURE__*/React.createElement("div", {
    className: "hub-milestone-sub"
  }, m.date, m.ref && ` · ${m.ref}`)), /*#__PURE__*/React.createElement("div", {
    className: "hub-milestone-amt"
  }, "$", m.amount.toLocaleString()))))), /*#__PURE__*/React.createElement("div", {
    className: "card card-pad-0"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd-title"
  }, "Invoice \xB7 #INV-2026-0428"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-sm"
  }, "\uD83D\uDCC4 Download PDF")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '16px 22px 20px'
    }
  }, /*#__PURE__*/React.createElement("table", {
    className: "tbl"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Description"), /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'right'
    }
  }, "Qty"), /*#__PURE__*/React.createElement("th", null, "Unit"), /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'right'
    }
  }, "Amount"))), /*#__PURE__*/React.createElement("tbody", null, est.lineItems.map(it => /*#__PURE__*/React.createElement("tr", {
    key: it.id
  }, /*#__PURE__*/React.createElement("td", {
    style: {
      maxWidth: 380,
      fontWeight: 600
    }
  }, it.label), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, it.qty.toLocaleString()), /*#__PURE__*/React.createElement("td", {
    className: "muted"
  }, it.unit), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, "$", it.total.toLocaleString()))), /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: 3,
    style: {
      fontWeight: 800,
      textAlign: 'right'
    }
  }, "Subtotal"), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, /*#__PURE__*/React.createElement("b", null, "$", total.toLocaleString()))), /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: 3,
    style: {
      textAlign: 'right',
      color: 'var(--c-green)',
      fontWeight: 700
    }
  }, "Deposit paid \xB7 May 2"), /*#__PURE__*/React.createElement("td", {
    className: "num green"
  }, "-$", paid.toLocaleString())), /*#__PURE__*/React.createElement("tr", {
    style: {
      background: 'var(--cream)'
    }
  }, /*#__PURE__*/React.createElement("td", {
    colSpan: 3,
    style: {
      fontWeight: 800,
      textAlign: 'right'
    }
  }, "Balance due"), /*#__PURE__*/React.createElement("td", {
    className: "num",
    style: {
      color: 'var(--denim)'
    }
  }, /*#__PURE__*/React.createElement("b", null, "$", balance.toLocaleString()))))))));
}

/* ── Documents tab ── */
function HubDocuments({
  biz
}) {
  const docs = [{
    name: "Proposal · signed.pdf",
    size: "248 KB",
    date: "Apr 28, 2026",
    tag: "Proposal",
    tagCls: "sf-deposit"
  }, {
    name: "Deposit receipt.pdf",
    size: "34 KB",
    date: "May 2, 2026",
    tag: "Receipt",
    tagCls: "sf-won"
  }, {
    name: "EPA lead-paint pamphlet.pdf",
    size: "1.2 MB",
    date: "Apr 28, 2026",
    tag: "Required",
    tagCls: "sf-pending"
  }, {
    name: "Color picks · Benjamin Moore.pdf",
    size: "410 KB",
    date: "May 1, 2026",
    tag: "Color",
    tagCls: "sf-active"
  }, {
    name: "Insurance certificate.pdf",
    size: "180 KB",
    date: "Jan 5, 2026",
    tag: "Compliance",
    tagCls: "sf-done"
  }, {
    name: "Workmanship warranty · 2 yrs.pdf",
    size: "96 KB",
    date: "At completion",
    tag: "Warranty",
    tagCls: "sf-deposit"
  }];
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "card card-pad-0",
    style: {
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd-title"
  }, "Project documents"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-sm"
  }, "\u21E9 Download all")), /*#__PURE__*/React.createElement("div", {
    className: "hub-doc-list"
  }, docs.map((d, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "hub-doc-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hub-doc-icon"
  }, "\uD83D\uDCC4"), /*#__PURE__*/React.createElement("div", {
    className: "hub-doc-body"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hub-doc-name"
  }, d.name), /*#__PURE__*/React.createElement("div", {
    className: "hub-doc-meta"
  }, d.size, " \xB7 uploaded ", d.date)), /*#__PURE__*/React.createElement("span", {
    className: "bdg-soft " + d.tagCls
  }, d.tag.toUpperCase()), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-sm"
  }, "View"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-sm"
  }, "\u21E9"))))), /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "td-h4",
    style: {
      marginBottom: 8
    }
  }, "Contractor info"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(Detail, {
    label: "Business",
    value: biz.name
  }), /*#__PURE__*/React.createElement(Detail, {
    label: "Owner",
    value: biz.owner
  }), /*#__PURE__*/React.createElement(Detail, {
    label: "License",
    value: biz.license
  }), /*#__PURE__*/React.createElement(Detail, {
    label: "Phone",
    value: biz.phone
  }), /*#__PURE__*/React.createElement(Detail, {
    label: "Email",
    value: biz.email
  }), /*#__PURE__*/React.createElement(Detail, {
    label: "Address",
    value: biz.address
  }))));
}
function Detail({
  label,
  value
}) {
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "td-micro",
    style: {
      marginBottom: 4
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 700,
      letterSpacing: '-.1px'
    }
  }, value));
}

/* ── Messages tab ── */
function HubMessages({
  biz,
  client
}) {
  const messages = [{
    from: "contractor",
    who: biz.owner,
    when: "Today, 11:43 AM",
    body: "Heads up — the kitchen cabinets came out beautifully. Sending a few photos."
  }, {
    from: "contractor",
    who: biz.owner,
    when: "Today, 11:42 AM",
    body: "📷 (3 photos)"
  }, {
    from: "client",
    who: client.name.split(',')[0],
    when: "Yesterday, 8:14 PM",
    body: "Hey Logan, can we add the upstairs hallway to the scope? Saw a couple scuff marks I'd rather not live with."
  }, {
    from: "contractor",
    who: biz.owner,
    when: "Yesterday, 8:32 PM",
    body: "Sure — I'll write up a change order tonight and put it in your hub. Approve there and we'll knock it out Thursday."
  }, {
    from: "client",
    who: client.name.split(',')[0],
    when: "Today, 9:01 AM",
    body: "Perfect, thanks!"
  }];
  return /*#__PURE__*/React.createElement("div", {
    className: "card card-pad-0",
    style: {
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd-title"
  }, "Messages with ", biz.owner), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-sm"
  }, "\uD83D\uDCDE Call instead")), /*#__PURE__*/React.createElement("div", {
    className: "hub-msg-list"
  }, messages.map((m, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "hub-msg hub-msg-" + m.from
  }, /*#__PURE__*/React.createElement("div", {
    className: "hub-msg-avatar"
  }, m.who.split(' ').map(s => s[0]).join('')), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "hub-msg-meta"
  }, /*#__PURE__*/React.createElement("b", null, m.who), " \xB7 ", m.when), /*#__PURE__*/React.createElement("div", {
    className: "hub-msg-bubble"
  }, m.body))))), /*#__PURE__*/React.createElement("div", {
    className: "hub-msg-composer"
  }, /*#__PURE__*/React.createElement("input", {
    placeholder: "Message " + biz.owner.split(' ')[0] + "…",
    style: {
      height: 42
    }
  }), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-icon"
  }, "\uD83D\uDCCE"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-p",
    style: {
      height: 42
    }
  }, "Send \u2192")));
}
function FeedItem({
  when,
  who,
  body,
  photos
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "hub-feed"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hub-feed-avatar"
  }, who.split(' ').map(s => s[0]).join('')), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      marginBottom: 5,
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      fontWeight: 800,
      letterSpacing: '-.1px'
    }
  }, who), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      color: 'var(--text-3)',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '.06em',
      flexShrink: 0
    }
  }, when)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: 'var(--text-2)',
      lineHeight: 1.5,
      marginBottom: 8
    }
  }, body), photos > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6
    }
  }, Array.from({
    length: photos
  }).map((_, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "hub-feed-photo"
  }, "\uD83D\uDCF7")))));
}
window.ClientHub = ClientHub;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/ClientHub.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/Clients.jsx
try { (() => {
/* Clients.jsx · v2 — filterable list with new client cards */
const {
  useState: useClientsState
} = React;
function Clients({
  data,
  onOpenClient
}) {
  const [filter, setFilter] = useClientsState("all");
  const [query, setQuery] = useClientsState("");
  const filters = [{
    id: "all",
    label: "All",
    count: data.clients.length
  }, {
    id: "active",
    label: "Active",
    count: data.clients.filter(c => c.status === "active").length
  }, {
    id: "deposit",
    label: "Approved",
    count: data.clients.filter(c => c.status === "deposit" || c.status === "awaiting_sig").length
  }, {
    id: "won",
    label: "Won",
    count: data.clients.filter(c => c.status === "won").length
  }, {
    id: "follow_up",
    label: "Follow-up",
    count: data.clients.filter(c => c.status === "follow_up").length
  }, {
    id: "new",
    label: "New",
    count: data.clients.filter(c => c.status === "new").length
  }];
  const filtered = data.clients.filter(c => {
    if (query && !c.name.toLowerCase().includes(query.toLowerCase()) && !c.address.toLowerCase().includes(query.toLowerCase())) return false;
    if (filter === "all") return true;
    if (filter === "deposit") return c.status === "deposit" || c.status === "awaiting_sig";
    return c.status === filter;
  });
  return /*#__PURE__*/React.createElement("div", {
    className: "pg"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tbar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tbar-l"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tbar-eyebrow"
  }, data.clients.length, " clients \xB7 ", data.clients.filter(c => c.status === 'active').length, " active jobs"), /*#__PURE__*/React.createElement("div", {
    className: "tbar-title"
  }, "Clients")), /*#__PURE__*/React.createElement("div", {
    className: "tbar-r"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn"
  }, "Export \u25BE"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-p"
  }, "+ New client"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10,
      marginBottom: 14,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: '1 1 280px',
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24",
    width: "14",
    height: "14",
    fill: "none",
    stroke: "var(--text-3)",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    style: {
      position: 'absolute',
      left: 14,
      top: '50%',
      transform: 'translateY(-50%)',
      pointerEvents: 'none'
    }
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "11",
    cy: "11",
    r: "8"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m21 21-4.35-4.35"
  })), /*#__PURE__*/React.createElement("input", {
    placeholder: "Search by name, address, phone...",
    value: query,
    onChange: e => setQuery(e.target.value),
    style: {
      paddingLeft: 36,
      height: 38,
      background: 'var(--bg-card)'
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: "seg"
  }, /*#__PURE__*/React.createElement("button", {
    className: "seg-btn on"
  }, "List"), /*#__PURE__*/React.createElement("button", {
    className: "seg-btn"
  }, "Map"))), /*#__PURE__*/React.createElement("div", {
    className: "fbar"
  }, filters.map(f => /*#__PURE__*/React.createElement("button", {
    key: f.id,
    className: "fb" + (filter === f.id ? " active" : ""),
    onClick: () => setFilter(f.id)
  }, f.label, /*#__PURE__*/React.createElement("span", {
    className: "fb-count"
  }, f.count)))), filtered.map(c => {
    const cls = c.status === "active" ? "client-card has-active" : c.status === "deposit" || c.status === "awaiting_sig" ? "client-card has-bid" : "client-card";
    return /*#__PURE__*/React.createElement("div", {
      key: c.id,
      className: cls,
      onClick: () => onOpenClient(c.id)
    }, /*#__PURE__*/React.createElement("div", {
      className: "cc-row"
    }, /*#__PURE__*/React.createElement("div", {
      className: "cc-l"
    }, /*#__PURE__*/React.createElement("div", {
      className: "cc-avatar " + (c.avatarTone || "")
    }, c.initials), /*#__PURE__*/React.createElement("div", {
      style: {
        minWidth: 0,
        flex: 1
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "cc-name"
    }, c.name), /*#__PURE__*/React.createElement("div", {
      className: "cc-meta"
    }, c.address, " \xB7 ", c.ptype, " \xB7 ", c.yearBuilt), /*#__PURE__*/React.createElement("div", {
      className: "cc-stats"
    }, /*#__PURE__*/React.createElement("span", {
      className: "cc-stat"
    }, "Tier ", c.tier), c.lifetimeValue > 0 && /*#__PURE__*/React.createElement("span", {
      className: "cc-stat"
    }, "$", (c.lifetimeValue / 1000).toFixed(1), "k LTV"), /*#__PURE__*/React.createElement("span", {
      className: "cc-stat"
    }, c.source), c.yearBuilt < 1978 && /*#__PURE__*/React.createElement("span", {
      className: "cc-stat",
      style: {
        color: 'var(--c-amber)'
      }
    }, "Pre-1978")))), /*#__PURE__*/React.createElement(StatusBadge, {
      status: c.status
    })));
  }), filtered.length === 0 && /*#__PURE__*/React.createElement("div", {
    className: "empty"
  }, /*#__PURE__*/React.createElement("div", {
    className: "em-emoji"
  }, "\uD83D\uDDC2\uFE0F"), /*#__PURE__*/React.createElement("h3", null, "No clients match"), /*#__PURE__*/React.createElement("p", null, "Try a different filter or clear the search box.")));
}
function StatusBadge({
  status
}) {
  const map = {
    active: {
      cls: "bdg-soft sf-active",
      label: "ACTIVE"
    },
    deposit: {
      cls: "bdg-soft sf-deposit",
      label: "DEPOSIT PAID"
    },
    follow_up: {
      cls: "bdg-soft sf-pending",
      label: "FOLLOW-UP"
    },
    awaiting_sig: {
      cls: "bdg-soft sf-deposit",
      label: "AWAITING SIG"
    },
    new: {
      cls: "bdg-soft sf-new",
      label: "NEW"
    },
    collect: {
      cls: "bdg-soft sf-overdue",
      label: "OVERDUE"
    },
    won: {
      cls: "bdg-soft sf-won",
      label: "WON"
    }
  };
  const v = map[status] || {
    cls: "bdg-soft sf-done",
    label: (status || "").toUpperCase()
  };
  return /*#__PURE__*/React.createElement("span", {
    className: v.cls
  }, v.label);
}
window.Clients = Clients;
window.StatusBadge = StatusBadge;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/Clients.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/Collect.jsx
try { (() => {
/* Collect.jsx — 7/14/21/30 collections escalation */

function Collect({
  data,
  onOpenClient
}) {
  const totalOwed = data.collect.reduce((s, r) => s + r.balance, 0);
  return /*#__PURE__*/React.createElement("div", {
    className: "pg"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tbar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tbar-l"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tbar-eyebrow"
  }, data.collect.length, " accounts past due \xB7 oldest is 22d out"), /*#__PURE__*/React.createElement("div", {
    className: "tbar-title"
  }, "Collect"), /*#__PURE__*/React.createElement("div", {
    className: "tbar-sub"
  }, "Pre-written SMS for each escalation stage. Lien deadlines auto-tracked under K.S.A. 60-1105.")), /*#__PURE__*/React.createElement("div", {
    className: "tbar-r"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn"
  }, "\uD83D\uDCE4 Send all reminders"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-p"
  }, "+ Manual invoice"))), /*#__PURE__*/React.createElement("div", {
    className: "mets"
  }, /*#__PURE__*/React.createElement("div", {
    className: "met"
  }, /*#__PURE__*/React.createElement("div", {
    className: "met-l"
  }, "Total outstanding"), /*#__PURE__*/React.createElement("div", {
    className: "met-v",
    style: {
      color: 'var(--c-red)'
    }
  }, "$", (totalOwed / 1000).toFixed(1), "k"), /*#__PURE__*/React.createElement("div", {
    className: "met-s"
  }, "across ", data.collect.length, " accounts")), /*#__PURE__*/React.createElement("div", {
    className: "met"
  }, /*#__PURE__*/React.createElement("div", {
    className: "met-l"
  }, "Avg days out"), /*#__PURE__*/React.createElement("div", {
    className: "met-v"
  }, Math.round(data.collect.reduce((s, r) => s + r.daysOut, 0) / data.collect.length), /*#__PURE__*/React.createElement("span", {
    className: "unit"
  }, "d")), /*#__PURE__*/React.createElement("div", {
    className: "met-s"
  }, "target \u2264 14d")), /*#__PURE__*/React.createElement("div", {
    className: "met"
  }, /*#__PURE__*/React.createElement("div", {
    className: "met-l"
  }, "Lien windows open"), /*#__PURE__*/React.createElement("div", {
    className: "met-v",
    style: {
      color: 'var(--c-amber)'
    }
  }, "1"), /*#__PURE__*/React.createElement("div", {
    className: "met-s"
  }, "closes May 26, 2026")), /*#__PURE__*/React.createElement("div", {
    className: "met"
  }, /*#__PURE__*/React.createElement("div", {
    className: "met-l"
  }, "Avg recovery"), /*#__PURE__*/React.createElement("div", {
    className: "met-v",
    style: {
      color: 'var(--c-green)'
    }
  }, "96", /*#__PURE__*/React.createElement("span", {
    className: "unit"
  }, "%")), /*#__PURE__*/React.createElement("div", {
    className: "met-s"
  }, "paid within 45 days"))), /*#__PURE__*/React.createElement("div", {
    className: "card card-pad-0"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd-title"
  }, "Escalation queue"), /*#__PURE__*/React.createElement("div", {
    className: "seg"
  }, /*#__PURE__*/React.createElement("button", {
    className: "seg-btn on"
  }, "All"), /*#__PURE__*/React.createElement("button", {
    className: "seg-btn"
  }, "7d"), /*#__PURE__*/React.createElement("button", {
    className: "seg-btn"
  }, "14d"), /*#__PURE__*/React.createElement("button", {
    className: "seg-btn"
  }, "21d"), /*#__PURE__*/React.createElement("button", {
    className: "seg-btn"
  }, "30d+"))), data.collect.map(r => {
    const stageColor = r.stage === "30d" || r.stage === "21d" ? 'var(--c-red)' : r.stage === "14d" ? 'var(--c-amber)' : 'var(--text-2)';
    return /*#__PURE__*/React.createElement("div", {
      key: r.id,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '14px 18px',
        borderBottom: '1px solid var(--line)',
        cursor: 'pointer'
      },
      onClick: () => onOpenClient(r.clientId)
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontFamily: 'var(--font-display)',
        fontSize: 18,
        fontWeight: 900,
        color: stageColor,
        background: r.stage === "30d" || r.stage === "21d" ? 'var(--c-red-soft)' : r.stage === "14d" ? 'var(--c-amber-soft)' : 'var(--cream)',
        border: '1px solid ' + (r.stage === "30d" || r.stage === "21d" ? 'var(--c-red-edge)' : r.stage === "14d" ? 'var(--c-amber-edge)' : 'var(--line)'),
        borderRadius: 8,
        padding: '8px 12px',
        minWidth: 60,
        textAlign: 'center',
        letterSpacing: '-.5px'
      }
    }, r.stage), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 14,
        fontWeight: 800,
        color: 'var(--text)',
        letterSpacing: '-.2px'
      }
    }, r.name), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: 'var(--text-3)',
        marginTop: 2,
        fontWeight: 500
      }
    }, r.action, " \xB7 ", r.daysOut, "d past completion", r.lienDeadline && /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--c-red)',
        fontWeight: 700
      }
    }, " \xB7 \u26A0 Lien: ", r.lienDeadline))), /*#__PURE__*/React.createElement("div", {
      style: {
        textAlign: 'right'
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "td-metric",
      style: {
        color: 'var(--c-red)',
        fontSize: 18
      }
    }, "$", r.balance.toLocaleString()), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        color: 'var(--text-3)',
        fontWeight: 600,
        letterSpacing: '.04em',
        textTransform: 'uppercase',
        marginTop: 2
      }
    }, "owed")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 6,
        flexShrink: 0
      }
    }, /*#__PURE__*/React.createElement("button", {
      className: "btn btn-sm",
      onClick: e => e.stopPropagation()
    }, "\uD83D\uDCAC SMS"), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-sm btn-p",
      onClick: e => e.stopPropagation()
    }, "Stripe link \u2192")));
  })), /*#__PURE__*/React.createElement("div", {
    className: "card card-pad-0",
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd-title"
  }, "SMS templates \xB7 sequenced")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 14,
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))',
      gap: 10
    }
  }, [{
    stage: "7d soft",
    tone: "sf-pending",
    body: "Hi {name} — just checking in on the balance from the {project}. Let me know if you need a payment link."
  }, {
    stage: "14d firm",
    tone: "sf-pending",
    body: "{name} — the balance of ${amt} is now 14 days past due. Card link: {link}. Reach out if there's an issue."
  }, {
    stage: "21d formal",
    tone: "sf-overdue",
    body: "{name} — invoice ${amt} is 21 days past due. Final reminder before our standard collections process begins."
  }, {
    stage: "30d lien",
    tone: "sf-lien",
    body: "{name} — under K.S.A. 60-1105 we have 4 months from {complete} to file a mechanic's lien. Final notice."
  }].map((t, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      background: 'var(--cream)',
      border: '1px solid var(--line)',
      borderRadius: 10,
      padding: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "bdg-soft " + t.tone
  }, t.stage), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-sm btn-ghost"
  }, "Edit")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: 'var(--text-2)',
      lineHeight: 1.5,
      fontWeight: 500
    }
  }, t.body))))));
}
window.Collect = Collect;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/Collect.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/Dashboard.jsx
try { (() => {
/* Dashboard.jsx · v2 — workwear modern, eyebrow + trend tiles + Today Feed */

function dashGreetingV2() {
  const hr = new Date().getHours();
  if (hr < 5) return "Working late";
  if (hr < 12) return "Good morning";
  if (hr < 17) return "Good afternoon";
  if (hr < 21) return "Good evening";
  return "Working late";
}
function TrendArrow({
  dir
}) {
  if (dir === "up") return /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 12 12",
    width: "10",
    height: "10",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M2 9l4-4 4 4"
  }));
  if (dir === "dn") return /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 12 12",
    width: "10",
    height: "10",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M2 3l4 4 4-4"
  }));
  return null;
}
function Dashboard({
  data,
  onOpenClient,
  onOpenEstimate,
  onOpenScreen
}) {
  const dateStr = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  });
  return /*#__PURE__*/React.createElement("div", {
    className: "pg"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tbar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tbar-l"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tbar-eyebrow"
  }, dateStr), /*#__PURE__*/React.createElement("div", {
    className: "tbar-title"
  }, dashGreetingV2(), ", Logan"), /*#__PURE__*/React.createElement("div", {
    className: "tbar-sub"
  }, "5 things need your attention today. The biggest one is $4,250 sitting in collections.")), /*#__PURE__*/React.createElement("div", {
    className: "tbar-r"
  }, /*#__PURE__*/React.createElement("div", {
    className: "seg"
  }, /*#__PURE__*/React.createElement("button", {
    className: "seg-btn"
  }, "Month"), /*#__PURE__*/React.createElement("button", {
    className: "seg-btn"
  }, "Quarter"), /*#__PURE__*/React.createElement("button", {
    className: "seg-btn on"
  }, "Year"), /*#__PURE__*/React.createElement("button", {
    className: "seg-btn"
  }, "All")), /*#__PURE__*/React.createElement("button", {
    className: "btn"
  }, "2026 \u25BE"))), /*#__PURE__*/React.createElement("div", {
    className: "mets"
  }, /*#__PURE__*/React.createElement(MetTile, {
    label: "Revenue",
    value: data.kpis.revenue,
    trend: data.kpis.revenueTrend,
    valueColor: "var(--text)",
    onClick: () => onOpenScreen('books')
  }), /*#__PURE__*/React.createElement(MetTile, {
    label: "Expenses",
    value: data.kpis.expenses,
    trend: data.kpis.expensesTrend,
    valueColor: "var(--text)",
    onClick: () => onOpenScreen('books')
  }), /*#__PURE__*/React.createElement(MetTile, {
    label: "Mileage",
    value: data.kpis.mileage,
    unit: "mi",
    trend: data.kpis.mileageTrend,
    onClick: () => onOpenScreen('books')
  }), /*#__PURE__*/React.createElement(MetTile, {
    label: "Taxes (est)",
    value: data.kpis.taxes,
    trend: data.kpis.taxesTrend,
    valueColor: "var(--c-amber)",
    onClick: () => onOpenScreen('taxes')
  }), /*#__PURE__*/React.createElement(MetTile, {
    label: "Profit",
    value: data.kpis.profit,
    trend: data.kpis.profitTrend,
    valueColor: "var(--c-green)",
    onClick: () => onOpenScreen('books')
  }), /*#__PURE__*/React.createElement(MetTile, {
    label: "Avg job",
    value: data.kpis.avgJob,
    trend: data.kpis.avgJobTrend
  })), /*#__PURE__*/React.createElement("div", {
    className: "split-2-wide"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card card-pad-0"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "card-hd-title"
  }, "Make money today"), /*#__PURE__*/React.createElement("div", {
    className: "card-hd-sub"
  }, "5 actions \xB7 sorted by money on the table")), /*#__PURE__*/React.createElement("div", {
    className: "seg"
  }, /*#__PURE__*/React.createElement("button", {
    className: "seg-btn on"
  }, "All"), /*#__PURE__*/React.createElement("button", {
    className: "seg-btn"
  }, "$$$"), /*#__PURE__*/React.createElement("button", {
    className: "seg-btn"
  }, "\u23F0"))), data.todayFeed.map((it, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "tf-card",
    onClick: () => it.clientId && onOpenClient(it.clientId)
  }, /*#__PURE__*/React.createElement("div", {
    className: "tf-icon " + (it.tone || "")
  }, it.emoji), /*#__PURE__*/React.createElement("div", {
    className: "tf-body"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tf-name"
  }, it.name), /*#__PURE__*/React.createElement("div", {
    className: "tf-sub",
    style: {
      color: it.subColor
    }
  }, it.sub)), /*#__PURE__*/React.createElement("div", {
    className: "tf-arrow"
  }, "\u2192")))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "td-micro",
    style: {
      marginBottom: 10
    }
  }, "Quick actions"), /*#__PURE__*/React.createElement("div", {
    className: "qa-grid"
  }, /*#__PURE__*/React.createElement(QA, {
    emoji: "\uD83D\uDC64",
    label: "New lead",
    variant: "p"
  }), /*#__PURE__*/React.createElement(QA, {
    emoji: "\uD83D\uDE97",
    label: "Drive",
    onClick: () => onOpenScreen('books')
  }), /*#__PURE__*/React.createElement(QA, {
    emoji: "\uD83D\uDCCB",
    label: "Estimate",
    onClick: () => onOpenEstimate(1)
  }), /*#__PURE__*/React.createElement(QA, {
    emoji: "\uD83D\uDCC5",
    label: "Schedule",
    onClick: () => onOpenScreen('cal')
  }), /*#__PURE__*/React.createElement(QA, {
    emoji: "\uD83E\uDDFE",
    label: "Expense",
    onClick: () => onOpenScreen('books')
  }), /*#__PURE__*/React.createElement(QA, {
    emoji: "\uD83D\uDCB0",
    label: "Collect",
    variant: "g",
    onClick: () => onOpenScreen('collect')
  }))), /*#__PURE__*/React.createElement("div", {
    className: "card card-pad-0"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd-title"
  }, "Today's calendar"), /*#__PURE__*/React.createElement("div", {
    className: "card-hd-sub"
  }, "Tue, May 12")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '4px 18px 14px'
    }
  }, /*#__PURE__*/React.createElement(CalRow, {
    emoji: "\uD83D\uDD28",
    name: "Hendrickson \xB7 interior day 7",
    sub: "2418 Riverside \xB7 8:00\u20134:00",
    badge: "ACTIVE",
    badgeCls: "bdg bdg-active"
  }), /*#__PURE__*/React.createElement(CalRow, {
    emoji: "\uD83D\uDCCB",
    name: "Park \xB7 estimate visit",
    sub: "5402 Greenwood \xB7 5:30 PM",
    badge: "ESTIMATE",
    badgeCls: "bdg bdg-upcoming"
  }))))), /*#__PURE__*/React.createElement("div", {
    className: "card card-pad-0",
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "card-hd-title"
  }, "Lead sources"), /*#__PURE__*/React.createElement("div", {
    className: "card-hd-sub"
  }, "Year to date \xB7 close rate & revenue")), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-sm"
  }, "Filter \u25BE")), /*#__PURE__*/React.createElement("table", {
    className: "tbl"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Source"), /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'right'
    }
  }, "Leads"), /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'right'
    }
  }, "Won"), /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'right'
    }
  }, "Close %"), /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'right'
    }
  }, "Revenue"))), /*#__PURE__*/React.createElement("tbody", null, data.leadSources.map((s, i) => {
    const pct = Math.round(s.won / s.leads * 100);
    const cls = pct >= 50 ? 'green' : pct >= 25 ? '' : 'red';
    return /*#__PURE__*/React.createElement("tr", {
      key: i
    }, /*#__PURE__*/React.createElement("td", {
      style: {
        fontWeight: 700
      }
    }, s.name), /*#__PURE__*/React.createElement("td", {
      className: "num"
    }, s.leads), /*#__PURE__*/React.createElement("td", {
      className: "num"
    }, s.won), /*#__PURE__*/React.createElement("td", {
      className: "num " + cls
    }, pct, "%"), /*#__PURE__*/React.createElement("td", {
      className: "num"
    }, "$", (s.revenue / 1000).toFixed(1), "k"));
  })))));
}
function MetTile({
  label,
  value,
  unit,
  trend,
  valueColor,
  onClick
}) {
  const trendCls = trend?.dir === "up" ? "up" : trend?.dir === "dn" ? "dn" : "";
  const trendColor = trend?.dir === "up" ? "var(--c-green)" : trend?.dir === "dn" ? "var(--c-red)" : "var(--text-3)";
  return /*#__PURE__*/React.createElement("div", {
    className: "met",
    onClick: onClick
  }, /*#__PURE__*/React.createElement("div", {
    className: "met-l"
  }, label), /*#__PURE__*/React.createElement("div", {
    className: "met-v",
    style: {
      color: valueColor
    }
  }, value, unit ? /*#__PURE__*/React.createElement("span", {
    className: "unit"
  }, unit) : null), trend && /*#__PURE__*/React.createElement("div", {
    className: "met-s",
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      color: trendColor
    }
  }, /*#__PURE__*/React.createElement(TrendArrow, {
    dir: trend.dir
  }), trend.pct ? `${trend.pct}%` : '—', " ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-3)'
    }
  }, trend.label)));
}
function QA({
  emoji,
  label,
  variant,
  onClick
}) {
  const cls = variant === "p" ? "qa qa-p" : variant === "g" ? "qa qa-g" : variant === "d" ? "qa qa-d" : "qa";
  return /*#__PURE__*/React.createElement("button", {
    className: cls,
    onClick: onClick
  }, /*#__PURE__*/React.createElement("span", {
    className: "qa-emoji"
  }, emoji), /*#__PURE__*/React.createElement("span", null, label));
}
function CalRow({
  emoji,
  name,
  sub,
  badge,
  badgeCls
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '10px 0',
      borderBottom: '1px solid var(--line)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "tf-icon"
  }, emoji), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 800,
      letterSpacing: '-.1px',
      color: 'var(--text)'
    }
  }, name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: 'var(--text-3)',
      fontWeight: 500,
      marginTop: 2
    }
  }, sub)), /*#__PURE__*/React.createElement("span", {
    className: badgeCls
  }, badge));
}
window.Dashboard = Dashboard;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/Dashboard.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/Estimate.jsx
try { (() => {
/* Estimate.jsx · v2 — full 7-step estimate builder with line items */
const {
  useState: useEstState
} = React;
const EST_STEPS = [{
  id: 1,
  label: "Client"
}, {
  id: 2,
  label: "Rates"
}, {
  id: 3,
  label: "Scope"
}, {
  id: 4,
  label: "Surfaces"
}, {
  id: 5,
  label: "Review"
}, {
  id: 6,
  label: "Proposal"
}, {
  id: 7,
  label: "Sign"
}];
function Estimate({
  data,
  client,
  onCancel,
  onSendProposal
}) {
  const [step, setStep] = useEstState(3);
  const [scope, setScope] = useEstState(data.scopeItems);
  const [rate, setRate] = useEstState(55);
  const [hours, setHours] = useEstState(58);
  const [crew, setCrew] = useEstState(1);
  const [items, setItems] = useEstState(data.estimate.lineItems);
  const toggle = id => setScope(s => s.map(it => it.id === id ? {
    ...it,
    on: !it.on
  } : it));
  return /*#__PURE__*/React.createElement("div", {
    className: "pg"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tbar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tbar-l"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tbar-eyebrow"
  }, "Step ", step, " of 7 \xB7 ", EST_STEPS.find(s => s.id === step)?.label), /*#__PURE__*/React.createElement("div", {
    className: "tbar-title"
  }, "New estimate"), /*#__PURE__*/React.createElement("div", {
    className: "tbar-sub"
  }, client ? client.name : "—", " \xB7 ", client?.address)), /*#__PURE__*/React.createElement("div", {
    className: "tbar-r"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn"
  }, "\uD83D\uDCBE Save draft"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-ghost",
    onClick: onCancel
  }, "Cancel"))), /*#__PURE__*/React.createElement("div", {
    className: "steps"
  }, EST_STEPS.map((s, i) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: s.id
  }, /*#__PURE__*/React.createElement("div", {
    className: "step" + (step === s.id ? " active" : "") + (step > s.id ? " done" : ""),
    onClick: () => setStep(s.id)
  }, /*#__PURE__*/React.createElement("div", {
    className: "snum"
  }, step > s.id ? "✓" : s.id), /*#__PURE__*/React.createElement("div", {
    className: "slbl"
  }, s.label)), i < EST_STEPS.length - 1 && /*#__PURE__*/React.createElement("div", {
    className: "ssep"
  })))), step === 1 && /*#__PURE__*/React.createElement(StepClient, {
    client: client
  }), step === 2 && /*#__PURE__*/React.createElement(StepRates, {
    rate: rate,
    setRate: setRate,
    hours: hours,
    setHours: setHours,
    crew: crew,
    setCrew: setCrew
  }), step === 3 && /*#__PURE__*/React.createElement(StepScope, {
    scope: scope,
    toggle: toggle
  }), step === 4 && /*#__PURE__*/React.createElement(StepSurfaces, {
    data: data
  }), step === 5 && /*#__PURE__*/React.createElement(StepReview, {
    items: items,
    setItems: setItems,
    client: client,
    data: data
  }), step === 6 && /*#__PURE__*/React.createElement(StepProposalConfirm, {
    items: items,
    client: client,
    data: data
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      marginTop: 14,
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn",
    onClick: () => setStep(s => Math.max(1, s - 1)),
    disabled: step === 1
  }, "\u2190 Back"), step < 6 && /*#__PURE__*/React.createElement("button", {
    className: "btn btn-p btn-xl",
    onClick: () => setStep(s => Math.min(6, s + 1))
  }, "Continue \u2192"), step === 6 && /*#__PURE__*/React.createElement("button", {
    className: "btn btn-p btn-xl",
    onClick: onSendProposal
  }, "\uD83D\uDCE8 Send proposal to ", client?.name?.split(',')[0])));
}
function StepClient({
  client
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "td-h3",
    style: {
      marginBottom: 14
    }
  }, "Confirm client & property"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 12,
      padding: 16,
      background: 'var(--cream)',
      borderRadius: 10,
      border: '1px solid var(--line)',
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "td-micro",
    style: {
      marginBottom: 4
    }
  }, "Client"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 16,
      fontWeight: 800,
      letterSpacing: '-.3px'
    }
  }, client?.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--text-3)',
      marginTop: 2,
      fontWeight: 500
    }
  }, client?.phone, " \xB7 ", client?.email)), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "td-micro",
    style: {
      marginBottom: 4
    }
  }, "Property"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 700
    }
  }, client?.address), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--text-3)',
      marginTop: 2,
      fontWeight: 500
    }
  }, client?.city, ", ", client?.state, " ", client?.zip, " \xB7 ", client?.ptype, " \xB7 ", client?.yearBuilt))), client?.yearBuilt < 1978 && /*#__PURE__*/React.createElement("div", {
    className: "tip t-w"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 18
    }
  }, "\u26A0\uFE0F"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", null, "Pre-1978 property. "), "EPA lead-paint pamphlet required at signing. Auto-attached to the proposal.")), /*#__PURE__*/React.createElement("div", {
    className: "tip"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 18
    }
  }, "\uD83D\uDCCB"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", null, "Looks good. "), "Tap Continue to set the per-job rates.")));
}
function StepRates({
  rate,
  setRate,
  hours,
  setHours,
  crew,
  setCrew
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "td-h3",
    style: {
      marginBottom: 8
    }
  }, "Per-job rates"), /*#__PURE__*/React.createElement("div", {
    className: "tip"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 18
    }
  }, "\uD83D\uDCA1"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", null, "Set rates upfront. "), "Never hardcoded. Adjust per job based on access, height, and crew size.")), /*#__PURE__*/React.createElement("div", {
    className: "fg fg2"
  }, /*#__PURE__*/React.createElement("div", {
    className: "f"
  }, /*#__PURE__*/React.createElement("label", null, "Labor rate \xB7 $/hr"), /*#__PURE__*/React.createElement("input", {
    type: "number",
    value: rate,
    onChange: e => setRate(+e.target.value)
  })), /*#__PURE__*/React.createElement("div", {
    className: "f"
  }, /*#__PURE__*/React.createElement("label", null, "Estimated hours"), /*#__PURE__*/React.createElement("input", {
    type: "number",
    value: hours,
    onChange: e => setHours(+e.target.value)
  })), /*#__PURE__*/React.createElement("div", {
    className: "f"
  }, /*#__PURE__*/React.createElement("label", null, "Crew size"), /*#__PURE__*/React.createElement("select", {
    value: crew,
    onChange: e => setCrew(+e.target.value)
  }, /*#__PURE__*/React.createElement("option", {
    value: 1
  }, "1 \xB7 solo"), /*#__PURE__*/React.createElement("option", {
    value: 2
  }, "2 \xB7 me + helper"), /*#__PURE__*/React.createElement("option", {
    value: 3
  }, "3+ \xB7 full crew"))), /*#__PURE__*/React.createElement("div", {
    className: "f"
  }, /*#__PURE__*/React.createElement("label", null, "Travel time"), /*#__PURE__*/React.createElement("input", {
    defaultValue: "45 min round trip"
  })), /*#__PURE__*/React.createElement("div", {
    className: "f"
  }, /*#__PURE__*/React.createElement("label", null, "Materials markup %"), /*#__PURE__*/React.createElement("input", {
    defaultValue: "18"
  })), /*#__PURE__*/React.createElement("div", {
    className: "f"
  }, /*#__PURE__*/React.createElement("label", null, "Deposit %"), /*#__PURE__*/React.createElement("input", {
    defaultValue: "30"
  }))));
}
function StepScope({
  scope,
  toggle
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "td-h3",
    style: {
      marginBottom: 8
    }
  }, "Scope of work"), /*#__PURE__*/React.createElement("div", {
    className: "tip"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 18
    }
  }, "\uD83D\uDCCB"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", null, "Tap to toggle. "), "Selected items drive the proposal language and the surface-by-surface math.")), /*#__PURE__*/React.createElement("div", {
    className: "scope-grid"
  }, scope.map(it => {
    const sel = it.on;
    return /*#__PURE__*/React.createElement("button", {
      type: "button",
      key: it.id,
      onClick: () => toggle(it.id),
      className: "scope-btn" + (sel ? " on" : "")
    }, /*#__PURE__*/React.createElement("div", {
      className: "scope-check"
    }, sel ? "✓" : ""), /*#__PURE__*/React.createElement("div", {
      className: "scope-body"
    }, /*#__PURE__*/React.createElement("div", {
      className: "scope-label"
    }, it.label), /*#__PURE__*/React.createElement("div", {
      className: "scope-rate"
    }, "$", it.rate.toFixed(2), " / ", it.id === 'prep' || it.id === 'cabinets' ? 'unit' : 'sf')));
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      marginTop: 12,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn btn-sm"
  }, "+ Custom scope item"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-sm btn-ghost"
  }, "Load from template \u25BE")));
}
function StepSurfaces({
  data
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "td-h3",
    style: {
      marginBottom: 8
    }
  }, "Room-by-room surfaces"), /*#__PURE__*/React.createElement("div", {
    className: "tip"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 18
    }
  }, "\uD83D\uDCD0"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", null, "L \xD7 W \xD7 H auto-calcs surface area. "), "Walls and ceilings, by room.")), data.surfaces.map((s, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      background: 'var(--cream)',
      borderRadius: 10,
      padding: '12px 14px',
      marginBottom: 8,
      border: '1px solid var(--line)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 800,
      letterSpacing: '-.1px'
    }
  }, s.room), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-sm btn-ghost"
  }, "Remove")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 1fr auto',
      gap: 8,
      alignItems: 'flex-end'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "f"
  }, /*#__PURE__*/React.createElement("label", null, "Length"), /*#__PURE__*/React.createElement("input", {
    defaultValue: s.l
  })), /*#__PURE__*/React.createElement("div", {
    className: "f"
  }, /*#__PURE__*/React.createElement("label", null, "Width"), /*#__PURE__*/React.createElement("input", {
    defaultValue: s.w
  })), /*#__PURE__*/React.createElement("div", {
    className: "f"
  }, /*#__PURE__*/React.createElement("label", null, "Height"), /*#__PURE__*/React.createElement("input", {
    defaultValue: s.h
  })), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-sm",
    style: {
      height: 38
    }
  }, "L\xD7H")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 14,
      marginTop: 8,
      fontSize: 11,
      color: 'var(--text-3)',
      fontWeight: 600
    }
  }, /*#__PURE__*/React.createElement("span", null, "Walls ", /*#__PURE__*/React.createElement("b", {
    style: {
      color: 'var(--text)'
    }
  }, 2 * (s.l + s.w) * s.h, " sf")), /*#__PURE__*/React.createElement("span", null, "Ceiling ", /*#__PURE__*/React.createElement("b", {
    style: {
      color: 'var(--text)'
    }
  }, s.l * s.w, " sf")), /*#__PURE__*/React.createElement("span", null, "Trim ~", /*#__PURE__*/React.createElement("b", {
    style: {
      color: 'var(--text)'
    }
  }, 2 * (s.l + s.w), " lf"))))), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-sm",
    style: {
      marginTop: 4
    }
  }, "+ Add room"));
}
function StepReview({
  items,
  setItems,
  client,
  data
}) {
  const subtotal = items.reduce((s, it) => s + it.total, 0);
  const tax = 0;
  const total = subtotal + tax;
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "card card-pad-0"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd-title"
  }, "Bid review \xB7 line items"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-sm"
  }, "+ Add line")), /*#__PURE__*/React.createElement("table", {
    className: "tbl"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Description"), /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'right'
    }
  }, "Qty"), /*#__PURE__*/React.createElement("th", null, "Unit"), /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'right'
    }
  }, "Price"), /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'right'
    }
  }, "Total"), /*#__PURE__*/React.createElement("th", null))), /*#__PURE__*/React.createElement("tbody", null, items.map((it, i) => /*#__PURE__*/React.createElement("tr", {
    key: it.id
  }, /*#__PURE__*/React.createElement("td", {
    style: {
      maxWidth: 340,
      fontWeight: 700
    }
  }, it.label), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, it.qty.toLocaleString()), /*#__PURE__*/React.createElement("td", {
    className: "muted"
  }, it.unit), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, "$", it.price.toFixed(2)), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, "$", it.total.toLocaleString()), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("button", {
    className: "btn btn-sm btn-ghost"
  }, "\u22EF"))))))), /*#__PURE__*/React.createElement("div", {
    className: "split-est",
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "td-h4",
    style: {
      marginBottom: 10
    }
  }, "Schedule"), /*#__PURE__*/React.createElement("div", {
    className: "fg fg2"
  }, /*#__PURE__*/React.createElement("div", {
    className: "f"
  }, /*#__PURE__*/React.createElement("label", null, "Start date"), /*#__PURE__*/React.createElement("input", {
    defaultValue: data.estimate.schedule.start
  })), /*#__PURE__*/React.createElement("div", {
    className: "f"
  }, /*#__PURE__*/React.createElement("label", null, "Estimated finish"), /*#__PURE__*/React.createElement("input", {
    defaultValue: data.estimate.schedule.end
  }))), /*#__PURE__*/React.createElement("div", {
    className: "tip t-s",
    style: {
      marginTop: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 18
    }
  }, "\u2713"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", null, "Calendar is clear May 18\u201324. "), "No conflicts found."))), /*#__PURE__*/React.createElement("div", {
    className: "card",
    style: {
      background: 'var(--cream)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "td-h4",
    style: {
      marginBottom: 10
    }
  }, "Totals"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      padding: '4px 0',
      fontSize: 13
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-2)'
    }
  }, "Subtotal"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontVariantNumeric: 'tabular-nums',
      fontWeight: 700
    }
  }, "$", subtotal.toLocaleString())), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      padding: '4px 0',
      fontSize: 13
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-2)'
    }
  }, "Tax (KS none on services)"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontVariantNumeric: 'tabular-nums'
    }
  }, "$0")), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 1,
      background: 'var(--ink)',
      margin: '8px 0'
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "prop-total"
  }, /*#__PURE__*/React.createElement("span", null, "Total"), /*#__PURE__*/React.createElement("span", {
    className: "v"
  }, "$", total.toLocaleString())), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      padding: '4px 0',
      fontSize: 12,
      color: 'var(--text-3)',
      marginTop: 4
    }
  }, /*#__PURE__*/React.createElement("span", null, "30% deposit on signing"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontVariantNumeric: 'tabular-nums'
    }
  }, "$", Math.round(total * 0.3).toLocaleString())), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      padding: '4px 0',
      fontSize: 12,
      color: 'var(--text-3)'
    }
  }, /*#__PURE__*/React.createElement("span", null, "Balance on completion"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontVariantNumeric: 'tabular-nums'
    }
  }, "$", (total - Math.round(total * 0.3)).toLocaleString())))));
}
function StepProposalConfirm({
  items,
  client,
  data
}) {
  const total = items.reduce((s, it) => s + it.total, 0);
  return /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "td-h3",
    style: {
      marginBottom: 14
    }
  }, "Ready to send"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 14,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 14,
      background: 'var(--cream)',
      borderRadius: 10,
      border: '1px solid var(--line)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "td-micro",
    style: {
      marginBottom: 4
    }
  }, "To"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 800
    }
  }, client?.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: 'var(--text-3)',
      marginTop: 2,
      fontWeight: 500
    }
  }, client?.email, " \xB7 ", client?.phone)), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 14,
      background: 'var(--cream)',
      borderRadius: 10,
      border: '1px solid var(--line)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "td-micro",
    style: {
      marginBottom: 4
    }
  }, "One-price total"), /*#__PURE__*/React.createElement("div", {
    className: "td-display",
    style: {
      fontSize: 28,
      color: 'var(--denim)'
    }
  }, "$", total.toLocaleString()), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: 'var(--text-3)',
      marginTop: 2,
      fontWeight: 500
    }
  }, "30% deposit \xB7 $", Math.round(total * 0.3).toLocaleString(), " on signing"))), /*#__PURE__*/React.createElement("div", {
    className: "tip t-s"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 18
    }
  }, "\uD83D\uDCE8"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", null, "Client sees one price, not the internal math. "), "SMS + email both go out, plus a Stripe-ready deposit link.")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      marginTop: 10,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "chip"
  }, "UETA compliant"), /*#__PURE__*/React.createElement("span", {
    className: "chip"
  }, "K.S.A. 60-1105 lien language"), /*#__PURE__*/React.createElement("span", {
    className: "chip"
  }, "Change-order clause"), /*#__PURE__*/React.createElement("span", {
    className: "chip"
  }, "3-day Kansas rescission")));
}
window.Estimate = Estimate;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/Estimate.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/EstimateBYO.jsx
try { (() => {
/* EstimateBYO.jsx — Build Your Own modular estimate */
const {
  useState: useBYOState
} = React;
function EstimateBYO({
  data,
  client,
  onCancel,
  onSendProposal,
  onSwitchType
}) {
  const [items, setItems] = useBYOState([{
    id: 1,
    section: "Interior",
    label: "Living room — walls + ceiling",
    price: 1280,
    required: true,
    on: true
  }, {
    id: 2,
    section: "Interior",
    label: "Kitchen — walls + trim",
    price: 980,
    required: true,
    on: true
  }, {
    id: 3,
    section: "Interior",
    label: "Master bedroom — walls only",
    price: 720,
    required: false,
    on: true
  }, {
    id: 4,
    section: "Interior",
    label: "Bedroom 2 — walls + trim",
    price: 640,
    required: false,
    on: false
  }, {
    id: 5,
    section: "Interior",
    label: "Hallway + stairwell",
    price: 540,
    required: false,
    on: false
  }, {
    id: 6,
    section: "Interior",
    label: "All baseboards · whole house",
    price: 380,
    required: false,
    on: true
  }, {
    id: 7,
    section: "Add-ons",
    label: "Cabinet refinish · 24 doors",
    price: 2400,
    required: false,
    on: false
  }, {
    id: 8,
    section: "Add-ons",
    label: "Front door · stain + reseal",
    price: 340,
    required: false,
    on: false
  }, {
    id: 9,
    section: "Add-ons",
    label: "Garage floor epoxy · 400 sf",
    price: 1800,
    required: false,
    on: false
  }, {
    id: 10,
    section: "Exterior",
    label: "Front porch + trim",
    price: 1100,
    required: false,
    on: false
  }, {
    id: 11,
    section: "Exterior",
    label: "Deck · stain + seal",
    price: 920,
    required: false,
    on: false
  }]);
  const toggle = id => setItems(arr => arr.map(it => it.id === id && !it.required ? {
    ...it,
    on: !it.on
  } : it));
  const sections = [...new Set(items.map(it => it.section))];
  const selected = items.filter(it => it.on);
  const subtotal = selected.reduce((s, it) => s + it.price, 0);
  const discount = subtotal > 6000 ? Math.round(subtotal * 0.05) : 0;
  const total = subtotal - discount;
  return /*#__PURE__*/React.createElement("div", {
    className: "pg"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tbar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tbar-l"
  }, /*#__PURE__*/React.createElement("button", {
    className: "link-back",
    onClick: onSwitchType,
    style: {
      marginBottom: 6
    }
  }, "\u2190 Pick a different type"), /*#__PURE__*/React.createElement("div", {
    className: "tbar-title"
  }, "Build Your Own estimate"), /*#__PURE__*/React.createElement("div", {
    className: "tbar-sub"
  }, client?.name, " \xB7 ", client?.address, " \u2014 the client will see this menu and pick what they want.")), /*#__PURE__*/React.createElement("div", {
    className: "tbar-r"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn"
  }, "\uD83D\uDCBE Save draft"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-ghost",
    onClick: onCancel
  }, "Cancel"))), /*#__PURE__*/React.createElement("div", {
    className: "split-est"
  }, /*#__PURE__*/React.createElement("div", null, sections.map(sec => /*#__PURE__*/React.createElement("div", {
    key: sec,
    className: "card card-pad-0",
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd-title"
  }, sec), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-sm"
  }, "+ Add item")), /*#__PURE__*/React.createElement("div", null, items.filter(it => it.section === sec).map(it => /*#__PURE__*/React.createElement("div", {
    key: it.id,
    className: "byo-row" + (it.on ? " on" : "") + (it.required ? " req" : ""),
    onClick: () => toggle(it.id)
  }, /*#__PURE__*/React.createElement("div", {
    className: "byo-check" + (it.on ? " on" : "")
  }, it.on ? "✓" : ""), /*#__PURE__*/React.createElement("div", {
    className: "byo-body"
  }, /*#__PURE__*/React.createElement("div", {
    className: "byo-label"
  }, it.label), /*#__PURE__*/React.createElement("div", {
    className: "byo-meta"
  }, it.required ? /*#__PURE__*/React.createElement("span", {
    className: "bdg-soft sf-deposit",
    style: {
      height: 18,
      fontSize: 9,
      padding: '0 6px'
    }
  }, "REQUIRED") : /*#__PURE__*/React.createElement("span", {
    className: "bdg-soft sf-done",
    style: {
      height: 18,
      fontSize: 9,
      padding: '0 6px'
    }
  }, "OPTIONAL"))), /*#__PURE__*/React.createElement("div", {
    className: "byo-price"
  }, "$", it.price.toLocaleString())))))), /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "td-h3",
    style: {
      marginBottom: 10
    }
  }, "Bundling & discounts"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "stat-tile"
  }, /*#__PURE__*/React.createElement("div", {
    className: "stat-l"
  }, "Bundle discount"), /*#__PURE__*/React.createElement("div", {
    className: "stat-v"
  }, "5%"), /*#__PURE__*/React.createElement("div", {
    className: "stat-s"
  }, "applies at $6k+")), /*#__PURE__*/React.createElement("div", {
    className: "stat-tile"
  }, /*#__PURE__*/React.createElement("div", {
    className: "stat-l"
  }, "Tax"), /*#__PURE__*/React.createElement("div", {
    className: "stat-v"
  }, "0%"), /*#__PURE__*/React.createElement("div", {
    className: "stat-s"
  }, "KS services exempt"))))), /*#__PURE__*/React.createElement("div", {
    className: "summary-rail"
  }, /*#__PURE__*/React.createElement("div", {
    className: "summary-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "td-micro",
    style: {
      marginBottom: 8
    }
  }, "Client total \xB7 live"), /*#__PURE__*/React.createElement("div", {
    className: "td-display summary-total"
  }, "$", total.toLocaleString()), /*#__PURE__*/React.createElement("div", {
    className: "summary-meta"
  }, selected.length, " of ", items.length, " items selected"), /*#__PURE__*/React.createElement("div", {
    className: "summary-divider"
  }), /*#__PURE__*/React.createElement("div", {
    className: "summary-row"
  }, /*#__PURE__*/React.createElement("span", null, "Items subtotal"), /*#__PURE__*/React.createElement("span", null, "$", subtotal.toLocaleString())), discount > 0 && /*#__PURE__*/React.createElement("div", {
    className: "summary-row",
    style: {
      color: 'var(--c-green)'
    }
  }, /*#__PURE__*/React.createElement("span", null, "Bundle 5%"), /*#__PURE__*/React.createElement("span", null, "-$", discount.toLocaleString())), /*#__PURE__*/React.createElement("div", {
    className: "summary-divider"
  }), /*#__PURE__*/React.createElement("div", {
    className: "summary-row"
  }, /*#__PURE__*/React.createElement("span", null, "Deposit \xB7 30%"), /*#__PURE__*/React.createElement("span", null, "$", Math.round(total * 0.3).toLocaleString())), /*#__PURE__*/React.createElement("div", {
    className: "summary-row",
    style: {
      color: 'var(--text-3)'
    }
  }, /*#__PURE__*/React.createElement("span", null, "Balance later"), /*#__PURE__*/React.createElement("span", null, "$", (total - Math.round(total * 0.3)).toLocaleString())), /*#__PURE__*/React.createElement("div", {
    className: "summary-divider"
  }), /*#__PURE__*/React.createElement("div", {
    className: "td-micro",
    style: {
      marginBottom: 6
    }
  }, "Client controls"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "chip"
  }, "Can toggle"), /*#__PURE__*/React.createElement("span", {
    className: "chip"
  }, "Lives 14d"), /*#__PURE__*/React.createElement("span", {
    className: "chip"
  }, "Auto-recalc")), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-p btn-xl btn-full",
    style: {
      marginTop: 14
    },
    onClick: onSendProposal
  }, "\uD83D\uDCE8 Send pick-your-own proposal"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-full",
    style: {
      marginTop: 8
    }
  }, "\uD83D\uDC41 Preview as client")))));
}
window.EstimateBYO = EstimateBYO;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/EstimateBYO.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/EstimateChooser.jsx
try { (() => {
/* EstimateChooser.jsx — pick one of three estimate types */

function EstimateChooser({
  client,
  onPick,
  onCancel
}) {
  const types = [{
    id: "scope-price",
    eyebrow: "Most popular",
    title: "Scope &  Price",
    sub: "Fixed scope, one final number",
    desc: "You define the work, the client sees one bottom-line price. Best for clearly-defined jobs like a full repaint or a single-room remodel.",
    icon: "📋",
    bullets: ["Line items hidden from client", "Internal labor + materials math", "Single-price proposal", "30% deposit standard"],
    tone: "denim"
  }, {
    id: "tm",
    eyebrow: "For variable scope",
    title: "Time &  Materials",
    sub: "Bill the hours, mark up the materials",
    desc: "Open-ended scope where the client agrees to a rate, not a final price. Best for unknown-scope work — water damage, surprise repairs.",
    icon: "⏱️",
    bullets: ["Hourly rate + crew size", "Materials at cost + markup", "Not-to-exceed cap (optional)", "Weekly invoicing"],
    tone: "amber"
  }, {
    id: "byo",
    eyebrow: "Pick and choose",
    title: "Build Your Own",
    sub: "Modular line items, client picks what they want",
    desc: "Send a menu of priced services. Client toggles what they want, you get a signed proposal back with exactly that scope.",
    icon: "🧩",
    bullets: ["Optional / required tiers", "Client-side toggles", "Real-time recalculation", "Upsell-friendly"],
    tone: "green"
  }];
  return /*#__PURE__*/React.createElement("div", {
    className: "pg"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tbar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tbar-l"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tbar-eyebrow"
  }, "Step 1 of 8 \xB7 Pick estimate type"), /*#__PURE__*/React.createElement("div", {
    className: "tbar-title"
  }, "How are you billing this job?"), /*#__PURE__*/React.createElement("div", {
    className: "tbar-sub"
  }, client ? client.name + " · " + client.address : "Pick a client after", " \u2014 you can change this later, but the proposal templates & math change per type.")), /*#__PURE__*/React.createElement("div", {
    className: "tbar-r"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn btn-ghost",
    onClick: onCancel
  }, "Cancel"))), /*#__PURE__*/React.createElement("div", {
    className: "chooser-grid"
  }, types.map(t => /*#__PURE__*/React.createElement("button", {
    key: t.id,
    className: "chooser-card chooser-" + t.tone,
    onClick: () => onPick(t.id)
  }, /*#__PURE__*/React.createElement("div", {
    className: "chooser-eyebrow"
  }, t.eyebrow), /*#__PURE__*/React.createElement("div", {
    className: "chooser-icon"
  }, t.icon), /*#__PURE__*/React.createElement("div", {
    className: "chooser-title"
  }, t.title), /*#__PURE__*/React.createElement("div", {
    className: "chooser-sub"
  }, t.sub), /*#__PURE__*/React.createElement("div", {
    className: "chooser-desc"
  }, t.desc), /*#__PURE__*/React.createElement("ul", {
    className: "chooser-bullets"
  }, t.bullets.map((b, i) => /*#__PURE__*/React.createElement("li", {
    key: i
  }, /*#__PURE__*/React.createElement("span", null, "\u2713"), b))), /*#__PURE__*/React.createElement("div", {
    className: "chooser-cta"
  }, "Start \u2192")))), /*#__PURE__*/React.createElement("div", {
    className: "tip",
    style: {
      marginTop: 18
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 18
    }
  }, "\uD83D\uDCA1"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", null, "Tip \xB7 "), "Most painters use ", /*#__PURE__*/React.createElement("b", null, "Scope & Price"), " for new clients and ", /*#__PURE__*/React.createElement("b", null, "Time & Materials"), " for repeat customers with open-ended work. ", /*#__PURE__*/React.createElement("b", null, "Build Your Own"), " shines for upsells \u2014 bigger close rates because the client picks their own price.")));
}
window.EstimateChooser = EstimateChooser;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/EstimateChooser.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/EstimateTM.jsx
try { (() => {
/* EstimateTM.jsx — Time & Materials estimate */
const {
  useState: useTMState
} = React;
function EstimateTM({
  data,
  client,
  onCancel,
  onSendProposal,
  onSwitchType
}) {
  const [hourlyRate, setHourlyRate] = useTMState(75);
  const [crew, setCrew] = useTMState(2);
  const [estHours, setEstHours] = useTMState(40);
  const [materialMarkup, setMaterialMarkup] = useTMState(20);
  const [notToExceed, setNotToExceed] = useTMState("");
  const dayRate = hourlyRate * 8 * crew;
  const totalLabor = hourlyRate * estHours * crew;
  const estMaterials = 1800;
  const markup = Math.round(estMaterials * materialMarkup / 100);
  const total = totalLabor + estMaterials + markup;
  return /*#__PURE__*/React.createElement("div", {
    className: "pg"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tbar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tbar-l"
  }, /*#__PURE__*/React.createElement("button", {
    className: "link-back",
    onClick: onSwitchType,
    style: {
      marginBottom: 6
    }
  }, "\u2190 Pick a different type"), /*#__PURE__*/React.createElement("div", {
    className: "tbar-title"
  }, "Time & Materials estimate"), /*#__PURE__*/React.createElement("div", {
    className: "tbar-sub"
  }, client?.name, " \xB7 ", client?.address)), /*#__PURE__*/React.createElement("div", {
    className: "tbar-r"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn"
  }, "\uD83D\uDCBE Save draft"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-ghost",
    onClick: onCancel
  }, "Cancel"))), /*#__PURE__*/React.createElement("div", {
    className: "split-est"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "td-h3",
    style: {
      marginBottom: 10
    }
  }, "Rates & crew"), /*#__PURE__*/React.createElement("div", {
    className: "fg fg2"
  }, /*#__PURE__*/React.createElement("div", {
    className: "f"
  }, /*#__PURE__*/React.createElement("label", null, "Hourly rate \xB7 $/hr"), /*#__PURE__*/React.createElement("div", {
    className: "input-prefix"
  }, /*#__PURE__*/React.createElement("span", null, "$"), /*#__PURE__*/React.createElement("input", {
    type: "number",
    value: hourlyRate,
    onChange: e => setHourlyRate(+e.target.value || 0)
  }))), /*#__PURE__*/React.createElement("div", {
    className: "f"
  }, /*#__PURE__*/React.createElement("label", null, "Crew size"), /*#__PURE__*/React.createElement("select", {
    value: crew,
    onChange: e => setCrew(+e.target.value)
  }, /*#__PURE__*/React.createElement("option", {
    value: 1
  }, "1 \xB7 solo"), /*#__PURE__*/React.createElement("option", {
    value: 2
  }, "2 \xB7 me + helper"), /*#__PURE__*/React.createElement("option", {
    value: 3
  }, "3 \xB7 full crew"), /*#__PURE__*/React.createElement("option", {
    value: 4
  }, "4+ \xB7 large crew"))), /*#__PURE__*/React.createElement("div", {
    className: "f"
  }, /*#__PURE__*/React.createElement("label", null, "Estimated hours"), /*#__PURE__*/React.createElement("input", {
    type: "number",
    value: estHours,
    onChange: e => setEstHours(+e.target.value || 0)
  })), /*#__PURE__*/React.createElement("div", {
    className: "f"
  }, /*#__PURE__*/React.createElement("label", null, "Material markup %"), /*#__PURE__*/React.createElement("div", {
    className: "input-suffix"
  }, /*#__PURE__*/React.createElement("input", {
    type: "number",
    value: materialMarkup,
    onChange: e => setMaterialMarkup(+e.target.value || 0)
  }), /*#__PURE__*/React.createElement("span", null, "%")))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3,1fr)',
      gap: 10,
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "stat-tile"
  }, /*#__PURE__*/React.createElement("div", {
    className: "stat-l"
  }, "Day rate"), /*#__PURE__*/React.createElement("div", {
    className: "stat-v"
  }, "$", dayRate.toLocaleString()), /*#__PURE__*/React.createElement("div", {
    className: "stat-s"
  }, crew, "-person crew \xB7 8hr day")), /*#__PURE__*/React.createElement("div", {
    className: "stat-tile"
  }, /*#__PURE__*/React.createElement("div", {
    className: "stat-l"
  }, "Est. labor total"), /*#__PURE__*/React.createElement("div", {
    className: "stat-v"
  }, "$", totalLabor.toLocaleString()), /*#__PURE__*/React.createElement("div", {
    className: "stat-s"
  }, estHours, "hr \xD7 ", crew, " \xD7 $", hourlyRate)), /*#__PURE__*/React.createElement("div", {
    className: "stat-tile"
  }, /*#__PURE__*/React.createElement("div", {
    className: "stat-l"
  }, "Working days"), /*#__PURE__*/React.createElement("div", {
    className: "stat-v"
  }, Math.ceil(estHours / 8)), /*#__PURE__*/React.createElement("div", {
    className: "stat-s"
  }, "at 8hr days")))), /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "row-bw",
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "td-h3"
  }, "Material categories"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-sm"
  }, "+ Add category")), /*#__PURE__*/React.createElement("div", {
    className: "tm-mat-list"
  }, [{
    cat: "Paint &amp; primer",
    est: "$680",
    notes: "SW Cashmere, Regal Select"
  }, {
    cat: "Drywall &amp; patch",
    est: "$240",
    notes: "compound, sandpaper, tape"
  }, {
    cat: "Masking &amp; cover",
    est: "$180",
    notes: "plastic, paper, frog tape"
  }, {
    cat: "Disposal",
    est: "$120",
    notes: "haul + dump fees"
  }, {
    cat: "Misc supplies",
    est: "$580",
    notes: "brushes, rollers, caulk"
  }].map((m, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "tm-mat-row"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "tm-mat-cat",
    dangerouslySetInnerHTML: {
      __html: m.cat
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "tm-mat-notes"
  }, m.notes)), /*#__PURE__*/React.createElement("div", {
    className: "tm-mat-est"
  }, m.est)))), /*#__PURE__*/React.createElement("div", {
    className: "tip",
    style: {
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 18
    }
  }, "\uD83E\uDDFE"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", null, "Materials billed at cost + ", materialMarkup, "% markup. "), "Client sees the actual receipts; we add the markup as a line item."))), /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "td-h3",
    style: {
      marginBottom: 10
    }
  }, "Not-to-exceed cap (optional)"), /*#__PURE__*/React.createElement("div", {
    className: "fg fg2"
  }, /*#__PURE__*/React.createElement("div", {
    className: "f"
  }, /*#__PURE__*/React.createElement("label", null, "Cap amount"), /*#__PURE__*/React.createElement("div", {
    className: "input-prefix"
  }, /*#__PURE__*/React.createElement("span", null, "$"), /*#__PURE__*/React.createElement("input", {
    type: "number",
    placeholder: "e.g. 12,000",
    value: notToExceed,
    onChange: e => setNotToExceed(e.target.value)
  }))), /*#__PURE__*/React.createElement("div", {
    className: "f"
  }, /*#__PURE__*/React.createElement("label", null, "What happens at cap"), /*#__PURE__*/React.createElement("select", null, /*#__PURE__*/React.createElement("option", null, "Stop & get re-approval"), /*#__PURE__*/React.createElement("option", null, "Continue at agreed rate"), /*#__PURE__*/React.createElement("option", null, "Switch to fixed-price quote")))))), /*#__PURE__*/React.createElement("div", {
    className: "summary-rail"
  }, /*#__PURE__*/React.createElement("div", {
    className: "summary-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "td-micro",
    style: {
      marginBottom: 8
    }
  }, "Estimated total"), /*#__PURE__*/React.createElement("div", {
    className: "td-display summary-total"
  }, "$", total.toLocaleString()), /*#__PURE__*/React.createElement("div", {
    className: "summary-meta"
  }, "\xB115% normal for T&M"), /*#__PURE__*/React.createElement("div", {
    className: "summary-divider"
  }), /*#__PURE__*/React.createElement("div", {
    className: "summary-row"
  }, /*#__PURE__*/React.createElement("span", null, "Labor"), /*#__PURE__*/React.createElement("span", null, "$", totalLabor.toLocaleString())), /*#__PURE__*/React.createElement("div", {
    className: "summary-row"
  }, /*#__PURE__*/React.createElement("span", null, "Materials est."), /*#__PURE__*/React.createElement("span", null, "$", estMaterials.toLocaleString())), /*#__PURE__*/React.createElement("div", {
    className: "summary-row"
  }, /*#__PURE__*/React.createElement("span", null, "Markup (", materialMarkup, "%)"), /*#__PURE__*/React.createElement("span", null, "$", markup.toLocaleString())), notToExceed && /*#__PURE__*/React.createElement("div", {
    className: "summary-row",
    style: {
      color: 'var(--c-amber)'
    }
  }, /*#__PURE__*/React.createElement("span", null, "NTE cap"), /*#__PURE__*/React.createElement("span", null, "$", (+notToExceed).toLocaleString())), /*#__PURE__*/React.createElement("div", {
    className: "summary-divider"
  }), /*#__PURE__*/React.createElement("div", {
    className: "td-micro",
    style: {
      marginBottom: 6
    }
  }, "Billing cadence"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "chip"
  }, "Weekly"), /*#__PURE__*/React.createElement("span", {
    className: "chip"
  }, "By milestone"), /*#__PURE__*/React.createElement("span", {
    className: "chip"
  }, "On completion")), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-p btn-xl btn-full",
    style: {
      marginTop: 14
    },
    onClick: onSendProposal
  }, "\uD83D\uDCE8 Send T&M proposal"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-full",
    style: {
      marginTop: 8
    }
  }, "\uD83D\uDC41 Preview as client")))));
}
window.EstimateTM = EstimateTM;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/EstimateTM.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/Estimates.jsx
try { (() => {
/* Estimates.jsx — list of all estimates + opens chooser */

function Estimates({
  data,
  onOpenChooser,
  onOpenProposal,
  onOpenClient
}) {
  const rows = [{
    id: 201,
    clientId: 4,
    name: "Whitlock, S.",
    project: "Exterior body + trim",
    type: "Scope & Price",
    typeCls: "sf-deposit",
    amount: 8950,
    sent: "May 8",
    status: "awaiting_sig"
  }, {
    id: 202,
    clientId: 2,
    name: "Calle, J.",
    project: "Full exterior",
    type: "Scope & Price",
    typeCls: "sf-deposit",
    amount: 6800,
    sent: "May 5",
    status: "signed"
  }, {
    id: 203,
    clientId: 5,
    name: "Park, A.",
    project: "Garage + porch · open scope",
    type: "Time & Materials",
    typeCls: "sf-pending",
    amount: "~$4.8k",
    sent: "May 4",
    status: "draft"
  }, {
    id: 204,
    clientId: 1,
    name: "Hendrickson, B.",
    project: "Interior 3 rooms + trim",
    type: "Scope & Price",
    typeCls: "sf-deposit",
    amount: 4250,
    sent: "Apr 26",
    status: "signed"
  }, {
    id: 205,
    clientId: 3,
    name: "Ortega, M.",
    project: "Interior + ceilings",
    type: "Build Your Own",
    typeCls: "sf-active",
    amount: 3400,
    sent: "Apr 23",
    status: "awaiting_sig"
  }, {
    id: 206,
    clientId: 6,
    name: "Truesdell, R.",
    project: "Cabinets + interior",
    type: "Scope & Price",
    typeCls: "sf-deposit",
    amount: 9200,
    sent: "Apr 2",
    status: "signed"
  }];
  return /*#__PURE__*/React.createElement("div", {
    className: "pg"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tbar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tbar-l"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tbar-eyebrow"
  }, rows.length, " estimates \xB7 1 draft \xB7 2 awaiting signature"), /*#__PURE__*/React.createElement("div", {
    className: "tbar-title"
  }, "Estimates"), /*#__PURE__*/React.createElement("div", {
    className: "tbar-sub"
  }, "All quotes you've sent, regardless of type. Drafts are private; sent estimates are visible in the client's hub.")), /*#__PURE__*/React.createElement("div", {
    className: "tbar-r"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn"
  }, "Export \u25BE"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-p",
    onClick: () => onOpenChooser()
  }, "+ New estimate"))), /*#__PURE__*/React.createElement("div", {
    className: "card card-pad-0",
    style: {
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd-title"
  }, "All estimates"), /*#__PURE__*/React.createElement("div", {
    className: "seg"
  }, /*#__PURE__*/React.createElement("button", {
    className: "seg-btn on"
  }, "All"), /*#__PURE__*/React.createElement("button", {
    className: "seg-btn"
  }, "Scope & Price"), /*#__PURE__*/React.createElement("button", {
    className: "seg-btn"
  }, "T&M"), /*#__PURE__*/React.createElement("button", {
    className: "seg-btn"
  }, "Build Your Own"))), /*#__PURE__*/React.createElement("table", {
    className: "tbl"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Client & project"), /*#__PURE__*/React.createElement("th", null, "Type"), /*#__PURE__*/React.createElement("th", null, "Status"), /*#__PURE__*/React.createElement("th", null, "Sent"), /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'right'
    }
  }, "Amount"), /*#__PURE__*/React.createElement("th", null))), /*#__PURE__*/React.createElement("tbody", null, rows.map(r => /*#__PURE__*/React.createElement("tr", {
    key: r.id,
    style: {
      cursor: 'pointer'
    },
    onClick: () => onOpenProposal(r.clientId)
  }, /*#__PURE__*/React.createElement("td", {
    style: {
      maxWidth: 380
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 800,
      letterSpacing: '-.1px'
    }
  }, r.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: 'var(--text-3)',
      fontWeight: 500,
      marginTop: 2
    }
  }, r.project)), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
    className: "bdg-soft " + r.typeCls
  }, r.type)), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(EstStatus, {
    status: r.status
  })), /*#__PURE__*/React.createElement("td", {
    className: "muted"
  }, r.sent), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, typeof r.amount === "number" ? `$${r.amount.toLocaleString()}` : r.amount), /*#__PURE__*/React.createElement("td", {
    style: {
      textAlign: 'right'
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn btn-sm btn-p",
    onClick: e => {
      e.stopPropagation();
      onOpenProposal(r.clientId);
    }
  }, "Open \u2192"))))))), /*#__PURE__*/React.createElement("div", {
    className: "estimate-types-promo",
    style: {
      marginTop: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "etp-card etp-denim"
  }, /*#__PURE__*/React.createElement("div", {
    className: "etp-icon"
  }, "\uD83D\uDCCB"), /*#__PURE__*/React.createElement("div", {
    className: "etp-title"
  }, "Scope & Price"), /*#__PURE__*/React.createElement("div", {
    className: "etp-sub"
  }, "Fixed scope, one final number. Best for clearly-defined jobs.")), /*#__PURE__*/React.createElement("div", {
    className: "etp-card etp-amber"
  }, /*#__PURE__*/React.createElement("div", {
    className: "etp-icon"
  }, "\u23F1\uFE0F"), /*#__PURE__*/React.createElement("div", {
    className: "etp-title"
  }, "Time & Materials"), /*#__PURE__*/React.createElement("div", {
    className: "etp-sub"
  }, "Bill the hours, mark up the materials. Best for unknown scope.")), /*#__PURE__*/React.createElement("div", {
    className: "etp-card etp-green"
  }, /*#__PURE__*/React.createElement("div", {
    className: "etp-icon"
  }, "\uD83E\uDDE9"), /*#__PURE__*/React.createElement("div", {
    className: "etp-title"
  }, "Build Your Own"), /*#__PURE__*/React.createElement("div", {
    className: "etp-sub"
  }, "Modular menu, client picks what they want. Best for upsells."))));
}
function EstStatus({
  status
}) {
  const map = {
    awaiting_sig: {
      cls: "bdg-soft sf-pending",
      label: "AWAITING SIG"
    },
    signed: {
      cls: "bdg-soft sf-won",
      label: "SIGNED"
    },
    draft: {
      cls: "bdg-soft sf-done",
      label: "DRAFT"
    },
    declined: {
      cls: "bdg-soft sf-lost",
      label: "DECLINED"
    }
  };
  const v = map[status] || {
    cls: "bdg-soft sf-done",
    label: status.toUpperCase()
  };
  return /*#__PURE__*/React.createElement("span", {
    className: v.cls
  }, v.label);
}
window.Estimates = Estimates;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/Estimates.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/Jobs.jsx
try { (() => {
/* Jobs.jsx — Kanban board · Lead → Estimate → Signed → Active → Complete · Collect */

function Jobs({
  data,
  onOpenClient
}) {
  const cols = [{
    id: "estimate",
    label: "Estimate sent",
    items: data.jobs.estimate
  }, {
    id: "signed",
    label: "Signed · ready to schedule",
    items: data.jobs.signed
  }, {
    id: "active",
    label: "Active",
    items: data.jobs.active
  }, {
    id: "collect",
    label: "Collect",
    items: data.jobs.collect
  }, {
    id: "complete",
    label: "Complete · paid",
    items: data.jobs.complete
  }];
  return /*#__PURE__*/React.createElement("div", {
    className: "pg"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tbar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tbar-l"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tbar-eyebrow"
  }, cols.reduce((s, c) => s + c.items.length, 0), " open \xB7 2 active this week"), /*#__PURE__*/React.createElement("div", {
    className: "tbar-title"
  }, "Jobs"), /*#__PURE__*/React.createElement("div", {
    className: "tbar-sub"
  }, "Drag a card to advance it. Click any card to open the client's hub.")), /*#__PURE__*/React.createElement("div", {
    className: "tbar-r"
  }, /*#__PURE__*/React.createElement("div", {
    className: "seg"
  }, /*#__PURE__*/React.createElement("button", {
    className: "seg-btn on"
  }, "Kanban"), /*#__PURE__*/React.createElement("button", {
    className: "seg-btn"
  }, "List")), /*#__PURE__*/React.createElement("button", {
    className: "btn"
  }, "Filter \u25BE"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-p"
  }, "+ New job"))), /*#__PURE__*/React.createElement("div", {
    className: "kanban"
  }, cols.map(col => /*#__PURE__*/React.createElement("div", {
    key: col.id,
    className: "kcol",
    "data-status": col.id
  }, /*#__PURE__*/React.createElement("div", {
    className: "kcol-hd"
  }, /*#__PURE__*/React.createElement("span", null, col.label), /*#__PURE__*/React.createElement("span", {
    className: "k-count"
  }, col.items.length)), col.items.map(j => /*#__PURE__*/React.createElement("div", {
    key: j.id,
    className: "k-card",
    onClick: () => onOpenClient(j.id)
  }, /*#__PURE__*/React.createElement("div", {
    className: "k-name"
  }, j.name), /*#__PURE__*/React.createElement("div", {
    className: "k-sub"
  }, j.sub), /*#__PURE__*/React.createElement("div", {
    className: "k-foot"
  }, /*#__PURE__*/React.createElement("span", {
    className: "bdg-soft " + (j.overdue ? "sf-overdue" : col.id === "active" ? "sf-active" : col.id === "estimate" ? "sf-new" : col.id === "complete" ? "sf-won" : "sf-deposit")
  }, j.due), /*#__PURE__*/React.createElement("span", {
    className: "k-amt"
  }, j.amt)))), col.items.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '18px 8px',
      textAlign: 'center',
      color: 'var(--text-3)',
      fontSize: 11,
      fontWeight: 500
    }
  }, "Nothing here yet")))));
}
window.Jobs = Jobs;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/Jobs.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/Leads.jsx
try { (() => {
/* Leads.jsx — pre-estimate lead pipeline */

function Leads({
  data,
  onOpenClient,
  onOpenEstimate
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "pg"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tbar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tbar-l"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tbar-eyebrow"
  }, data.leads.length, " open leads \xB7 1 unread from today"), /*#__PURE__*/React.createElement("div", {
    className: "tbar-title"
  }, "Leads"), /*#__PURE__*/React.createElement("div", {
    className: "tbar-sub"
  }, "New prospects waiting for an estimate. Cold leads turn warm again fast \u2014 chase the ones with a name beside them.")), /*#__PURE__*/React.createElement("div", {
    className: "tbar-r"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn"
  }, "\uD83D\uDCCB Intake form"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-p"
  }, "+ New lead"))), /*#__PURE__*/React.createElement("div", {
    className: "card card-pad-0"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd-title"
  }, "Pipeline"), /*#__PURE__*/React.createElement("div", {
    className: "seg"
  }, /*#__PURE__*/React.createElement("button", {
    className: "seg-btn on"
  }, "All"), /*#__PURE__*/React.createElement("button", {
    className: "seg-btn"
  }, "Unread"), /*#__PURE__*/React.createElement("button", {
    className: "seg-btn"
  }, "Cold (5+ days)"))), /*#__PURE__*/React.createElement("table", {
    className: "tbl"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Lead"), /*#__PURE__*/React.createElement("th", null, "Source"), /*#__PURE__*/React.createElement("th", null, "Notes"), /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'right'
    }
  }, "Est."), /*#__PURE__*/React.createElement("th", null, "Aged"), /*#__PURE__*/React.createElement("th", null))), /*#__PURE__*/React.createElement("tbody", null, data.leads.map(l => /*#__PURE__*/React.createElement("tr", {
    key: l.id
  }, /*#__PURE__*/React.createElement("td", {
    style: {
      fontWeight: 800
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "cc-avatar",
    style: {
      width: 32,
      height: 32,
      fontSize: 11
    }
  }, l.name.split(',')[0].slice(0, 2).toUpperCase()), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", null, l.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: 'var(--text-3)',
      fontWeight: 500,
      marginTop: 1
    }
  }, l.sub)))), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
    className: "chip"
  }, l.source)), /*#__PURE__*/React.createElement("td", {
    className: "muted"
  }, l.sub), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, l.est || /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-3)',
      fontWeight: 500
    }
  }, "\u2014")), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
    className: "bdg-soft sf-pending"
  }, l.since)), /*#__PURE__*/React.createElement("td", {
    style: {
      textAlign: 'right'
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn btn-sm btn-p",
    onClick: () => onOpenEstimate(l.id)
  }, "Estimate \u2192"))))))), /*#__PURE__*/React.createElement("div", {
    className: "tip t-s",
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 18
    }
  }, "\uD83C\uDFAF"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", null, "Close-rate tip \xB7 "), "Leads from your top source (Referral) close at 64% vs 22% from Google. Spend less ad money, more time on referrals.")));
}
window.Leads = Leads;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/Leads.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/NavSidebar.jsx
try { (() => {
/* NavSidebar.jsx · v2 — warm charcoal, denim accents, Pro tag */

const NAV_ITEMS_V2 = [{
  id: "dash",
  label: "Dashboard",
  icon: /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "3",
    width: "7",
    height: "7",
    rx: "1.5"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "14",
    y: "3",
    width: "7",
    height: "7",
    rx: "1.5"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "14",
    width: "7",
    height: "7",
    rx: "1.5"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "14",
    y: "14",
    width: "7",
    height: "7",
    rx: "1.5"
  }))
}, {
  id: "leads",
  label: "Leads",
  badge: 4,
  icon: /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M22 11.08V12a10 10 0 11-5.93-9.14"
  }), /*#__PURE__*/React.createElement("polyline", {
    points: "22 4 12 14.01 9 11.01"
  }))
}, {
  id: "clients",
  label: "Clients",
  icon: /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "9",
    cy: "7",
    r: "4"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"
  }))
}, {
  id: "jobs",
  label: "Jobs",
  icon: /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M3 6h18M3 12h18M3 18h12"
  }))
}, {
  id: "estimates",
  label: "Estimates",
  icon: /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"
  }), /*#__PURE__*/React.createElement("polyline", {
    points: "14 2 14 8 20 8"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M9 13l2 2 4-4"
  }))
}, {
  id: "proposals",
  label: "Proposals",
  badge: 2,
  icon: /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"
  }), /*#__PURE__*/React.createElement("polyline", {
    points: "14 2 14 8 20 8"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M9 13h6M9 17h4"
  }))
}, {
  id: "cal",
  label: "Calendar",
  icon: /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "4",
    width: "18",
    height: "18",
    rx: "2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M16 2v4M8 2v4M3 10h18"
  }))
}, {
  id: "collect",
  label: "Collect",
  badge: 1,
  icon: /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"
  }))
}, {
  id: "books",
  label: "Books",
  icon: /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"
  }))
}, {
  id: "taxes",
  label: "Taxes",
  icon: /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"
  }), /*#__PURE__*/React.createElement("polyline", {
    points: "14 2 14 8 20 8"
  }))
}, {
  id: "hub",
  label: "Client hub",
  icon: /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"
  }), /*#__PURE__*/React.createElement("polyline", {
    points: "9 22 9 12 15 12 15 22"
  }))
}];
function NavSidebar({
  active,
  onNavigate,
  user
}) {
  return /*#__PURE__*/React.createElement("div", {
    id: "nav"
  }, /*#__PURE__*/React.createElement("div", {
    id: "nav-logo"
  }, /*#__PURE__*/React.createElement("div", {
    id: "nav-logo-icon"
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"
  }))), /*#__PURE__*/React.createElement("span", {
    id: "nav-logo-text"
  }, "TradeDesk"), /*#__PURE__*/React.createElement("span", {
    id: "nav-pro"
  }, "Pro")), /*#__PURE__*/React.createElement("div", {
    id: "nav-section-label"
  }, "Workspace"), NAV_ITEMS_V2.map(item => /*#__PURE__*/React.createElement("button", {
    key: item.id,
    className: "nb" + (active === item.id ? " active" : ""),
    onClick: () => onNavigate(item.id)
  }, /*#__PURE__*/React.createElement("span", {
    className: "bx"
  }, item.icon, item.badge ? /*#__PURE__*/React.createElement("span", {
    className: "nbadge"
  }, item.badge) : null), /*#__PURE__*/React.createElement("span", null, item.label))), /*#__PURE__*/React.createElement("div", {
    id: "nav-spacer"
  }), /*#__PURE__*/React.createElement("div", {
    id: "nav-section-label",
    style: {
      paddingTop: 14,
      paddingBottom: 4
    }
  }, "Account"), /*#__PURE__*/React.createElement("button", {
    className: "nb",
    onClick: () => onNavigate("settings")
  }, /*#__PURE__*/React.createElement("span", {
    className: "bx"
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.9",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "3"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 005 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 005 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"
  }))), /*#__PURE__*/React.createElement("span", null, "Settings")), /*#__PURE__*/React.createElement("div", {
    id: "nav-user"
  }, /*#__PURE__*/React.createElement("div", {
    id: "nav-user-avatar"
  }, user.name.split(" ").map(s => s[0]).join("")), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0,
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    id: "nav-user-name"
  }, user.name), /*#__PURE__*/React.createElement("div", {
    id: "nav-user-role"
  }, user.role))));
}
window.NavSidebar = NavSidebar;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/NavSidebar.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/Proposal.jsx
try { (() => {
/* Proposal.jsx · v2 — full client-facing proposal with line items + deposit + signature */

function Proposal({
  data,
  client,
  onBack,
  onSign
}) {
  if (!client) return null;
  const est = data.estimate;
  const biz = data.business;
  const subtotal = est.lineItems.reduce((s, it) => s + it.total, 0);
  const total = subtotal + (est.tax || 0);
  const depositAmount = Math.round(total * 0.30);
  return /*#__PURE__*/React.createElement("div", {
    className: "pg"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn btn-sm btn-ghost",
    onClick: onBack,
    style: {
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("polyline", {
    points: "15 18 9 12 15 6"
  })), "Back to estimate builder"), /*#__PURE__*/React.createElement("div", {
    className: "proposal"
  }, /*#__PURE__*/React.createElement("div", {
    className: "prop-hdr"
  }, /*#__PURE__*/React.createElement("div", {
    className: "prop-hdr-tag"
  }, "Proposal \xB7 ", new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })), /*#__PURE__*/React.createElement("div", {
    className: "prop-co"
  }, biz.name), /*#__PURE__*/React.createElement("div", {
    className: "prop-tag"
  }, biz.owner, " \xB7 ", biz.license, " \xB7 ", biz.phone)), /*#__PURE__*/React.createElement("div", {
    className: "prop-body"
  }, /*#__PURE__*/React.createElement("div", {
    className: "prop-sec"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "prop-lbl"
  }, "Prepared for"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 15,
      fontWeight: 800,
      letterSpacing: '-.2px'
    }
  }, client.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--text-2)',
      marginTop: 2
    }
  }, client.address, /*#__PURE__*/React.createElement("br", null), client.city, ", ", client.state, " ", client.zip)), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "prop-lbl"
  }, "Schedule"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 700
    }
  }, est.schedule.start, " \u2192 ", est.schedule.end), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: 'var(--text-3)',
      marginTop: 4,
      fontWeight: 500
    }
  }, "Estimated 6 working days \xB7 weather contingent")))), /*#__PURE__*/React.createElement("div", {
    className: "prop-sec"
  }, /*#__PURE__*/React.createElement("div", {
    className: "prop-lbl"
  }, "Scope & line items"), /*#__PURE__*/React.createElement("table", {
    className: "tbl",
    style: {
      marginTop: 6
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Description"), /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'right'
    }
  }, "Qty"), /*#__PURE__*/React.createElement("th", null, "Unit"), /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'right'
    }
  }, "Total"))), /*#__PURE__*/React.createElement("tbody", null, est.lineItems.map(it => /*#__PURE__*/React.createElement("tr", {
    key: it.id
  }, /*#__PURE__*/React.createElement("td", {
    style: {
      fontWeight: 600,
      maxWidth: 380
    }
  }, it.label), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, it.qty.toLocaleString()), /*#__PURE__*/React.createElement("td", {
    className: "muted"
  }, it.unit), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, "$", it.total.toLocaleString())))))), /*#__PURE__*/React.createElement("div", {
    className: "prop-sec"
  }, /*#__PURE__*/React.createElement("div", {
    className: "prop-lbl"
  }, "What's included"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 6,
      marginTop: 4
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "chip"
  }, "All paint & materials"), /*#__PURE__*/React.createElement("span", {
    className: "chip"
  }, "Daily cleanup + dust containment"), /*#__PURE__*/React.createElement("span", {
    className: "chip"
  }, "Furniture moved & protected"), /*#__PURE__*/React.createElement("span", {
    className: "chip"
  }, "2 coats minimum"), /*#__PURE__*/React.createElement("span", {
    className: "chip"
  }, "Drywall patch & prep"), /*#__PURE__*/React.createElement("span", {
    className: "chip"
  }, "Final walkthrough"), /*#__PURE__*/React.createElement("span", {
    className: "chip"
  }, "2-year touch-up warranty"))), /*#__PURE__*/React.createElement("div", {
    className: "prop-sec"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 280px',
      gap: 14,
      alignItems: 'flex-start'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "prop-lbl"
  }, "Terms"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--text-2)',
      lineHeight: 1.6
    }
  }, "By signing below, you authorize ", biz.name, " to perform the work described above. ", /*#__PURE__*/React.createElement("b", {
    style: {
      color: 'var(--text)'
    }
  }, "30% deposit due on signing"), ", balance due on completion. Either party may cancel in writing within 3 business days under the Kansas Uniform Electronic Transactions Act. Change orders must be approved in writing before additional work begins. Per K.S.A. 60-1105 we reserve the right to file a mechanic's lien on unpaid balances within 4 months of completion.")), /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--cream)',
      borderRadius: 10,
      padding: 14,
      border: '1px solid var(--line)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "prop-row"
  }, /*#__PURE__*/React.createElement("span", {
    className: "lbl"
  }, "Subtotal"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontVariantNumeric: 'tabular-nums',
      fontWeight: 700
    }
  }, "$", subtotal.toLocaleString())), /*#__PURE__*/React.createElement("div", {
    className: "prop-row muted"
  }, /*#__PURE__*/React.createElement("span", null, "Tax \xB7 KS services exempt"), /*#__PURE__*/React.createElement("span", null, "$0.00")), /*#__PURE__*/React.createElement("div", {
    className: "prop-total"
  }, /*#__PURE__*/React.createElement("span", null, "Total"), /*#__PURE__*/React.createElement("span", {
    className: "v"
  }, "$", total.toLocaleString())), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      marginTop: 10,
      padding: '10px 12px',
      background: 'var(--bg-card)',
      borderRadius: 8,
      border: '1px solid var(--line)',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      fontWeight: 800,
      textTransform: 'uppercase',
      letterSpacing: '.08em',
      color: 'var(--text-3)',
      whiteSpace: 'nowrap'
    }
  }, "Due on signing"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 800,
      color: 'var(--denim)',
      marginTop: 2
    }
  }, "$", depositAmount.toLocaleString())), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'right',
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      fontWeight: 800,
      textTransform: 'uppercase',
      letterSpacing: '.08em',
      color: 'var(--text-3)',
      whiteSpace: 'nowrap'
    }
  }, "Balance later"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 800,
      marginTop: 2
    }
  }, "$", (total - depositAmount).toLocaleString())))))))), /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "row-bw",
    style: {
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "td-h3"
  }, "Terms & conditions"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-sm"
  }, "\uD83D\uDCC4 Download as PDF")), /*#__PURE__*/React.createElement("div", {
    className: "prop-terms"
  }, /*#__PURE__*/React.createElement("ol", null, /*#__PURE__*/React.createElement("li", null, /*#__PURE__*/React.createElement("b", null, "Scope of work. "), "The work to be performed is described in the proposal above. Any changes to scope must be agreed in writing as a separate ", /*#__PURE__*/React.createElement("b", null, "change order"), " before the additional work begins."), /*#__PURE__*/React.createElement("li", null, /*#__PURE__*/React.createElement("b", null, "Payment terms. "), "A ", /*#__PURE__*/React.createElement("b", null, "30% deposit ($", depositAmount.toLocaleString(), ")"), " is due on signing. The remaining balance is due upon completion of the work. Payments may be made by check, ACH, or credit/debit card via Stripe. A returned-check fee of $35 applies."), /*#__PURE__*/React.createElement("li", null, /*#__PURE__*/React.createElement("b", null, "Schedule. "), "Work is estimated to begin ", est.schedule.start, " and complete by ", est.schedule.end, ". Weather, supply delays, and unforeseen site conditions may shift the schedule; ", biz.name, " will give the client at least 24 hours' notice of any change."), /*#__PURE__*/React.createElement("li", null, /*#__PURE__*/React.createElement("b", null, "Materials & warranty. "), "All paint and materials are included unless explicitly listed otherwise. ", biz.name, " warrants the workmanship for ", /*#__PURE__*/React.createElement("b", null, "2 years"), " from completion. Manufacturer warranties on materials are passed through to the client."), /*#__PURE__*/React.createElement("li", null, /*#__PURE__*/React.createElement("b", null, "Access & preparation. "), "The client agrees to provide unobstructed access to the work areas. ", biz.name, " will move and protect furniture and personal items; valuable or fragile items should be removed by the client prior to start."), /*#__PURE__*/React.createElement("li", null, /*#__PURE__*/React.createElement("b", null, "Lead-paint disclosure. "), "If the property was built before 1978, the client acknowledges receipt of the EPA Renovate, Repair & Paint pamphlet attached to this proposal as required by federal law."), /*#__PURE__*/React.createElement("li", null, /*#__PURE__*/React.createElement("b", null, "Lien rights. "), "Under K.S.A. 60-1105, ", biz.name, " reserves the right to file a mechanic's lien against the property for unpaid balances within 4 months of substantial completion. The client will be given 21 days' written notice before any lien is filed."), /*#__PURE__*/React.createElement("li", null, /*#__PURE__*/React.createElement("b", null, "Cancellation. "), "Either party may cancel this agreement in writing within ", /*#__PURE__*/React.createElement("b", null, "3 business days"), " of signing under the Kansas Uniform Electronic Transactions Act (UETA). After that period, the client is responsible for materials purchased and work completed to the date of cancellation."), /*#__PURE__*/React.createElement("li", null, /*#__PURE__*/React.createElement("b", null, "Insurance. "), biz.name, " carries general liability insurance and workers' compensation. Certificates of insurance are available on request through the client hub."), /*#__PURE__*/React.createElement("li", null, /*#__PURE__*/React.createElement("b", null, "Dispute resolution. "), "Any dispute arising from this agreement will be governed by the laws of the State of Kansas. The parties agree to good-faith mediation before pursuing litigation."), /*#__PURE__*/React.createElement("li", null, /*#__PURE__*/React.createElement("b", null, "Acceptance. "), "By signing the next page, the client agrees to the scope, schedule, and total above, and to all terms in this section. This proposal is valid for ", /*#__PURE__*/React.createElement("b", null, "30 days"), " from the date it was sent."))), /*#__PURE__*/React.createElement("div", {
    className: "prop-sign-cta"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "td-micro",
    style: {
      marginBottom: 4
    }
  }, "Ready to move forward?"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 600,
      color: 'var(--text-2)',
      letterSpacing: '-.1px'
    }
  }, "Continue to the signature page \u2014 the deposit charges immediately on signing.")), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-p btn-xl",
    onClick: () => onSign && onSign(client.id)
  }, "Continue to sign \u2192"))));
}
window.Proposal = Proposal;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/Proposal.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/Proposals.jsx
try { (() => {
/* Proposals.jsx — list of every proposal that's been sent */
const {
  useState: useProposalsState
} = React;
function Proposals({
  data,
  onOpenClient,
  onOpenProposal
}) {
  const [filter, setFilter] = useProposalsState("all");

  // Synthesize a proposals list from clients + estimate fixture
  const proposals = [{
    id: 101,
    clientId: 4,
    name: "Whitlock, S.",
    project: "Exterior body + trim · 12 Cedar Ridge",
    amount: 8950,
    sent: "May 8, 2026",
    aged: "4d",
    status: "awaiting_sig"
  }, {
    id: 102,
    clientId: 2,
    name: "Calle, J.",
    project: "Full exterior · 17 Bluegrass",
    amount: 6800,
    sent: "May 5, 2026",
    aged: "7d",
    status: "signed",
    deposit: 2040
  }, {
    id: 103,
    clientId: 1,
    name: "Hendrickson, B.",
    project: "Interior 3 rooms + trim · 2418 Riverside",
    amount: 4250,
    sent: "Apr 26, 2026",
    aged: "16d",
    status: "signed",
    deposit: 1500
  }, {
    id: 104,
    clientId: 3,
    name: "Ortega, M.",
    project: "Interior + ceilings · 884 Oak Park",
    amount: 3400,
    sent: "Apr 23, 2026",
    aged: "19d",
    status: "awaiting_sig"
  }, {
    id: 105,
    clientId: 6,
    name: "Truesdell, R.",
    project: "Cabinets + interior · 1818 Briar Crest",
    amount: 9200,
    sent: "Apr 2, 2026",
    aged: "40d",
    status: "signed",
    deposit: 2760
  }, {
    id: 106,
    clientId: 99,
    name: "Mendez, R.",
    project: "Garage + porch · 4119 Brooks",
    amount: 5400,
    sent: "Apr 1, 2026",
    aged: "41d",
    status: "declined"
  }];
  const filters = [{
    id: "all",
    label: "All",
    count: proposals.length
  }, {
    id: "awaiting_sig",
    label: "Awaiting sig",
    count: proposals.filter(p => p.status === "awaiting_sig").length
  }, {
    id: "signed",
    label: "Signed",
    count: proposals.filter(p => p.status === "signed").length
  }, {
    id: "declined",
    label: "Declined",
    count: proposals.filter(p => p.status === "declined").length
  }];
  const filtered = filter === "all" ? proposals : proposals.filter(p => p.status === filter);
  const totalSent = proposals.reduce((s, p) => s + p.amount, 0);
  const signedAmt = proposals.filter(p => p.status === "signed").reduce((s, p) => s + p.amount, 0);
  const awaitingAmt = proposals.filter(p => p.status === "awaiting_sig").reduce((s, p) => s + p.amount, 0);
  return /*#__PURE__*/React.createElement("div", {
    className: "pg"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tbar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tbar-l"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tbar-eyebrow"
  }, proposals.length, " proposals sent \xB7 ", Math.round(signedAmt / totalSent * 100), "% close rate (last 90 days)"), /*#__PURE__*/React.createElement("div", {
    className: "tbar-title"
  }, "Proposals"), /*#__PURE__*/React.createElement("div", {
    className: "tbar-sub"
  }, "Everything you've sent for signature. Click any row to open the client-facing proposal preview.")), /*#__PURE__*/React.createElement("div", {
    className: "tbar-r"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn"
  }, "\uD83D\uDCE4 Export"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-p"
  }, "+ New estimate"))), /*#__PURE__*/React.createElement("div", {
    className: "mets"
  }, /*#__PURE__*/React.createElement("div", {
    className: "met"
  }, /*#__PURE__*/React.createElement("div", {
    className: "met-l"
  }, "Sent (90d)"), /*#__PURE__*/React.createElement("div", {
    className: "met-v"
  }, "$", (totalSent / 1000).toFixed(1), "k"), /*#__PURE__*/React.createElement("div", {
    className: "met-s"
  }, proposals.length, " proposals")), /*#__PURE__*/React.createElement("div", {
    className: "met"
  }, /*#__PURE__*/React.createElement("div", {
    className: "met-l"
  }, "Signed"), /*#__PURE__*/React.createElement("div", {
    className: "met-v",
    style: {
      color: 'var(--c-green)'
    }
  }, "$", (signedAmt / 1000).toFixed(1), "k"), /*#__PURE__*/React.createElement("div", {
    className: "met-s up"
  }, proposals.filter(p => p.status === "signed").length, " clients")), /*#__PURE__*/React.createElement("div", {
    className: "met"
  }, /*#__PURE__*/React.createElement("div", {
    className: "met-l"
  }, "Awaiting signature"), /*#__PURE__*/React.createElement("div", {
    className: "met-v",
    style: {
      color: 'var(--c-amber)'
    }
  }, "$", (awaitingAmt / 1000).toFixed(1), "k"), /*#__PURE__*/React.createElement("div", {
    className: "met-s"
  }, proposals.filter(p => p.status === "awaiting_sig").length, " clients \xB7 follow up")), /*#__PURE__*/React.createElement("div", {
    className: "met"
  }, /*#__PURE__*/React.createElement("div", {
    className: "met-l"
  }, "Avg time to sign"), /*#__PURE__*/React.createElement("div", {
    className: "met-v"
  }, "2.4", /*#__PURE__*/React.createElement("span", {
    className: "unit"
  }, "d")), /*#__PURE__*/React.createElement("div", {
    className: "met-s"
  }, "target \u2264 3d"))), /*#__PURE__*/React.createElement("div", {
    className: "fbar"
  }, filters.map(f => /*#__PURE__*/React.createElement("button", {
    key: f.id,
    className: "fb" + (filter === f.id ? " active" : ""),
    onClick: () => setFilter(f.id)
  }, f.label, /*#__PURE__*/React.createElement("span", {
    className: "fb-count"
  }, f.count)))), /*#__PURE__*/React.createElement("div", {
    className: "card card-pad-0"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-hd-title"
  }, "Proposals")), /*#__PURE__*/React.createElement("table", {
    className: "tbl"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Client & project"), /*#__PURE__*/React.createElement("th", null, "Status"), /*#__PURE__*/React.createElement("th", null, "Sent"), /*#__PURE__*/React.createElement("th", null, "Aged"), /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'right'
    }
  }, "Amount"), /*#__PURE__*/React.createElement("th", null))), /*#__PURE__*/React.createElement("tbody", null, filtered.map(p => /*#__PURE__*/React.createElement("tr", {
    key: p.id,
    style: {
      cursor: 'pointer'
    },
    onClick: () => onOpenProposal(p.clientId)
  }, /*#__PURE__*/React.createElement("td", {
    style: {
      maxWidth: 380
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 800,
      letterSpacing: '-.1px'
    }
  }, p.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: 'var(--text-3)',
      fontWeight: 500,
      marginTop: 2
    }
  }, p.project), p.deposit && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: 'var(--c-green)',
      fontWeight: 700,
      marginTop: 2
    }
  }, "Deposit $", p.deposit.toLocaleString(), " received")), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(ProposalStatus, {
    status: p.status
  })), /*#__PURE__*/React.createElement("td", {
    className: "muted"
  }, p.sent), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
    className: "bdg-soft " + (p.aged.replace('d', '') > 14 ? "sf-overdue" : p.aged.replace('d', '') > 7 ? "sf-pending" : "sf-done")
  }, p.aged)), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, "$", p.amount.toLocaleString()), /*#__PURE__*/React.createElement("td", {
    style: {
      textAlign: 'right'
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn btn-sm btn-p",
    onClick: e => {
      e.stopPropagation();
      onOpenProposal(p.clientId);
    }
  }, "Open \u2192"))))))), filtered.length === 0 && /*#__PURE__*/React.createElement("div", {
    className: "empty"
  }, /*#__PURE__*/React.createElement("div", {
    className: "em-emoji"
  }, "\uD83D\uDCE8"), /*#__PURE__*/React.createElement("h3", null, "No proposals in this filter"), /*#__PURE__*/React.createElement("p", null, "Try a different filter, or send a new estimate to a client.")));
}
function ProposalStatus({
  status
}) {
  const map = {
    awaiting_sig: {
      cls: "bdg-soft sf-pending",
      label: "AWAITING SIG"
    },
    signed: {
      cls: "bdg-soft sf-won",
      label: "SIGNED"
    },
    declined: {
      cls: "bdg-soft sf-lost",
      label: "DECLINED"
    }
  };
  const v = map[status] || {
    cls: "bdg-soft sf-done",
    label: status.toUpperCase()
  };
  return /*#__PURE__*/React.createElement("span", {
    className: v.cls
  }, v.label);
}
window.Proposals = Proposals;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/Proposals.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/Signature.jsx
try { (() => {
/* Signature.jsx — dedicated signature page · typed name renders in Dancing Script */
const {
  useState: useSigState
} = React;
function Signature({
  data,
  client,
  onBack,
  onComplete
}) {
  const [name, setName] = useSigState("");
  const [initials, setInitials] = useSigState("");
  const [agreed, setAgreed] = useSigState(false);
  const [paying, setPaying] = useSigState("deposit"); // "deposit" | "full"

  if (!client) return null;
  const est = data.estimate;
  const biz = data.business;
  const subtotal = est.lineItems.reduce((s, it) => s + it.total, 0);
  const total = subtotal + (est.tax || 0);
  const depositAmount = Math.round(total * 0.30);
  const dateStr = new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
  const canSign = name.trim().length >= 3 && agreed;
  return /*#__PURE__*/React.createElement("div", {
    className: "pg"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn btn-sm btn-ghost",
    onClick: onBack,
    style: {
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("polyline", {
    points: "15 18 9 12 15 6"
  })), "Back to proposal"), /*#__PURE__*/React.createElement("div", {
    className: "sig-page"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sig-hdr"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sig-eyebrow"
  }, "Step 2 of 2 \xB7 sign & pay deposit"), /*#__PURE__*/React.createElement("div", {
    className: "sig-title"
  }, "Sign this proposal"), /*#__PURE__*/React.createElement("div", {
    className: "sig-sub"
  }, "Type your full legal name. Your signature will be generated automatically and bound to today's date and your IP address \u2014 same legal weight as a wet-ink signature under the Kansas UETA.")), /*#__PURE__*/React.createElement("div", {
    className: "sig-summary"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "td-micro",
    style: {
      marginBottom: 4
    }
  }, "Agreement summary"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 800,
      letterSpacing: '-.1px'
    }
  }, client.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: 'var(--text-3)',
      marginTop: 2,
      fontWeight: 500
    }
  }, client.address, " \xB7 ", client.city, ", ", client.state, " ", client.zip)), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'right'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "td-micro",
    style: {
      marginBottom: 4
    }
  }, "Total"), /*#__PURE__*/React.createElement("div", {
    className: "td-display",
    style: {
      fontSize: 24,
      color: 'var(--text)'
    }
  }, "$", total.toLocaleString()), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: 'var(--text-3)',
      marginTop: 2,
      fontWeight: 500
    }
  }, "30% deposit \xB7 $", depositAmount.toLocaleString(), " on signing"))), /*#__PURE__*/React.createElement("div", {
    className: "sig-fields"
  }, /*#__PURE__*/React.createElement("div", {
    className: "f"
  }, /*#__PURE__*/React.createElement("label", null, "Full legal name"), /*#__PURE__*/React.createElement("input", {
    className: "sig-input",
    placeholder: "Type your full name\u2026",
    value: name,
    onChange: e => {
      setName(e.target.value);
      const parts = e.target.value.trim().split(/\s+/).filter(Boolean);
      setInitials(parts.map(p => p[0] || "").join("").slice(0, 3).toUpperCase());
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: "f"
  }, /*#__PURE__*/React.createElement("label", null, "Date"), /*#__PURE__*/React.createElement("input", {
    value: dateStr,
    readOnly: true,
    style: {
      background: 'var(--cream)',
      color: 'var(--text-3)'
    }
  }))), /*#__PURE__*/React.createElement("div", {
    className: "sig-pad"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sig-pad-label"
  }, "YOUR SIGNATURE"), name.trim() ? /*#__PURE__*/React.createElement("div", {
    className: "sig-glyph"
  }, name) : /*#__PURE__*/React.createElement("div", {
    className: "sig-glyph sig-glyph-placeholder"
  }, "Your signature appears here"), /*#__PURE__*/React.createElement("div", {
    className: "sig-pad-foot"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    className: "td-micro"
  }, "Signed by"), /*#__PURE__*/React.createElement("div", {
    className: "sig-pad-name"
  }, name.trim() || "—")), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    className: "td-micro"
  }, "Initials"), /*#__PURE__*/React.createElement("div", {
    className: "sig-pad-init"
  }, initials || "—")), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    className: "td-micro"
  }, "Signed on"), /*#__PURE__*/React.createElement("div", {
    className: "sig-pad-date"
  }, dateStr)), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    className: "td-micro"
  }, "Signing method"), /*#__PURE__*/React.createElement("div", {
    className: "sig-pad-method"
  }, "Typed \xB7 UETA")))), /*#__PURE__*/React.createElement("div", {
    className: "sig-agree"
  }, /*#__PURE__*/React.createElement("label", {
    className: "sig-checkbox" + (agreed ? " on" : ""),
    onClick: () => setAgreed(!agreed)
  }, /*#__PURE__*/React.createElement("div", {
    className: "sig-checkbox-box"
  }, agreed ? "✓" : ""), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 700,
      color: 'var(--text)',
      letterSpacing: '-.1px'
    }
  }, "I agree to the proposal terms & conditions"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: 'var(--text-3)',
      marginTop: 3,
      fontWeight: 500,
      lineHeight: 1.5
    }
  }, "By checking this box and typing my name above, I'm electronically signing this proposal between me (", client.name.split(',')[0], ") and ", biz.name, ". I acknowledge this signature is legally binding under the Kansas Uniform Electronic Transactions Act.")))), /*#__PURE__*/React.createElement("div", {
    className: "sig-pay"
  }, /*#__PURE__*/React.createElement("div", {
    className: "td-micro",
    style: {
      marginBottom: 10
    }
  }, "Deposit \xB7 charges immediately"), /*#__PURE__*/React.createElement("div", {
    className: "sig-pay-options"
  }, /*#__PURE__*/React.createElement("label", {
    className: "sig-pay-opt" + (paying === "deposit" ? " on" : ""),
    onClick: () => setPaying("deposit")
  }, /*#__PURE__*/React.createElement("div", {
    className: "sig-pay-radio"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "sig-pay-label"
  }, "Pay 30% deposit only"), /*#__PURE__*/React.createElement("div", {
    className: "sig-pay-sub"
  }, "Balance due on completion")), /*#__PURE__*/React.createElement("div", {
    className: "sig-pay-amt"
  }, "$", depositAmount.toLocaleString())), /*#__PURE__*/React.createElement("label", {
    className: "sig-pay-opt" + (paying === "full" ? " on" : ""),
    onClick: () => setPaying("full")
  }, /*#__PURE__*/React.createElement("div", {
    className: "sig-pay-radio"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "sig-pay-label"
  }, "Pay in full now ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--c-green)',
      fontSize: 10,
      fontWeight: 800,
      letterSpacing: '.04em'
    }
  }, "SAVE 3%")), /*#__PURE__*/React.createElement("div", {
    className: "sig-pay-sub"
  }, "Locks in the price; no change orders without re-approval")), /*#__PURE__*/React.createElement("div", {
    className: "sig-pay-amt"
  }, "$", Math.round(total * 0.97).toLocaleString()))), /*#__PURE__*/React.createElement("div", {
    className: "sig-pay-methods"
  }, /*#__PURE__*/React.createElement("span", {
    className: "td-micro"
  }, "Charging method"), /*#__PURE__*/React.createElement("button", {
    className: "chip sig-chip-on"
  }, "\uD83D\uDCB3 \u2022\u2022\u2022\u2022 4242"), /*#__PURE__*/React.createElement("button", {
    className: "chip"
  }, "\uD83C\uDFE6 ACH"), /*#__PURE__*/React.createElement("button", {
    className: "chip"
  }, "\uD83D\uDCF1 Apple Pay"), /*#__PURE__*/React.createElement("button", {
    className: "chip"
  }, "+ Add card"))), /*#__PURE__*/React.createElement("div", {
    className: "sig-actions"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn btn-xl",
    onClick: onBack
  }, "Back to proposal"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-xl " + (canSign ? "btn-g" : ""),
    disabled: !canSign,
    onClick: onComplete,
    style: canSign ? {} : {
      opacity: .5,
      cursor: 'not-allowed'
    }
  }, "\u2713 Sign & pay $", paying === "deposit" ? depositAmount.toLocaleString() : Math.round(total * 0.97).toLocaleString(), " \u2192")), /*#__PURE__*/React.createElement("div", {
    className: "sig-foot"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14
    }
  }, "\uD83D\uDD12"), /*#__PURE__*/React.createElement("span", null, "Encrypted by Stripe \xB7 TLS 1.3 \xB7 PCI-DSS Level 1")), /*#__PURE__*/React.createElement("div", null, "UETA \xB7 K.S.A. 16-1601 et seq."))));
}
window.Signature = Signature;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/Signature.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/data.js
try { (() => {
// data.js — fake fixtures for the UI kit recreation · v2 expanded
window.TD_DATA = {
  user: {
    name: "Logan S.",
    role: "Owner · TradeDesk Painting"
  },
  business: {
    name: "Skyline Painting Co.",
    owner: "Logan Sample",
    license: "KS #PNT-2024-08812",
    phone: "316-555-0100",
    email: "logan@skylinepaintingco.com",
    address: "1042 N Saint Francis · Wichita, KS 67214"
  },
  clients: [{
    id: 1,
    name: "Hendrickson, B.",
    firstName: "Brian",
    initials: "HB",
    avatarTone: "denim",
    address: "2418 Riverside Dr",
    city: "Wichita",
    state: "KS",
    zip: "67203",
    phone: "316-555-0142",
    email: "brian.h@example.com",
    source: "Referral",
    ptype: "Single family home",
    yearBuilt: 1965,
    tier: "B",
    status: "active",
    lifetimeValue: 24500,
    activeJobTotal: 4250,
    balance: 4250,
    daysSinceComplete: 22,
    timeline: [{
      kind: "active",
      label: "Job in progress · interior repaint",
      meta: "Started May 4 · 60% complete"
    }, {
      kind: "payment",
      label: "Deposit received · $1,500",
      meta: "May 2 · stripe"
    }, {
      kind: "bid",
      label: "Proposal signed · $4,250",
      meta: "Apr 28 · UETA"
    }, {
      kind: "estimate",
      label: "Estimate sent · 3 rooms + trim",
      meta: "Apr 26"
    }, {
      kind: "note",
      label: "Initial call · referred by Truesdell",
      meta: "Apr 24"
    }]
  }, {
    id: 2,
    name: "Calle, J.",
    initials: "CJ",
    avatarTone: "denim",
    address: "17 Bluegrass Ln",
    city: "Andover",
    state: "KS",
    zip: "67002",
    phone: "316-555-0184",
    email: "jess.c@example.com",
    source: "Nextdoor",
    ptype: "Townhouse/condo",
    yearBuilt: 2018,
    tier: "A",
    status: "deposit",
    lifetimeValue: 6800,
    balance: 4760,
    timeline: [{
      kind: "payment",
      label: "Deposit received · $2,040",
      meta: "May 9 · stripe"
    }, {
      kind: "bid",
      label: "Proposal signed · $6,800",
      meta: "May 8 · UETA"
    }, {
      kind: "estimate",
      label: "Estimate sent · full exterior",
      meta: "May 5"
    }]
  }, {
    id: 3,
    name: "Ortega, M.",
    initials: "MO",
    avatarTone: "",
    address: "884 Oak Park Cir",
    city: "Derby",
    state: "KS",
    zip: "67037",
    phone: "316-555-0211",
    email: "mortega@example.com",
    source: "Door hanger",
    ptype: "Single family home",
    yearBuilt: 1989,
    tier: "B",
    status: "follow_up",
    lifetimeValue: 0,
    timeline: [{
      kind: "estimate",
      label: "Estimate sent · $3,400 · awaiting sig",
      meta: "Apr 23 · 9d ago"
    }]
  }, {
    id: 4,
    name: "Whitlock, S.",
    initials: "SW",
    avatarTone: "green",
    address: "12 Cedar Ridge Ct",
    city: "Wichita",
    state: "KS",
    zip: "67205",
    phone: "316-555-0399",
    email: "sarah.w@example.com",
    source: "Repeat customer",
    ptype: "Single family home",
    yearBuilt: 2001,
    tier: "A",
    status: "awaiting_sig",
    lifetimeValue: 18200,
    timeline: [{
      kind: "estimate",
      label: "Estimate sent · $8,950",
      meta: "May 8 · 4d ago"
    }]
  }, {
    id: 5,
    name: "Park, A.",
    initials: "AP",
    avatarTone: "",
    address: "5402 Greenwood Pl",
    city: "Bel Aire",
    state: "KS",
    zip: "67220",
    phone: "316-555-0712",
    email: "park.a@example.com",
    source: "Google / online",
    ptype: "Rental property",
    yearBuilt: 1972,
    tier: "C",
    status: "new",
    lifetimeValue: 0,
    timeline: [{
      kind: "note",
      label: "Lead intake · waiting on estimate",
      meta: "Today"
    }]
  }, {
    id: 6,
    name: "Truesdell, R.",
    initials: "RT",
    avatarTone: "denim",
    address: "1818 Briar Crest",
    city: "Wichita",
    state: "KS",
    zip: "67212",
    phone: "316-555-0444",
    email: "rt@example.com",
    source: "Real estate agent",
    ptype: "Single family home",
    yearBuilt: 1992,
    tier: "A",
    status: "won",
    lifetimeValue: 32400,
    balance: 0,
    timeline: [{
      kind: "payment",
      label: "Final payment received · $9,200",
      meta: "Apr 18"
    }, {
      kind: "complete",
      label: "Job complete · cabinets + interior",
      meta: "Apr 16"
    }]
  }],
  /* ── Dashboard feed ── */
  todayFeed: [{
    kind: "collect",
    emoji: "💰",
    tone: "t-red",
    clientId: 1,
    name: "Hendrickson, B.",
    sub: "$4,250 owed · 22d since completion",
    subColor: "var(--c-red)"
  }, {
    kind: "schedule",
    emoji: "🗓️",
    tone: "t-blue",
    clientId: 2,
    name: "Calle, J.",
    sub: "Approved $6,800 · deposit paid · not scheduled",
    subColor: "var(--denim)"
  }, {
    kind: "follow_up",
    emoji: "🔥",
    tone: "t-red",
    clientId: 3,
    name: "Ortega, M.",
    sub: "2nd follow-up needed · $3,400 · 9d waiting",
    subColor: "var(--c-red)"
  }, {
    kind: "awaiting_sig",
    emoji: "📨",
    tone: "t-amber",
    clientId: 4,
    name: "Whitlock, S.",
    sub: "$8,950 · 4d · awaiting signature",
    subColor: "var(--c-amber)"
  }, {
    kind: "new",
    emoji: "🙋",
    tone: "t-blue",
    clientId: 5,
    name: "1 new lead ready for an estimate",
    sub: "Go build estimates to move them forward",
    subColor: "var(--denim)"
  }],
  kpis: {
    revenue: "$185.4k",
    revenueTrend: {
      dir: "up",
      pct: 12,
      label: "vs LY"
    },
    expenses: "$42.6k",
    expensesTrend: {
      dir: "up",
      pct: 4,
      label: "vs LY"
    },
    mileage: "1,240",
    mileageTrend: {
      dir: "up",
      pct: 18,
      label: "vs LY"
    },
    taxes: "$28.0k",
    taxesTrend: {
      dir: "—",
      pct: 0,
      label: "est."
    },
    profit: "$94.0k",
    profitTrend: {
      dir: "up",
      pct: 14,
      label: "vs LY"
    },
    avgJob: "$5.2k",
    avgJobTrend: {
      dir: "up",
      pct: 8,
      label: "vs LY"
    }
  },
  leadSources: [{
    name: "Referral",
    leads: 14,
    won: 9,
    revenue: 62400
  }, {
    name: "Repeat customer",
    leads: 8,
    won: 8,
    revenue: 41200
  }, {
    name: "Nextdoor",
    leads: 12,
    won: 5,
    revenue: 28800
  }, {
    name: "Google / online",
    leads: 18,
    won: 4,
    revenue: 22150
  }, {
    name: "Door hanger",
    leads: 9,
    won: 2,
    revenue: 9600
  }, {
    name: "Real estate agent",
    leads: 6,
    won: 3,
    revenue: 24800
  }],
  /* ── Leads pipeline ── */
  leads: [{
    id: 11,
    name: "Park, A.",
    sub: "Bel Aire · rental · 1972 build",
    since: "Today",
    source: "Google / online",
    est: null
  }, {
    id: 12,
    name: "Marshfield, T.",
    sub: "Maize · new construction",
    since: "1d ago",
    source: "Builder / contractor",
    est: "$11,400"
  }, {
    id: 13,
    name: "Vogel, K.",
    sub: "East Wichita · interior",
    since: "2d ago",
    source: "Referral",
    est: "$3,250"
  }, {
    id: 14,
    name: "Lin, P.",
    sub: "Andover · exterior repaint",
    since: "3d ago",
    source: "Nextdoor",
    est: "$8,900"
  }],
  /* ── Jobs by Kanban column ── */
  jobs: {
    estimate: [{
      id: 21,
      name: "Ortega, M.",
      sub: "884 Oak Park · 3 rooms",
      due: "Apr 23 sent",
      amt: "$3,400"
    }, {
      id: 22,
      name: "Whitlock, S.",
      sub: "12 Cedar Ridge · exterior",
      due: "May 8 sent",
      amt: "$8,950"
    }],
    signed: [{
      id: 23,
      name: "Calle, J.",
      sub: "17 Bluegrass · ext.",
      due: "Schedule now",
      amt: "$6,800"
    }],
    active: [{
      id: 24,
      name: "Hendrickson, B.",
      sub: "2418 Riverside · day 7",
      due: "60% complete",
      amt: "$4,250"
    }, {
      id: 25,
      name: "Reyes, A.",
      sub: "302 N Maize · cabinets",
      due: "day 2 of 4",
      amt: "$2,800"
    }],
    collect: [{
      id: 26,
      name: "Hendrickson, B.",
      sub: "22d past completion",
      due: "$4,250 owed",
      amt: "$4,250",
      overdue: true
    }],
    complete: [{
      id: 27,
      name: "Truesdell, R.",
      sub: "1818 Briar Crest · paid",
      due: "Apr 18 paid",
      amt: "$9,200"
    }]
  },
  /* ── Calendar bookings ── */
  calendar: {
    month: "May 2026",
    today: 12,
    bookings: {
      12: [{
        label: "Hendrickson · day 7",
        tone: "j-active"
      }, {
        label: "Park · estimate 5:30p",
        tone: "j-estimate"
      }],
      13: [{
        label: "Hendrickson · day 8",
        tone: "j-active"
      }],
      14: [{
        label: "Hendrickson · day 9",
        tone: "j-active"
      }],
      15: [{
        label: "Calle · start",
        tone: "j-upcoming"
      }, {
        label: "Reyes · cabinets",
        tone: "j-active"
      }],
      18: [{
        label: "Calle · day 2",
        tone: "j-upcoming"
      }, {
        label: "Marshfield · est",
        tone: "j-estimate"
      }],
      19: [{
        label: "Calle · day 3",
        tone: "j-upcoming"
      }],
      20: [{
        label: "Lin · estimate",
        tone: "j-estimate"
      }],
      22: [{
        label: "Vogel · interior",
        tone: "j-upcoming"
      }],
      26: [{
        label: "Truesdell · followup",
        tone: "j-estimate"
      }]
    }
  },
  /* ── Collections / escalation ── */
  collect: [{
    id: 31,
    clientId: 1,
    name: "Hendrickson, B.",
    balance: 4250,
    stage: "21d",
    stageTone: "red",
    daysOut: 22,
    action: "Send 21d collections SMS",
    lienDeadline: "May 26, 2026 · K.S.A. 60-1105"
  }, {
    id: 32,
    clientId: 99,
    name: "Brookhart, D.",
    balance: 2400,
    stage: "14d",
    stageTone: "amber",
    daysOut: 14,
    action: "Send 14d firm follow-up"
  }, {
    id: 33,
    clientId: 98,
    name: "Mason, R.",
    balance: 1180,
    stage: "7d",
    stageTone: "amber",
    daysOut: 8,
    action: "Send soft reminder"
  }],
  /* ── Books / financial tracker ── */
  income: [{
    date: "May 9",
    who: "Calle, J.",
    label: "Deposit",
    amt: 2040,
    method: "stripe"
  }, {
    date: "May 5",
    who: "Truesdell, R.",
    label: "Final payment",
    amt: 9200,
    method: "check"
  }, {
    date: "May 2",
    who: "Hendrickson, B.",
    label: "Deposit",
    amt: 1500,
    method: "stripe"
  }, {
    date: "Apr 28",
    who: "Mendoza, F.",
    label: "Final payment",
    amt: 5800,
    method: "stripe"
  }],
  expenses: [{
    date: "May 11",
    vendor: "Sherwin-Williams",
    cat: "Materials",
    amt: 412,
    recpt: true
  }, {
    date: "May 10",
    vendor: "Phillips 66",
    cat: "Fuel",
    amt: 68,
    recpt: true
  }, {
    date: "May 7",
    vendor: "Home Depot",
    cat: "Tools",
    amt: 142,
    recpt: true
  }, {
    date: "May 5",
    vendor: "State Farm",
    cat: "Insurance",
    amt: 280,
    recpt: false
  }],
  mileage: [{
    date: "May 11",
    from: "Office",
    to: "Hendrickson · Riverside",
    miles: 9.2,
    business: true
  }, {
    date: "May 10",
    from: "Hendrickson",
    to: "Sherwin-Williams",
    miles: 5.8,
    business: true
  }, {
    date: "May 8",
    from: "Office",
    to: "Whitlock estimate visit",
    miles: 14.4,
    business: true
  }, {
    date: "May 5",
    from: "Office",
    to: "Calle estimate · Andover",
    miles: 18.1,
    business: true
  }],
  /* ── Estimate / proposal line items ── */
  estimate: {
    client: "Hendrickson, B.",
    address: "2418 Riverside Dr · Wichita, KS 67203",
    lineItems: [{
      id: "li1",
      label: "Interior walls — living room, kitchen, master bedroom",
      qty: 1420,
      unit: "sf",
      price: 1.85,
      total: 2627
    }, {
      id: "li2",
      label: "Trim, doors, baseboards — full",
      qty: 380,
      unit: "lf",
      price: 2.40,
      total: 912
    }, {
      id: "li3",
      label: "Prep & patch · 4 hrs",
      qty: 4,
      unit: "hr",
      price: 55,
      total: 220
    }, {
      id: "li4",
      label: "Two coats Benjamin Moore Regal · client color",
      qty: 1,
      unit: "lot",
      price: 491,
      total: 491
    }],
    subtotal: 4250,
    deposit: 1275,
    tax: 0,
    total: 4250,
    schedule: {
      start: "May 18, 2026",
      end: "May 24, 2026"
    }
  },
  /* ── Scope library ── */
  scopeItems: [{
    id: "int_walls",
    label: "Interior walls",
    rate: 1.85,
    on: true
  }, {
    id: "int_trim",
    label: "Trim & doors",
    rate: 2.40,
    on: true
  }, {
    id: "int_ceil",
    label: "Ceilings",
    rate: 1.20,
    on: false
  }, {
    id: "ext_body",
    label: "Exterior body",
    rate: 2.10,
    on: true
  }, {
    id: "ext_trim",
    label: "Exterior trim",
    rate: 3.50,
    on: false
  }, {
    id: "cabinets",
    label: "Cabinets",
    rate: 28.0,
    on: false
  }, {
    id: "deck_stain",
    label: "Deck stain/seal",
    rate: 1.95,
    on: false
  }, {
    id: "prep",
    label: "Prep & patch",
    rate: 55.0,
    on: true
  }],
  surfaces: [{
    room: "Living room",
    l: 18,
    w: 14,
    h: 9
  }, {
    room: "Kitchen",
    l: 14,
    w: 12,
    h: 9
  }, {
    room: "Master bdrm",
    l: 16,
    w: 13,
    h: 9
  }]
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/data.js", error: String((e && e.message) || e) }); }

})();
