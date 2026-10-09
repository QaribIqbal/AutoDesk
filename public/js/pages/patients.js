import { $, api, esc, day, debounce, modal, closeModal, confirmBox, toast, icon, parseCsv } from '../core.js';
import { head, stat } from '../ui.js';

let filter = '';
const SYNONYMS = {
  name: ['name', 'full name', 'patient', 'patient name', 'client', 'client name'],
  first: ['first name', 'firstname', 'given name'], last: ['last name', 'lastname', 'surname', 'family name'],
  phone: ['phone', 'mobile', 'cell', 'phone number', 'mobile number', 'mobile phone', 'contact number', 'sms number'],
  email: ['email', 'e-mail', 'email address'],
  last_visit: ['last visit', 'last_visit', 'last appointment', 'last seen', 'last visit date', 'last appt', 'last attended'],
  treatment: ['treatment', 'last treatment', 'service', 'procedure'],
  consent: ['consent', 'sms consent', 'marketing consent', 'opt in', 'opt-in', 'can text'],
  opted_out: ['opted out', 'opted_out', 'unsubscribed', 'opt out', 'opt-out', 'do not text'],
};
const SAMPLE_CSV = 'name,phone,email,last_visit,treatment,consent,opted_out\nSarah Mitchell,0412 345 678,sarah@example.com,14/02/2025,Checkup & clean,yes,no\nJames O\'Connor,+61423456789,,03/11/2024,Root canal consult,yes,no\n';

export async function patients(el) {
  el.innerHTML = `${head('Your list', 'Patients', 'Everyone your automations can text, and who has said no. Import straight from your practice software as a CSV file.',
    `<a class="btn" href="/api/export/patients.csv">${icon('download', 15)} Export</a><button class="btn" id="imp">${icon('upload', 15)} Import CSV</button><button class="btn primary" id="add">${icon('plus', 16)} Add patient</button>`, false)}
    <div class="stats" id="counts"></div>
    <div class="toolbar"><input id="q" placeholder="Search name, phone or email…" style="min-width:280px">
      <div class="seg" id="flt">${[['', 'All'], ['eligible', 'Can be texted'], ['opted_out', 'Opted out'], ['no_consent', 'No consent']].map(([k, l]) => `<button class="${filter === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}</div></div>
    <div id="tbl"></div>`;
  $('#add').onclick = () => edit(null, () => patients(el));
  $('#imp').onclick = () => importer(() => patients(el));
  el.querySelectorAll('#flt [data-f]').forEach(b => (b.onclick = () => { filter = b.dataset.f; patients(el); }));
  const load = async () => {
    const { rows, counts: c } = await api(`/patients?search=${encodeURIComponent($('#q').value)}&filter=${filter}`);
    $('#counts').innerHTML = stat('Total patients', c.total, 'on your list') + stat('Can be texted', c.eligible, 'consent + not opted out', '#0d7a4b')
      + stat('Opted out', c.opted_out, 'never texted again', '#ff5b3a') + stat('No consent', c.no_consent, 'skipped by campaigns', '#b86e00');
    $('#tbl').innerHTML = rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>Patient</th><th>Last visit</th><th>Treatment</th><th>Can we text?</th><th>Last texted</th><th></th></tr></thead><tbody>
      ${rows.map(p => `<tr><td class="who"><b>${esc(p.name) || 'No name'}</b><small>${esc(p.phone)}${p.email ? ' · ' + esc(p.email) : ''}</small></td>
        <td class="mono">${day(p.last_visit)}</td><td>${esc(p.treatment) || '<span class="muted">—</span>'}</td>
        <td>${p.opted_out ? '<span class="chip r">opted out</span>' : p.consent ? '<span class="chip g">yes</span>' : '<span class="chip a">no consent</span>'}${p.booked ? ' <span class="chip k">booked</span>' : ''}</td>
        <td class="mono">${p.last_contacted ? day(p.last_contacted) : '<span class="muted">never</span>'}</td>
        <td class="act"><button class="mini" data-a="edit" data-id="${p.id}">edit</button><button class="mini" data-a="del" data-id="${p.id}" aria-label="Delete">✕</button></td></tr>`).join('')}
      </tbody></table></div>` : `<div class="empty"><b>${c.total ? 'Nobody matches' : 'Your patient list is empty'}</b>${c.total ? 'Try another search.' : 'Import a CSV from your practice software, or add patients one by one.'}</div>`;
    $('#tbl').querySelectorAll('[data-a]').forEach(b => (b.onclick = async () => {
      const p = rows.find(x => x.id == b.dataset.id);
      if (b.dataset.a === 'edit') edit(p, () => patients(el));
      if (b.dataset.a === 'del' && await confirmBox(`Remove ${esc(p.name || p.phone)}?`, 'Their past texts stay in your history.', 'Remove', true)) { await api('/patients/' + p.id, { method: 'DELETE' }); load(); }
    }));
  };
  $('#q').oninput = debounce(load); load();
}

