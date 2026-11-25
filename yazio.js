'use strict';
// Yazio-Anzeige (nur lesen). Läuft über einen kleinen Vermittler (worker/yazio-proxy.js), weil Yazio
// direkte Browser-Anfragen blockiert. Das Passwort wird nur zur Anmeldung durchgereicht und nie gespeichert;
// gespeichert wird nur der Zugangsschlüssel (Token), und zwar ausschließlich auf diesem Gerät.
(() => {
  const PROXY = window.YAZIO_PROXY || null;
  const TKEY = 'sporttracker.yazio.token', CKEY = 'sporttracker.yazio.cache';
  const $ = s => document.querySelector(s);
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const get = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const fmt = n => Math.round(n).toLocaleString('de-DE');

  async function tokenRequest(body) {
    const r = await fetch(PROXY + '/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(r.status === 400 || r.status === 401 ? 'E-Mail oder Passwort falsch' : 'Yazio nicht erreichbar (' + r.status + ')');
    const t = await r.json();
    const tok = { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + (t.expires_in || 3600) * 1000 };
    set(TKEY, tok); return tok;
  }
  async function token() {
    let t = get(TKEY); if (!t) return null;
    if (Date.now() > t.expires_at - 60000) {
      try { t = await tokenRequest({ refresh_token: t.refresh_token }); }
      catch (e) { if (/falsch/.test(e.message)) { set(TKEY, null); renderSettings(); } throw e; }
    }
    return t.access_token;
  }
  async function api(path) {
    const tk = await token(); if (!tk) return null;
    const r = await fetch(PROXY + path, { headers: { Authorization: 'Bearer ' + tk } });
    if (!r.ok) throw new Error('Yazio ' + r.status);
    return r.json();
  }

  function summarize(s) {
    const sum = { kcal: 0, carb: 0, protein: 0, fat: 0 };
    for (const m of Object.values(s.meals || {})) {
      const n = m.nutrients || {};
      sum.kcal += n['energy.energy'] || 0; sum.carb += n['nutrient.carb'] || 0;
      sum.protein += n['nutrient.protein'] || 0; sum.fat += n['nutrient.fat'] || 0;
    }
    const g = s.goals || {};
    return { ...sum, goal: g['energy.energy'] || 0, gProtein: g['nutrient.protein'] || 0, gCarb: g['nutrient.carb'] || 0, gFat: g['nutrient.fat'] || 0,
      activity: s.activity_energy || 0, steps: s.steps || 0, water: s.water_intake || 0, unit: (s.units || {}).unit_energy || 'kcal', at: Date.now() };
  }

  function renderCard(d) {
    const box = $('#yazio'); if (!box) return;
    if (!PROXY || !get(TKEY)) { box.hidden = true; return; }
    box.hidden = false;
    if (!d) { box.innerHTML = '<div class="card"><span class="hint">Yazio wird geladen …</span></div>'; return; }
    const left = d.goal - d.kcal, pct = d.goal ? Math.min(d.kcal / d.goal, 1) * 100 : 0;
    const t = new Date(d.at);
    box.innerHTML = `<div class="card" style="--c:var(--accent)">
      <div class="head"><span class="name">Ernährung (Yazio)</span><span class="nums"><b>${fmt(d.kcal)}</b> / ${fmt(d.goal)} kcal</span></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="sub"><span>${left >= 0 ? `noch <b>${fmt(left)}</b> kcal` : `<b class="behind">${fmt(-left)}</b> kcal drüber`}</span>
        <span>Eiweiß <b>${fmt(d.protein)}</b>/${fmt(d.gProtein)} g</span><span>KH <b>${fmt(d.carb)}</b>/${fmt(d.gCarb)} g</span><span>Fett <b>${fmt(d.fat)}</b>/${fmt(d.gFat)} g</span></div>
      <div class="sub" style="margin-top:4px">${d.steps ? `<span>${fmt(d.steps)} Schritte</span>` : ''}${d.activity ? `<span>Aktivität ${fmt(d.activity)} kcal</span>` : ''}
        <span>Stand ${pad(t.getHours())}:${pad(t.getMinutes())}</span></div></div>`;
  }

  let loading = false;
  async function refresh() {
    const day = iso(new Date()), cache = get(CKEY) || {};
    renderCard(cache[day] || null);
    if (!PROXY || !get(TKEY) || loading || !navigator.onLine) return;
    loading = true;
    try {
      const s = await api(`/user/widgets/daily-summary?date=${day}`);
      if (s) { cache[day] = summarize(s); for (const k of Object.keys(cache)) if (k < iso(new Date(Date.now() - 14 * 864e5))) delete cache[k]; set(CKEY, cache); renderCard(cache[day]); }
    } catch (e) { console.warn('yazio', e); if (!cache[day]) $('#yazio').innerHTML = `<div class="card"><span class="hint">Yazio: ${e.message}</span></div>`; }
    finally { loading = false; }
  }

  function renderSettings() {
    const conn = !!get(TKEY);
    $('#yazioform').hidden = conn || !PROXY; $('#yazioconn').hidden = !conn;
    $('#yaziostatus').textContent = !PROXY ? 'Yazio-Anbindung wird gerade eingerichtet.'
      : conn ? 'Verbunden. Deine Kalorien von heute erscheinen auf der Startseite.'
      : 'Melde dich mit deinen Yazio-Daten an. Das Passwort wird nur an Yazio weitergegeben und nirgends gespeichert.';
  }

  $('#yazioform').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target, btn = f.querySelector('button'); btn.disabled = true;
    try { await tokenRequest({ username: f.email.value.trim(), password: f.password.value }); f.password.value = ''; renderSettings(); refresh(); window.SportStore?.toast('Yazio verbunden'); }
    catch (e) { f.password.value = ''; window.SportStore?.toast(e.message); }
    finally { btn.disabled = false; }
  });
  $('#yazioout').addEventListener('click', () => { set(TKEY, null); set(CKEY, null); renderSettings(); renderCard(); });

  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  addEventListener('online', refresh);
  document.addEventListener('click', ev => { if (ev.target.closest('.tabs button[data-view="today"]')) refresh(); });
  renderSettings(); refresh();
})();
