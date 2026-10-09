import { $, esc, ago, pct } from './core.js';

export const state = { days: 0 };

// ---------- dial gauge ----------
const polar = (a, r) => { const t = a * Math.PI / 180; return [100 + r * Math.sin(t), 100 - r * Math.cos(t)]; };
const arc = (a0, a1, r) => { const [x0, y0] = polar(a0, r), [x1, y1] = polar(a1, r); return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`; };

/** v and max are fractions (0..1); the scale end is printed so the dial never exaggerates. */
export function gauge({ v, max, label, sub, color = '#d3ff3c', help = '' }) {
  const f = Math.max(0, Math.min(1, max ? v / max : 0)), rot = -120 + 240 * f;
  let ticks = '';
  for (let i = 0; i <= 40; i++) {
    const a = -120 + i * 6, maj = i % 10 === 0, [x1, y1] = polar(a, maj ? 57 : 62), [x2, y2] = polar(a, 69);
    ticks += `<line class="g-tick ${maj ? 'maj' : ''} ${f > 0 && i / 40 <= f ? 'lit' : ''}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
  }
  const [lx, ly] = polar(-120, 78), [rx] = polar(120, 78);
  const txt = (v * 100).toFixed(v > 0 && v < 0.1 ? 1 : 0) + '%';
  return `<div class="cell gauge" ${help ? `title="${esc(help)}"` : ''}><svg viewBox="0 0 200 168" role="img" aria-label="${esc(label)}: ${txt}">
    <path class="g-track" d="${arc(-120, 120, 78)}"/>
    <path class="g-val" pathLength="100" d="${arc(-120, 120, 78)}" stroke="${color}" data-f="${(f * 100).toFixed(1)}"/>
    ${ticks}
    <g class="g-needle" data-rot="${rot}" style="transform:rotate(-120deg)"><path d="M96.5 100 L100 38 L103.5 100Z" fill="#ff5b3a"/></g>
    <circle cx="100" cy="100" r="8" fill="#171a1f" stroke="#d3ff3c" stroke-width="2"/>
    <text class="g-num" x="100" y="138">${txt}</text>
    <text class="g-end" x="${lx.toFixed(0)}" y="${(ly + 14).toFixed(0)}">0</text><text class="g-end" x="${rx.toFixed(0)}" y="${(ly + 14).toFixed(0)}">${Math.round(max * 100)}%</text>
  </svg><div class="lbl">${label}</div><div class="sub2">${sub}</div></div>`;
}