function edit(p, done) {
  const v = p || { consent: 1 };
  modal(`<h3>${p ? 'Edit patient' : 'Add a patient'}</h3>
    <div class="row2"><div class="field"><label>Full name</label><input id="p_name" value="${esc(v.name)}"></div>
    <div class="field"><label>Mobile number *</label><input id="p_phone" value="${esc(v.phone)}" ${p ? 'disabled' : ''} placeholder="0412 345 678"></div></div>
    <div class="row2"><div class="field"><label>Email</label><input id="p_email" type="email" value="${esc(v.email)}"></div>
    <div class="field"><label>Last visit</label><input id="p_last" type="date" value="${esc(v.last_visit)}"></div></div>
    <div class="field"><label>Last treatment</label><input id="p_treat" value="${esc(v.treatment)}" placeholder="Checkup & clean"></div>
    <label class="check"><input type="checkbox" id="p_consent" ${v.consent ? 'checked' : ''}> They agreed to receive texts from the clinic</label>
    <label class="check"><input type="checkbox" id="p_opt" ${v.opted_out ? 'checked' : ''}> They asked us to stop texting them</label>
    <div class="foot"><button class="btn" id="p_c">Cancel</button><button class="btn primary" id="p_s">Save</button></div>`);
  $('#p_c').onclick = closeModal;
  $('#p_s').onclick = async () => {
    const body = { name: $('#p_name').value, email: $('#p_email').value, last_visit: $('#p_last').value, treatment: $('#p_treat').value,
      consent: $('#p_consent').checked, opted_out: $('#p_opt').checked };
    try {
      if (p) await api('/patients/' + p.id, { method: 'PATCH', body }); else await api('/patients', { method: 'POST', body: { ...body, phone: $('#p_phone').value } });
      closeModal(); toast(p ? 'Saved' : 'Patient added'); done();
    } catch (e) { toast(e.message, 'bad'); }
  };
}

function mapRows(table) {
  const [header, ...body] = table, h = header.map(x => x.trim().toLowerCase());
  const col = key => h.findIndex(x => SYNONYMS[key].includes(x));
  const idx = Object.fromEntries(Object.keys(SYNONYMS).map(k => [k, col(k)]));
  const get = (r, k) => (idx[k] >= 0 ? (r[idx[k]] || '').trim() : '');
  const rows = body.map(r => ({
    name: get(r, 'name') || [get(r, 'first'), get(r, 'last')].filter(Boolean).join(' '),
    phone: get(r, 'phone'), email: get(r, 'email'), last_visit: get(r, 'last_visit'), treatment: get(r, 'treatment'),
    ...(idx.consent >= 0 ? { consent: get(r, 'consent') } : {}), opted_out: get(r, 'opted_out'),
  }));
  return { rows, found: Object.entries(idx).filter(([, i]) => i >= 0).map(([k]) => k), hasPhone: idx.phone >= 0 };
}

function importer(done) {
  modal(`<h3>Import patients</h3><p class="sub">Export your patient list from your practice software as a <b>CSV</b> file and drop it here. We match columns like <i>Name, Mobile, Email, Last visit</i> automatically. Existing patients are updated, not duplicated.</p>
    <label class="drop" id="drop"><input type="file" id="file" accept=".csv,text/csv" hidden>${icon('upload', 26)}<b>Choose a CSV file</b><span>or drag it here</span></label>
    <p class="hint-sm">Not sure about the format? <a href="#" id="tpl">Download an example file</a>. Patients without a consent column are treated as having agreed — only import people who did.</p>
    <div id="imp_prev"></div>
    <div class="foot"><button class="btn" id="i_c">Cancel</button><button class="btn primary" id="i_go" disabled>Import</button></div>`, { wide: true });
  let mapped = null;
  $('#i_c').onclick = closeModal;
  $('#tpl').onclick = e => { e.preventDefault(); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([SAMPLE_CSV], { type: 'text/csv' })); a.download = 'patients-example.csv'; a.click(); };
  const read = async file => {
    const table = parseCsv(await file.text());
    if (table.length < 2) return ($('#imp_prev').innerHTML = '<p class="err">That file looks empty.</p>');
    mapped = mapRows(table);
    if (!mapped.hasPhone) { $('#i_go').disabled = true; return ($('#imp_prev').innerHTML = '<p class="err">We couldn\'t find a phone or mobile column. Rename it to "Mobile" and try again.</p>'); }
    const withPhone = mapped.rows.filter(r => r.phone).length;
    $('#imp_prev').innerHTML = `<div class="imp-sum"><b>${withPhone}</b> patients ready to import${mapped.rows.length - withPhone ? ` · ${mapped.rows.length - withPhone} rows skipped (no phone)` : ''}<br><small>Columns found: ${mapped.found.join(', ')}</small></div>
      <div class="tbl-wrap"><table><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Last visit</th></tr></thead><tbody>${mapped.rows.slice(0, 5).map(r => `<tr><td>${esc(r.name)}</td><td class="mono">${esc(r.phone)}</td><td>${esc(r.email)}</td><td class="mono">${esc(r.last_visit)}</td></tr>`).join('')}</tbody></table></div>`;
    $('#i_go').disabled = !withPhone; $('#i_go').textContent = `Import ${withPhone} patients`;
  };
  $('#file').onchange = e => e.target.files[0] && read(e.target.files[0]);
  const drop = $('#drop');
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); e.dataTransfer.files[0] && read(e.dataTransfer.files[0]); };
  $('#i_go').onclick = async () => {
    $('#i_go').disabled = true; $('#i_go').textContent = 'Importing…';
    try { const r = await api('/patients/import', { method: 'POST', body: { rows: mapped.rows } }); closeModal(); toast(`${r.added} added · ${r.updated} updated${r.skipped ? ` · ${r.skipped} skipped` : ''}`); done(); }
    catch (e) { toast(e.message, 'bad'); $('#i_go').disabled = false; }
  };
}
