// Writes the n8n engine for THIS install (real API key + CRM URL) — same file as Settings → Connect → Download.
//   npm run export-workflow -- https://crm.myclinic.com
// With --template, writes a placeholder version safe to commit (n8n-workflows/clinic-automation-engine.template.json).
import fs from 'node:fs';
import path from 'node:path';
import { buildWorkflow } from '../lib/workflow.js';

const template = process.argv.includes('--template');
const out = path.join(import.meta.dirname, '..', 'n8n-workflows');
fs.mkdirSync(out, { recursive: true });

let wf, file;
if (template) {
  wf = buildWorkflow({ crmUrl: 'https://YOUR-CRM-ADDRESS', apiKey: 'YOUR-CRM-API-KEY', installId: 'clinic', clinic: 'Your Clinic' });
  file = path.join(out, 'clinic-automation-engine.template.json');
} else {
  const { getSettings } = await import('../lib/db.js');
  const s = getSettings({ secrets: true }), crmUrl = process.argv[2] || s.public_url || 'http://localhost:3000';
  wf = buildWorkflow({ crmUrl, apiKey: s.api_key, installId: s.install_id, clinic: s.clinic_name,
    twilioCred: { id: s.n8n_twilio_cred_id, name: s.n8n_twilio_cred_name }, gmailCred: { id: s.n8n_gmail_cred_id, name: s.n8n_gmail_cred_name } });
  file = path.join(out, 'clinic-automation-engine.local.json'); // gitignored: contains the API key
}
fs.writeFileSync(file, JSON.stringify(wf, null, 2));
console.log(`Wrote ${path.relative(process.cwd(), file)}`);
