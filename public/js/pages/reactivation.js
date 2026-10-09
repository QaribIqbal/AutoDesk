import { $, api, esc, money, pct, when, day, debounce, modal, closeModal, confirmBox, toast, icon, smsCredits } from '../core.js';
import { gauge, odometer, funnel, stat, head, bindRange, animate, setSync, syncPill, state, testBanner, phone, chips, bindChips } from '../ui.js';

let tab = 'campaigns', campaignFilter = '';
const AUDIENCE = [[0, 'Everyone who can be texted'], [6, "Haven't visited in 6+ months"], [12, "Haven't visited in 12+ months"], [18, "Haven't visited in 18+ months"], [24, "Haven't visited in 2+ years"]];

export async function reactivation(el) {
  const [s, settings] = await Promise.all([api('/summary?days=' + state.days), api('/settings')]);
  const r = s.reactivation; setSync(s);
  el.innerHTML = `${testBanner(settings.demo_mode)}
  ${head('Automation 01', 'Win-back texts', 'Text patients who haven\'t been in for a while. See who replied, who booked, and what it earned.', syncPill(r.last))}
  <div class="cluster">
    ${odometer(r.revenue, 'Estimated revenue', `<span><b>${r.booked}</b> booked</span><span>cost <b>${money(r.cost)}</b></span><span>return <b>${r.roi == null ? '—' : r.roi.toFixed(1) + '×'}</b></span>`)}
    ${gauge({ v: r.reply_rate, max: 0.6, label: 'Reply rate', sub: `${r.replies} replies` })}
    ${gauge({ v: r.book_rate, max: 0.3, label: 'Booking rate', sub: `${r.booked} appointments` })}
    ${gauge({ v: r.sent ? r.optouts / r.sent : 0, max: 0.2, label: 'Opt-out rate', sub: `${r.optouts} said STOP`, color: '#ff5b3a', help: 'Lower is better' })}
  </div>
  <div class="sec">Funnel</div>
  <div class="two"><div class="panel">${funnel([{ label: 'Texted', n: r.sent, color: '#0f1114' }, { label: 'Replied', n: r.replies, color: '#2f4bff' }, { label: 'Booked', n: r.booked, color: '#0d7a4b' }])}</div>
  <div class="stats two-col">${stat('Patients reached', r.contacts, 'unique numbers')}${stat('Avg per booking', r.booked ? money(r.revenue / r.booked) : '—', 'revenue')}</div></div>
  <div class="tabs">${[['campaigns', 'Campaigns'], ['log', 'Every text sent']].map(([k, l]) => `<button class="tab ${tab === k ? 'active' : ''}" data-t="${k}">${l}</button>`).join('')}</div>
  <div id="pane"></div>`;
  bindRange(el, () => reactivation(el)); animate(el);
  el.querySelectorAll('.tab').forEach(t => (t.onclick = () => { tab = t.dataset.t; campaignFilter = ''; reactivation(el); }));
  tab === 'campaigns' ? campaigns($('#pane'), settings, () => reactivation(el)) : log($('#pane'), () => reactivation(el));
}

