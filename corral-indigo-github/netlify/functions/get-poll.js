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
    const showGroupCounts = row.get('show_group_counts') !== 'false';
    const common = {pollId, title:row.get('title'), slots, mustAttend, showGroupCounts,
      deadlineIso:row.get('deadline_iso') || null, finalizedSlotId:row.get('finalized_slot_id') || null};
    // Send the organizer token in a header; it never appears in a request URL or server log.
    const isOrganizer = authorized(row, event.headers?.['x-organizer-token'] || event.headers?.['X-Organizer-Token']);
    if (!isOrganizer && !showGroupCounts) return json(200, common);
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
    const groupCounts = Object.fromEntries(slots.map(s => [s.id, {yes:0, ifNeeded:0, no:0}]));
    for (const answers of Object.values(responses)) {
      for (const slot of slots) {
        const answer = answers[slot.id];
        if (answer === 'yes') groupCounts[slot.id].yes++;
        else if (answer === 'if_needed') groupCounts[slot.id].ifNeeded++;
        else if (answer === 'no') groupCounts[slot.id].no++;
      }
    }
    if (!isOrganizer) return json(200, {...common, groupCounts});
    return json(200, {...common, groupCounts, participants:Object.keys(responses), responses, linkedMustAttend});
  } catch (err) { console.error('get-poll failed', err); return json(500, {error:'Unable to load poll.'}); }
};
