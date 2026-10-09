// Builds the single n8n workflow ("Clinic Automation Engine") for one clinic install.
// Every setting, template and patient list lives in the CRM; n8n only moves messages.

export const webhookPaths = id => ({
  launch: `${id}-launch`, missed: `${id}-missed-call`, reply: `${id}-sms-reply`,
  voice: `${id}-voice-call`, booking: `${id}-booking`, ping: `${id}-ping`,
});

export function buildWorkflow({ crmUrl, apiKey, installId, clinic, twilioCred = {}, gmailCred = {} }) {
  const CRM = String(crmUrl).replace(/\/$/, '');
  const P = webhookPaths(installId);
  const twilio = { twilioApi: { id: twilioCred.id || '', name: twilioCred.name || 'Twilio account' } };
  const gmail = { gmailOAuth2: { id: gmailCred.id || '', name: gmailCred.name || 'Gmail account' } };
  const nodes = [], connections = {};
  let n = 0;
  const add = (node) => { nodes.push({ id: `engine-${String(++n).padStart(3, '0')}`, ...node }); return node.name; };
  const wire = (from, to, output = 0) => {
    const c = (connections[from] ||= { main: [] });
    while (c.main.length <= output) c.main.push([]);
    c.main[output].push({ node: to, type: 'main', index: 0 });
  };

  const sticky = (content, position, height = 160, width = 380, color = 7) =>
    add({ name: `Note ${n + 1}`, type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position, parameters: { content, height, width, color } });
  const webhook = (name, path, position, responseMode = 'onReceived') =>
    add({ name, type: 'n8n-nodes-base.webhook', typeVersion: 2, position, webhookId: path, parameters: { httpMethod: 'POST', path, responseMode, options: {} } });
  const code = (name, jsCode, position) =>
    add({ name, type: 'n8n-nodes-base.code', typeVersion: 2, position, parameters: { mode: 'runOnceForAllItems', jsCode } });
  const crm = (name, method, urlExpr, bodyExpr, position) => add({
    name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position, onError: 'continueRegularOutput',
    parameters: {
      method, url: urlExpr.startsWith('=') ? urlExpr : `${CRM}${urlExpr}`,
      sendHeaders: true, headerParameters: { parameters: [{ name: 'x-api-key', value: apiKey }] },
      ...(bodyExpr ? { sendBody: true, specifyBody: 'json', jsonBody: `={{ ${bodyExpr} }}` } : {}), options: {},
    },
  });
  const ifEquals = (name, leftExpr, right, position) => add({
    name, type: 'n8n-nodes-base.if', typeVersion: 2, position,
    parameters: { conditions: { combinator: 'and', options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [{ id: `cond-${n}`, leftValue: `={{ ${leftExpr} }}`, rightValue: right, operator: { type: 'string', operation: 'equals', singleValue: true } }] }, options: {} },
  });
  const twilioSms = (name, from, to, message, position) => add({
    name, type: 'n8n-nodes-base.twilio', typeVersion: 1, position, onError: 'continueRegularOutput', credentials: twilio,
    parameters: { resource: 'sms', operation: 'send', from: `={{ ${from} }}`, to: `={{ ${to} }}`, message: `={{ ${message} }}` },
  });

  sticky(`## Clinic Automation Engine — ${clinic}
Everything is controlled from the clinic's CRM (messages, opening hours, patient list, test mode, on/off switches). **Don't edit messages here.**

**Setup (once):** pick your Twilio + Gmail credential on the 4 marked nodes if they're not pre-filled → Activate → paste the webhook URLs shown in CRM → Settings → Connect into Twilio / your voice agent.`, [-460, 40], 300, 400, 4);

  // ---- A. Win-back campaign sender ----
  sticky('### 1 · Win-back campaigns\nThe CRM\'s **Launch** button calls this. Each eligible patient gets their personalised SMS; every send is logged back to the CRM.', [0, 40], 140, 520);
  const launch = webhook('Launch Campaign', P.launch, [0, 240]);
  const getR = crm('Get Recipients', 'GET', `={{ '${CRM}/api/n8n/campaigns/' + $json.body.campaign_id + '/recipients' }}`, null, [220, 240]);
  const split = code('One Item per Patient', `const r = $input.first().json;
return (r.recipients || []).map(x => ({ json: { ...x, campaign_id: r.campaign.id, campaign: r.campaign.name, demo_mode: r.demo_mode, sms_from: r.sms_from } }));`, [440, 240]);
  const testA = ifEquals('Test Mode?', 'String($json.demo_mode)', 'true', [660, 240]);
  const fakeA = code('Pretend to Send', `return $input.all().map(i => ({ json: { ...i.json, status: 'demo_sent', sid: 'DEMO' + Math.random().toString(36).slice(2, 10).toUpperCase() } }));`, [900, 140]);
  const sendA = twilioSms('Send SMS', '$json.sms_from', '$json.phone', '$json.message', [900, 340]);
  const src = "$('One Item per Patient').item.json";
  const logA = crm('Log SMS to CRM', 'POST', '/api/sms', `JSON.stringify({ name: ${src}.name, phone: ${src}.phone, message: ${src}.message,
    treatment: ${src}.treatment, campaign: ${src}.campaign, campaign_id: ${src}.campaign_id, patient_id: ${src}.patient_id,
    status: $json.status === 'demo_sent' ? 'demo_sent' : ($json.error ? 'failed' : 'sent'), sent_at: new Date().toISOString() })`.replace(/\s+/g, ' '), [1140, 240]);
  wire(launch, getR); wire(getR, split); wire(split, testA); wire(testA, fakeA, 0); wire(testA, sendA, 1); wire(fakeA, logA); wire(sendA, logA);

  // ---- B. Missed-call follow-up ----
  sticky('### 2 · Missed calls\nYour phone system calls this when nobody answers (Twilio status callback, or `{"caller_number":"+61…"}`). The CRM logs the call, looks the caller up, and decides email vs SMS.', [0, 480], 160, 520);
  const missed = webhook('Missed Call', P.missed, [0, 700]);
  const wasMissed = code('Was It Missed?', `const b = $input.first().json.body || {};
const status = String(b.DialCallStatus || b.CallStatus || b.call_status || '').toLowerCase();
if (status && !['no-answer', 'busy', 'failed', 'canceled'].includes(status)) return []; // answered → nothing to do
const number = b.caller_number || b.From || b.from;
return number ? [{ json: { caller_number: number, caller_name: b.caller_name || b.CallerName || '', at: b.at || b.Timestamp || '' } }] : [];`, [220, 700]);
  const lookup = crm('Log Call & Get Message', 'POST', '/api/n8n/missed-call', 'JSON.stringify($json)', [440, 700]);
  const follow = ifEquals('Follow Up?', 'String($json.skip)', 'false', [660, 700]);
  const wait = add({ name: 'Wait Before Following Up', type: 'n8n-nodes-base.wait', typeVersion: 1, position: [880, 700], webhookId: `${installId}-wait`,
    parameters: { resume: 'afterTimeInterval', amount: '={{ $json.delay_seconds }}', unit: 'seconds' } });
  const testB = ifEquals('Test Mode (calls)?', 'String($json.demo_mode)', 'true', [1100, 700]);
  const emailOrSms = ifEquals('Email on File?', '$json.channel', 'email', [1320, 800]);
  const sendEmail = add({ name: 'Send Email', type: 'n8n-nodes-base.gmail', typeVersion: 2.1, position: [1540, 720], onError: 'continueRegularOutput', credentials: gmail,
    parameters: { resource: 'message', operation: 'send', sendTo: '={{ $json.email.to }}', subject: '={{ $json.email.subject }}', emailType: 'text', message: '={{ $json.email.body }}', options: { appendAttribution: false } } });
  const sendText = twilioSms('Send Text-back', '$json.sms.from', '$json.sms.to', '$json.sms.body', [1540, 900]);
  const L = "$('Log Call & Get Message').item.json";
  const report = crm('Report Follow-up', 'POST', `={{ '${CRM}/api/n8n/calls/' + ${L}.call_id + '/followup' }}`,
    `JSON.stringify({ status: ${L}.demo_mode ? 'demo_logged' : ($json.error ? 'failed' : 'sent') })`, [1780, 700]);
  wire(missed, wasMissed); wire(wasMissed, lookup); wire(lookup, follow); wire(follow, wait, 0); wire(wait, testB);
  wire(testB, report, 0); wire(testB, emailOrSms, 1); wire(emailOrSms, sendEmail, 0); wire(emailOrSms, sendText, 1); wire(sendEmail, report); wire(sendText, report);

  // ---- C. SMS replies ----
  sticky('### 3 · Patient replies\nPaste this webhook into your Twilio number → Messaging → "A message comes in". STOP = automatic opt-out. YES = the owner gets a text.', [0, 1020], 150, 520);
  const inbound = webhook('Incoming SMS', P.reply, [0, 1220], 'responseNode');
  const logReply = crm('Log Reply', 'POST', '/api/n8n/sms-reply', 'JSON.stringify({ from: $json.body.From, body: $json.body.Body })', [220, 1220]);
  const respond = add({ name: 'Answer Twilio', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: [440, 1220],
    parameters: { respondWith: 'text', responseBody: '<Response></Response>', options: { responseHeaders: { entries: [{ name: 'Content-Type', value: 'text/xml' }] } } } });
  const hot = ifEquals('Hot Lead?', 'String(!!$json.alert_owner && !$json.demo_mode)', 'true', [660, 1220]);
  const alert = twilioSms('Text the Owner', '$json.sms_from', '$json.owner_phone', '$json.alert_text', [880, 1200]);
  wire(inbound, logReply); wire(logReply, respond); wire(respond, hot); wire(hot, alert, 0);

  // ---- D/E/F. Voice agent, bookings, connection test ----
  sticky('### 4 · Voice agent · bookings · connection test\nVoice agent end-of-call webhook → log the call (after-hours is worked out from clinic hours). Booking webhook → mark booked. Test → used by the CRM\'s "Test connection" button.', [0, 1400], 170, 520);
  const voice = webhook('Voice Agent Call', P.voice, [0, 1620]);
  const logVoice = crm('Log Voice Call', 'POST', '/api/n8n/voice-call', 'JSON.stringify($json.body)', [220, 1620]);
  const booking = webhook('Booking Confirmed', P.booking, [0, 1800]);
  const logBooking = crm('Log Booking', 'POST', '/api/n8n/booking', 'JSON.stringify($json.body)', [220, 1800]);
  const ping = webhook('Connection Test', P.ping, [0, 1980]);
  const pong = crm('Tell CRM We\'re Connected', 'POST', '/api/n8n/ping', 'JSON.stringify({ ok: true })', [220, 1980]);
  wire(voice, logVoice); wire(booking, logBooking); wire(ping, pong);

  return { name: `Clinic Automation Engine — ${clinic}`, active: false, nodes, connections, pinData: {}, settings: { executionOrder: 'v1' } };
}
