/* ============================================================
   43 MUNN — SCHEDULE ENGINE + APP
   ============================================================ */

/* ---------- Global mutable state ---------- */
const STATE = {
  milestones: deepClone(BASELINE_MILESTONES),
  trades: deepClone(BASELINE_TRADES),
  holidays: deepClone(DEFAULT_HOLIDAYS),
  activity: [],
  lastUpdated: new Date(),
  statusFilter: "All",
  tradeFilter: "active",
  activityPage: 1,
  openMilestoneId: null,
  openTradeId: null,
};

const ACTIVITY_PAGE_SIZE = 5;
const WORK_STATUS_OPTIONS = ["Not Started", "In Progress", "Complete", "On Hold"];

const STATUS_OPTIONS = ["Not Started", "In Progress", "Complete", "Delayed", "On Hold"];
const STATUS_COLOR = {
  "Not Started": "gray",
  "In Progress": "blue",
  "Complete": "green",
  "Delayed": "red",
  "On Hold": "amber",
};

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }
function pad(n) { return n < 10 ? "0" + n : "" + n; }
function isoDate(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function parseISO(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function fmtDate(d) { return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
function fmtDateShort(d) { return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); }

/* ============================================================
   BUSINESS-DAY ENGINE
   ============================================================ */

function isWeekend(d) { const day = d.getDay(); return day === 0 || day === 6; }

function isHoliday(d, holidays) {
  const s = isoDate(d);
  return holidays.some(h => h.date === s);
}

function isBusinessDay(d, holidays) {
  return !isWeekend(d) && !isHoliday(d, holidays);
}

function nextBusinessDay(d, holidays) {
  const cur = new Date(d);
  cur.setDate(cur.getDate() + 1);
  while (!isBusinessDay(cur, holidays)) cur.setDate(cur.getDate() + 1);
  return cur;
}

// Returns {start, finish} — start is rolled forward to the first
// business day on/after the given date; finish is `duration`
// business days later inclusive of start.
function addBusinessDays(fromDate, duration, holidays) {
  const start = new Date(fromDate);
  while (!isBusinessDay(start, holidays)) start.setDate(start.getDate() + 1);
  let count = 1;
  const cursor = new Date(start);
  const dur = Math.max(1, duration);
  while (count < dur) {
    cursor.setDate(cursor.getDate() + 1);
    if (isBusinessDay(cursor, holidays)) count++;
  }
  return { start, finish: cursor };
}

// Signed count of business days between two dates (end - start),
// excluding weekends/holidays. Positive = end is after start.
function calculateBusinessDays(startDate, endDate, holidays) {
  if (isoDate(startDate) === isoDate(endDate)) return 0;
  const forward = endDate > startDate;
  let a = new Date(Math.min(startDate, endDate));
  const b = new Date(Math.max(startDate, endDate));
  let count = 0;
  const cur = new Date(a);
  while (cur < b) {
    cur.setDate(cur.getDate() + 1);
    if (isBusinessDay(cur, STATE.holidays)) count++;
  }
  return forward ? count : -count;
}

/* ============================================================
   SCHEDULE COMPUTATION (dependency resolution)
   ============================================================ */

function computeSchedule(milestones, holidays, projectStartISO) {
  const projectStart = parseISO(projectStartISO);
  const resolved = {};
  const results = {};
  let iterations = 0;
  const maxIter = milestones.length + 5;

  while (Object.keys(resolved).length < milestones.length && iterations < maxIter) {
    iterations++;
    for (const m of milestones) {
      if (resolved[m.id]) continue;
      const deps = m.dependency || [];
      const ready = deps.every(depId => resolved[depId]);
      if (!ready) continue;

      let fromDate;
      if (m.manualStart) {
        fromDate = parseISO(m.manualStart);
      } else if (deps.length === 0) {
        fromDate = projectStart;
      } else {
        const depFinishes = deps.map(depId => results[depId].finish);
        const maxFinish = new Date(Math.max(...depFinishes.map(d => d.getTime())));
        fromDate = nextBusinessDay(maxFinish, holidays);
      }
      const { start, finish } = addBusinessDays(fromDate, m.duration, holidays);
      results[m.id] = { start, finish };
      resolved[m.id] = true;
    }
  }

  if (Object.keys(resolved).length < milestones.length) {
    milestones.forEach(m => {
      if (!resolved[m.id]) console.error(`Circular or broken dependency at milestone #${m.id} (${m.name})`);
    });
  }
  return results;
}

/* ============================================================
   DERIVED METRICS
   ============================================================ */

function getComputed() {
  return computeSchedule(STATE.milestones, STATE.holidays, PROJECT.start);
}

function getProjectedCompletion(schedule) {
  let latest = null;
  STATE.milestones.forEach(m => {
    const f = schedule[m.id] && schedule[m.id].finish;
    if (f && (!latest || f > latest)) latest = f;
  });
  return latest;
}

function getOverallProgress() {
  const totalDur = STATE.milestones.reduce((s, m) => s + m.duration, 0);
  const weighted = STATE.milestones.reduce((s, m) => s + m.duration * m.progress, 0);
  return totalDur ? Math.round(weighted / totalDur) : 0;
}

function getCounts() {
  const c = { "Not Started": 0, "In Progress": 0, "Complete": 0, "Delayed": 0, "On Hold": 0 };
  STATE.milestones.forEach(m => c[m.status] = (c[m.status] || 0) + 1);
  return c;
}

function getScheduleHealth(varianceDays, counts) {
  const delayed = counts["Delayed"] || 0;
  let level, label, icon;
  if (varianceDays > 10 || delayed >= 2) { level = "red"; label = "DELAYED"; icon = "\uD83D\uDD34"; }
  else if (varianceDays > 0 || delayed === 1) { level = "amber"; label = "AT RISK"; icon = "\uD83D\uDFE1"; }
  else { level = "green"; label = "ON TRACK"; icon = "\uD83D\uDFE2"; }

  let explanation;
  if (delayed > 0) {
    const worst = STATE.milestones.filter(m => m.status === "Delayed")[0];
    explanation = `Project is currently ${Math.abs(varianceDays)} business day${Math.abs(varianceDays) === 1 ? "" : "s"} ${varianceDays >= 0 ? "behind" : "ahead of"} target, with ${delayed} milestone${delayed === 1 ? "" : "s"} marked delayed (e.g. ${worst.name}).`;
  } else if (varianceDays > 0) {
    explanation = `Projected completion is ${varianceDays} business day${varianceDays === 1 ? "" : "s"} past the target completion date.`;
  } else if (varianceDays < 0) {
    explanation = `Projected completion is ${Math.abs(varianceDays)} business day${Math.abs(varianceDays) === 1 ? "" : "s"} ahead of the target completion date.`;
  } else {
    explanation = `Projected completion lands exactly on the target completion date.`;
  }
  return { level, label, icon, explanation };
}

/* ============================================================
   LIVE SYNC (Firebase Realtime Database)
   Every mutation writes the whole schedule to /schedule.
   Every client listens to /schedule and re-renders on any
   change — including its own writes and writes from other
   tabs/devices. Last write wins.
   ============================================================ */

let FIREBASE_READY = false;

// Firebase Realtime Database silently drops empty arrays ([]) and null
// fields on write — they simply won't exist when read back, leaving the
// JS object with `undefined` for that key instead of [] or null. That
// undefined then blows up code expecting an array, and if it gets written
// back verbatim, Firebase's .set() throws and aborts the ENTIRE save
// (nothing else in that write goes through either). These two helpers
// keep milestone objects well-formed on the way out and on the way in.
function sanitizeMilestone(m) {
  return {
    id: m.id,
    name: m.name,
    duration: m.duration,
    dependency: Array.isArray(m.dependency) ? m.dependency : [],
    manualStart: (m.manualStart === undefined || m.manualStart === null) ? null : m.manualStart,
    status: m.status,
    progress: m.progress,
    trade: m.trade || "",
    notes: m.notes || "",
    contractPrice: Number(m.contractPrice) || 0,
    changeOrders: (Array.isArray(m.changeOrders) ? m.changeOrders : []).map(sanitizeChangeOrder),
    invoices: (Array.isArray(m.invoices) ? m.invoices : []).map(sanitizeInvoice),
    paymentDetails: sanitizePaymentDetails(m.paymentDetails),
  };
}
function sanitizeChangeOrder(c) {
  return {
    id: c.id,
    description: c.description || "",
    date: c.date || null,
    amount: Number(c.amount) || 0,
    approvedBy: c.approvedBy || "",
    status: c.status || "Pending",
    notes: c.notes || "",
  };
}
function sanitizeInvoice(inv) {
  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber || "",
    vendor: inv.vendor || "",
    invoiceDate: inv.invoiceDate || null,
    dueDate: inv.dueDate || null,
    subtotal: Number(inv.subtotal) || 0,
    hst: Number(inv.hst) || 0,
    total: Number(inv.total) || 0,
    paymentStatus: inv.paymentStatus || "Pending",
    paymentDate: inv.paymentDate || null,
    fileName: inv.fileName || "",
    notes: inv.notes || "",
  };
}
function sanitizePaymentDetails(pd) {
  pd = pd || {};
  return {
    vendorName: pd.vendorName || "",
    poNumber: pd.poNumber || "",
    paymentTerms: pd.paymentTerms || "",
    paymentMethod: pd.paymentMethod || "",
    bankName: pd.bankName || "",
    accountName: pd.accountName || "",
    accountLast4: pd.accountLast4 || "",
    paymentReference: pd.paymentReference || "",
    notes: pd.notes || "",
  };
}
function rehydrateMilestone(m) {
  return {
    ...m,
    dependency: Array.isArray(m.dependency) ? m.dependency : [],
    manualStart: m.manualStart === undefined ? null : m.manualStart,
    trade: m.trade || "",
    notes: m.notes || "",
    contractPrice: Number(m.contractPrice) || 0,
    changeOrders: Array.isArray(m.changeOrders) ? m.changeOrders.map(sanitizeChangeOrder) : [],
    invoices: Array.isArray(m.invoices) ? m.invoices.map(sanitizeInvoice) : [],
    paymentDetails: sanitizePaymentDetails(m.paymentDetails),
  };
}

function sanitizeTradeChangeOrder(c) {
  return {
    changeOrderId: c.changeOrderId,
    description: c.description || "",
    date: c.date || null,
    amount: Number(c.amount) || 0,
    approvedBy: c.approvedBy || "",
    status: c.status || "Pending",
    notes: c.notes || "",
  };
}
function sanitizeTradeInvoice(inv) {
  return {
    invoiceId: inv.invoiceId,
    invoiceNumber: inv.invoiceNumber || "",
    vendor: inv.vendor || "",
    invoiceDate: inv.invoiceDate || null,
    dueDate: inv.dueDate || null,
    subtotal: Number(inv.subtotal) || 0,
    hst: Number(inv.hst) || 0,
    total: Number(inv.total) || 0,
    fileName: inv.fileName || "",
    notes: inv.notes || "",
  };
}
function sanitizeTradePayment(p) {
  return {
    paymentId: p.paymentId,
    invoiceId: (p.invoiceId === undefined || p.invoiceId === null) ? null : p.invoiceId,
    amount: Number(p.amount) || 0,
    date: p.date || null,
    method: p.method || "",
    reference: p.reference || "",
    notes: p.notes || "",
  };
}
function sanitizeTrade(t) {
  return {
    tradeId: t.tradeId,
    tradeName: t.tradeName || "",
    vendor: t.vendor || "",
    scope: t.scope || "",
    milestoneId: (t.milestoneId === undefined || t.milestoneId === null) ? null : t.milestoneId,
    contractAmount: Number(t.contractAmount) || 0,
    hst: Number(t.hst) || 0,
    workStatus: t.workStatus || "Not Started",
    paymentTerms: t.paymentTerms || "",
    poNumber: t.poNumber || "",
    notes: t.notes || "",
    active: t.active === undefined ? true : !!t.active,
    createdAt: t.createdAt || new Date().toISOString(),
    updatedAt: t.updatedAt || new Date().toISOString(),
    changeOrders: (Array.isArray(t.changeOrders) ? t.changeOrders : []).map(sanitizeTradeChangeOrder),
    invoices: (Array.isArray(t.invoices) ? t.invoices : []).map(sanitizeTradeInvoice),
    payments: (Array.isArray(t.payments) ? t.payments : []).map(sanitizeTradePayment),
  };
}
function rehydrateTrade(t) {
  return {
    ...t,
    milestoneId: (t.milestoneId === undefined) ? null : t.milestoneId,
    vendor: t.vendor || "",
    scope: t.scope || "",
    paymentTerms: t.paymentTerms || "",
    poNumber: t.poNumber || "",
    notes: t.notes || "",
    active: t.active === undefined ? true : !!t.active,
    changeOrders: Array.isArray(t.changeOrders) ? t.changeOrders.map(sanitizeTradeChangeOrder) : [],
    invoices: Array.isArray(t.invoices) ? t.invoices.map(sanitizeTradeInvoice) : [],
    payments: Array.isArray(t.payments) ? t.payments.map(sanitizeTradePayment) : [],
  };
}

function firebaseSave() {
  if (typeof db === "undefined") return;
  const payload = {
    milestones: STATE.milestones.map(sanitizeMilestone),
    trades: STATE.trades.map(sanitizeTrade),
    holidays: STATE.holidays,
    activity: STATE.activity.map(a => ({ text: a.text, time: a.time.toISOString() })),
    lastUpdated: STATE.lastUpdated.toISOString(),
  };
  db.ref("schedule").set(payload).catch((err) => {
    console.error("Firebase save failed:", err);
    alert("Couldn't sync to the live database: " + err.message + "\n\nYour change is only visible in this browser until this is fixed.");
  });
}

function firebaseListen() {
  if (typeof db === "undefined") {
    // Firebase not configured — fall back to local-only mode.
    logActivity("Schedule loaded — baseline for 43 Munn, project start Aug 7, 2026.");
    renderAll();
    return;
  }
  db.ref("schedule").on("value", (snapshot) => {
    const val = snapshot.val();
    if (!val) {
      // Nothing in the database yet — seed it with the baseline.
      STATE.milestones = deepClone(BASELINE_MILESTONES);
      STATE.trades = deepClone(BASELINE_TRADES);
      STATE.holidays = deepClone(DEFAULT_HOLIDAYS);
      STATE.activity = [];
      STATE.lastUpdated = new Date();
      logActivity("Schedule loaded — baseline for 43 Munn, project start Aug 7, 2026.");
      firebaseSave();
      return;
    }
    STATE.milestones = (val.milestones || deepClone(BASELINE_MILESTONES)).map(rehydrateMilestone);
    STATE.trades = (val.trades || []).map(rehydrateTrade);
    STATE.holidays = val.holidays || deepClone(DEFAULT_HOLIDAYS);
    STATE.activity = (val.activity || []).map(a => ({ text: a.text, time: new Date(a.time) }));
    STATE.lastUpdated = val.lastUpdated ? new Date(val.lastUpdated) : new Date();
    FIREBASE_READY = true;
    renderAll();
  }, (err) => {
    console.error("Firebase listen failed:", err);
  });
}

/* ============================================================
   TRADES — calculation engine
   Trades are independent records (own tradeId, optional link to
   a milestone via milestoneId). All financial figures derive live
   from a trade's changeOrders + invoices + payments; nothing here
   is stored pre-computed.
   ============================================================ */

function fmtMoney(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function activeTrades() { return STATE.trades.filter(t => t.active); }

function approvedChangeOrderTotal(t) {
  return (t.changeOrders || []).filter(c => c.status === "Approved").reduce((s, c) => s + (Number(c.amount) || 0), 0);
}

function revisedContractValue(t) {
  return (Number(t.contractAmount) || 0) + (Number(t.hst) || 0) + approvedChangeOrderTotal(t);
}

function tradeTotalInvoiced(t) {
  return (t.invoices || []).reduce((s, inv) => s + (Number(inv.total) || 0), 0);
}

function tradeTotalPaid(t) {
  return (t.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
}

function tradeOutstanding(t) {
  return revisedContractValue(t) - tradeTotalPaid(t);
}

function invoicePaidAmount(t, invoiceId) {
  return (t.payments || []).filter(p => p.invoiceId === invoiceId).reduce((s, p) => s + (Number(p.amount) || 0), 0);
}

function invoiceBalance(t, inv) {
  return (Number(inv.total) || 0) - invoicePaidAmount(t, inv.invoiceId);
}

function invoiceOverdue(t, inv) {
  if (!inv.dueDate) return false;
  if (invoiceBalance(t, inv) <= 0) return false;
  return parseISO(inv.dueDate) < new Date();
}

function tradePaymentStatus(t) {
  const invoices = t.invoices || [], payments = t.payments || [];
  if (invoices.length === 0 && payments.length === 0) return "Not Invoiced";
  if (invoices.some(inv => invoiceOverdue(t, inv))) return "Overdue";
  const paid = tradeTotalPaid(t);
  const revised = revisedContractValue(t);
  if (paid <= 0) return "Unpaid";
  if (revised > 0 && paid >= revised) return "Paid";
  return "Partially Paid";
}

function pendingInvoiceCount() {
  let n = 0;
  activeTrades().forEach(t => (t.invoices || []).forEach(inv => { if (invoiceBalance(t, inv) > 0) n++; }));
  return n;
}

function financialTotals() {
  return activeTrades().reduce((acc, t) => {
    acc.contract += revisedContractValue(t);
    acc.invoiced += tradeTotalInvoiced(t);
    acc.paid += tradeTotalPaid(t);
    acc.outstanding += tradeOutstanding(t);
    return acc;
  }, { contract: 0, invoiced: 0, paid: 0, outstanding: 0 });
}

function tradesForMilestone(milestoneId) {
  return STATE.trades.filter(t => t.milestoneId === milestoneId);
}

function nextTradeId() {
  let max = 0;
  STATE.trades.forEach(t => {
    const m = /^TRD-(\d+)$/.exec(t.tradeId || "");
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return "TRD-" + String(max + 1).padStart(3, "0");
}

let FIN_ID_SEQ = Date.now();
function nextFinId() { return ++FIN_ID_SEQ; }

// Session-only object URLs for uploaded PDFs — never synced to Firebase.
// Keyed by invoice id. This is the prototype's local-preview layer;
// real deployments should point fileName at real document storage.
const LOCAL_INVOICE_FILES = {};

/* ============================================================
   ACTIVITY FEED
   ============================================================ */

function logActivity(text) {
  STATE.activity.unshift({ text, time: new Date() });
  if (STATE.activity.length > 200) STATE.activity.pop();
  STATE.activityPage = 1;
}

/* ============================================================
   RENDERING
   ============================================================ */

let CACHED_SCHEDULE = {};

function renderAll() {
  CACHED_SCHEDULE = getComputed();
  renderHeader();
  renderDashboard();
  renderSummary();
  renderHealth();
  renderLegendFilters();
  renderGantt();
  renderMobileList();
  renderUpcoming();
  renderActivity();
  renderHolidays();
  renderFinancialSummary();
  renderTradeCostTable();
  document.getElementById("lastUpdated").textContent = "Last updated: " + STATE.lastUpdated.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  const syncEl = document.getElementById("syncStatus");
  if (syncEl) syncEl.textContent = FIREBASE_READY ? "🔥 Live sync on" : "Local mode";
}

function renderHeader() {
  document.getElementById("projAddress").textContent = PROJECT.address.toUpperCase();
  document.getElementById("projType").textContent = PROJECT.type;
}

function renderDashboard() {
  const schedule = CACHED_SCHEDULE;
  const projected = getProjectedCompletion(schedule);
  const target = parseISO(PROJECT.targetCompletion);
  const today = new Date();
  const progress = getOverallProgress();
  const daysRemaining = projected ? Math.max(0, calculateBusinessDays(today, projected)) : 0;
  const variance = projected ? calculateBusinessDays(target, projected) : 0;

  let statusLabel, statusClass;
  if (variance < 0) { statusLabel = "AHEAD OF SCHEDULE"; statusClass = "green"; }
  else if (variance === 0) { statusLabel = "ON SCHEDULE"; statusClass = "blue"; }
  else { statusLabel = "BEHIND SCHEDULE"; statusClass = "red"; }

  document.getElementById("metricProgress").textContent = progress + "%";
  document.getElementById("metricDaysRemaining").textContent = daysRemaining + " Business Days";
  document.getElementById("metricProjected").textContent = projected ? fmtDate(projected) : "—";
  const statusEl = document.getElementById("metricStatus");
  statusEl.textContent = statusLabel;
  statusEl.className = "metric-value badge-text " + statusClass;

  document.getElementById("varianceNote").textContent =
    variance === 0 ? "Exactly on target" :
    (variance < 0 ? `${Math.abs(variance)} business day${Math.abs(variance) === 1 ? "" : "s"} ahead of target` : `${variance} business day${variance === 1 ? "" : "s"} behind target`);
}

function renderSummary() {
  const schedule = CACHED_SCHEDULE;
  const projected = getProjectedCompletion(schedule);
  const counts = getCounts();
  const el = document.getElementById("summaryGrid");
  el.innerHTML = "";
  const rows = [
    ["Project", PROJECT.address],
    ["Start", fmtDate(parseISO(PROJECT.start))],
    ["Target Completion", fmtDate(parseISO(PROJECT.targetCompletion))],
    ["Projected Completion", projected ? fmtDate(projected) : "—"],
    ["Total Milestones", STATE.milestones.length],
    ["Completed", counts["Complete"] || 0],
    ["In Progress", counts["In Progress"] || 0],
    ["Upcoming", counts["Not Started"] || 0],
    ["Delayed", counts["Delayed"] || 0],
    ["Overall Progress", getOverallProgress() + "%"],
  ];
  rows.forEach(([label, val]) => {
    const d = document.createElement("div");
    d.className = "summary-row";
    d.innerHTML = `<span class="summary-label">${label}</span><span class="summary-val">${val}</span>`;
    el.appendChild(d);
  });
}

function renderHealth() {
  const schedule = CACHED_SCHEDULE;
  const projected = getProjectedCompletion(schedule);
  const target = parseISO(PROJECT.targetCompletion);
  const variance = projected ? calculateBusinessDays(target, projected) : 0;
  const counts = getCounts();
  const h = getScheduleHealth(variance, counts);
  document.getElementById("healthIcon").textContent = h.icon;
  document.getElementById("healthLabel").textContent = h.label;
  document.getElementById("healthLabel").className = "health-label " + h.level;
  document.getElementById("healthExplain").textContent = h.explanation;
}

function renderLegendFilters() {
  const el = document.getElementById("statusFilters");
  el.innerHTML = "";
  ["All", ...STATUS_OPTIONS].forEach(s => {
    const btn = document.createElement("button");
    btn.className = "chip" + (STATE.statusFilter === s ? " active" : "") + (s !== "All" ? " dot-" + STATUS_COLOR[s] : "");
    btn.textContent = s;
    btn.onclick = () => { STATE.statusFilter = s; renderAll(); };
    el.appendChild(btn);
  });
}

function visibleMilestones() {
  if (STATE.statusFilter === "All") return STATE.milestones;
  return STATE.milestones.filter(m => m.status === STATE.statusFilter);
}

function statusOfDate(m, schedule, today) {
  // Determine display bucket for coloring the bar, independent of manual status label
  return m.status;
}

function renderGantt() {
  const schedule = CACHED_SCHEDULE;
  const container = document.getElementById("ganttBody");
  container.innerHTML = "";
  const projectStart = parseISO(PROJECT.start);
  const target = parseISO(PROJECT.targetCompletion);
  const today = new Date();
  const list = visibleMilestones();

  const lastFinish = getProjectedCompletion(schedule) || target;
  const spanEnd = new Date(Math.max(target.getTime(), lastFinish.getTime()));
  const totalDays = Math.round((spanEnd - projectStart) / 86400000) + 15;
  const PX = 8;
  const LABEL_W = 230;

  const monthsRow = document.getElementById("ganttMonths");
  monthsRow.innerHTML = "";
  monthsRow.style.width = (totalDays * PX) + "px";
  let mCursor = new Date(projectStart.getFullYear(), projectStart.getMonth(), 1);
  while (mCursor <= spanEnd) {
    const offset = Math.round((mCursor - projectStart) / 86400000);
    if (offset >= 0) {
      const m = document.createElement("div");
      m.className = "gantt-month";
      m.style.left = (offset * PX) + "px";
      m.textContent = mCursor.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
      monthsRow.appendChild(m);
    }
    mCursor.setMonth(mCursor.getMonth() + 1);
  }

  container.style.width = (totalDays * PX) + "px";

  list.forEach(m => {
    const sched = schedule[m.id];
    if (!sched) return;
    const row = document.createElement("div");
    row.className = "gantt-row";

    const label = document.createElement("div");
    label.className = "gantt-label";
    label.innerHTML = `<span class="gname">${m.name}</span><span class="gsub">${fmtDateShort(sched.start)} – ${fmtDateShort(sched.finish)} · ${m.duration}d</span>`;
    label.style.width = LABEL_W + "px";
    label.onclick = () => openModal(m.id);
    row.appendChild(label);

    const lane = document.createElement("div");
    lane.className = "gantt-lane";
    lane.style.width = (totalDays * PX) + "px";

    const off = Math.round((sched.start - projectStart) / 86400000);
    const span = Math.round((sched.finish - sched.start) / 86400000) + 1;
    const bar = document.createElement("div");
    bar.className = "gantt-bar bar-" + STATUS_COLOR[m.status];
    bar.style.left = (off * PX) + "px";
    bar.style.width = Math.max(span * PX - 2, 6) + "px";
    bar.title = `${m.name}: ${fmtDate(sched.start)} → ${fmtDate(sched.finish)} (${m.duration} business days) — ${m.status}`;
    bar.onclick = () => openModal(m.id);

    const fill = document.createElement("div");
    fill.className = "gantt-bar-fill";
    fill.style.width = m.progress + "%";
    bar.appendChild(fill);

    lane.appendChild(bar);
    row.appendChild(lane);
    container.appendChild(row);
  });

  // today marker
  const oldMarkers = document.querySelectorAll(".gantt-todaymark, .gantt-targetmark");
  oldMarkers.forEach(n => n.remove());
  const ganttWrap = document.getElementById("ganttWrap");
  const bodyHeight = 40 + list.length * 40;

  const todayOff = Math.round((today - projectStart) / 86400000);
  if (todayOff >= -2 && todayOff <= totalDays) {
    const line = document.createElement("div");
    line.className = "gantt-todaymark";
    line.style.left = (LABEL_W + todayOff * PX) + "px";
    line.style.height = bodyHeight + "px";
    line.innerHTML = `<span>TODAY</span>`;
    ganttWrap.appendChild(line);
  }
  const targetOff = Math.round((target - projectStart) / 86400000);
  const tLine = document.createElement("div");
  tLine.className = "gantt-targetmark";
  tLine.style.left = (LABEL_W + targetOff * PX) + "px";
  tLine.style.height = bodyHeight + "px";
  tLine.innerHTML = `<span>TARGET</span>`;
  ganttWrap.appendChild(tLine);
}

function renderMobileList() {
  const schedule = CACHED_SCHEDULE;
  const container = document.getElementById("mobileList");
  container.innerHTML = "";
  visibleMilestones().forEach(m => {
    const sched = schedule[m.id];
    if (!sched) return;
    const card = document.createElement("div");
    card.className = "mcard";
    card.onclick = () => openModal(m.id);
    card.innerHTML = `
      <div class="mcard-top">
        <span class="mcard-name">${m.name}</span>
        <span class="status-badge bg-${STATUS_COLOR[m.status]}">${m.status}</span>
      </div>
      <div class="mcard-dates">${fmtDate(sched.start)} → ${fmtDate(sched.finish)} · ${m.duration} business days</div>
      <div class="progress-track"><div class="progress-fill fill-${STATUS_COLOR[m.status]}" style="width:${m.progress}%"></div></div>
      <div class="mcard-meta">${m.trade}</div>
    `;
    container.appendChild(card);
  });
}

function renderUpcoming() {
  const schedule = CACHED_SCHEDULE;
  const today = new Date();
  const upcoming = STATE.milestones
    .filter(m => m.status === "Not Started" || m.status === "In Progress")
    .map(m => ({ m, sched: schedule[m.id] }))
    .filter(x => x.sched)
    .sort((a, b) => a.sched.start - b.sched.start)
    .slice(0, 5);
  const el = document.getElementById("upcomingList");
  el.innerHTML = "";
  if (upcoming.length === 0) {
    el.innerHTML = `<div class="empty-note">No upcoming milestones.</div>`;
    return;
  }
  upcoming.forEach(({ m, sched }) => {
    const row = document.createElement("div");
    row.className = "upcoming-row";
    row.onclick = () => openModal(m.id);
    row.innerHTML = `
      <div class="upcoming-name">${m.name}</div>
      <div class="upcoming-dates">${fmtDateShort(sched.start)} – ${fmtDateShort(sched.finish)}</div>
      <div class="upcoming-dur">${m.duration}d</div>
      <div class="upcoming-trade">${m.trade}</div>
      <span class="status-badge bg-${STATUS_COLOR[m.status]}">${m.status}</span>
    `;
    el.appendChild(row);
  });
}

function renderActivity() {
  const el = document.getElementById("activityList");
  el.innerHTML = "";
  if (STATE.activity.length === 0) {
    el.innerHTML = `<div class="empty-note">No changes yet this session.</div>`;
    updateActivityPagerControls(1, 1);
    return;
  }
  const totalPages = Math.max(1, Math.ceil(STATE.activity.length / ACTIVITY_PAGE_SIZE));
  STATE.activityPage = Math.min(Math.max(1, STATE.activityPage), totalPages);
  const start = (STATE.activityPage - 1) * ACTIVITY_PAGE_SIZE;
  const pageItems = STATE.activity.slice(start, start + ACTIVITY_PAGE_SIZE);
  pageItems.forEach(a => {
    const row = document.createElement("div");
    row.className = "activity-row";
    row.innerHTML = `<span class="activity-dot"></span><span class="activity-text">${escapeHtml(a.text)}</span><span class="activity-time">${a.time.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>`;
    el.appendChild(row);
  });
  updateActivityPagerControls(STATE.activityPage, totalPages);
}

function updateActivityPagerControls(page, totalPages) {
  const pager = document.getElementById("activityPager");
  if (!pager) return;
  pager.style.display = totalPages > 1 ? "flex" : "none";
  document.getElementById("activityPageLabel").textContent = `Page ${page} of ${totalPages}`;
  document.getElementById("btnActivityPrev").disabled = page <= 1;
  document.getElementById("btnActivityNext").disabled = page >= totalPages;
}

function renderHolidays() {
  const el = document.getElementById("holidayList");
  el.innerHTML = "";
  STATE.holidays
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach(h => {
      const row = document.createElement("div");
      row.className = "holiday-row";
      row.innerHTML = `<span>${fmtDate(parseISO(h.date))} — ${h.name}</span>`;
      const rm = document.createElement("button");
      rm.className = "icon-btn";
      rm.textContent = "×";
      rm.onclick = () => {
        STATE.holidays = STATE.holidays.filter(x => !(x.date === h.date && x.name === h.name));
        STATE.lastUpdated = new Date();
        logActivity(`Holiday removed: ${h.name} (${h.date})`);
        firebaseSave();
        renderAll();
      };
      row.appendChild(rm);
      el.appendChild(row);
    });
}

function renderFinancialSummary() {
  const totals = financialTotals();
  const el = document.getElementById("finSummaryMetrics");
  if (!el) return;
  el.innerHTML = `
    <div class="metric-card">
      <div class="metric-label">Total Contract Value</div>
      <div class="metric-value">${fmtMoney(totals.contract)}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Total Invoiced</div>
      <div class="metric-value">${fmtMoney(totals.invoiced)}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Total Paid</div>
      <div class="metric-value green">${fmtMoney(totals.paid)}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Total Outstanding</div>
      <div class="metric-value ${totals.outstanding > 0 ? "red" : ""}">${fmtMoney(totals.outstanding)}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Pending Invoices</div>
      <div class="metric-value">${pendingInvoiceCount()}</div>
    </div>
  `;
}

function statusPillClass(status) {
  const map = {
    "Paid": "st-paid", "Partially Paid": "st-partial", "Unpaid": "st-unpaid",
    "Overdue": "st-overdue", "Pending": "st-pending", "Approved": "st-approved", "Rejected": "st-rejected",
    "Not Invoiced": "st-gray",
  };
  return map[status] || "st-pending";
}

function visibleTrades() {
  if (STATE.tradeFilter === "archived") return STATE.trades.filter(t => !t.active);
  if (STATE.tradeFilter === "all") return STATE.trades;
  return STATE.trades.filter(t => t.active);
}

function renderTradeFilterTabs() {
  const el = document.getElementById("tradeFilterTabs");
  if (!el) return;
  const opts = [["active", "Active"], ["archived", "Archived"], ["all", "All"]];
  el.innerHTML = "";
  opts.forEach(([key, label]) => {
    const btn = document.createElement("button");
    btn.className = "chip" + (STATE.tradeFilter === key ? " active" : "");
    btn.textContent = label;
    btn.onclick = () => { STATE.tradeFilter = key; renderTradeCostTable(); renderTradeFilterTabs(); };
    el.appendChild(btn);
  });
}

function milestoneName(id) {
  const m = STATE.milestones.find(x => x.id === id);
  return m ? m.name : "—";
}

function renderTradeCostTable() {
  const body = document.getElementById("tradeCostTableBody");
  if (!body) return;
  body.innerHTML = "";
  const list = visibleTrades();
  if (list.length === 0) {
    body.innerHTML = `<tr><td colspan="11" class="empty-note">No trades yet. Click "+ Add Trade" to create one.</td></tr>`;
    return;
  }
  list.forEach(t => {
    const invoiced = tradeTotalInvoiced(t);
    const paid = tradeTotalPaid(t);
    const outstanding = tradeOutstanding(t);
    const status = tradePaymentStatus(t);
    const tr = document.createElement("tr");
    tr.className = "clickable" + (t.active ? "" : " archived-row");
    tr.onclick = (e) => { if (!e.target.closest("button")) openTradeModal(t.tradeId); };
    tr.innerHTML = `
      <td>${escapeHtml(t.tradeName)}</td>
      <td>${escapeHtml(t.vendor) || "—"}</td>
      <td>${escapeHtml(t.scope) || "—"}</td>
      <td>${escapeHtml(milestoneName(t.milestoneId)) || "—"}</td>
      <td class="num">${fmtMoney(revisedContractValue(t))}</td>
      <td class="num">${fmtMoney(invoiced)}</td>
      <td class="num">${fmtMoney(paid)}</td>
      <td class="num">${fmtMoney(outstanding)}</td>
      <td class="num">${(t.invoices || []).length}</td>
      <td><span class="status-pill ${statusPillClass(status)}">${status}</span>${!t.active ? '<span class="status-pill st-gray" style="margin-left:4px;">Archived</span>' : ""}</td>
      <td class="trade-actions-cell">
        <button data-taction="edit" data-tid="${t.tradeId}">Edit</button>
        ${t.active ? `<button data-taction="archive" data-tid="${t.tradeId}">Archive</button>` : `<button data-taction="restore" data-tid="${t.tradeId}">Restore</button>`}
      </td>
    `;
    body.appendChild(tr);
  });
}

function handleTradeTableClick(e) {
  const btn = e.target.closest("[data-taction]");
  if (!btn) return;
  e.stopPropagation();
  const tid = btn.dataset.tid;
  const action = btn.dataset.taction;
  if (action === "edit") openTradeModal(tid);
  if (action === "archive") archiveTradePrompt(tid);
  if (action === "restore") restoreTrade(tid);
}

/* ============================================================
   MODAL — VIEW / EDIT MILESTONE
   ============================================================ */

let MODAL_REVEAL_PAYMENT = false;

function openModal(id, tab) {
  STATE.openMilestoneId = id;
  MODAL_REVEAL_PAYMENT = false;
  const m = STATE.milestones.find(x => x.id === id);
  const sched = CACHED_SCHEDULE[id];
  const overlay = document.getElementById("modalOverlay");
  overlay.classList.add("show");

  document.getElementById("modalTitle").textContent = m.name;
  document.getElementById("mStart").value = isoDate(sched.start);
  document.getElementById("mFinishDisplay").textContent = fmtDate(sched.finish);
  document.getElementById("mDuration").value = m.duration;
  document.getElementById("mStatus").value = m.status;
  document.getElementById("mProgress").value = m.progress;
  document.getElementById("mProgressLabel").textContent = m.progress + "%";
  document.getElementById("mTrade").value = m.trade;
  document.getElementById("mNotes").value = m.notes;
  document.getElementById("mDependency").textContent = ((m.dependency || []).length
    ? m.dependency.map(id2 => STATE.milestones.find(x => x.id === id2)?.name).filter(Boolean).join(", ")
    : "None — starts at project start");
  document.getElementById("mError").textContent = "";

  renderMilestoneTradesTab(m);
  switchModalTab(tab === "financials" ? "financials" : "schedule");
}

function switchModalTab(tab) {
  const schedBtn = document.getElementById("tabBtnSchedule");
  const finBtn = document.getElementById("tabBtnFinancials");
  const schedBody = document.getElementById("scheduleTabContent");
  const finBody = document.getElementById("financialsTabContent");
  const schedFoot = document.getElementById("scheduleModalFoot");
  if (tab === "financials") {
    schedBtn.classList.remove("active"); finBtn.classList.add("active");
    schedBody.style.display = "none"; finBody.style.display = "block";
    schedFoot.style.display = "none";
  } else {
    finBtn.classList.remove("active"); schedBtn.classList.add("active");
    finBody.style.display = "none"; schedBody.style.display = "flex";
    schedFoot.style.display = "flex";
  }
}

function closeModal() {
  document.getElementById("modalOverlay").classList.remove("show");
  STATE.openMilestoneId = null;
}

function saveModal() {
  const id = STATE.openMilestoneId;
  const m = STATE.milestones.find(x => x.id === id);
  const errEl = document.getElementById("mError");

  const newDuration = parseInt(document.getElementById("mDuration").value, 10);
  const newStatus = document.getElementById("mStatus").value;
  const newProgress = parseInt(document.getElementById("mProgress").value, 10);
  const newTrade = document.getElementById("mTrade").value.trim();
  const newNotes = document.getElementById("mNotes").value.trim();
  const newStartRaw = document.getElementById("mStart").value;

  if (!newDuration || newDuration < 1) { errEl.textContent = "Duration must be at least 1 business day."; return; }
  if (newProgress < 0 || newProgress > 100 || isNaN(newProgress)) { errEl.textContent = "Progress must be between 0 and 100."; return; }
  if (!newStartRaw) { errEl.textContent = "Start date is required."; return; }

  const oldStartISO = isoDate(CACHED_SCHEDULE[id].start);
  const manualOverride = newStartRaw !== oldStartISO ? newStartRaw : m.manualStart;

  const changes = [];
  if (m.duration !== newDuration) changes.push(`duration ${m.duration}d → ${newDuration}d`);
  if (m.status !== newStatus) changes.push(`status "${m.status}" → "${newStatus}"`);
  if (m.progress !== newProgress) changes.push(`progress ${m.progress}% → ${newProgress}%`);
  if (m.trade !== newTrade) changes.push(`trade reassigned`);
  if (newStartRaw !== oldStartISO) changes.push(`start moved to ${newStartRaw}`);

  m.duration = newDuration;
  m.status = newStatus;
  m.progress = newProgress;
  m.trade = newTrade;
  m.notes = newNotes;
  m.manualStart = manualOverride;

  STATE.lastUpdated = new Date();
  if (changes.length) {
    logActivity(`${m.name}: ${changes.join(", ")}`);
    const oldProjected = getProjectedCompletion(CACHED_SCHEDULE);
    const newSchedule = computeSchedule(STATE.milestones, STATE.holidays, PROJECT.start);
    const newProjected = getProjectedCompletion(newSchedule);
    if (oldProjected && newProjected && isoDate(oldProjected) !== isoDate(newProjected)) {
      const delta = calculateBusinessDays(oldProjected, newProjected);
      logActivity(`Schedule impact: ${delta > 0 ? "+" : ""}${delta} business days — projected completion moved from ${fmtDate(oldProjected)} to ${fmtDate(newProjected)}`);
    }
  } else {
    logActivity(`${m.name}: notes updated`);
  }

  closeModal();
  firebaseSave();
  renderAll();
}

function clearManualStart() {
  const id = STATE.openMilestoneId;
  const m = STATE.milestones.find(x => x.id === id);
  m.manualStart = null;
  STATE.lastUpdated = new Date();
  logActivity(`${m.name}: start date reset to dependency-calculated date`);
  firebaseSave();
  renderAll();
  openModal(id);
}

/* ============================================================
   MILESTONE MODAL — "Trades" tab (read-mostly link view)
   ============================================================ */

function renderMilestoneTradesTab(m) {
  const el = document.getElementById("financialsTabContent");
  const linked = tradesForMilestone(m.id);
  const rows = linked.length
    ? linked.map(t => {
        const status = tradePaymentStatus(t);
        return `
      <div class="fin-list-item clickable-item" data-taction="open-linked" data-tid="${t.tradeId}">
        <div class="fin-list-item-top">
          <strong>${escapeHtml(t.tradeName)}</strong>
          <span class="status-pill ${statusPillClass(status)}">${status}</span>
        </div>
        <div class="fin-list-item-meta">${escapeHtml(t.vendor) || "No vendor set"} · ${fmtMoney(revisedContractValue(t))} contract</div>
      </div>`;
      }).join("")
    : `<div class="empty-note">No trades linked to this milestone yet.</div>`;

  el.innerHTML = `
    <div class="fin-section">
      <div class="fin-section-title">Trades linked to "${escapeHtml(m.name)}"</div>
      ${rows}
      <button class="btn primary" style="margin-top:8px;" data-taction="add-linked">+ Add Trade for ${escapeHtml(m.name)}</button>
      <div class="fin-note">Trades are managed independently in the Trade Costs section below the timeline — this is just a quick link. Adding or removing a trade here never changes this milestone's schedule.</div>
    </div>
  `;
  el.onclick = (e) => {
    const item = e.target.closest("[data-taction]");
    if (!item) return;
    if (item.dataset.taction === "open-linked") openTradeModal(item.dataset.tid);
    if (item.dataset.taction === "add-linked") { closeModal(); openTradeModal(null, m.id); }
  };
}

/* ============================================================
   TRADE MODAL — add / edit / archive / delete a trade
   ============================================================ */

let TRADE_REVEAL = false; // reserved for future sensitive-field masking on trades

function openTradeModal(tradeId, presetMilestoneId) {
  STATE.openTradeId = tradeId || null;
  const overlay = document.getElementById("tradeModalOverlay");
  overlay.classList.add("show");
  renderTradeModal(presetMilestoneId);
}

function closeTradeModal() {
  document.getElementById("tradeModalOverlay").classList.remove("show");
  STATE.openTradeId = null;
}

function getOpenTrade() {
  return STATE.trades.find(t => t.tradeId === STATE.openTradeId) || null;
}

function milestoneOptionsHtml(selectedId) {
  let opts = `<option value="">— No milestone —</option>`;
  STATE.milestones.forEach(m => {
    opts += `<option value="${m.id}" ${selectedId === m.id ? "selected" : ""}>${escapeHtml(m.name)}</option>`;
  });
  return opts;
}

function renderTradeModal(presetMilestoneId) {
  const t = getOpenTrade();
  const isNew = !t;
  const body = document.getElementById("tradeModalBody");
  const title = document.getElementById("tradeModalTitle");
  title.textContent = isNew ? "Add Trade" : t.tradeName;

  const changeOrdersHtml = t && (t.changeOrders || []).length
    ? t.changeOrders.map(c => `
      <div class="fin-list-item">
        <div class="fin-list-item-top">
          <strong>${escapeHtml(c.description) || "Change order"}</strong>
          <span class="status-pill ${statusPillClass(c.status)}">${c.status}</span>
        </div>
        <div class="fin-list-item-meta">${c.date ? fmtDate(parseISO(c.date)) : "No date"} · ${fmtMoney(c.amount)}${c.approvedBy ? " · Approved by " + escapeHtml(c.approvedBy) : ""}</div>
        <div class="fin-list-actions">
          <select data-caction="co-status" data-id="${c.changeOrderId}">
            <option value="Pending" ${c.status === "Pending" ? "selected" : ""}>Pending</option>
            <option value="Approved" ${c.status === "Approved" ? "selected" : ""}>Approved</option>
            <option value="Rejected" ${c.status === "Rejected" ? "selected" : ""}>Rejected</option>
          </select>
          <button class="danger" data-caction="co-delete" data-id="${c.changeOrderId}">Delete</button>
        </div>
      </div>`).join("")
    : `<div class="empty-note">No change orders yet.</div>`;

  const invoicesHtml = t && (t.invoices || []).length
    ? t.invoices.map(inv => {
        const bal = invoiceBalance(t, inv);
        const overdue = invoiceOverdue(t, inv);
        const dispStatus = overdue ? "Overdue" : (bal <= 0 ? "Paid" : (bal < inv.total ? "Partially Paid" : "Unpaid"));
        const hasLocalFile = !!LOCAL_INVOICE_FILES[inv.invoiceId];
        return `
      <div class="fin-list-item">
        <div class="fin-list-item-top">
          <strong>${escapeHtml(inv.invoiceNumber) || "Invoice"}</strong>
          <span class="status-pill ${statusPillClass(dispStatus)}">${dispStatus}</span>
        </div>
        <div class="fin-list-item-meta">${escapeHtml(inv.vendor) || t.vendor || ""} · ${fmtMoney(inv.total)}${inv.dueDate ? " · Due " + fmtDate(parseISO(inv.dueDate)) : ""} · Balance ${fmtMoney(bal)}</div>
        <div class="fin-list-item-meta">${inv.fileName ? "📎 " + escapeHtml(inv.fileName) + (hasLocalFile ? "" : " (preview not available in this session)") : "No file attached"}</div>
        <div class="fin-list-actions">
          ${hasLocalFile ? `<button data-caction="inv-view" data-id="${inv.invoiceId}">View</button><button data-caction="inv-download" data-id="${inv.invoiceId}">Download</button>` : ""}
          <button data-caction="inv-attach" data-id="${inv.invoiceId}">${inv.fileName ? "Replace file" : "Attach PDF"}</button>
          <button class="danger" data-caction="inv-delete" data-id="${inv.invoiceId}">Delete</button>
        </div>
      </div>`;
      }).join("")
    : `<div class="empty-note">No invoices yet.</div>`;

  const paymentsHtml = t && (t.payments || []).length
    ? t.payments.map(p => {
        const inv = (t.invoices || []).find(i => i.invoiceId === p.invoiceId);
        return `
      <div class="fin-list-item">
        <div class="fin-list-item-top">
          <strong>${fmtMoney(p.amount)}</strong>
          <span class="fin-list-item-meta">${p.date ? fmtDate(parseISO(p.date)) : "No date"}</span>
        </div>
        <div class="fin-list-item-meta">${inv ? "Applied to " + escapeHtml(inv.invoiceNumber) : "Not linked to an invoice"}${p.method ? " · " + escapeHtml(p.method) : ""}${p.reference ? " · Ref " + escapeHtml(p.reference) : ""}</div>
        ${p.notes ? `<div class="fin-list-item-meta">${escapeHtml(p.notes)}</div>` : ""}
        <div class="fin-list-actions">
          <button class="danger" data-caction="pay-delete" data-id="${p.paymentId}">Delete</button>
        </div>
      </div>`;
      }).join("")
    : `<div class="empty-note">No payments recorded yet.</div>`;

  const invoiceOptionsForPayment = t
    ? `<option value="">— Not linked to an invoice —</option>` + t.invoices.map(inv => `<option value="${inv.invoiceId}">${escapeHtml(inv.invoiceNumber)} (${fmtMoney(invoiceBalance(t, inv))} owing)</option>`).join("")
    : "";

  const summaryBlock = t ? `
    <div class="fin-grid">
      <div class="fin-stat"><div class="fin-stat-label">Revised Contract</div><div class="fin-stat-val">${fmtMoney(revisedContractValue(t))}</div></div>
      <div class="fin-stat"><div class="fin-stat-label">Total Invoiced</div><div class="fin-stat-val">${fmtMoney(tradeTotalInvoiced(t))}</div></div>
      <div class="fin-stat"><div class="fin-stat-label">Total Paid</div><div class="fin-stat-val">${fmtMoney(tradeTotalPaid(t))}</div></div>
      <div class="fin-stat"><div class="fin-stat-label">Outstanding</div><div class="fin-stat-val">${fmtMoney(tradeOutstanding(t))}</div></div>
    </div>
    <div class="fin-stat" style="margin-bottom:16px;"><div class="fin-stat-label">Payment Status</div><div class="fin-stat-val"><span class="status-pill ${statusPillClass(tradePaymentStatus(t))}">${tradePaymentStatus(t)}</span></div></div>
  ` : "";

  body.innerHTML = `
    <div class="fin-section">
      <div class="fin-section-title">Trade Details ${t ? `<span class="trade-id-tag">${t.tradeId}</span>` : ""}</div>
      <div class="field"><label>Trade Name *</label><input type="text" id="tName" value="${t ? escapeHtml(t.tradeName) : ""}" placeholder="e.g. Roofing"></div>
      <div class="field-row">
        <div class="field"><label>Vendor / Contractor</label><input type="text" id="tVendor" value="${t ? escapeHtml(t.vendor) : ""}"></div>
        <div class="field"><label>Scope of Work</label><input type="text" id="tScope" value="${t ? escapeHtml(t.scope) : ""}"></div>
      </div>
      <div class="field"><label>Milestone</label><select id="tMilestone">${milestoneOptionsHtml(t ? t.milestoneId : (presetMilestoneId ?? null))}</select></div>
      <div class="field-row">
        <div class="field"><label>Contract Amount</label><input type="number" id="tContract" min="0" step="1" value="${t ? t.contractAmount : ""}"></div>
        <div class="field"><label>HST</label><input type="number" id="tHst" min="0" step="1" value="${t ? t.hst : ""}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Payment Terms</label><input type="text" id="tTerms" value="${t ? escapeHtml(t.paymentTerms) : ""}" placeholder="e.g. Net 30"></div>
        <div class="field"><label>PO Number</label><input type="text" id="tPo" value="${t ? escapeHtml(t.poNumber) : ""}"></div>
      </div>
      <div class="field">
        <label>Status</label>
        <select id="tWorkStatus">${WORK_STATUS_OPTIONS.map(s => `<option ${t && t.workStatus === s ? "selected" : ""}>${s}</option>`).join("")}</select>
      </div>
      <div class="field"><label>Notes</label><textarea id="tNotes">${t ? escapeHtml(t.notes) : ""}</textarea></div>
      <div class="modal-error" id="tError"></div>
      <button class="btn primary" data-taction="save">${isNew ? "Save Trade" : "Save Changes"}</button>
    </div>

    ${t ? `
    <div class="fin-section">
      ${summaryBlock}
    </div>

    <div class="fin-section">
      <div class="fin-section-title">Change Orders</div>
      ${changeOrdersHtml}
      <div class="fin-add-form">
        <div class="field"><label>Description</label><input type="text" id="coDescription"></div>
        <div class="field-row">
          <div class="field"><label>Date</label><input type="date" id="coDate"></div>
          <div class="field"><label>Amount</label><input type="number" id="coAmount" min="0" step="1"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Approved By</label><input type="text" id="coApprovedBy"></div>
          <div class="field"><label>Status</label><select id="coStatus"><option>Pending</option><option>Approved</option><option>Rejected</option></select></div>
        </div>
        <div class="field"><label>Notes</label><textarea id="coNotes"></textarea></div>
        <button class="btn" data-taction="co-add">Add Change Order</button>
      </div>
    </div>

    <div class="fin-section">
      <div class="fin-section-title">Invoices</div>
      ${invoicesHtml}
      <div class="fin-add-form">
        <div class="fin-dropzone" id="invDropzone">
          Drag &amp; drop a PDF here, or <span style="color:var(--accent); font-weight:600;">browse files</span>
          <input type="file" id="invFileInput" accept="application/pdf" style="display:none;">
        </div>
        <div class="fin-note" id="invFileStatus" style="display:none;"></div>
        <div class="field-row">
          <div class="field"><label>Invoice Number</label><input type="text" id="invNumber"></div>
          <div class="field"><label>Vendor</label><input type="text" id="invVendor" value="${escapeHtml(t.vendor)}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Invoice Date</label><input type="date" id="invDate"></div>
          <div class="field"><label>Due Date</label><input type="date" id="invDue"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Subtotal</label><input type="number" id="invSubtotal" min="0" step="1"></div>
          <div class="field"><label>HST</label><input type="number" id="invHst" min="0" step="1"></div>
        </div>
        <div class="field"><label>Total (subtotal + HST)</label><div class="dep-static" id="invTotalDisplay">$0</div></div>
        <div class="field"><label>Notes</label><textarea id="invNotes"></textarea></div>
        <button class="btn" data-taction="inv-add">Add Invoice</button>
      </div>
    </div>

    <div class="fin-section">
      <div class="fin-section-title">Payments</div>
      ${paymentsHtml}
      <div class="fin-add-form">
        <div class="field-row">
          <div class="field"><label>Amount</label><input type="number" id="payAmount" min="0" step="1"></div>
          <div class="field"><label>Date</label><input type="date" id="payDate"></div>
        </div>
        <div class="field"><label>Applies to Invoice</label><select id="payInvoice">${invoiceOptionsForPayment}</select></div>
        <div class="field-row">
          <div class="field"><label>Payment Method</label><input type="text" id="payMethod" placeholder="e.g. E-transfer"></div>
          <div class="field"><label>Payment Reference</label><input type="text" id="payReference"></div>
        </div>
        <div class="field"><label>Notes</label><textarea id="payNotes"></textarea></div>
        ${t.invoices.length === 0 ? `<div class="fin-note">This trade has no invoices yet — you can still record a payment, but consider adding the invoice first for a full paper trail.</div>` : ""}
        <button class="btn" data-taction="pay-add">Add Payment</button>
      </div>
    </div>

    <div class="fin-section">
      <div class="fin-section-title">Trade Status</div>
      ${t.active
        ? `<button class="btn danger" data-taction="archive-open">Archive Trade</button>`
        : `<button class="btn primary" data-taction="restore-open">Restore Trade</button>`}
      <button class="link-btn" style="margin-top:10px;" data-taction="delete-open">Permanently delete this trade instead</button>
    </div>
    ` : ""}
  `;

  wireTradeModalInputs(t);
}

function wireTradeModalInputs(t) {
  const body = document.getElementById("tradeModalBody");
  body.onclick = (e) => handleTradeModalClick(e);
  body.onchange = (e) => handleTradeModalChange(e);

  if (!t) return; // add-form only, no invoice total calc / dropzone yet

  const subtotalEl = document.getElementById("invSubtotal");
  const hstEl = document.getElementById("invHst");
  const totalDisplay = document.getElementById("invTotalDisplay");
  const updateTotal = () => {
    const val = (Number(subtotalEl.value) || 0) + (Number(hstEl.value) || 0);
    totalDisplay.textContent = fmtMoney(val);
  };
  subtotalEl.addEventListener("input", updateTotal);
  hstEl.addEventListener("input", updateTotal);

  const dropzone = document.getElementById("invDropzone");
  const fileInput = document.getElementById("invFileInput");
  const fileStatus = document.getElementById("invFileStatus");
  const showStaged = () => {
    if (PENDING_INVOICE_FILE) {
      fileStatus.style.display = "block";
      fileStatus.textContent = `Staged: ${PENDING_INVOICE_FILE.file.name} — will attach when you click "Add Invoice."`;
    } else {
      fileStatus.style.display = "none";
    }
  };
  const stageFile = (file) => {
    if (!file) return;
    if (file.type !== "application/pdf") { alert("Please choose a PDF file."); return; }
    if (PENDING_INVOICE_FILE) URL.revokeObjectURL(PENDING_INVOICE_FILE.objectUrl);
    PENDING_INVOICE_FILE = { file, objectUrl: URL.createObjectURL(file) };
    showStaged();
  };
  dropzone.onclick = () => fileInput.click();
  fileInput.onchange = (e) => stageFile(e.target.files[0]);
  dropzone.ondragover = (e) => { e.preventDefault(); dropzone.classList.add("drag-over"); };
  dropzone.ondragleave = () => dropzone.classList.remove("drag-over");
  dropzone.ondrop = (e) => { e.preventDefault(); dropzone.classList.remove("drag-over"); stageFile(e.dataTransfer.files[0]); };
  showStaged();
}

let PENDING_INVOICE_FILE = null;
let PENDING_ATTACH_INVOICE_ID = null; // when replacing/attaching a file to an existing invoice

function handleTradeModalClick(e) {
  const btn = e.target.closest("[data-taction], [data-caction]");
  if (!btn) return;
  const taction = btn.dataset.taction;
  const caction = btn.dataset.caction;
  const id = btn.dataset.id;

  if (taction === "save") return saveTradeModal();
  if (taction === "co-add") return addChangeOrder();
  if (taction === "inv-add") return addInvoice();
  if (taction === "pay-add") return addPayment();
  if (taction === "archive-open") return archiveTradePrompt(STATE.openTradeId);
  if (taction === "restore-open") return restoreTrade(STATE.openTradeId);
  if (taction === "delete-open") return deleteTradePrompt(STATE.openTradeId);

  if (caction === "co-delete") return deleteChangeOrder(id);
  if (caction === "inv-delete") return deleteInvoice(id);
  if (caction === "inv-view") return viewInvoiceFile(id);
  if (caction === "inv-download") return downloadInvoiceFile(id);
  if (caction === "inv-attach") return attachInvoiceFile(id);
  if (caction === "pay-delete") return deletePayment(id);
}

function handleTradeModalChange(e) {
  const el = e.target;
  if (el.dataset.caction === "co-status") {
    const t = getOpenTrade();
    const c = t.changeOrders.find(x => x.changeOrderId === el.dataset.id);
    if (!c) return;
    const old = c.status;
    c.status = el.value;
    STATE.lastUpdated = new Date();
    logActivity(`Trade cost updated: ${t.tradeName} (change order "${c.description || c.changeOrderId}" ${old} → ${c.status})`);
    firebaseSave();
    renderAll();
    renderTradeModal();
  }
  if (el.id === "invFileInputHidden") {
    // used by attachInvoiceFile flow
    const file = el.files[0];
    if (!file) return;
    if (file.type !== "application/pdf") { alert("Please choose a PDF file."); return; }
    const t = getOpenTrade();
    const inv = t.invoices.find(x => x.invoiceId === PENDING_ATTACH_INVOICE_ID);
    if (!inv) return;
    if (LOCAL_INVOICE_FILES[inv.invoiceId]) URL.revokeObjectURL(LOCAL_INVOICE_FILES[inv.invoiceId]);
    LOCAL_INVOICE_FILES[inv.invoiceId] = URL.createObjectURL(file);
    inv.fileName = file.name;
    STATE.lastUpdated = new Date();
    logActivity(`Invoice attached to: ${t.tradeName} (${inv.invoiceNumber})`);
    firebaseSave();
    renderAll();
    renderTradeModal();
    alert("Invoice uploaded successfully.");
  }
}

function saveTradeModal() {
  const errEl = document.getElementById("tError");
  const tradeName = document.getElementById("tName").value.trim();
  if (!tradeName) { errEl.textContent = "Trade Name is required."; return; }

  const vendor = document.getElementById("tVendor").value.trim();
  const scope = document.getElementById("tScope").value.trim();
  const milestoneIdRaw = document.getElementById("tMilestone").value;
  const milestoneId = milestoneIdRaw ? Number(milestoneIdRaw) : null;
  const contractAmount = Number(document.getElementById("tContract").value) || 0;
  const hst = Number(document.getElementById("tHst").value) || 0;
  const paymentTerms = document.getElementById("tTerms").value.trim();
  const poNumber = document.getElementById("tPo").value.trim();
  const workStatus = document.getElementById("tWorkStatus").value;
  const notes = document.getElementById("tNotes").value.trim();

  let t = getOpenTrade();
  const now = new Date().toISOString();

  if (!t) {
    t = {
      tradeId: nextTradeId(), tradeName, vendor, scope, milestoneId,
      contractAmount, hst, workStatus, paymentTerms, poNumber, notes,
      active: true, createdAt: now, updatedAt: now,
      changeOrders: [], invoices: [], payments: [],
    };
    STATE.trades.push(t);
    logActivity(`New trade added: ${tradeName}`);
    STATE.openTradeId = t.tradeId;
  } else {
    const nameChanged = t.tradeName !== tradeName;
    const oldName = t.tradeName;
    t.tradeName = tradeName; t.vendor = vendor; t.scope = scope; t.milestoneId = milestoneId;
    t.contractAmount = contractAmount; t.hst = hst; t.paymentTerms = paymentTerms;
    t.poNumber = poNumber; t.workStatus = workStatus; t.notes = notes;
    t.updatedAt = now;
    if (nameChanged) logActivity(`Trade name changed: ${oldName} → ${tradeName}`);
    else logActivity(`Trade cost updated: ${tradeName}`);
  }

  STATE.lastUpdated = new Date();
  firebaseSave();
  renderAll();
  renderTradeModal();
}

function addChangeOrder() {
  const t = getOpenTrade();
  const description = document.getElementById("coDescription").value.trim();
  const date = document.getElementById("coDate").value || null;
  const amount = Number(document.getElementById("coAmount").value) || 0;
  const approvedBy = document.getElementById("coApprovedBy").value.trim();
  const status = document.getElementById("coStatus").value;
  const notes = document.getElementById("coNotes").value.trim();
  if (!description) { alert("Enter a description for the change order."); return; }
  t.changeOrders.push({ changeOrderId: nextFinId(), description, date, amount, approvedBy, status, notes });
  t.updatedAt = new Date().toISOString();
  STATE.lastUpdated = new Date();
  logActivity(`Trade cost updated: ${t.tradeName} (change order added — ${description}, ${fmtMoney(amount)})`);
  firebaseSave();
  renderAll();
  renderTradeModal();
}

function deleteChangeOrder(coId) {
  const t = getOpenTrade();
  const c = t.changeOrders.find(x => x.changeOrderId === coId);
  if (!c) return;
  if (!confirm(`Delete change order "${c.description}"?`)) return;
  t.changeOrders = t.changeOrders.filter(x => x.changeOrderId !== coId);
  t.updatedAt = new Date().toISOString();
  STATE.lastUpdated = new Date();
  logActivity(`Trade cost updated: ${t.tradeName} (change order deleted — ${c.description})`);
  firebaseSave();
  renderAll();
  renderTradeModal();
}

function addInvoice() {
  const t = getOpenTrade();
  const invoiceNumber = document.getElementById("invNumber").value.trim();
  const vendor = document.getElementById("invVendor").value.trim();
  const invoiceDate = document.getElementById("invDate").value || null;
  const dueDate = document.getElementById("invDue").value || null;
  const subtotal = Number(document.getElementById("invSubtotal").value) || 0;
  const hst = Number(document.getElementById("invHst").value) || 0;
  const total = subtotal + hst;
  const notes = document.getElementById("invNotes").value.trim();
  if (!invoiceNumber) { alert("Enter an invoice number."); return; }
  if (total <= 0) { alert("Invoice total must be greater than $0."); return; }

  const invoiceId = nextFinId();
  const fileName = PENDING_INVOICE_FILE ? PENDING_INVOICE_FILE.file.name : "";
  if (PENDING_INVOICE_FILE) {
    LOCAL_INVOICE_FILES[invoiceId] = PENDING_INVOICE_FILE.objectUrl;
    PENDING_INVOICE_FILE = null;
  }
  t.invoices.push({ invoiceId, invoiceNumber, vendor, invoiceDate, dueDate, subtotal, hst, total, fileName, notes });
  t.updatedAt = new Date().toISOString();
  STATE.lastUpdated = new Date();
  logActivity(`Invoice attached to: ${t.tradeName} (${invoiceNumber}, ${fmtMoney(total)})`);
  firebaseSave();
  renderAll();
  renderTradeModal();
  if (fileName) alert("Invoice uploaded successfully.");
}

function deleteInvoice(invId) {
  const t = getOpenTrade();
  const inv = t.invoices.find(x => x.invoiceId === invId);
  if (!inv) return;
  const linkedPayments = t.payments.filter(p => p.invoiceId === invId).length;
  const warn = linkedPayments ? ` This invoice has ${linkedPayments} payment(s) recorded against it — they will stay on the trade but become unlinked.` : "";
  if (!confirm(`Delete invoice "${inv.invoiceNumber}"?${warn}`)) return;
  if (LOCAL_INVOICE_FILES[invId]) { URL.revokeObjectURL(LOCAL_INVOICE_FILES[invId]); delete LOCAL_INVOICE_FILES[invId]; }
  t.invoices = t.invoices.filter(x => x.invoiceId !== invId);
  t.payments.forEach(p => { if (p.invoiceId === invId) p.invoiceId = null; });
  t.updatedAt = new Date().toISOString();
  STATE.lastUpdated = new Date();
  logActivity(`Trade cost updated: ${t.tradeName} (invoice deleted — ${inv.invoiceNumber})`);
  firebaseSave();
  renderAll();
  renderTradeModal();
}

function attachInvoiceFile(invId) {
  PENDING_ATTACH_INVOICE_ID = invId;
  let hidden = document.getElementById("invFileInputHidden");
  if (!hidden) {
    hidden = document.createElement("input");
    hidden.type = "file";
    hidden.accept = "application/pdf";
    hidden.id = "invFileInputHidden";
    hidden.style.display = "none";
    document.getElementById("tradeModalBody").appendChild(hidden);
    hidden.addEventListener("change", handleTradeModalChange);
  }
  hidden.click();
}

function viewInvoiceFile(invId) {
  const url = LOCAL_INVOICE_FILES[invId];
  if (!url) { alert("This PDF is only available in the browser session it was uploaded in. Real file storage (OneDrive/SharePoint/Supabase) is needed to make invoices viewable everywhere."); return; }
  window.open(url, "_blank");
}

function downloadInvoiceFile(invId) {
  const t = getOpenTrade();
  const inv = t.invoices.find(x => x.invoiceId === invId);
  const url = LOCAL_INVOICE_FILES[invId];
  if (!url || !inv) { alert("This PDF is only available in the browser session it was uploaded in."); return; }
  const a = document.createElement("a");
  a.href = url; a.download = inv.fileName || "invoice.pdf";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

function addPayment() {
  const t = getOpenTrade();
  const amount = Number(document.getElementById("payAmount").value) || 0;
  const date = document.getElementById("payDate").value || null;
  const invoiceIdRaw = document.getElementById("payInvoice").value;
  const invoiceId = invoiceIdRaw ? Number(invoiceIdRaw) : null;
  const method = document.getElementById("payMethod").value.trim();
  const reference = document.getElementById("payReference").value.trim();
  const notes = document.getElementById("payNotes").value.trim();
  if (amount <= 0) { alert("Payment amount must be greater than $0."); return; }
  if (!invoiceId && t.invoices.length > 0) {
    if (!confirm("This payment isn't linked to a specific invoice. Add it anyway?")) return;
  }
  t.payments.push({ paymentId: nextFinId(), invoiceId, amount, date, method, reference, notes });
  t.updatedAt = new Date().toISOString();
  STATE.lastUpdated = new Date();
  logActivity(`Payment added to: ${t.tradeName} (${fmtMoney(amount)})`);
  firebaseSave();
  renderAll();
  renderTradeModal();
}

function deletePayment(payId) {
  const t = getOpenTrade();
  const p = t.payments.find(x => x.paymentId === payId);
  if (!p) return;
  if (!confirm(`Delete this ${fmtMoney(p.amount)} payment?`)) return;
  t.payments = t.payments.filter(x => x.paymentId !== payId);
  t.updatedAt = new Date().toISOString();
  STATE.lastUpdated = new Date();
  logActivity(`Trade cost updated: ${t.tradeName} (payment deleted — ${fmtMoney(p.amount)})`);
  firebaseSave();
  renderAll();
  renderTradeModal();
}

/* ============================================================
   ARCHIVE / RESTORE / DELETE TRADE
   ============================================================ */

function archiveTradePrompt(tradeId) {
  const t = STATE.trades.find(x => x.tradeId === tradeId);
  if (!t) return;
  openRemoveTradeModal(t);
}

function deleteTradePrompt(tradeId) {
  const t = STATE.trades.find(x => x.tradeId === tradeId);
  if (!t) return;
  openRemoveTradeModal(t, true);
}

function hasFinancialHistory(t) {
  return (t.invoices || []).length > 0 || (t.payments || []).length > 0 || (t.changeOrders || []).length > 0;
}

function openRemoveTradeModal(t, forceDeleteView) {
  const overlay = document.getElementById("removeTradeOverlay");
  const body = document.getElementById("removeTradeBody");
  overlay.classList.add("show");
  overlay.dataset.tid = t.tradeId;

  const hasHistory = hasFinancialHistory(t);
  const showDelete = forceDeleteView || !hasHistory;

  const summary = `
    <div class="fin-stat" style="margin-bottom:14px;">
      <div class="fin-stat-label">Trade</div>
      <div class="fin-stat-val" style="font-size:15px;">${escapeHtml(t.tradeName)}</div>
    </div>
    <div class="fin-grid">
      <div class="fin-stat"><div class="fin-stat-label">Contract Amount</div><div class="fin-stat-val">${fmtMoney(revisedContractValue(t))}</div></div>
      <div class="fin-stat"><div class="fin-stat-label">Invoices</div><div class="fin-stat-val">${(t.invoices || []).length}</div></div>
      <div class="fin-stat"><div class="fin-stat-label">Payments</div><div class="fin-stat-val">${(t.payments || []).length}</div></div>
      <div class="fin-stat"><div class="fin-stat-label">Change Orders</div><div class="fin-stat-val">${(t.changeOrders || []).length}</div></div>
    </div>
  `;

  if (!showDelete) {
    body.innerHTML = `
      <p>Remove this trade?</p>
      ${summary}
      <div class="fin-note">This trade has financial history, so it will be <strong>archived</strong> instead of deleted — its invoices, payments, and change orders stay fully intact and accessible, and you can restore it any time from the "Archived" filter.</div>
      <div class="modal-foot" style="padding:16px 0 0; border-top:none;">
        <button class="btn" data-raction="cancel">Cancel</button>
        <button class="btn primary" data-raction="archive">Archive Trade</button>
      </div>
    `;
  } else {
    body.innerHTML = `
      <p>${hasHistory ? `This trade has ${(t.invoices||[]).length} invoice(s) and ${(t.payments||[]).length} payment(s). Permanently deleting it will remove its associated records.` : "Remove this trade permanently? This cannot be undone."}</p>
      ${summary}
      ${hasHistory ? `
      <div class="field">
        <label>Type DELETE to confirm permanent deletion</label>
        <input type="text" id="deleteConfirmInput" placeholder="DELETE">
      </div>` : ""}
      <div class="modal-foot" style="padding:16px 0 0; border-top:none;">
        <button class="btn" data-raction="cancel">Cancel</button>
        ${hasHistory ? `<button class="btn" data-raction="archive">Archive Instead</button>` : ""}
        <button class="btn danger" data-raction="delete-confirm">Permanently Delete</button>
      </div>
    `;
  }

  body.onclick = (e) => {
    const btn = e.target.closest("[data-raction]");
    if (!btn) return;
    const action = btn.dataset.raction;
    if (action === "cancel") return closeRemoveTradeModal();
    if (action === "archive") return doArchiveTrade(t.tradeId);
    if (action === "delete-confirm") {
      if (hasHistory) {
        const input = document.getElementById("deleteConfirmInput");
        if (!input || input.value.trim().toUpperCase() !== "DELETE") {
          alert('Type "DELETE" exactly to confirm permanent deletion.');
          return;
        }
      }
      return doDeleteTrade(t.tradeId);
    }
  };
}

function closeRemoveTradeModal() {
  document.getElementById("removeTradeOverlay").classList.remove("show");
}

function doArchiveTrade(tradeId) {
  const t = STATE.trades.find(x => x.tradeId === tradeId);
  if (!t) return;
  t.active = false;
  t.updatedAt = new Date().toISOString();
  STATE.lastUpdated = new Date();
  logActivity(`Trade archived: ${t.tradeName}`);
  firebaseSave();
  closeRemoveTradeModal();
  closeTradeModal();
  renderAll();
}

function doDeleteTrade(tradeId) {
  const t = STATE.trades.find(x => x.tradeId === tradeId);
  if (!t) return;
  (t.invoices || []).forEach(inv => {
    if (LOCAL_INVOICE_FILES[inv.invoiceId]) { URL.revokeObjectURL(LOCAL_INVOICE_FILES[inv.invoiceId]); delete LOCAL_INVOICE_FILES[inv.invoiceId]; }
  });
  STATE.trades = STATE.trades.filter(x => x.tradeId !== tradeId);
  STATE.lastUpdated = new Date();
  logActivity(`Trade permanently deleted: ${t.tradeName}`);
  firebaseSave();
  closeRemoveTradeModal();
  closeTradeModal();
  renderAll();
}

function restoreTrade(tradeId) {
  const t = STATE.trades.find(x => x.tradeId === tradeId);
  if (!t) return;
  t.active = true;
  t.updatedAt = new Date().toISOString();
  STATE.lastUpdated = new Date();
  logActivity(`Trade restored: ${t.tradeName}`);
  firebaseSave();
  renderAll();
  if (STATE.openTradeId === tradeId) renderTradeModal();
}

function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ============================================================
   IMPORT / EXPORT
   ============================================================ */

function exportCSV() {
  const schedule = CACHED_SCHEDULE;
  const header = ["ID", "Milestone", "Start Date", "Duration (Business Days)", "Finish Date", "Status", "Progress %", "Trade", "Dependency", "Notes"];
  const rows = [header];
  STATE.milestones.forEach(m => {
    const sched = schedule[m.id];
    rows.push([
      m.id,
      m.name,
      sched ? isoDate(sched.start) : "",
      m.duration,
      sched ? isoDate(sched.finish) : "",
      m.status,
      m.progress,
      m.trade,
      m.dependency.join(";"),
      m.notes,
    ]);
  });
  const csv = rows.map(r => r.map(csvEscape).join(",")).join("\r\n");
  downloadFile(csv, "43-munn-schedule.csv", "text/csv");
  logActivity("Schedule exported to CSV.");
}

function exportTradeFinancialsCSV() {
  const header = ["Trade ID", "Trade Name", "Vendor", "Scope", "Milestone", "Contract Amount", "HST",
    "Approved Change Orders", "Revised Contract", "Total Invoiced", "Total Paid", "Outstanding",
    "Payment Status", "Trade Status", "PO Number", "Payment Terms", "Notes"];
  const rows = [header];
  STATE.trades.forEach(t => {
    rows.push([
      t.tradeId, t.tradeName, t.vendor, t.scope, milestoneName(t.milestoneId),
      t.contractAmount || 0, t.hst || 0,
      approvedChangeOrderTotal(t),
      revisedContractValue(t),
      tradeTotalInvoiced(t),
      tradeTotalPaid(t),
      tradeOutstanding(t),
      tradePaymentStatus(t),
      t.active ? "Active" : "Archived",
      t.poNumber || "",
      t.paymentTerms || "",
      t.notes || "",
    ]);
  });
  const csv = rows.map(r => r.map(csvEscape).join(",")).join("\r\n");
  downloadFile(csv, "43-munn-trade-financials.csv", "text/csv");
  logActivity("Trade financials exported to CSV.");
}

function csvEscape(val) {
  const s = String(val ?? "");
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else field += c;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function importCSVFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const rows = parseCSV(reader.result);
      if (rows.length < 2) throw new Error("File appears to be empty.");
      const body = rows.slice(1).filter(r => r.length >= 10 && r[0] !== "");
      const seen = new Set();
      const newMilestones = body.map(r => {
        const id = parseInt(r[0], 10);
        const duration = parseInt(r[3], 10);
        const progress = parseInt(r[6], 10);
        const status = r[5].trim();
        if (isNaN(id)) throw new Error(`Invalid milestone ID: "${r[0]}"`);
        if (seen.has(id)) throw new Error(`Duplicate milestone ID: ${id}`);
        seen.add(id);
        if (isNaN(duration) || duration < 1) throw new Error(`Invalid duration for milestone #${id}`);
        if (isNaN(progress) || progress < 0 || progress > 100) throw new Error(`Invalid progress for milestone #${id}`);
        if (!STATUS_OPTIONS.includes(status)) throw new Error(`Invalid status "${status}" for milestone #${id}. Must be one of: ${STATUS_OPTIONS.join(", ")}`);
        const dependency = r[8].trim() ? r[8].split(";").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)) : [];
        // Preserve any existing financial data for this milestone ID — the
        // schedule CSV doesn't carry contract/invoice fields, so re-importing
        // a schedule must not wipe out financials already entered in the app.
        const existing = STATE.milestones.find(x => x.id === id);
        return {
          id, name: r[1].trim(), duration, dependency, manualStart: null,
          status, progress, trade: r[7].trim(), notes: r[9] ? r[9].trim() : "",
          contractPrice: existing ? existing.contractPrice : 0,
          changeOrders: existing ? existing.changeOrders : [],
          invoices: existing ? existing.invoices : [],
          paymentDetails: existing ? existing.paymentDetails : sanitizePaymentDetails({ vendorName: r[7].trim() }),
        };
      });
      // validate dependencies reference known ids
      const ids = new Set(newMilestones.map(m => m.id));
      newMilestones.forEach(m => m.dependency.forEach(d => {
        if (!ids.has(d)) throw new Error(`Milestone #${m.id} (${m.name}) references unknown dependency #${d}`);
      }));

      STATE.milestones = newMilestones;
      STATE.lastUpdated = new Date();
      STATE.statusFilter = "All";
      logActivity(`Schedule imported from CSV — ${newMilestones.length} milestones loaded.`);
      firebaseSave();
      renderAll();
      alert(`Import successful: ${newMilestones.length} milestones loaded.`);
    } catch (err) {
      alert("Import failed: " + err.message);
    }
  };
  reader.readAsText(file);
}

/* ============================================================
   RESET
   ============================================================ */

function resetSchedule() {
  if (!confirm("Reset the entire schedule AND all trades (contracts, change orders, invoices, payments) to the original 43 Munn baseline? This will discard everything entered this session and cannot be undone.")) return;
  STATE.milestones = deepClone(BASELINE_MILESTONES);
  STATE.trades = deepClone(BASELINE_TRADES);
  STATE.holidays = deepClone(DEFAULT_HOLIDAYS);
  STATE.statusFilter = "All";
  STATE.tradeFilter = "active";
  STATE.activityPage = 1;
  Object.keys(LOCAL_INVOICE_FILES).forEach(k => { URL.revokeObjectURL(LOCAL_INVOICE_FILES[k]); delete LOCAL_INVOICE_FILES[k]; });
  STATE.lastUpdated = new Date();
  logActivity("Schedule reset to original baseline.");
  firebaseSave();
  renderAll();
}

/* ============================================================
   HOLIDAYS UI
   ============================================================ */

function addHoliday() {
  const dateInput = document.getElementById("newHolidayDate");
  const nameInput = document.getElementById("newHolidayName");
  const date = dateInput.value;
  const name = nameInput.value.trim() || "Statutory Holiday";
  if (!date) { alert("Choose a date first."); return; }
  STATE.holidays.push({ date, name });
  dateInput.value = "";
  nameInput.value = "";
  STATE.lastUpdated = new Date();
  logActivity(`Holiday added: ${name} (${date})`);
  firebaseSave();
  renderAll();
}

/* ============================================================
   INIT
   ============================================================ */

function init() {
  document.getElementById("btnExport").onclick = exportCSV;
  document.getElementById("btnExportFinancials").onclick = exportTradeFinancialsCSV;
  document.getElementById("btnImport").onclick = () => document.getElementById("csvFileInput").click();
  document.getElementById("csvFileInput").onchange = (e) => {
    if (e.target.files[0]) importCSVFile(e.target.files[0]);
    e.target.value = "";
  };
  document.getElementById("btnReset").onclick = resetSchedule;
  document.getElementById("btnAddHoliday").onclick = addHoliday;
  document.getElementById("btnCloseModal").onclick = closeModal;
  document.getElementById("btnCancelModal").onclick = closeModal;
  document.getElementById("btnSaveModal").onclick = saveModal;
  document.getElementById("btnClearManualStart").onclick = clearManualStart;
  document.getElementById("mProgress").oninput = (e) => {
    document.getElementById("mProgressLabel").textContent = e.target.value + "%";
  };
  document.getElementById("modalOverlay").onclick = (e) => {
    if (e.target.id === "modalOverlay") closeModal();
  };
  document.getElementById("btnToggleHolidays").onclick = () => {
    document.getElementById("holidayPanel").classList.toggle("show");
  };
  document.getElementById("tabBtnSchedule").onclick = () => switchModalTab("schedule");
  document.getElementById("tabBtnFinancials").onclick = () => switchModalTab("financials");

  document.getElementById("btnAddTrade").onclick = () => openTradeModal(null);
  document.getElementById("tradeCostTableBody").onclick = handleTradeTableClick;
  document.getElementById("btnCloseTradeModal").onclick = closeTradeModal;
  document.getElementById("btnCancelTradeModal").onclick = closeTradeModal;
  document.getElementById("tradeModalOverlay").onclick = (e) => {
    if (e.target.id === "tradeModalOverlay") closeTradeModal();
  };
  document.getElementById("removeTradeOverlay").onclick = (e) => {
    if (e.target.id === "removeTradeOverlay") closeRemoveTradeModal();
  };
  document.getElementById("btnActivityPrev").onclick = () => { STATE.activityPage--; renderActivity(); };
  document.getElementById("btnActivityNext").onclick = () => { STATE.activityPage++; renderActivity(); };

  renderTradeFilterTabs();
  firebaseListen();
}

document.addEventListener("DOMContentLoaded", init);
