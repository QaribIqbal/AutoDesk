import { $, api, esc, icon } from './js/core.js';
import { renderLogin, renderSetup } from './js/pages/auth.js';
import { overview } from './js/pages/overview.js';
import { reactivation } from './js/pages/reactivation.js';
import { voice } from './js/pages/voice.js';
import { patients } from './js/pages/patients.js';
import { automations } from './js/pages/automations.js';
import { settings } from './js/pages/settings.js';

// ---- Add a new automation here and it appears in the sidebar. ----
const PAGES = [
  { id: 'overview', label: 'Overview', icon: 'overview', group: 'Home', render: overview },
  { id: 'reactivation', label: 'Win-back texts', icon: 'sms', group: 'Automations', render: reactivation },
  { id: 'voice', label: 'Calls & voice agent', icon: 'voice', group: 'Automations', render: voice },
  { id: 'invoices', label: 'Invoices', icon: 'invoice', group: 'Automations', soon: true },
  { id: 'patients', label: 'Patients', icon: 'patients', group: 'Manage', render: patients },
  { id: 'automations', label: 'Automations', icon: 'bolt', group: 'Manage', render: automations },
  { id: 'settings', label: 'Settings', icon: 'settings', group: 'Manage', render: settings },
];

const root = $('#app');

function shell(clinic) {
  root.innerHTML = `<aside class="sidebar">
    <div class="brand"><span class="mark"></span><div><b id="clinic">${esc(clinic)}</b><small>CLINIC AUTOPILOT</small></div></div>
    <nav id="nav"></nav>
    <span class="modechip hidden" id="modechip">TEST MODE</span>
    <div class="sync" id="sync"><span class="pulse"></span><div><b>Checking…</b><small>&nbsp;</small></div></div>
  </aside><main id="main"></main>`;
}

function nav() {
  const cur = location.hash.slice(1) || 'overview'; let html = '', group = '';
  for (const p of PAGES) {
    if (p.group !== group) { group = p.group; html += `<div class="nav-label">${group}</div>`; }
    html += p.soon ? `<div class="nav-item soon">${icon(p.icon)}${p.label}<span class="tag">SOON</span></div>`
      : `<a class="nav-item ${cur === p.id ? 'active' : ''}" href="#${p.id}">${icon(p.icon)}${p.label}</a>`;
  }
  $('#nav').innerHTML = html;
}

async function route() {
  if (!$('#main')) return;
  nav();
  const page = PAGES.find(p => p.id === (location.hash.slice(1) || 'overview') && !p.soon) || PAGES[0];
  const main = $('#main');
  main.classList.add('loading');
  try { await page.render(main); window.scrollTo(0, 0); }
  catch (e) { main.innerHTML = `<div class="empty"><b>Something went wrong</b>${esc(e.message)}</div>`; }
  main.classList.remove('loading');
}

async function boot() {
  const st = await api('/status');
  if (!st.setup_complete) return renderSetup(root, boot);
  if (!st.logged_in) return renderLogin(root, st.clinic_name, boot);
  shell(st.clinic_name); route();
}

window.addEventListener('hashchange', route);
window.addEventListener('auth-required', () => boot());
boot();
