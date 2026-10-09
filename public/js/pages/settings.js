import { $, api, esc, toast, copy, icon, ago, confirmBox } from '../core.js';
import { head, setSync } from '../ui.js';
import { TIMEZONES, hourOptions, dayChips, bindDayChips, readDays } from './auth.js';

export async function settings(el) {
  const [s, integ, summary] = await Promise.all([api('/settings'), api('/integrations'), api('/summary')]);
  setSync(summary);
  const f = (k, label, attrs = '') => `<div class="field"><label for="${k}">${label}</label><input id="${k}" value="${esc(s[k])}" ${attrs}></div>`;
  const hooks = integ.webhooks;
  const hookRow = (label, help, url) => `<div class="hook"><div><b>${label}</b><small>${help}</small></div><div class="urlbox"><code>${esc(url)}</code><button class="btn" data-copy="${esc(url)}">${icon('copy', 15)} Copy</button></div></div>`;

  el.innerHTML = `${head('System', 'Settings', 'Clinic details, opening hours, and the connection to your messaging tools.', '', false)}
  <div class="settings">
  <nav class="snav">${[['clinic', 'Clinic'], ['hours', 'Opening hours'], ['money', 'Money'], ['connect', 'Connect'], ['data', 'Your data'], ['account', 'Account']].map(([k, l]) => `<a href="#settings" data-jump="${k}">${l}</a>`).join('')}</nav>
  <div class="scol">
    <section class="panel" id="s-clinic"><h3>Clinic details</h3><p class="sub">Used in every text and email.</p>
      <div class="row2">${f('clinic_name', 'Clinic name')}${f('clinic_phone', 'Clinic phone')}</div>
      <div class="row2">${f('booking_link', 'Online booking link', 'placeholder="https://…"')}<div class="field"><label>Time zone</label><select id="timezone">${TIMEZONES.map(t => `<option ${t === s.timezone ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div></section>

    <section class="panel" id="s-hours"><h3>Opening hours</h3><p class="sub">Calls outside these hours count as after-hours.</p>
      <div class="field"><label>Open days</label>${dayChips(s.open_days)}</div>
      <div class="row2"><div class="field"><label>Opens at</label><select id="open_hour">${hourOptions(s.open_hour)}</select></div><div class="field"><label>Closes at</label><select id="close_hour">${hourOptions(s.close_hour)}</select></div></div></section>

    <section class="panel" id="s-money"><h3>Money</h3><p class="sub">Every revenue and return figure in the dashboard is worked out from these.</p>
      <div class="row2">${f('avg_appointment_value', 'Average appointment value ($)', 'type="number" min="0"')}${f('sms_cost', 'Cost per text ($)', 'type="number" min="0" step="0.01"')}</div>
      <div class="row2">${f('email_cost', 'Cost per email ($)', 'type="number" min="0" step="0.01"')}${f('voice_cost_per_call', 'Cost per AI-answered call ($)', 'type="number" min="0" step="0.01"')}</div></section>
    <div class="savebar inline"><button class="btn primary big" id="save">Save changes</button></div>

    <section class="panel" id="s-connect"><h3>Connect your automations</h3>
      <p class="sub">The automations run on <b>n8n</b> and send through <b>Twilio</b> (texts) and <b>Gmail</b> (emails). Usually done once by whoever installed this for you.</p>
      <div class="status-row"><span class="light ${integ.last_n8n_contact ? 'ok' : ''}"></span>${integ.last_n8n_contact ? `Connected · last check-in ${ago(integ.last_n8n_contact)}` : 'Not connected yet'}</div>
      <ol class="steps">
        <li><div><b>Addresses</b><p class="sub">n8n must be able to open the CRM address (use your public domain, not "localhost", if n8n runs in the cloud).</p>
          <div class="row2"><div class="field"><label>This CRM's public address</label><input id="public_url" value="${esc(s.public_url)}" placeholder="${esc(integ.crm_url)}"></div>
          <div class="field"><label>Your n8n address</label><input id="n8n_base_url" value="${esc(s.n8n_base_url)}" placeholder="https://yourname.app.n8n.cloud"></div></div>
          <div class="row2"><div class="field"><label>Twilio number texts come from</label><input id="sms_from" value="${esc(s.sms_from)}" placeholder="+61400000000"></div><div></div></div></div></li>
        <li><div><b>Already-saved logins (optional, recommended)</b><p class="sub">Paste the IDs of the Twilio and Gmail credentials already saved in n8n and the engine arrives <b>pre-connected</b> — nobody has to log in again. Find an ID by opening the credential in n8n: it's the code at the end of the address bar.</p>
          <div class="row2">${f('n8n_twilio_cred_id', 'Twilio credential ID')}${f('n8n_twilio_cred_name', 'Twilio credential name', 'placeholder="Twilio account"')}</div>
          <div class="row2">${f('n8n_gmail_cred_id', 'Gmail credential ID')}${f('n8n_gmail_cred_name', 'Gmail credential name', 'placeholder="Gmail account"')}</div></div></li>
        <li><div><b>Install the engine</b><p class="sub">Save, download, then in n8n choose <i>Workflows → Import from file</i> and switch it to <b>Active</b>. It's one workflow that runs everything; messages and settings stay here.</p>
          <button class="btn" id="save2">Save addresses</button> <a class="btn primary" id="dl" href="/api/integrations/workflow">${icon('download', 15)} Download engine for n8n</a></div></li>
        <li><div><b>Test it</b><p class="sub">Checks both directions: the CRM can reach n8n, and n8n can reach the CRM.</p>
          <button class="btn" id="test">Test connection</button><div id="test_out"></div></div></li>
        <li><div><b>Plug in your phone line</b>${hooks ? `<p class="sub">Paste these into Twilio and your voice agent. That's the last step.</p>
          ${hookRow('Incoming texts', 'Twilio → your number → Messaging → "A message comes in"', hooks.reply)}
          ${hookRow('Missed calls', 'Twilio → your number → Voice → "Call status changes" (or your phone system\'s missed-call webhook)', hooks.missed)}
          ${hookRow('Voice agent', "Your AI receptionist's end-of-call webhook", hooks.voice)}
          ${hookRow('Bookings', 'Optional: your booking system, to mark appointments automatically', hooks.booking)}` : '<p class="sub">Add your n8n address above and save — the links to paste appear here.</p>'}</div></li>
      </ol>
      <details class="adv"><summary>Advanced: API key</summary><p class="sub">The engine already contains this key. Only needed for custom integrations (send it as the <code>x-api-key</code> header).</p>
        <div class="urlbox"><code id="key">••••••••••••••••••••</code><button class="btn" id="reveal">Show</button><button class="btn" data-copy="${esc(integ.api_key)}">${icon('copy', 15)} Copy</button></div></details>
    </section>

    <section class="panel" id="s-data"><h3>Your data</h3><p class="sub">Download everything as spreadsheets at any time.</p>
      <div class="btnrow"><a class="btn" href="/api/export/patients.csv">${icon('download', 15)} Patients</a><a class="btn" href="/api/export/messages.csv">${icon('download', 15)} Texts</a><a class="btn" href="/api/export/calls.csv">${icon('download', 15)} Calls</a></div>
      <h4>Sample data</h4><p class="sub">Fake patients, texts and calls marked "sample" — handy for training staff. Your real data is never touched.</p>
      <div class="btnrow"><button class="btn" id="seed">Load sample data</button><button class="btn danger" id="clear">Remove sample data</button></div></section>

    <section class="panel" id="s-account"><h3>Account</h3>
      <div class="row2"><div class="field"><label>Current password</label><input id="pw_cur" type="password" autocomplete="current-password"></div><div class="field"><label>New password (8+ characters)</label><input id="pw_new" type="password" autocomplete="new-password"></div></div>
      <div class="btnrow"><button class="btn" id="pw">Change password</button><button class="btn" id="logout">${icon('logout', 15)} Log out</button></div></section>
  </div></div>`;

  bindDayChips(el);
  el.querySelectorAll('[data-jump]').forEach(a => (a.onclick = e => { e.preventDefault(); $('#s-' + a.dataset.jump).scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  el.querySelectorAll('[data-copy]').forEach(b => (b.onclick = () => copy(b.dataset.copy)));
  const keys = ['clinic_name', 'clinic_phone', 'booking_link', 'timezone', 'open_hour', 'close_hour', 'avg_appointment_value', 'sms_cost', 'email_cost', 'voice_cost_per_call',
    'public_url', 'n8n_base_url', 'sms_from', 'n8n_twilio_cred_id', 'n8n_twilio_cred_name', 'n8n_gmail_cred_id', 'n8n_gmail_cred_name'];
  const save = async (again = true) => {
    const body = Object.fromEntries(keys.map(k => [k, $('#' + k).value.trim()]));
    body.open_days = readDays(el);
    if (!body.open_days) return toast('Pick at least one open day.', 'warn');
    if (+body.close_hour <= +body.open_hour) return toast('Closing time must be after opening time.', 'warn');
    body.n8n_base_url = body.n8n_base_url.replace(/\/+$/, ''); body.public_url = body.public_url.replace(/\/+$/, '');
    await api('/settings', { method: 'PUT', body }); $('#clinic').textContent = body.clinic_name; toast('Saved');
    if (again) settings(el);
  };
  $('#save').onclick = () => save(); $('#save2').onclick = () => save();
  $('#dl').onclick = async e => { e.preventDefault(); await save(false); location.href = '/api/integrations/workflow'; };
  $('#test').onclick = async () => {
    const out = $('#test_out'); out.innerHTML = '<p class="sub">Testing… (up to 10 seconds)</p>';
    try {
      const r = await api('/integrations/test', { method: 'POST', body: {} });
      out.innerHTML = `<ul class="checks"><li class="${r.n8n ? 'ok' : 'bad'}">CRM → n8n</li><li class="${r.crm ? 'ok' : 'bad'}">n8n → CRM</li></ul>${r.hint ? `<p class="err">${esc(r.hint)}</p>` : '<p class="ok-text">All good — your automations are connected.</p>'}`;
    } catch (e) { out.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  };
  $('#reveal').onclick = () => { $('#key').textContent = integ.api_key; };
  $('#seed').onclick = async () => { await api('/demo/seed', { method: 'POST', body: {} }); toast('Sample data loaded'); location.hash = 'overview'; };
  $('#clear').onclick = async () => { if (await confirmBox('Remove sample data?', 'Only records marked "sample" are removed.', 'Remove', true)) { await api('/demo', { method: 'DELETE' }); toast('Sample data removed'); } };
  $('#pw').onclick = async () => {
    try { await api('/auth/password', { method: 'POST', body: { current: $('#pw_cur').value, next: $('#pw_new').value } }); toast('Password changed'); $('#pw_cur').value = $('#pw_new').value = ''; }
    catch (e) { toast(e.message, 'bad'); }
  };
  $('#logout').onclick = async () => { await api('/auth/logout', { method: 'POST', body: {} }); location.reload(); };
}
