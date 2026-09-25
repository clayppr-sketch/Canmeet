const { getDoc, getPollsSheet, getResponsesSheet } = require('./lib/sheets');
const { authorized, normalize, json } = require('./lib/security');

exports.handler = async event => {
  if (event.httpMethod !== 'GET') return json(405, {error:'Method not allowed'});
  const pollId = event.queryStringParameters?.id;
  if (!pollId || !/^[a-z0-9]{8,20}$/.test(pollId)) return json(400, {error:'Invalid poll id.'});
  try {
    const doc = await getDoc();
    const row = (await (await getPollsSheet(doc)).getRows()).find(r => r.get('poll_id') === pollId);
    if (!row) return json(404, {error:'Poll not found.'});
    const slots = JSON.parse(row.get('slots_json') || '[]');
    const mustAttend = JSON.parse(row.get('must_attend_json') || '[]');
    const common = {pollId, title:row.get('title'), slots, mustAttend,
      deadlineIso:row.get('deadline_iso') || null, finalizedSlotId:row.get('finalized_slot_id') || null};
    // Send the organizer token in a header; it never appears in a request URL or server log.
    if (!authorized(row, event.headers?.['x-organizer-token'] || event.headers?.['X-Organizer-Token'])) {
      return json(200, common);
    }
    const responseRows = await (await getResponsesSheet(doc)).getRows();
    const names = new Map();
    for (const r of responseRows) {
      if (r.get('poll_id') !== pollId) continue;
      const name = r.get('participant_name') || '';
      const key = normalize(name);
      if (!key) continue;
      if (!names.has(key)) names.set(key, {name, slots:{}, link:null});
      const entry = names.get(key);
      entry.slots[r.get('slot_id')] = r.get('response');
      entry.link = r.get('linked_must_attend') || entry.link;
    }
    const responses = Object.create(null), linkedMustAttend = Object.create(null);
    const claimed = new Set();
    for (const entry of names.values()) {
      const direct = mustAttend.find(n => normalize(n) === normalize(entry.name));
      const manual = mustAttend.find(n => normalize(n) === normalize(entry.link));
      const linked = direct || manual || null;
      if (linked && claimed.has(normalize(linked))) continue; // legacy duplicates cannot take one identity twice
      if (linked) claimed.add(normalize(linked));
      responses[entry.name] = entry.slots;
      linkedMustAttend[entry.name] = linked;
    }
    return json(200, {...common, participants:Object.keys(responses), responses, linkedMustAttend});
  } catch (err) { console.error('get-poll failed', err); return json(500, {error:'Unable to load poll.'}); }
};
