const crypto = require("crypto");
const {hashToken, normalize, validName, validIso, json} = require("./lib/security");
const { getDoc, getPollsSheet, genId } = require("./lib/sheets");

function slugify(str, index) {
  return (
    str
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") +
    "-" +
    index
  );
}

function hasFirstAndLast(name) {
  return name.trim().replace(/\s+/g, " ").split(" ").filter(Boolean).length >= 2;
}

function isValidIso(s) {
  if (typeof s !== "string") return false;
  const d = new Date(s);
  return !isNaN(d.getTime());
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const rawSlots = Array.isArray(body.slots) ? body.slots : [];
  const rawMustAttend = Array.isArray(body.mustAttend) ? body.mustAttend : [];
  const deadlineIso = body.deadlineIso ? String(body.deadlineIso) : "";
  const organizerTimezone = (body.organizerTimezone || "").trim();

  if (!title || title.length > 140) {
    return { statusCode: 400, body: JSON.stringify({ error: "Poll title is required." }) };
  }
  if (rawSlots.length < 1 || rawSlots.length > 30) {
    return { statusCode: 400, body: JSON.stringify({ error: "At least one proposed time is required." }) };
  }
  for (const s of rawSlots) {
    if (!s || !validIso(s.iso)) {
      return { statusCode: 400, body: JSON.stringify({ error: "Each proposed time needs a valid date and time." }) };
    }
  }
  if (deadlineIso && !validIso(deadlineIso)) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid response deadline." }) };
  }
  for (const name of rawMustAttend) {
    if (!validName(name)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: `"${name}" needs a first and last name.` }),
      };
    }
  }

  if (rawMustAttend.length > 40 || new Set(rawMustAttend.map(normalize)).size !== rawMustAttend.length) return json(400, {error: "Must-Attend names must be unique (up to 40)."});
  if (deadlineIso && (Date.parse(deadlineIso) <= Date.now() || rawSlots.some(s => Date.parse(s.iso) <= Date.parse(deadlineIso)))) return json(400, {error: "Deadline must be in the future and before each proposed time."});
  const slots = rawSlots.map((s, i) => ({
    id: slugify(new Date(s.iso).toISOString(), i),
    iso: new Date(s.iso).toISOString(),
  }));

  const mustAttend = rawMustAttend.map((n) => n.trim().replace(/\s+/g, " "));

  try {
    const doc = await getDoc();
    const pollsSheet = await getPollsSheet(doc);
    const pollId = genId(12);
    const organizerToken = crypto.randomBytes(32).toString("base64url");

    await pollsSheet.addRow({
      poll_id: pollId,
      title,
      slots_json: JSON.stringify(slots),
      must_attend_json: JSON.stringify(mustAttend),
      created_at: new Date().toISOString(),
      deadline_iso: deadlineIso ? new Date(deadlineIso).toISOString() : "",
      finalized_slot_id: "",
      organizer_timezone: organizerTimezone,
      organizer_token_hash: hashToken(organizerToken),
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ pollId, organizerToken, slots, mustAttend, title, deadlineIso, organizerTimezone }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
