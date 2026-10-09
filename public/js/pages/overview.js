import { api, esc, money, when, toast } from '../core.js';
import { gauge, odometer, stat, head, bindRange, animate, setSync, state, testBanner } from '../ui.js';

export async function overview(el) {
  const [s, inbox] = await Promise.all([api('/summary?days=' + state.days), api('/inbox')]);
  const { reactivation: r, voice: v, totals: t, series } = s;
  setSync(s);
  const saved = v.missed_recovered + v.after_hours_handled, max = Math.max(1, ...series.map(x => x.sms + x.calls));
  const totalRev = Math.max(1, r.revenue + v.revenue);
  const todo = inbox.hot_leads.length + inbox.callbacks.length;

  el.innerHTML = `${testBanner(s.n8n.demo_mode)}
  ${head('Home', 'Overview', 'What your automations have earned the clinic, and who needs a call back today.')}
  <div class="cluster">
    ${odometer(t.revenue, 'Estimated revenue', `<span><b>${t.booked}</b> appointments</span><span>cost <b>${money(t.cost)}</b></span><span>net <b>${money(t.net)}</b></span>`)}
    ${gauge({ v: r.reply_rate, max: 0.6, label: 'Text reply rate', sub: `${r.replies} of ${r.sent} texts`, help: 'Share of win-back texts that got a reply' })}
    ${gauge({ v: v.recovery_rate, max: 1, label: 'Missed calls recovered', sub: `${v.missed_recovered} of ${v.missed} calls`, help: 'Missed calls where the patient came back' })}
    ${gauge({ v: v.handled_rate, max: 1, label: 'After-hours handled', sub: `${v.after_hours_handled} of ${v.after_hours} calls`, help: 'Calls while closed that still got answered or followed up' })}
  </div>
  ${r.sent + v.total === 0 ? `<div class="callout"><span>Nothing here yet. Add your patients and launch your first win-back campaign.</span><a class="btn" href="#patients">Add patients →</a></div>` : ''}

  <div class="sec">To do today ${todo ? `<span class="count">${todo}</span>` : ''}</div>
  <div class="two eq">
    <div class="panel"><h3>Replied to a text — book them in</h3>${inbox.hot_leads.length ? `<ul class="todo">${inbox.hot_leads.map(x => `<li>
      <div><b>${esc(x.name) || esc(x.phone)}</b><small>"${esc(x.reply_text)}" · ${esc(x.phone)} · ${when(x.replied_at || x.sent_at)}</small></div>
      <div class="todo-a"><button class="mini on" data-k="sms" data-a="book" data-id="${x.id}">Booked</button><button class="mini" data-k="sms" data-a="dismiss" data-id="${x.id}">Not interested</button></div></li>`).join('')}</ul>`
      : '<p class="sub">No one waiting. Nice.</p>'}</div>
    <div class="panel"><h3>Missed calls — call them back</h3>${inbox.callbacks.length ? `<ul class="todo">${inbox.callbacks.map(x => `<li>
      <div><b>${esc(x.caller_name) || esc(x.caller_number)}</b><small>${esc(x.caller_number)} · ${when(x.created_at)} · we sent ${esc(x.followup_channel || 'nothing')}</small></div>
      <div class="todo-a"><button class="mini on" data-k="calls" data-a="book" data-id="${x.id}">Booked</button><button class="mini" data-k="calls" data-a="rec" data-id="${x.id}">Spoke to them</button><button class="mini" data-k="calls" data-a="dismiss" data-id="${x.id}">Dismiss</button></div></li>`).join('')}</ul>`
      : '<p class="sub">Every missed call has been handled.</p>'}</div>
  </div>

  <div class="sec">Scorecard</div>
  <div class="stats">
    ${stat('Appointments booked', t.booked, `${r.booked} from texts · ${v.booked} from calls`, '#0d7a4b')}
    ${stat('Win-back revenue', money(r.revenue), `${r.sent} texts sent`, '#d3ff3c')}
    ${stat('Calls revenue', money(v.revenue), `${saved} calls saved`, '#2f4bff')}
    ${stat('Running cost', money(t.cost), 'texts · emails · AI calls', '#ff5b3a')}
    ${stat('Net gain', money(t.net), 'revenue minus cost', '#0f1114')}
  </div>

  <div class="sec">Activity</div>
  <div class="two">
    <div class="panel"><h3>Last 14 days</h3><div class="chart">${series.map(d => `<div class="col" title="${d.date}: ${d.sms} texts, ${d.calls} calls">
      <div class="b" style="height:0;background:#2f4bff" data-h="${d.calls / max * 100}"></div><div class="b" style="height:0;background:#0f1114" data-h="${d.sms / max * 100}"></div><span class="d">${d.date.slice(8)}</span></div>`).join('')}</div>
      <div class="legend"><span><i style="background:#0f1114"></i>Texts sent</span><span><i style="background:#2f4bff"></i>Calls</span></div></div>
    <div class="panel"><h3>Where the money comes from</h3>
      <div class="split"><i style="width:${r.revenue / totalRev * 100}%;background:#0f1114"></i><i style="width:${v.revenue / totalRev * 100}%;background:#2f4bff"></i></div>
      <div class="legend col"><span><i style="background:#0f1114"></i>Win-back texts — ${money(r.revenue)}</span><span><i style="background:#2f4bff"></i>Calls & voice agent — ${money(v.revenue)}</span></div></div>
  </div>`;

  bindRange(el, () => overview(el)); animate(el);
  el.querySelectorAll('.todo [data-a]').forEach(b => (b.onclick = async () => {
    const body = b.dataset.a === 'book' ? { appointment_booked: 1, ...(b.dataset.k === 'calls' ? { recovered: 1 } : {}) }
      : b.dataset.a === 'rec' ? { recovered: 1 } : { dismissed: 1 };
    await api(`/${b.dataset.k}/${b.dataset.id}`, { method: 'PATCH', body });
    toast(b.dataset.a === 'book' ? 'Marked as booked — added to revenue' : 'Done'); overview(el);
  }));
}
