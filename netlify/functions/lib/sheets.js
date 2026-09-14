const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");

const POLLS_HEADERS = [
  "poll_id",
  "title",
  "slots_json",
  "must_attend_json",
  "created_at",
  "deadline_iso",
  "finalized_slot_id",
  "organizer_timezone",
];
const RESPONSES_HEADERS = [
  "poll_id",
  "participant_name",
  "slot_id",
  "response",
  "linked_must_attend",
  "submitted_at",
];

async function getDoc() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  const sheetId = process.env.GOOGLE_SHEET_ID;

  if (!email || !rawKey || !sheetId) {
    throw new Error(
      "Missing env vars. Required: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SHEET_ID"
    );
  }

  // Netlify env vars store newlines as literal \n — restore real newlines.
  const privateKey = rawKey.replace(/\\n/g, "\n");

  const auth = new JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const doc = new GoogleSpreadsheet(sheetId, auth);
  await doc.loadInfo();
  return doc;
}

async function ensureSheet(doc, title, headers) {
  let sheet = doc.sheetsByTitle[title];
  if (!sheet) {
    sheet = await doc.addSheet({ title, headerValues: headers });
    return sheet;
  }
  // If the sheet exists but has no header row yet (e.g. freshly created
  // manually), or is missing newer columns (e.g. deadline/finalize fields
  // added after the sheet was first used), bring the header row up to date.
  // New columns are appended at the end, so existing row data by column
  // position is preserved.
  try {
    await sheet.loadHeaderRow();
    const missing = headers.filter((h) => !sheet.headerValues.includes(h));
    if (missing.length > 0) {
      await sheet.setHeaderRow([...sheet.headerValues, ...missing]);
    }
  } catch {
    await sheet.setHeaderRow(headers);
  }
  return sheet;
}

async function getPollsSheet(doc) {
  return ensureSheet(doc, "Polls", POLLS_HEADERS);
}

async function getResponsesSheet(doc) {
  return ensureSheet(doc, "Responses", RESPONSES_HEADERS);
}

function genId(len = 8) {
  const chars = "abcdefghijkmnopqrstuvwxyz23456789"; // no 0/o/1/l ambiguity
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

module.exports = { getDoc, getPollsSheet, getResponsesSheet, genId };
