'use strict';
const VERSION = '0.4.1';

/* ---------- Hilfen ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const todayStr = () => isoDate(new Date());
const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const dayDiff = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000); // b - a in Tagen
const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return isoDate(d); };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const fmt = (n, dec = 0) => Number(n).toLocaleString('de-DE', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtKm = n => fmt(n, n % 1 === 0 ? 0 : (Math.abs(n * 10 % 1) < 1e-9 ? 1 : 2));
const round2 = n => Math.round(n * 100) / 100;
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const dayLabel = s => { const d = parseDate(s); return `${WD[d.getDay()]} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`; };

/* ---------- Speicher (lokal, sync-fähig) ---------- */
// Jeder Eintrag: { id, date, time, pullups, pushups, km, note, updatedAt, deleted }
// updatedAt + deleted erlauben später Last-Write-Wins-Sync mit Firebase.
const KEY = 'sporttracker.v1';
const DEFAULTS = {
  settings: {
    name: 'Challenge 2026',
    start: '2026-11-10',
    end: '2026-12-31',
    goals: { pullups: 7500, pushups: 20000, km: 300 },
    lap: 400,
    presets: [[10, 20, 0], [10, 0, 0], [0, 20, 0], [5, 10, 0], [0, 0, 1], [0, 0, 4]],
    updatedAt: 0,
  },
  entries: {},
  synced: {}, // id -> updatedAt, das zuletzt erfolgreich in die Cloud ging ('settings' für Einstellungen)
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      return { settings: { ...DEFAULTS.settings, ...d.settings, goals: { ...DEFAULTS.settings.goals, ...(d.settings || {}).goals } }, entries: d.entries || {}, synced: d.synced || {} };
    }
  } catch (e) { console.warn('load failed', e); }
  return structuredClone(DEFAULTS);
}
let db = load();
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); }
  catch (e) { toast('Speichern fehlgeschlagen: ' + e.message); }
  window.dispatchEvent(new Event('data-changed'));
}
const live = () => Object.values(db.entries).filter(e => !e.deleted);

function addEntry({ pullups = 0, pushups = 0, km = 0, date, time, note = '' }) {
  const now = new Date();
  const e = {
    id: uid(), date: date || isoDate(now), time: time || hhmm(now),
    pullups: Math.max(0, Math.round(+pullups || 0)), pushups: Math.max(0, Math.round(+pushups || 0)),
    km: Math.max(0, round2(+km || 0)), note: (note || '').trim(), updatedAt: Date.now(), deleted: false,
  };
  if (!e.pullups && !e.pushups && !e.km) return null;
  db.entries[e.id] = e; persist(); return e;
}
function updateEntry(id, patch) { db.entries[id] = { ...db.entries[id], ...patch, updatedAt: Date.now() }; persist(); }
function deleteEntry(id) { updateEntry(id, { deleted: true }); }

/* ---------- Rechnen ---------- */
const EX = [
  { k: 'pullups', name: 'Klimmzüge', short: 'KZ', c: 'var(--pull)', goal: s => s.goals.pullups, f: n => fmt(n) },
  { k: 'pushups', name: 'Liegestütze', short: 'LS', c: 'var(--push)', goal: s => s.goals.pushups, f: n => fmt(n) },
  { k: 'km', name: 'Laufen', short: 'km', c: 'var(--run)', goal: s => s.goals.km, f: n => fmtKm(round2(n)) + ' km' },
];

function byDay() {
  const m = {};
  for (const e of live()) {
    const d = (m[e.date] ||= { pullups: 0, pushups: 0, km: 0, n: 0 });
    d.pullups += e.pullups; d.pushups += e.pushups; d.km += e.km; d.n++;
  }
  return m;
}