async function campaigns(pane, settings, refresh) {
  const list = await api('/campaigns');
  pane.innerHTML = `<div class="toolbar"><p class="sub grow">A campaign texts every matching patient once. Patients who opted out or have no consent are always skipped.</p>
    <button class="btn primary" id="new">${icon('plus', 16)} New campaign</button></div>
    ${list.length ? `<div class="cards">${list.map(c => `<article class="ccard">
      <header><div><h3>${esc(c.name)}</h3><small>${c.launched_at ? 'Sent ' + day(c.launched_at) : 'Draft · created ' + day(c.created_at)}</small></div>
      <span class="chip ${c.status === 'draft' ? '' : c.status === 'sending' ? 'a' : 'g'}">${c.status === 'draft' ? 'draft' : c.status === 'sending' ? 'sending…' : 'sent'}</span></header>
      <p class="cmsg">${esc(c.template)}</p>
      <div class="cstats"><div><b>${c.sent}</b><small>texted</small></div><div><b>${c.replies}</b><small>replied</small></div><div><b>${c.booked}</b><small>booked</small></div><div><b>${money(c.revenue)}</b><small>revenue</small></div></div>
      <footer>${c.status === 'draft' ? `<button class="btn primary" data-a="launch" data-id="${c.id}">${icon('send', 15)} Send now</button><button class="btn" data-a="del" data-id="${c.id}">Delete</button>`
        : `<button class="btn" data-a="view" data-id="${c.id}">See texts</button><span class="sub">${c.sent ? pct(c.replies / c.sent) + ' replied' : ''}</span>`}</footer></article>`).join('')}</div>`
      : `<div class="empty"><b>No campaigns yet</b>Create one to text patients who haven't visited in a while.</div>`}`;
  $('#new').onclick = () => editor(settings, refresh);
  pane.querySelectorAll('[data-a]').forEach(b => (b.onclick = async () => {
    const c = list.find(x => x.id == b.dataset.id);
    if (b.dataset.a === 'launch') await launch(c, settings, refresh);
    if (b.dataset.a === 'view') { tab = 'log'; campaignFilter = c.id; log(pane, refresh, c); document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.t === 'log')); }
    if (b.dataset.a === 'del' && await confirmBox('Delete this draft?', 'It has not been sent, so nothing is lost.', 'Delete', true)) { await api('/campaigns/' + c.id, { method: 'DELETE' }); refresh(); }
  }));
}

async function launch(c, settings, refresh) {
  const preview = await api('/campaigns/preview', { method: 'POST', body: { min_months: c.min_months, template: c.template } });
  if (!preview.count) return toast('No patients match this campaign right now.', 'warn');
  const ok = await confirmBox(`Send to ${preview.count} patient${preview.count === 1 ? '' : 's'}?`,
    settings.demo_mode ? 'Test mode is on, so nothing will actually be sent. The texts will appear in your log marked "test".'
      : 'Real text messages will go out now. This cannot be undone.', settings.demo_mode ? 'Run test send' : 'Send texts now');
  if (!ok) return;
  try {
    const r = await api(`/campaigns/${c.id}/launch`, { method: 'POST', body: {} });
    toast(r.mode === 'test' ? `Test send done — ${r.sent} texts logged` : `Sending to ${r.queued} patients…`); refresh();
  } catch (e) { toast(e.message, 'bad'); }
}

