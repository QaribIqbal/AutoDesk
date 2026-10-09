import { $, api, esc, money, when, debounce, modal, closeModal, confirmBox, toast, icon } from '../core.js';
import { gauge, odometer, funnel, stat, head, bindRange, animate, setSync, syncPill, state } from '../ui.js';

let tab = 'all';
const HANDLED = { ai: 'AI receptionist', email: 'Email sent', sms: 'Text sent', human: 'Staff', none: 'Not handled' };

export async function voice(el) {
  const s = await api('/summary?days=' + state.days), v = s.voice; setSync(s);
  const saved = v.missed_recovered + v.after_hours_handled;
  el.innerHTML = `${head('Automation 02', 'Calls & voice agent', 'Missed calls we followed up, and after-hours calls your AI receptionist answered — calls that would otherwise be lost.', syncPill(v.last))}
  <div class="cluster">
    ${odometer(v.revenue, 'Estimated revenue', `<span><b>${v.booked}</b> booked</span><span>cost <b>${money(v.cost)}</b></span><span>return <b>${v.roi == null ? '—' : v.roi.toFixed(1) + '×'}</b></span>`)}
    ${gauge({ v: v.recovery_rate, max: 1, label: 'Missed calls recovered', sub: `${v.missed_recovered} of ${v.missed}` })}
    ${gauge({ v: v.handled_rate, max: 1, label: 'After-hours handled', sub: `${v.after_hours_handled} of ${v.after_hours}` })}
    ${gauge({ v: v.total ? v.booked / v.total : 0, max: 0.5, label: 'Call → appointment', sub: `${v.booked} of ${v.total} calls` })}
  </div>
  <div class="sec">Funnel</div>
  <div class="two"><div class="panel">${funnel([{ label: 'All calls', n: v.total, color: '#0f1114' }, { label: 'Saved', n: saved, color: '#2f4bff' }, { label: 'Booked', n: v.booked, color: '#0d7a4b' }])}</div>
  <div class="stats two-col">${stat('Missed calls', v.missed, `${v.emails} emailed · ${v.sms_followups} texted`, '#ffb020')}${stat('After-hours calls', v.after_hours, `${v.ai_handled} answered by AI`, '#2f4bff')}</div></div>
  <div class="tabs">${[['all', 'All calls'], ['missed', 'Missed (while open)'], ['after_hours', 'After-hours']].map(([k, l]) => `<button class="tab ${tab === k ? 'active' : ''}" data-t="${k}">${l}</button>`).join('')}</div>
  <div class="toolbar"><input id="q" placeholder="Search name, number, email or summary…" style="min-width:280px"><span class="grow"></span>
    <a class="btn" href="/api/export/calls.csv">${icon('download', 15)} Export</a><button class="btn primary" id="add">${icon('plus', 16)} Log a call</button></div>
  <div id="tbl"></div>`;
  bindRange(el, () => voice(el)); animate(el);
  el.querySelectorAll('.tab').forEach(t => (t.onclick = () => { tab = t.dataset.t; voice(el); }));
  const load = async () => {
    const rows = await api(`/calls?search=${encodeURIComponent($('#q').value)}${tab !== 'all' ? '&type=' + tab : ''}`);
    $('#tbl').innerHTML = rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>When</th><th>Caller</th><th>Type</th><th>What happened</th><th>Summary</th><th>Came back?</th><th>Appointment</th><th></th></tr></thead><tbody>
    ${rows.map(x => `<tr>
      <td class="mono">${when(x.created_at)}</td>
      <td class="who"><b>${esc(x.caller_name) || 'Unknown caller'}</b><small>${esc(x.caller_number)}${x.caller_email ? ' · ' + esc(x.caller_email) : ''}</small></td>
      <td>${x.call_type === 'after_hours' ? '<span class="chip b">after-hours</span>' : '<span class="chip a">missed</span>'}${x.source === 'seed' ? ' <span class="chip plain">sample</span>' : ''}</td>
      <td>${HANDLED[x.handled_by] || esc(x.handled_by)}${x.status === 'failed' ? ' <span class="chip r">failed</span>' : x.status === 'demo_logged' ? ' <span class="chip a">test</span>' : ''}</td>
      <td class="msg">${esc(x.summary || '')}</td>
      <td>${x.recovered ? '<span class="chip g">yes</span>' : '<span class="chip">not yet</span>'}</td>
      <td>${x.appointment_booked ? `<span class="chip k">booked${x.value ? ' · ' + money(x.value) : ''}</span>` : ''}</td>
      <td class="act"><button class="mini ${x.recovered ? 'on' : ''}" data-a="rec" data-id="${x.id}">came back</button><button class="mini ${x.appointment_booked ? 'on' : ''}" data-a="book" data-id="${x.id}">booked</button><button class="mini" data-a="del" data-id="${x.id}" aria-label="Delete">✕</button></td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty"><b>No calls yet</b>They appear here as soon as your phone system or voice agent reports them.</div>';
    $('#tbl').querySelectorAll('button[data-a]').forEach(b => (b.onclick = async () => {
      const x = rows.find(r => r.id == b.dataset.id);
      if (b.dataset.a === 'rec') await api('/calls/' + x.id, { method: 'PATCH', body: { recovered: !x.recovered } });
      if (b.dataset.a === 'book') await api('/calls/' + x.id, { method: 'PATCH', body: { appointment_booked: !x.appointment_booked, ...(x.appointment_booked ? {} : { recovered: 1 }) } });
      if (b.dataset.a === 'del') { if (!await confirmBox('Delete this call?', 'It will be removed from your stats.', 'Delete', true)) return; await api('/calls/' + x.id, { method: 'DELETE' }); }
      voice(el);
    }));
  };
  $('#q').oninput = debounce(load); load();
  $('#add').onclick = () => {
    modal(`<h3>Log a call</h3><p class="sub">For calls your phone system didn't report automatically.</p>
    <div class="row2"><div class="field"><label>Caller name</label><input id="m_name"></div><div class="field"><label>Phone number *</label><input id="m_num" placeholder="0412 345 678"></div></div>
    <div class="row2"><div class="field"><label>Type</label><select id="m_type"><option value="missed">Missed call (while open)</option><option value="after_hours">After-hours call</option></select></div>
    <div class="field"><label>Who handled it?</label><select id="m_by">${Object.entries(HANDLED).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div></div>
    <div class="field"><label>Notes</label><textarea id="m_sum" rows="2"></textarea></div>
    <div class="foot"><button class="btn" id="m_c">Cancel</button><button class="btn primary" id="m_s">Save</button></div>`);
    $('#m_c').onclick = closeModal;
    $('#m_s').onclick = async () => {
      try {
        await api('/calls', { method: 'POST', body: { caller_name: $('#m_name').value, caller_number: $('#m_num').value, call_type: $('#m_type').value, handled_by: $('#m_by').value, summary: $('#m_sum').value, source: 'manual' } });
        closeModal(); toast('Call logged'); voice(el);
      } catch (e) { toast(e.message, 'bad'); }
    };
  };
}