function stats() {
  const s = db.settings, t = todayStr(), days = byDay();
  const totalDays = dayDiff(s.start, s.end) + 1;
  const elapsed = Math.min(Math.max(dayDiff(s.start, t) + 1, 1), totalDays); // inkl. heute
  const leftInclToday = Math.max(dayDiff(t, s.end) + 1, 0);
  const leftAfterToday = Math.max(leftInclToday - 1, 0);
  const out = {};
  for (const x of EX) {
    let total = 0, before = 0;
    for (const [d, v] of Object.entries(days)) { total += v[x.k]; if (d < t) before += v[x.k]; }
    const goal = x.goal(s), today = (days[t] || {})[x.k] || 0;
    const remaining = Math.max(goal - total, 0);
    // Tagessoll für heute: was ab heute Morgen noch fehlte, gleichmäßig verteilt
    const perDayFromToday = leftInclToday ? Math.max(goal - before, 0) / leftInclToday : 0;
    const todayLeft = Math.max(perDayFromToday - today, 0);
    // Ab morgen nötig, wenn heute nichts mehr kommt
    const perDayFromTomorrow = leftAfterToday ? remaining / leftAfterToday : remaining;
    const expected = goal * elapsed / totalDays;   // linearer Sollstand bis Ende heute
    const avg = total / elapsed;
    const projected = avg * totalDays;
    out[x.k] = { goal, total, today, remaining, perDayFromToday, todayLeft, perDayFromTomorrow, expected, avg, projected, pct: goal ? total / goal : 0 };
  }
  return { per: out, totalDays, elapsed, leftInclToday, days };
}

/* ---------- UI: Heute ---------- */
let selectedDay = null; // null = heute
let runMode = 'laps';

function renderProgress() {
  const st = stats(), s = db.settings;
  $('#title').textContent = s.name;
  $('#progress').innerHTML = EX.map(x => {
    const p = st.per[x.k], diff = p.total - p.expected;
    const ceil = v => x.k === 'km' ? fmtKm(Math.ceil(v * 10) / 10) + ' km' : fmt(Math.ceil(v));
    const done = p.remaining <= 0;
    return `<div class="card" style="--c:${x.c}">
      <div class="head"><span class="name">${x.name}</span>
        <span class="nums"><b>${x.f(p.total)}</b> / ${x.f(p.goal)}</span></div>
      <div class="bar"><i style="width:${Math.min(p.pct * 100, 100)}%"></i>
        <span class="tick" style="left:${Math.min(p.expected / p.goal * 100, 100)}%" title="Soll heute"></span></div>
      <div class="sub">
        <span>${fmt(p.pct * 100, 1)} %</span>
        <span>Rest <b>${done ? '0' : ceil(p.remaining)}</b></span>
        <span class="${diff >= 0 ? 'ok' : 'behind'}">${diff >= 0 ? '+' : '−'}${ceil(Math.abs(diff))} ggü. Plan</span>
      </div>
      <div class="today-left">${done ? '<span class="ok">Ziel erreicht 🎉</span>'
        : p.todayLeft <= 0 ? `<span class="ok">Heute geschafft</span> · ${ceil(p.today)} gemacht`
        : `Heute noch <b>${ceil(p.todayLeft)}</b> <span class="hint">(Soll ${ceil(p.perDayFromToday)}, ${ceil(p.today)} gemacht)</span>`}</div>
    </div>`;
  }).join('');
}

function presetLabel([pu, ps, laps]) {
  const parts = [];
  if (pu) parts.push(`${pu} KZ`);
  if (ps) parts.push(`${ps} LS`);
  if (laps) parts.push(`${laps} ${laps === 1 ? 'Runde' : 'Runden'}`);
  return parts.join(' + ') || '—';
}
function renderPresets() {
  const lap = db.settings.lap;
  $('#presets').innerHTML = db.settings.presets.map((p, i) =>
    `<button type="button" data-i="${i}">${presetLabel(p)}${p[2] ? `<small>${fmtKm(round2(p[2] * lap / 1000))} km</small>` : ''}</button>`).join('');
}
$('#presets').addEventListener('click', ev => {
  const b = ev.target.closest('button[data-i]'); if (!b) return;
  const [pu, ps, laps] = db.settings.presets[+b.dataset.i];
  const e = addEntry({ pullups: pu, pushups: ps, km: laps * db.settings.lap / 1000, date: selectedDay || undefined });
  if (e) { navigator.vibrate?.(15); toast(`${presetLabel(db.settings.presets[+b.dataset.i])} gespeichert`, () => deleteEntry(e.id)); }
});