function editor(settings, refresh) {
  modal(`<h3>New win-back campaign</h3><div class="editor">
    <div><div class="field"><label>Campaign name</label><input id="c_name" placeholder="e.g. End-of-year health fund reminder"></div>
      <div class="field"><label>Who should get it?</label><select id="c_aud">${AUDIENCE.map(([v, l]) => `<option value="${v}" ${v === 6 ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label>The message</label><textarea id="c_tpl" rows="7">${esc(settings.tpl_reactivation)}</textarea>${chips('c_tpl')}<div class="meter" id="c_meter"></div></div>
      <div class="reach" id="c_reach">Counting patients…</div></div>
    <div class="preview-col"><div class="eyebrow">What patients will see</div><div id="c_prev"></div></div></div>
    <div class="foot"><button class="btn" id="c_cancel">Cancel</button><button class="btn" id="c_save">Save as draft</button><button class="btn primary" id="c_go">${icon('send', 15)} Save & send</button></div>`, { wide: true });
  const update = debounce(async () => {
    const tpl = $('#c_tpl').value, m = smsCredits(tpl.replace(/\{\w+\}/g, 'xxxxxxxx'));
    $('#c_meter').innerHTML = `<span>${m.len} characters · about <b>${m.credits}</b> text credit${m.credits === 1 ? '' : 's'} each</span>${m.unicode ? '<span class="warn">Special characters (like — or emoji) make texts cost more</span>' : ''}`;
    const p = await api('/campaigns/preview', { method: 'POST', body: { min_months: +$('#c_aud').value, template: tpl } });
    $('#c_reach').innerHTML = `<b>${p.count}</b> patient${p.count === 1 ? '' : 's'} will get this text${p.count ? ` · est. cost ${money(p.count * m.credits * settings.sms_cost)}` : ' — try a wider audience or add patients'}`;
    $('#c_prev').innerHTML = phone(settings.clinic_name, p.sample.message);
  }, 200);
  $('#c_tpl').oninput = update; $('#c_aud').onchange = update; bindChips($('#modal'), update); update();
  $('#c_cancel').onclick = closeModal;
  const save = async go => {
    const body = { name: $('#c_name').value, template: $('#c_tpl').value, min_months: +$('#c_aud').value };
    try {
      const { id } = await api('/campaigns', { method: 'POST', body });
      closeModal(); refresh();
      if (go) await launch({ id, ...body }, settings, refresh); else toast('Draft saved');
    } catch (e) { toast(e.message, 'bad'); }
  };
  $('#c_save').onclick = () => save(false); $('#c_go').onclick = () => save(true);
}

async function log(pane, refresh, campaign) {
  pane.innerHTML = `<div class="toolbar">${campaign ? `<span class="chip k plain">${esc(campaign.name)}</span><button class="mini" id="clr">show all</button>` : ''}
    <input id="q" placeholder="Search name, phone or message…" style="min-width:260px">
    <select id="f"><option value="">All texts</option><option value="replied">Replied</option><option value="booked">Booked</option><option value="opted_out">Opted out</option></select>
    <span class="grow"></span><a class="btn" href="/api/export/messages.csv">${icon('download', 15)} Export</a></div><div id="tbl"></div>`;
  $('#clr')?.addEventListener('click', () => { campaignFilter = ''; log(pane, refresh); });
  const load = async () => {
    const f = $('#f').value, qs = new URLSearchParams({ search: $('#q').value, ...(f ? { [f]: '1' } : {}), ...(campaignFilter ? { campaign_id: campaignFilter } : {}) });
    const rows = await api('/sms?' + qs);
    $('#tbl').innerHTML = rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>Sent</th><th>Patient</th><th>Message</th><th>Status</th><th>Reply</th><th>Appointment</th><th></th></tr></thead><tbody>
    ${rows.map(x => `<tr>
      <td class="mono">${when(x.sent_at)}</td>
      <td class="who"><b>${esc(x.name) || 'Unknown'}</b><small>${esc(x.phone)}${x.treatment ? ' · ' + esc(x.treatment) : ''}</small></td>
      <td class="msg">${esc(x.message)}</td>
      <td>${x.status === 'demo_sent' ? '<span class="chip a">test</span>' : x.status === 'failed' ? '<span class="chip r">failed</span>' : '<span class="chip b">sent</span>'}${x.source === 'seed' ? ' <span class="chip plain">sample</span>' : ''}</td>
      <td>${x.opted_out ? '<span class="chip r">STOP</span>' : x.replied ? `<span class="chip g">${esc(x.reply_text) || 'replied'}</span>` : '<span class="mono muted">—</span>'}</td>
      <td>${x.appointment_booked ? `<span class="chip k">booked${x.value ? ' · ' + money(x.value) : ''}</span>` : ''}</td>
      <td class="act"><button class="mini ${x.replied ? 'on' : ''}" data-a="reply" data-id="${x.id}">replied</button><button class="mini ${x.appointment_booked ? 'on' : ''}" data-a="book" data-id="${x.id}">booked</button><button class="mini" data-a="del" data-id="${x.id}" aria-label="Delete">✕</button></td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty"><b>No texts found</b>Launch a campaign and every text will show up here.</div>';
    $('#tbl').querySelectorAll('button[data-a]').forEach(b => (b.onclick = async () => {
      const x = rows.find(r => r.id == b.dataset.id);
      if (b.dataset.a === 'reply') await api('/sms/' + x.id, { method: 'PATCH', body: { replied: !x.replied, replied_at: new Date().toISOString() } });
      if (b.dataset.a === 'book') await api('/sms/' + x.id, { method: 'PATCH', body: { appointment_booked: !x.appointment_booked, ...(x.appointment_booked ? {} : { replied: 1 }) } });
      if (b.dataset.a === 'del') { if (!await confirmBox('Delete this record?', 'It will be removed from your stats.', 'Delete', true)) return; await api('/sms/' + x.id, { method: 'DELETE' }); }
      refresh();
    }));
  };
  $('#q').oninput = debounce(load); $('#f').onchange = load; load();
}
