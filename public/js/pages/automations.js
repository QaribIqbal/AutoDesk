import { $, api, esc, toast, copy, icon, smsCredits, confirmBox } from '../core.js';
import { head, toggle, phone, chips, bindChips, setSync } from '../ui.js';

const DELAYS = [[10, '10 seconds'], [60, '1 minute'], [120, '2 minutes'], [300, '5 minutes'], [900, '15 minutes']];

export async function automations(el) {
  const [s, integ, summary] = await Promise.all([api('/settings'), api('/integrations'), api('/summary')]);
  setSync(summary);
  const connected = !!integ.last_n8n_contact;
  const sample = { first_name: 'Sarah', name: 'Sarah Mitchell', clinic: s.clinic_name, months: 11, booking_link: s.booking_link || s.clinic_phone || 'your booking link', clinic_phone: s.clinic_phone, phone: '+61412345678', reply: 'YES' };
  const fill = t => String(t || '').replace(/\{(\w+)\}/g, (_, k) => sample[k] ?? '');
  const meter = id => `<div class="meter" id="${id}_m"></div>`;

  el.innerHTML = `${head('Control', 'Automations', 'Switch each automation on or off and choose exactly what patients receive. Changes apply instantly — no technical setup needed.', '', false)}
  <section class="golive ${s.demo_mode ? 'test' : 'live'}">
    <div><div class="eyebrow">${s.demo_mode ? 'Test mode' : 'Live'}</div>
      <h2>${s.demo_mode ? 'Nothing is being sent to patients yet' : 'Your automations are live'}</h2>
      <p>${s.demo_mode ? 'Try everything safely: campaigns and follow-ups run and are logged, but no real texts or emails go out.' : 'Real texts and emails are going out to patients. Switch back to test mode any time.'}</p></div>
    <button class="btn ${s.demo_mode ? 'primary' : ''} big" id="mode">${s.demo_mode ? 'Go live' : 'Back to test mode'}</button>
  </section>

  <section class="auto">
    <header>${icon('sms', 22)}<div><h3>Win-back texts</h3><p>Text patients who haven't visited in a while. You choose who and when on the <a href="#reactivation">Win-back</a> page.</p></div>${toggle('reactivation_enabled', s.reactivation_enabled, 'Win-back texts on/off')}</header>
    <div class="auto-body"><div>
      <div class="field"><label>Default message for new campaigns</label><textarea id="tpl_reactivation" rows="5">${esc(s.tpl_reactivation)}</textarea>${chips('tpl_reactivation')}${meter('tpl_reactivation')}</div>
      <div class="row2"><div class="field"><label>Text me when a patient replies YES</label><input id="owner_phone" value="${esc(s.owner_phone)}" placeholder="Your mobile, e.g. 0412 345 678"></div><div></div></div>
      <div class="field"><label>That alert says</label><textarea id="tpl_owner_alert" rows="2">${esc(s.tpl_owner_alert)}</textarea></div>
    </div><div class="preview-col" id="pv_react"></div></div>
  </section>

  <section class="auto">
    <header>${icon('voice', 22)}<div><h3>Missed-call follow-up</h3><p>When nobody picks up, we follow up automatically: an email if we know their address, otherwise a text.</p></div>${toggle('missed_call_enabled', s.missed_call_enabled, 'Missed-call follow-up on/off')}</header>
    <div class="auto-body"><div>
      <div class="field"><label>Wait before following up</label><select id="followup_delay_seconds">${DELAYS.map(([v, l]) => `<option value="${v}" ${+s.followup_delay_seconds === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label>Text message (when we don't have their email)</label><textarea id="tpl_missed_sms" rows="3">${esc(s.tpl_missed_sms)}</textarea>${chips('tpl_missed_sms', [['{first_name}', 'First name'], ['{clinic}', 'Clinic name'], ['{booking_link}', 'Booking link'], ['{clinic_phone}', 'Clinic phone']])}${meter('tpl_missed_sms')}</div>
      <div class="field"><label>Email subject</label><input id="tpl_missed_email_subject" value="${esc(s.tpl_missed_email_subject)}"></div>
      <div class="field"><label>Email message</label><textarea id="tpl_missed_email_body" rows="7">${esc(s.tpl_missed_email_body)}</textarea>${chips('tpl_missed_email_body', [['{first_name}', 'First name'], ['{clinic}', 'Clinic name'], ['{booking_link}', 'Booking link']])}</div>
    </div><div class="preview-col" id="pv_missed"></div></div>
  </section>

  <section class="auto">
    <header>${icon('bolt', 22)}<div><h3>After-hours AI receptionist</h3><p>Your voice agent answers when you're closed. Every call it takes is logged here and counted as an after-hours call (based on your <a href="#settings">opening hours</a>).</p></div>
      <span class="chip ${summary.voice.ai_handled ? 'g' : ''}">${summary.voice.ai_handled ? summary.voice.ai_handled + ' calls handled' : 'waiting for first call'}</span></header>
    <div class="auto-body single">${integ.webhooks ? `<p class="sub">Give this address to your voice agent provider as its <b>end-of-call webhook</b>:</p>
      <div class="urlbox"><code>${esc(integ.webhooks.voice)}</code><button class="btn" data-copy="${esc(integ.webhooks.voice)}">${icon('copy', 15)} Copy</button></div>`
      : '<p class="sub">Connect your automations first in <a href="#settings">Settings → Connect</a>, then the address to give your voice agent appears here.</p>'}</div>
  </section>
  <div class="savebar"><span class="sub">Changes to messages are used from the next text or email onwards.</span><button class="btn primary big" id="save">Save changes</button></div>`;

  const previews = () => {
    $('#pv_react').innerHTML = `<div class="eyebrow">Patient sees</div>${phone(s.clinic_name, fill($('#tpl_reactivation').value))}<div class="eyebrow" style="margin-top:14px">You get (on YES)</div>${phone(s.clinic_name + ' alerts', fill($('#tpl_owner_alert').value))}`;
    $('#pv_missed').innerHTML = `<div class="eyebrow">Text</div>${phone(s.clinic_name, fill($('#tpl_missed_sms').value))}
      <div class="eyebrow" style="margin-top:14px">Email</div><div class="mail"><b>${esc(fill($('#tpl_missed_email_subject').value))}</b><p>${esc(fill($('#tpl_missed_email_body').value)).replace(/\n/g, '<br>')}</p></div>`;
    for (const id of ['tpl_reactivation', 'tpl_missed_sms']) {
      const m = smsCredits(fill($('#' + id).value));
      $(`#${id}_m`).innerHTML = `<span>${m.len} characters · <b>${m.credits}</b> text credit${m.credits === 1 ? '' : 's'}</span>${m.unicode ? '<span class="warn">Special characters (— “ ” emoji) make each text cost more</span>' : ''}`;
    }
  };
  el.querySelectorAll('textarea,input').forEach(i => i.addEventListener('input', previews));
  bindChips(el, previews); previews();
  el.querySelectorAll('[data-copy]').forEach(b => (b.onclick = () => copy(b.dataset.copy)));

  const fields = ['tpl_reactivation', 'owner_phone', 'tpl_owner_alert', 'followup_delay_seconds', 'tpl_missed_sms', 'tpl_missed_email_subject', 'tpl_missed_email_body'];
  const collect = () => ({ ...Object.fromEntries(fields.map(f => [f, $('#' + f).value])), reactivation_enabled: $('#reactivation_enabled').checked, missed_call_enabled: $('#missed_call_enabled').checked });
  $('#save').onclick = async () => { await api('/settings', { method: 'PUT', body: collect() }); toast('Saved'); };
  for (const id of ['reactivation_enabled', 'missed_call_enabled']) $('#' + id).onchange = async e => {
    await api('/settings', { method: 'PUT', body: { [id]: e.target.checked } }); toast(e.target.checked ? 'Switched on' : 'Switched off');
  };
  $('#mode').onclick = async () => {
    if (s.demo_mode) {
      if (!connected) return toast('Connect your automations first (Settings → Connect), then go live.', 'warn');
      if (!s.sms_from) return toast('Add your Twilio sending number in Settings → Connect first.', 'warn');
      if (!await confirmBox('Go live?', 'From now on, campaigns and missed-call follow-ups will send real texts and emails to patients.', 'Go live')) return;
    }
    await api('/settings', { method: 'PUT', body: { ...collect(), demo_mode: !s.demo_mode } });
    toast(s.demo_mode ? "You're live!" : 'Back in test mode'); automations(el);
  };
}