function entryText(e) {
  const p = [];
  if (e.pullups) p.push(`<b style="color:var(--pull)">${e.pullups}</b> KZ`);
  if (e.pushups) p.push(`<b style="color:var(--push)">${e.pushups}</b> LS`);
  if (e.km) {
    const laps = e.km * 1000 / db.settings.lap;
    p.push(`<b style="color:var(--run)">${fmtKm(e.km)}</b> km` + (Math.abs(laps - Math.round(laps)) < 1e-6 ? ` <em>(${Math.round(laps)} Rd.)</em>` : ''));
  }
  return p.join(' · ') + (e.note ? ` <em>– ${escapeHtml(e.note)}</em>` : '');
}
const escapeHtml = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function renderDay() {
  const d = selectedDay || todayStr();
  const isToday = d === todayStr();
  $('#daytitle').innerHTML = isToday ? 'Heute' : `${dayLabel(d)} <button type="button" id="backtoday">zurück zu heute</button>`;
  const list = live().filter(e => e.date === d).sort((a, b) => b.time.localeCompare(a.time) || b.updatedAt - a.updatedAt);
  const sum = list.reduce((a, e) => (a.pullups += e.pullups, a.pushups += e.pushups, a.km += e.km, a), { pullups: 0, pushups: 0, km: 0 });
  $('#daytotals').innerHTML = EX.map(x => `<span class="pill" style="--c:${x.c}"><b>${x.f(sum[x.k])}</b> ${x.k === 'km' ? '' : x.short}</span>`).join('')
    + `<span class="pill">${list.length} ${list.length === 1 ? 'Satz' : 'Sätze'}</span>`;
  $('#daylog').innerHTML = list.length ? list.map(e =>
    `<li><span class="t">${e.time}</span><span class="what">${entryText(e)}</span><button type="button" data-edit="${e.id}">✎</button></li>`).join('')
    : `<li class="empty">${isToday ? 'Noch nichts eingetragen heute.' : 'Keine Einträge an diesem Tag.'}</li>`;
}
document.addEventListener('click', ev => {
  if (ev.target.id === 'backtoday') { selectedDay = null; $('#custom [name=date]').value = ''; renderAll(); }
  const ed = ev.target.closest('[data-edit]'); if (ed) openEdit(ed.dataset.edit);
});

/* Eigener Satz */
const form = $('#custom');
$$('.stepper', form).forEach(st => st.addEventListener('click', ev => {
  const b = ev.target.closest('button[data-d]'); if (!b) return;
  const inp = $('input', st), step = +b.dataset.d * (st.dataset.field === 'run' && runMode === 'km' ? 0.4 : 1);
  inp.value = Math.max(0, round2((+inp.value || 0) + step));
  updateRunHint();
}));
$('#runmode').addEventListener('click', ev => {
  const b = ev.target.closest('button[data-mode]'); if (!b) return;
  runMode = b.dataset.mode;
  $$('#runmode button').forEach(x => x.classList.toggle('on', x === b));
  form.run.value = 0; updateRunHint();
});
form.run.addEventListener('input', updateRunHint);
function updateRunHint() {
  const v = +form.run.value || 0;
  $('#runhint').textContent = runMode === 'laps'
    ? (v ? `= ${fmtKm(round2(v * db.settings.lap / 1000))} km (${db.settings.lap}-m-Runden)` : `Runden à ${db.settings.lap} m`)
    : (v ? `≈ ${fmt(v * 1000 / db.settings.lap, 1)} Runden` : 'Kilometer direkt');
}
form.addEventListener('submit', ev => {
  ev.preventDefault();
  const v = +form.run.value || 0;
  const km = runMode === 'laps' ? v * db.settings.lap / 1000 : v;
  const e = addEntry({ pullups: form.pullups.value, pushups: form.pushups.value, km,
    date: form.date.value || selectedDay || undefined, time: form.time.value || undefined, note: form.note.value });
  if (!e) { toast('Erst etwas eintragen 🙂'); return; }
  if (form.date.value && form.date.value !== todayStr()) selectedDay = form.date.value;
  form.pullups.value = form.pushups.value = form.run.value = 0; form.note.value = ''; form.time.value = '';
  updateRunHint(); navigator.vibrate?.(15);
  toast('Satz gespeichert', () => deleteEntry(e.id));
});
form.date.addEventListener('change', () => { selectedDay = form.date.value && form.date.value !== todayStr() ? form.date.value : null; renderDay(); renderPresetsHint(); });
function renderPresetsHint() {
  $$('#presets button').forEach(b => b.title = selectedDay ? `wird für ${dayLabel(selectedDay)} eingetragen` : '');
}