export const odometer = (value, label, metaHtml) => `<div class="cell odo-wrap"><div class="k">${label}</div><div class="odo" data-v="${Math.round(value)}"></div><div class="meta">${metaHtml}</div></div>`;
function setOdo(el, val) {
  const s = Math.round(val).toLocaleString('en-US');
  el.innerHTML = '<i class="cur">$</i>' + [...s].map(c => (c === ',' ? '<i class="sep">,</i>' : `<span class="dg">${c}</span>`)).join('');
}
export function funnel(steps) {
  const top = Math.max(1, steps[0].n);
  return `<div class="funnel">${steps.map((s, i) => `<div class="fn"><span class="t">${s.label}</span>
    <div class="bar"><i style="--c:${s.color}" data-w="${(s.n / top * 100).toFixed(1)}"></i></div>
    <span class="n">${s.n}<small>${i ? pct(steps[i - 1].n ? s.n / steps[i - 1].n : 0) + ' of previous' : 'start'}</small></span></div>`).join('')}</div>`;
}
/** Starts every needle / bar / odometer animation once the markup is on screen. */
export function animate(root) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    root.querySelectorAll('.g-needle').forEach(n => (n.style.transform = `rotate(${n.dataset.rot}deg)`));
    root.querySelectorAll('.g-val').forEach(p => (p.style.strokeDasharray = `${p.dataset.f} 100`));
    root.querySelectorAll('.fn .bar i').forEach(b => (b.style.width = b.dataset.w + '%'));
    root.querySelectorAll('.chart .b').forEach(b => (b.style.height = b.dataset.h + '%'));
  }));
  root.querySelectorAll('.odo').forEach(el => {
    const target = +el.dataset.v, t0 = performance.now();
    const step = t => { const k = Math.min(1, (t - t0) / 1000); setOdo(el, target * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
    setOdo(el, 0); requestAnimationFrame(step);
  });
}

// ---------- building blocks ----------
export const stat = (l, v, h = '', c = '') => `<div class="stat" ${c ? `style="--c:${c}"` : ''}><div class="l">${l}</div><div class="v">${v}</div><div class="h">${h}</div></div>`;
export const rangeBar = () => `<div class="seg" role="group" aria-label="Date range">${[[0, 'All time'], [30, '30 days'], [7, '7 days']].map(([d, l]) => `<button class="${state.days === d ? 'on' : ''}" data-days="${d}">${l}</button>`).join('')}</div>`;
export const bindRange = (el, again) => el.querySelectorAll('[data-days]').forEach(b => (b.onclick = () => { state.days = +b.dataset.days; again(); }));
export const head = (eyebrow, title, sub, right = '', range = true) =>
  `<div class="head"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p class="sub">${sub}</p></div><div class="head-r">${right}${range ? rangeBar() : ''}</div></div>`;
export const syncPill = last => !last ? '<span class="pill"><i></i>no live activity yet</span>'
  : `<span class="pill ${Date.now() - new Date(last) < 864e5 ? 'ok' : 'stale'}"><i></i>last activity ${ago(last)}</span>`;
export const testBanner = on => on ? `<div class="test-banner"><b>Test mode is on</b> — nothing is really sent to patients. <a href="#automations">Go live →</a></div>` : '';

export function setSync(summary) {
  const last = summary?.n8n?.last_contact, el = $('#sync'); if (!el) return;
  const st = !last ? ['', 'Not connected yet', 'Settings → Connect'] : Date.now() - new Date(last) < 3 * 864e5 ? ['ok', 'Automations connected', 'last check-in ' + ago(last)] : ['stale', 'No recent check-in', 'last ' + ago(last)];
  el.innerHTML = `<span class="pulse ${st[0]}"></span><div><b>${st[1]}</b><small>${st[2]}</small></div>`;
  $('#modechip')?.classList.toggle('hidden', !summary?.n8n?.demo_mode);
}

export const toggle = (id, on, label = '') => `<label class="switch" title="${esc(label)}"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span></span></label>`;

/** Phone mock-up that shows exactly what the patient will receive. */
export const phone = (from, text) => `<div class="phone"><div class="ph-top"><span>${esc(from)}</span><small>Text message</small></div>
  <div class="ph-body"><div class="bubble">${esc(text).replace(/\n/g, '<br>')}</div></div></div>`;

export const PLACEHOLDERS = [['{first_name}', 'First name'], ['{clinic}', 'Clinic name'], ['{months}', 'Months since visit'], ['{booking_link}', 'Booking link'], ['{clinic_phone}', 'Clinic phone']];
export const chips = (target, list = PLACEHOLDERS) => `<div class="chips" data-target="${target}">${list.map(([k, l]) => `<button type="button" class="tchip" data-ins="${k}" title="Insert ${l}">+ ${l}</button>`).join('')}</div>`;
/** Wires placeholder chips to insert at the cursor. */
export function bindChips(root, after = () => {}) {
  root.querySelectorAll('.chips').forEach(box => box.querySelectorAll('[data-ins]').forEach(b => (b.onclick = () => {
    const ta = $('#' + box.dataset.target, root); const s = ta.selectionStart ?? ta.value.length;
    ta.value = ta.value.slice(0, s) + b.dataset.ins + ta.value.slice(ta.selectionEnd ?? s); ta.focus();
    ta.selectionStart = ta.selectionEnd = s + b.dataset.ins.length; after();
  })));
}
