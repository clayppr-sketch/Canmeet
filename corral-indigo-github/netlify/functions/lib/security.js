const crypto = require('crypto');
const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');
function authorized(row, token) {
  const stored = row.get('organizer_token_hash') || '';
  if (!stored || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(stored)) return false;
  const supplied = hashToken(token);
  return crypto.timingSafeEqual(Buffer.from(stored, 'hex'), Buffer.from(supplied, 'hex'));
}
const normalize = n => String(n).trim().replace(/\s+/g, ' ').toLowerCase();
const validName = n => typeof n === 'string' && n.length <= 100 && normalize(n).split(' ').length >= 2;
const validIso = s => typeof s === 'string' && !Number.isNaN(Date.parse(s)) && /^\d{4}-\d\d-\d\dT/.test(s);
const json = (statusCode, data) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(data) });
function sheetsError(err) {
  const message = String(err?.message || '');
  const status = Number(err?.response?.status || err?.status || err?.code);
  if (status === 429 || /quota exceeded|rate limit/i.test(message)) {
    return { statusCode:503, headers:{'Content-Type':'application/json','Cache-Control':'no-store','Retry-After':'60'},
      body:JSON.stringify({error:'The poll is temporarily busy. Please try again in about a minute.'}) };
  }
  return json(500, {error:'Unable to complete the request right now.'});
}
module.exports = { hashToken, authorized, normalize, validName, validIso, json, sheetsError };
