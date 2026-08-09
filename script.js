/* ============================================================
   43 MUNN — SCHEDULE ENGINE + APP
   ============================================================ */

/* ---------- Global mutable state ---------- */
const STATE = {
  milestones: deepClone(BASELINE_MILESTONES),
  holidays: deepClone(DEFAULT_HOLIDAYS),
  activity: [],
  lastUpdated: new Date(),
  statusFilter: "All",
  openMilestoneId: null,
};

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

function firebaseSave() {
  if (typeof db === "undefined") return;
  const payload = {
    milestones: STATE.milestones,
    holidays: STATE.holidays,
    activity: STATE.activity.map(a => ({ text: a.text, time: a.time.toISOString() })),
    lastUpdated: STATE.lastUpdated.toISOString(),
  };
  db.ref("schedule").set(payload);
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
      STATE.holidays = deepClone(DEFAULT_HOLIDAYS);
      STATE.activity = [];
      STATE.lastUpdated = new Date();
      logActivity("Schedule loaded — baseline for 43 Munn, project start Aug 7, 2026.");
      firebaseSave();
      return;
    }
    STATE.milestones = val.milestones || deepClone(BASELINE_MILESTONES);
    STATE.holidays = val.holidays || deepClone(DEFAULT_HOLIDAYS);
    STATE.activity = (val.activity || []).map(a => ({ text: a.text, time: new Date(a.time) }));
    STATE.lastUpdated = val.lastUpdated ? new Date(val.lastUpdated) : new Date();
    FIREBASE_READY = true;
    renderAll();
  });
}

/* ============================================================
   ACTIVITY FEED
   ============================================================ */

function logActivity(text) {
  STATE.activity.unshift({ text, time: new Date() });
  if (STATE.activity.length > 25) STATE.activity.pop();
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
    return;
  }
  STATE.activity.forEach(a => {
    const row = document.createElement("div");
    row.className = "activity-row";
    row.innerHTML = `<span class="activity-dot"></span><span class="activity-text">${a.text}</span><span class="activity-time">${a.time.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>`;
    el.appendChild(row);
  });
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

/* ============================================================
   MODAL — VIEW / EDIT MILESTONE
   ============================================================ */

function openModal(id) {
  STATE.openMilestoneId = id;
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
  document.getElementById("mDependency").textContent = (m.dependency.length
    ? m.dependency.map(id2 => STATE.milestones.find(x => x.id === id2)?.name).filter(Boolean).join(", ")
    : "None — starts at project start");
  document.getElementById("mError").textContent = "";
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
        return {
          id, name: r[1].trim(), duration, dependency, manualStart: null,
          status, progress, trade: r[7].trim(), notes: r[9] ? r[9].trim() : "",
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
  if (!confirm("Reset the entire schedule to the original 43 Munn baseline? This will discard all edits made this session.")) return;
  STATE.milestones = deepClone(BASELINE_MILESTONES);
  STATE.holidays = deepClone(DEFAULT_HOLIDAYS);
  STATE.statusFilter = "All";
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

  firebaseListen();
}

document.addEventListener("DOMContentLoaded", init);