/* Bearbeiten */
const dlg = $('#edit'), ef = $('#editform');
let editId = null;
function openEdit(id) {
  const e = db.entries[id]; if (!e) return; editId = id;
  ef.pullups.value = e.pullups; ef.pushups.value = e.pushups; ef.km.value = e.km; ef.note.value = e.note || '';
  ef.date.value = e.date; ef.time.value = e.time;
  dlg.showModal();
}
dlg.addEventListener('close', () => {
  if (!editId) return;
  if (dlg.returnValue === 'delete') { const id = editId; deleteEntry(id); toast('Eintrag gelöscht', () => updateEntry(id, { deleted: false })); }
  if (dlg.returnValue === 'save') updateEntry(editId, {
    pullups: Math.max(0, Math.round(+ef.pullups.value || 0)), pushups: Math.max(0, Math.round(+ef.pushups.value || 0)),
    km: Math.max(0, round2(+ef.km.value || 0)), note: ef.note.value.trim(), date: ef.date.value || db.entries[editId].date, time: ef.time.value || db.entries[editId].time,
  });
  editId = null;
});

/* ---------- UI: Plan ---------- */
function renderPlan() {
  const st = stats(), s = db.settings;
  const endLabel = dayLabel(s.end);
  $('#plan').innerHTML = `
    <h2>Zeitraum</h2>
    <div class="card"><div class="stat">
      <div><small>Tag</small><b>${st.elapsed} / ${st.totalDays}</b></div>
      <div><small>Tage übrig (inkl. heute)</small><b>${st.leftInclToday}</b></div>
      <div><small>Ende</small><b>${endLabel}</b></div>
    </div></div>
    <h2>Was du pro Tag brauchst</h2>
    <div class="plan-grid">${EX.map(x => {
      const p = st.per[x.k];
      const r = v => x.k === 'km' ? fmtKm(Math.ceil(v * 10) / 10) : fmt(Math.ceil(v));
      const reach = p.projected >= p.goal;
      return `<div class="card" style="--c:${x.c}">
        <div class="head"><span class="name">${x.name}</span><span class="nums">${x.f(p.total)} / ${x.f(p.goal)}</span></div>
        <div class="stat">
          <div><small>Soll pro Tag ab heute</small><b>${r(p.perDayFromToday)}</b></div>
          <div><small>ab morgen, falls heute nichts mehr</small><b>${r(p.perDayFromTomorrow)}</b></div>
          <div><small>Dein Schnitt bisher</small><b>${r(p.avg)}</b></div>
        </div>
        <p class="hint">Mit deinem Schnitt kommst du bis ${endLabel} auf <b class="${reach ? 'ok' : 'behind'}">${x.f(Math.round(p.projected * (x.k === 'km' ? 10 : 1)) / (x.k === 'km' ? 10 : 1))}</b>${reach ? ' – Ziel wird erreicht.' : ` – es fehlen ${r(p.goal - p.projected)}.`}
        ${x.k === 'km' ? ` Pro Tag ab heute sind das ${fmt(Math.ceil(p.perDayFromToday * 1000 / s.lap))} Runden à ${s.lap} m.` : ''}</p>
      </div>`;
    }).join('')}</div>`;
}

