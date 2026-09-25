const crypto = require("crypto");

function createOrganizerToken() {
  return crypto.randomBytes(24).toString("base64url");
}

function hashOrganizerToken(token) {
  return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

function getOrganizerToken(event) {
  const headers = (event && event.headers) || {};
  return (
    headers["x-organizer-token"] ||
    headers["X-Organizer-Token"] ||
    headers["X-ORGANIZER-TOKEN"] ||
    ""
  ).trim();
}

function tokenMatches(storedHash, token) {
  if (!storedHash || !token) return false;
  const actual = Buffer.from(hashOrganizerToken(token), "hex");
  let expected;
  try {
    expected = Buffer.from(String(storedHash), "hex");
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function hasValidOrganizerToken(pollRow, event) {
  return tokenMatches(pollRow.get("organizer_token_hash") || "", getOrganizerToken(event));
}

module.exports = {
  createOrganizerToken,
  hashOrganizerToken,
  getOrganizerToken,
  tokenMatches,
  hasValidOrganizerToken,
};
