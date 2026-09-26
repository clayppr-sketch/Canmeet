const { getDoc, getPollsSheet, getResponsesSheet, getCalendarSheet } = require('./lib/sheets');
const { hashToken, normalize, json } = require('./lib/security');

const calendarResponse = (body, download) => ({
  statusCode: 200,
  headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="corral-holds.ics"` },
  body,
});
const utc = date => new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const escapeText = value => String(value).replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
function fold(line) {
  const parts = [];
  let part = '';
  for (const char of line) {
    if (Buffer.byteLength(part + char, 'utf8') > 70) { parts.push(part); part = ' ' + char; }
    else part += char;
  }
  parts.push(part);
  return parts.join('\r\n');
}

exports.handler = async event => {
  if (event.httpMethod !== 'GET') return json(405, {error:'Method not allowed.'});
  const token = event.queryStringParameters?.token || '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return json(404, {error:'Calendar link not found.'});
  try {
    const doc = await getDoc();
    const tokenHash = hashToken(token);
    const calendarRows = await (await getCalendarSheet(doc)).getRows();
    const person = calendarRows.find(r => r.get('token_hash') === tokenHash);
    if (!person) return json(404, {error:'Calendar link not found.'});
    const pollId = person.get('poll_id');
    const poll = (await (await getPollsSheet(doc)).getRows()).find(r => r.get('poll_id') === pollId);
    if (!poll) return json(404, {error:'Poll not found.'});

    const slots = JSON.parse(poll.get('slots_json') || '[]');
    const answers = Object.create(null);
    const name = normalize(person.get('participant_name'));
    for (const row of await (await getResponsesSheet(doc)).getRows()) {
      if (row.get('poll_id') === pollId && normalize(row.get('participant_name')) === name) {
        answers[row.get('slot_id')] = row.get('response');
      }
    }
    const finalized = poll.get('finalized_slot_id');
    const duration = [30,60,90,120,180].includes(Number(poll.get('duration_minutes')))
      ? Number(poll.get('duration_minutes')) : 60;
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Corral//Calendar holds//EN',
      'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Corral holds'];
    for (const slot of slots) {
      if (answers[slot.id] !== 'yes' || (finalized && slot.id !== finalized)) continue;
      const start = Date.parse(slot.iso);
      if (!Number.isFinite(start)) continue;
      const confirmed = slot.id === finalized;
      lines.push('BEGIN:VEVENT', `UID:${pollId}-${slot.id}-${tokenHash.slice(0,16)}@getcorral.netlify.app`,
        `DTSTAMP:${utc(new Date())}`, `DTSTART:${utc(start)}`,
        `DTEND:${utc(start + duration * 60000)}`,
        `SUMMARY:${escapeText((confirmed ? '' : 'Tentative: ') + poll.get('title'))}`,
        `STATUS:${confirmed ? 'CONFIRMED' : 'TENTATIVE'}`,
        'TRANSP:OPAQUE', 'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return calendarResponse(lines.map(fold).join('\r\n') + '\r\n', event.queryStringParameters?.download === '1');
  } catch (err) {
    console.error('calendar feed failed', err);
    return json(500, {error:'Unable to load calendar.'});
  }
};
