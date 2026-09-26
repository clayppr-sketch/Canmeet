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
module.exports = { hashToken, authorized, normalize, validName, validIso, json };
