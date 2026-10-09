import { $, $$, api, esc, hourLabel, toast } from '../core.js';

export const TIMEZONES = ['Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane', 'Australia/Adelaide', 'Australia/Perth', 'Australia/Hobart', 'Australia/Darwin',
  'Pacific/Auckland', 'Europe/London', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Singapore', 'UTC'];
export const DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
export const hourOptions = sel => [...Array(24)].map((_, h) => `<option value="${h}" ${+sel === h ? 'selected' : ''}>${hourLabel(h)}</option>`).join('');
export const dayChips = (selected, id = 'days') => `<div class="daychips" id="${id}">${DAYS.map(([d, l]) =>
  `<button type="button" class="dchip ${String(selected).split(',').includes(String(d)) ? 'on' : ''}" data-d="${d}">${l}</button>`).join('')}</div>`;
export const bindDayChips = root => $$('.dchip', root).forEach(b => (b.onclick = () => b.classList.toggle('on')));
export const readDays = (root, id = 'days') => $$(`#${id} .dchip.on`, root).map(b => b.dataset.d).join(',');

const brandPanel = (steps, cur) => `<aside class="auth-side">
  <div class="brand"><span class="mark"></span><div><b>Clinic Autopilot</b><small>AUTOMATION CONTROL ROOM</small></div></div>
  <div class="auth-copy"><h2>Win back patients.<br>Catch every call.<br><span>See the money.</span></h2>
  <p>Texts, missed calls and your AI receptionist — all tracked in one place.</p></div>
  ${steps ? `<ol class="wiz-steps">${steps.map((s, i) => `<li class="${i < cur ? 'done' : i === cur ? 'cur' : ''}">${s}</li>`).join('')}</ol>` : ''}
</aside>`;

export function renderLogin(root, clinic, done) {
  root.innerHTML = `<div class="auth">${brandPanel()}<main class="auth-main"><form class="auth-card" id="f">
    <div class="eyebrow">Welcome back</div><h1>${esc(clinic)}</h1><p class="sub">Enter your password to open the dashboard.</p>
    <div class="field"><label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" required></div>
    <p class="err" id="err"></p><button class="btn primary big" type="submit">Log in</button>
    <p class="hint-sm">Forgot it? Whoever set this up can reset it on the server with <code>npm run reset-password</code>.</p></form></main></div>`;
  $('#f').onsubmit = async e => {
    e.preventDefault(); $('#err').textContent = '';
    try { await api('/auth/login', { method: 'POST', body: { password: $('#pw').value } }); done(); }
    catch (err) { $('#err').textContent = err.message; }
  };
  $('#pw').focus();
}

export function renderSetup(root, done) {
  const steps = ['Your clinic', 'Opening hours', 'Your numbers', 'Secure it'];
  const data = { clinic_name: '', clinic_phone: '', booking_link: '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    open_days: '1,2,3,4,5', open_hour: 9, close_hour: 17, avg_appointment_value: 250, sms_cost: 0.08 };
  if (!TIMEZONES.includes(data.timezone)) data.timezone = 'Australia/Sydney';
  let i = -1;

  const views = [
    () => `<div class="eyebrow">Step 1 of 4</div><h1>Tell us about your clinic</h1><p class="sub">This is how patients will see you in texts and emails.</p>
      <div class="field"><label>Clinic name *</label><input id="clinic_name" value="${esc(data.clinic_name)}" placeholder="Bright Smiles Dental" required></div>
      <div class="row2"><div class="field"><label>Clinic phone</label><input id="clinic_phone" value="${esc(data.clinic_phone)}" placeholder="02 9000 0000"></div>
      <div class="field"><label>Online booking link</label><input id="booking_link" value="${esc(data.booking_link)}" placeholder="https://…"></div></div>
      <div class="field"><label>Time zone</label><select id="timezone">${TIMEZONES.map(t => `<option ${t === data.timezone ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`,
    () => `<div class="eyebrow">Step 2 of 4</div><h1>When are you open?</h1><p class="sub">Calls outside these hours are counted as <b>after-hours</b> calls, so you can see what the voice agent catches while you're closed.</p>
      <div class="field"><label>Open days</label>${dayChips(data.open_days)}</div>
      <div class="row2"><div class="field"><label>Opens at</label><select id="open_hour">${hourOptions(data.open_hour)}</select></div>
      <div class="field"><label>Closes at</label><select id="close_hour">${hourOptions(data.close_hour)}</select></div></div>`,
    () => `<div class="eyebrow">Step 3 of 4</div><h1>What is an appointment worth?</h1><p class="sub">We multiply booked appointments by this to estimate how much money your automations bring in. A rough average is fine — you can change it any time.</p>
      <div class="row2"><div class="field"><label>Average appointment value ($)</label><input id="avg_appointment_value" type="number" min="0" value="${data.avg_appointment_value}"></div>
      <div class="field"><label>Cost per text message ($)</label><input id="sms_cost" type="number" min="0" step="0.01" value="${data.sms_cost}"></div></div>`,
    () => `<div class="eyebrow">Step 4 of 4</div><h1>Choose a password</h1><p class="sub">Anyone at the front desk with this password can use the dashboard.</p>
      <div class="field"><label>Password (8+ characters)</label><input id="pw" type="password" autocomplete="new-password"></div>
      <div class="field"><label>Type it again</label><input id="pw2" type="password" autocomplete="new-password"></div>
      <label class="check"><input type="checkbox" id="sample" checked> Fill the dashboard with sample data so I can look around (easy to remove later)</label>`,
  ];
  const collect = () => {
    for (const k of ['clinic_name', 'clinic_phone', 'booking_link', 'timezone', 'open_hour', 'close_hour', 'avg_appointment_value', 'sms_cost']) { const el = $('#' + k, root); if (el) data[k] = el.value; }
    if ($('#days', root)) data.open_days = readDays(root);
  };
  const welcome = () => `<div class="eyebrow">Welcome</div><h1>Let's get your clinic set up</h1><p class="sub">Four quick questions — about 2 minutes. Nothing is sent to patients until you say so: everything starts in <b>test mode</b>.</p>
    <ul class="ticks"><li>Track every win-back text, reply and booking</li><li>See missed calls you recovered and after-hours calls handled</li><li>Know exactly how much money it made you</li></ul>`;

  const draw = () => {
    root.innerHTML = `<div class="auth">${brandPanel(steps, i)}<main class="auth-main"><form class="auth-card" id="f">${i < 0 ? welcome() : views[i]()}
      <p class="err" id="err"></p><div class="wiz-nav">${i >= 0 ? '<button type="button" class="btn" id="back">Back</button>' : '<span></span>'}
      <button class="btn primary big" type="submit">${i < 0 ? "Let's go" : i === views.length - 1 ? 'Finish setup' : 'Continue'}</button></div></form></main></div>`;
    bindDayChips(root);
    $('#back', root)?.addEventListener('click', () => { collect(); i--; draw(); });
    $('#f', root).onsubmit = async e => {
      e.preventDefault(); collect(); const err = $('#err', root);
      if (i === 0 && !data.clinic_name.trim()) return (err.textContent = 'Please enter your clinic name.');
      if (i === 1 && !data.open_days) return (err.textContent = 'Pick at least one open day.');
      if (i === 1 && +data.close_hour <= +data.open_hour) return (err.textContent = 'Closing time must be after opening time.');
      if (i < views.length - 1) { i++; return draw(); }
      const pw = $('#pw', root).value;
      if (pw.length < 8) return (err.textContent = 'Use at least 8 characters.');
      if (pw !== $('#pw2', root).value) return (err.textContent = "The two passwords don't match.");
      try {
        const sample = $('#sample', root).checked;
        await api('/auth/setup', { method: 'POST', body: { password: pw, settings: data } });
        if (sample) await api('/demo/seed', { method: 'POST', body: {} });
        toast('All set — welcome aboard!'); done();
      } catch (e2) { err.textContent = e2.message; }
    };
    $('input,select', root)?.focus();
  };
  draw();
}
