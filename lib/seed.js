import { db, getSettings } from './db.js';
import { insertSms, insertCall, upsertPatient, render, ctxFor, now } from './logic.js';

export const clearSeed = () => db.exec(`DELETE FROM sms WHERE source='seed'; DELETE FROM calls WHERE source='seed';
  DELETE FROM patients WHERE source='seed'; DELETE FROM campaigns WHERE source='seed';`);

export function seed() {
  clearSeed();
  const s = getSettings();
  const first = ['Sarah', 'James', 'Priya', 'Emma', 'David', 'Olivia', 'Liam', 'Mia', 'Noah', 'Chloe', 'Ethan', 'Grace', 'Lucas', 'Zoe', 'Ryan', 'Ava', 'Jack', 'Ella'];
  const last = ['Mitchell', "O'Connor", 'Sharma', 'Wilson', 'Nguyen', 'Brown', 'Taylor', 'Singh', 'Walker', 'Lee'];
  const treat = ['Checkup & clean', 'Root canal consult', 'Whitening', 'Crown', 'Filling'];
  const rnd = n => Math.floor(Math.random() * n);
  const ago = (d, h = 0) => new Date(Date.now() - d * 864e5 - h * 36e5).toISOString();
  const phone = () => '+614' + String(10000000 + rnd(89999999));

  const patients = [];
  for (let i = 0; i < 80; i++) {
    const p = { name: `${first[rnd(first.length)]} ${last[rnd(last.length)]}`, phone: phone(), email: Math.random() < 0.6 ? `patient${i}@example.com` : '',
      last_visit: ago(150 + rnd(700)).slice(0, 10), treatment: treat[rnd(treat.length)], consent: Math.random() < 0.92, opted_out: false };
    const r = upsertPatient(p, 'seed'); if (r) patients.push({ ...p, id: r.id });
  }
  const tpl = s.tpl_reactivation;
  const cid = Number(db.prepare(`INSERT INTO campaigns(name,template,min_months,status,recipients,created_at,launched_at,source) VALUES(?,?,?,?,?,?,?,?)`)
    .run('Dec-31 extras reactivation', tpl, 6, 'sent', 60, ago(14), ago(14), 'seed').lastInsertRowid);
  for (const p of patients.filter(p => p.consent).slice(0, 60)) {
    const replied = Math.random() < 0.28, opt = !replied && Math.random() < 0.05, booked = replied && Math.random() < 0.5;
    insertSms({ name: p.name, phone: p.phone, treatment: p.treatment, message: render(tpl, ctxFor(p, s)), status: 'sent',
      campaign: 'Dec-31 extras reactivation', campaign_id: cid, patient_id: p.id, sent_at: ago(rnd(14), rnd(10)),
      replied, reply_text: replied ? (booked ? 'YES' : ['Yes please', 'What times?', 'YES'][rnd(3)]) : opt ? 'STOP' : null, replied_at: replied ? now() : null,
      opted_out: opt, appointment_booked: booked, value: booked ? [180, 250, 320, 450][rnd(4)] : null }, 'seed');
    if (opt) db.prepare('UPDATE patients SET opted_out=1 WHERE id=?').run(p.id);
  }
  for (let i = 0; i < 45; i++) {
    const afterHours = Math.random() < 0.4, nm = `${first[rnd(first.length)]} ${last[rnd(last.length)]}`;
    if (afterHours) {
      const booked = Math.random() < 0.45;
      insertCall({ caller_number: phone(), caller_name: nm, call_type: 'after_hours', handled_by: Math.random() < 0.9 ? 'ai' : 'none',
        status: booked ? 'booked' : 'answered', summary: booked ? 'AI agent booked a new-patient check-up.' : 'Asked about prices and opening hours.',
        recovered: true, appointment_booked: booked, value: booked ? [180, 250, 320][rnd(3)] : null, created_at: ago(rnd(14), rnd(10)) }, 'seed');
    } else {
      const email = Math.random() < 0.7, rec = Math.random() < 0.35, booked = rec && Math.random() < 0.5;
      insertCall({ caller_number: phone(), caller_name: nm, caller_email: email ? 'patient@example.com' : null, call_type: 'missed',
        handled_by: email ? 'email' : 'sms', followup_channel: email ? 'email' : 'sms', status: rec ? 'recovered' : 'sent',
        recovered: rec, appointment_booked: booked, value: booked ? [180, 250, 320][rnd(3)] : null,
        campaign: 'missed-call', created_at: ago(rnd(14), rnd(10)) }, 'seed');
    }
  }
}
