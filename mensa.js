'use strict';
// Mensaplan Kiel (Mensa I + II). Daten kommen aus data/mensa.json, das eine GitHub Action täglich erzeugt.
(() => {
  const KEY = 'sporttracker.mensa', PREF = 'sporttracker.mensaPref';
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const label = s => { const [y, m, d] = s.split('-').map(Number); const t = new Date(y, m - 1, d); return `${WD[t.getDay()]} ${pad(d)}.${pad(m)}.`; };
  const eur = n => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

  let data = null, mensaId = 1, day = null, wanted = null;
  try { data = JSON.parse(localStorage.getItem(KEY)); } catch {}
  try { mensaId = +(localStorage.getItem(PREF) || 1); } catch {}

  async function load() {
    try {
      const r = await fetch('data/mensa.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error(r.status);
      data = await r.json();
      try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
    } catch (e) { console.warn('mensa', e); }
    render();
  }

  function render() {
    const box = $('#mensa');
    if (!data) { box.innerHTML = '<p class="empty">Noch kein Speiseplan geladen. Bei Internet wird er automatisch geholt.</p>'; return; }
    const mensa = data.mensen.find(m => m.id === mensaId) || data.mensen[0];
    $('#mensasel').innerHTML = data.mensen.map(m => `<button type="button" data-id="${m.id}" class="${m.id === mensa.id ? 'on' : ''}">${esc(m.name)}</button>`).join('');
    const today = iso(new Date());
    const dates = Object.keys(mensa.tage).filter(d => d >= today);
    // Gewählten Tag beibehalten; hat diese Mensa an dem Tag nichts (z. B. Wochenende), nächsten Tag mit Plan nehmen,
    // der gewählte Tag bleibt aber gemerkt, damit er beim Zurückwechseln wieder aktiv ist.
    if (!wanted || wanted < today) wanted = dates[0] || null;
    day = mensa.tage[wanted] ? wanted : (dates.find(d => d >= wanted) || dates[dates.length - 1] || null);
    $('#mensadays').innerHTML = dates.map(d => `<button type="button" data-day="${d}" class="${d === day ? 'on' : ''}">${d === today ? 'Heute' : label(d)}</button>`).join('');
    const upd = new Date(data.updated);
    $('#mensaupd').textContent = `Stand ${pad(upd.getDate())}.${pad(upd.getMonth() + 1)}. ${pad(upd.getHours())}:${pad(upd.getMinutes())}`;
    if (!day) { box.innerHTML = '<p class="empty">Für die kommenden Tage gibt es noch keinen Plan.</p>'; return; }
    const groups = {};
    for (const m of mensa.tage[day]) (groups[m.ort || 'Mensa'] ||= []).push(m);
    box.innerHTML = Object.entries(groups).map(([ort, meals]) => `<h2>${esc(ort)}</h2>` + meals.map(m => `
      <div class="meal"><div class="top2"><span class="n">${esc(m.name)}</span>${m.preise.length ? `<span class="p">${eur(m.preise[0])}</span>` : ''}</div>
      ${m.tags.length ? `<div class="tags">${m.tags.map(t => `<span class="tag ${esc(t)}">${esc(t)}</span>`).join('')}</div>` : ''}</div>`).join('')).join('')
      + '<p class="hint">Preis für Studierende. Angaben ohne Gewähr, Quelle: Studentenwerk SH.</p>';
  }

  document.addEventListener('click', ev => {
    const b = ev.target.closest('#mensasel button[data-id]');
    if (b) { mensaId = +b.dataset.id; try { localStorage.setItem(PREF, mensaId); } catch {} render(); }
    const d = ev.target.closest('#mensadays button[data-day]');
    if (d) { wanted = d.dataset.day; render(); }
    if (ev.target.closest('.tabs button[data-view="mensa"]')) load();
  });
  render(); load();
})();