/* ---------- UI: Verlauf ---------- */
function renderHistory() {
  const st = stats(), s = db.settings, t = todayStr();
  const first = Object.keys(st.days).sort()[0];
  const from = first && first < s.start ? first : s.start;
  const to = t < s.end ? t : s.end;
  const rows = [];
  for (let d = to; d >= from; d = addDays(d, -1)) rows.push(d);

  // Diagramm: kumulativer Fortschritt in % pro Übung + Sollkurve
  const W = 600, H = 220, P = 28;
  const total = st.totalDays;
  const xOf = d => P + (W - P - 8) * Math.min(Math.max(dayDiff(s.start, d), 0), total - 1) / Math.max(total - 1, 1);
  const yOf = pct => H - P - (H - P - 10) * Math.min(pct, 1.1) / 1.1;
  let lines = '';
  for (const x of EX) {
    let cum = 0; const pts = [];
    const pre = Object.entries(st.days).filter(([d]) => d < s.start).reduce((a, [, v]) => a + v[x.k], 0);
    cum = pre;
    for (let d = s.start; d <= to; d = addDays(d, 1)) { cum += (st.days[d] || {})[x.k] || 0; pts.push(`${xOf(d).toFixed(1)},${yOf(cum / x.goal(s)).toFixed(1)}`); }
    if (pts.length) lines += `<polyline fill="none" stroke="${x.c}" stroke-width="2.5" stroke-linejoin="round" points="${pts.join(' ')}"/>`;
  }
  const grid = [0, .25, .5, .75, 1].map(p => `<line x1="${P}" x2="${W - 8}" y1="${yOf(p)}" y2="${yOf(p)}" stroke="var(--line)"/><text x="${P - 4}" y="${yOf(p) + 4}" text-anchor="end" font-size="10" fill="var(--muted)">${p * 100}%</text>`).join('');
  const ideal = `<line x1="${xOf(s.start)}" y1="${yOf(1 / total)}" x2="${xOf(s.end)}" y2="${yOf(1)}" stroke="var(--muted)" stroke-dasharray="4 4"/>`;
  const today = `<line x1="${xOf(t)}" x2="${xOf(t)}" y1="10" y2="${H - P}" stroke="var(--muted)" stroke-width="1" opacity=".5"/>`;
  const axis = `<text x="${P}" y="${H - 8}" font-size="10" fill="var(--muted)">${dayLabel(s.start)}</text><text x="${W - 8}" y="${H - 8}" font-size="10" text-anchor="end" fill="var(--muted)">${dayLabel(s.end)}</text>`;
  $('#chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Fortschritt in Prozent">${grid}${ideal}${today}${lines}${axis}</svg>
    <div class="legend">${EX.map(x => `<span style="--c:${x.c}">${x.name}</span>`).join('')}<span style="--c:transparent;border-bottom:1px dashed var(--muted)">Plan</span></div>`;

  $('#history').innerHTML = `<table><thead><tr><th>Tag</th><th>KZ</th><th>LS</th><th>km</th><th>Sätze</th></tr></thead><tbody>
    ${rows.map(d => { const v = st.days[d] || { pullups: 0, pushups: 0, km: 0, n: 0 };
      return `<tr class="click${d === t ? ' today' : ''}" data-day="${d}"><td>${dayLabel(d)}</td><td>${fmt(v.pullups)}</td><td>${fmt(v.pushups)}</td><td>${fmtKm(round2(v.km))}</td><td>${v.n}</td></tr>`; }).join('')}
    </tbody></table><p class="hint">Tipp: Tag antippen, um seine Sätze zu sehen, zu bearbeiten oder nachzutragen.</p>`;
}
$('#history').addEventListener('click', ev => {
  const tr = ev.target.closest('tr[data-day]'); if (!tr) return;
  const d = tr.dataset.day;
  selectedDay = d === todayStr() ? null : d;
  $('#custom [name=date]').value = selectedDay || '';
  if (selectedDay) $('details.when').open = true;
  show('today'); renderAll();
  $('#daytitle').scrollIntoView({ behavior: 'smooth' });
});

/* ---------- UI: Einstellungen ---------- */
const sf = $('#settings');
function fillSettings() {
  const s = db.settings;
  sf.name.value = s.name; sf.start.value = s.start; sf.end.value = s.end;
  sf.g_pullups.value = s.goals.pullups; sf.g_pushups.value = s.goals.pushups; sf.g_km.value = s.goals.km; sf.lap.value = s.lap;
  sf.presets.value = s.presets.map(p => p.join(',')).join('\n');
  $('#ver').textContent = VERSION;
}
sf.addEventListener('submit', ev => {
  ev.preventDefault();
  const presets = sf.presets.value.split('\n').map(l => l.split(/[,;\s]+/).filter(Boolean).map(Number))
    .filter(p => p.length && p.every(n => n >= 0 && Number.isFinite(n))).map(p => [Math.round(p[0] || 0), Math.round(p[1] || 0), +(p[2] || 0)])
    .filter(p => p[0] || p[1] || p[2]).slice(0, 12);
  if (!sf.start.value || !sf.end.value || sf.end.value < sf.start.value) { toast('Start/Ende prüfen'); return; }
  db.settings = { ...db.settings, name: sf.name.value.trim() || 'Challenge', start: sf.start.value, end: sf.end.value,
    goals: { pullups: +sf.g_pullups.value || 0, pushups: +sf.g_pushups.value || 0, km: +sf.g_km.value || 0 },
    lap: Math.max(50, +sf.lap.value || 400), presets: presets.length ? presets : DEFAULTS.settings.presets, updatedAt: Date.now() };
  persist(); fillSettings(); toast('Einstellungen gespeichert');
});
const bf = $('#backfill');
bf.date.value = addDays(todayStr(), -1);
bf.addEventListener('submit', ev => {
  ev.preventDefault();
  const e = addEntry({ pullups: bf.pullups.value, pushups: bf.pushups.value, km: bf.km.value, date: bf.date.value, time: '23:59', note: 'nachgetragen' });
  if (!e) { toast('Erst Werte eintragen'); return; }
  toast(`${dayLabel(bf.date.value)} nachgetragen`, () => deleteEntry(e.id));
  bf.pullups.value = bf.pushups.value = bf.km.value = 0;
  bf.date.value = addDays(bf.date.value, -1);
});
$('#export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `sport-backup-${todayStr()}.json` });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
$('#import').addEventListener('change', async ev => {
  const f = ev.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!d.entries || !d.settings) throw new Error('Kein gültiges Backup');
    let n = 0;
    for (const [id, e] of Object.entries(d.entries)) {
      const cur = db.entries[id];
      if (!cur || (e.updatedAt || 0) > (cur.updatedAt || 0)) { db.entries[id] = e; n++; }
    }
    if ((d.settings.updatedAt || 0) > (db.settings.updatedAt || 0)) db.settings = { ...db.settings, ...d.settings };
    persist(); fillSettings(); toast(`${n} Einträge übernommen`);
  } catch (e) { toast('Import fehlgeschlagen: ' + e.message); }
  ev.target.value = '';
});

/* ---------- Navigation, Toast, Netz ---------- */
function show(view) {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  try { sessionStorage.setItem('view', view); } catch {}
  window.scrollTo(0, 0);
}
$$('.tabs button').forEach(b => b.addEventListener('click', () => { show(b.dataset.view); renderAll(); }));

let toastTimer;
function toast(msg, undo) {
  const t = $('#toast'); clearTimeout(toastTimer);
  t.innerHTML = ''; t.append(msg);
  if (undo) { const b = document.createElement('button'); b.textContent = 'Rückgängig'; b.onclick = () => { undo(); t.hidden = true; }; t.append(b); }
  t.hidden = false; toastTimer = setTimeout(() => t.hidden = true, undo ? 5000 : 2500);
}
function net() { $('#net').className = 'net ' + (navigator.onLine ? 'on' : 'off'); }
addEventListener('online', net); addEventListener('offline', net);

function renderAll() { renderProgress(); renderPresets(); renderPresetsHint(); renderDay(); renderPlan(); renderHistory(); }
addEventListener('data-changed', renderAll);
addEventListener('storage', ev => { if (ev.key === KEY) { db = load(); renderAll(); } });
// Tageswechsel / Rückkehr in die App
document.addEventListener('visibilitychange', () => { if (!document.hidden) renderAll(); });

async function storageInfo() {
  let txt = `${live().length} Einträge lokal gespeichert.`;
  try {
    if (navigator.storage?.persist) { const p = await navigator.storage.persist(); txt += p ? ' Speicher ist dauerhaft geschützt.' : ''; }
  } catch {}
  $('#storageinfo').textContent = txt;
}

/* ---------- Schnittstelle für den Cloud-Sync (sync.js) ---------- */
window.SportStore = {
  get db() { return db; },
  // Änderungen aus der Cloud übernehmen (Last-Write-Wins über updatedAt)
  mergeRemote({ entries = [], settings = null }) {
    let changed = false;
    for (const r of entries) {
      const cur = db.entries[r.id];
      if (!cur || (r.updatedAt || 0) > (cur.updatedAt || 0)) { db.entries[r.id] = r; changed = true; }
      if (db.entries[r.id].updatedAt === r.updatedAt) db.synced[r.id] = r.updatedAt;
    }
    if (settings && (settings.updatedAt || 0) > (db.settings.updatedAt || 0)) {
      db.settings = { ...db.settings, ...settings, goals: { ...db.settings.goals, ...settings.goals } }; changed = true; fillSettings();
    }
    if (settings && settings.updatedAt === db.settings.updatedAt) db.synced.settings = settings.updatedAt;
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {}
    if (changed) window.dispatchEvent(new Event('data-changed'));
  },
  pending() {
    const list = Object.values(db.entries).filter(e => db.synced[e.id] !== e.updatedAt);
    const settings = db.synced.settings !== db.settings.updatedAt ? db.settings : null;
    return { entries: list, settings };
  },
  markSynced(ids, settingsTs) {
    for (const [id, ts] of ids) db.synced[id] = ts;
    if (settingsTs != null) db.synced.settings = settingsTs;
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {}
  },
  toast: (...a) => toast(...a),
};

/* ---------- Start ---------- */
fillSettings(); updateRunHint(); net(); renderAll(); storageInfo();
try { const v = sessionStorage.getItem('view'); if (v) show(v); } catch {}
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e));
}
