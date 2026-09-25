const { getDoc, getPollsSheet, genId } = require("./lib/sheets");
const { createOrganizerToken, hashOrganizerToken } = require("./lib/auth");

const MAX_TITLE = 200;
const MAX_SLOTS = 30;
const MAX_MUST_ATTEND = 50;
const MAX_NAME = 120;

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

function normalizeName(name) {
  return String(name || "").trim().replace(/\s+/g, " ");
}

function nameKey(name) {
  return normalizeName(name).toLocaleLowerCase("en");
}

function hasFirstAndLast(name) {
  return normalizeName(name).split(" ").filter(Boolean).length >= 2;
}

function isValidIso(s) {
  if (typeof s !== "string") return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime());
}

function json(statusCode, body) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  if ((event.body || "").length > 100000) return json(413, { error: "Request is too large." });

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const title = String(body.title || "").trim();
  const rawSlots = Array.isArray(body.slots) ? body.slots : [];
  const rawMustAttend = Array.isArray(body.mustAttend) ? body.mustAttend : [];
  const deadlineIso = body.deadlineIso ? String(body.deadlineIso) : "";
  const organizerTimezone = String(body.organizerTimezone || "").trim().slice(0, 100);

  if (!title) return json(400, { error: "Poll title is required." });
  if (title.length > MAX_TITLE) return json(400, { error: `Poll title is limited to ${MAX_TITLE} characters.` });
  if (rawSlots.length < 1) return json(400, { error: "At least one proposed time is required." });
  if (rawSlots.length > MAX_SLOTS) return json(400, { error: `A poll can have at most ${MAX_SLOTS} proposed times.` });
  if (rawMustAttend.length > MAX_MUST_ATTEND) return json(400, { error: `A poll can have at most ${MAX_MUST_ATTEND} Must-Attend participants.` });

  const slotIsos = [];
  for (const s of rawSlots) {
    if (!s || !isValidIso(s.iso)) return json(400, { error: "Each proposed time needs a valid date and time." });
    slotIsos.push(new Date(s.iso).toISOString());
  }
  if (new Set(slotIsos).size !== slotIsos.length) return json(400, { error: "Remove duplicate proposed times." });

  if (deadlineIso && !isValidIso(deadlineIso)) return json(400, { error: "Invalid response deadline." });
  const normalizedDeadline = deadlineIso ? new Date(deadlineIso).toISOString() : "";
  if (normalizedDeadline && slotIsos.some((iso) => new Date(normalizedDeadline) >= new Date(iso))) {
    return json(400, { error: "The response deadline must be before every proposed meeting time." });
  }

  const mustAttend = [];
  const seenNames = new Set();
  for (const rawName of rawMustAttend) {
    const name = normalizeName(rawName);
    if (!hasFirstAndLast(name)) return json(400, { error: `"${name}" needs a first and last name.` });
    if (name.length > MAX_NAME) return json(400, { error: `Must-Attend names are limited to ${MAX_NAME} characters.` });
    const key = nameKey(name);
    if (seenNames.has(key)) return json(400, { error: `"${name}" appears more than once in the Must-Attend list.` });
    seenNames.add(key);
    mustAttend.push(name);
  }

  const slots = slotIsos.map((iso, i) => ({ id: slugify(iso, i), iso }));

  try {
    const doc = await getDoc();
    const pollsSheet = await getPollsSheet(doc);
    const pollId = genId();
    const organizerToken = createOrganizerToken();

    await pollsSheet.addRow({
      poll_id: pollId,
      title,
      slots_json: JSON.stringify(slots),
      must_attend_json: JSON.stringify(mustAttend),
      created_at: new Date().toISOString(),
      deadline_iso: normalizedDeadline,
      finalized_slot_id: "",
      organizer_timezone: organizerTimezone,
      organizer_token_hash: hashOrganizerToken(organizerToken),
    });

    return json(200, {
      pollId,
      organizerToken,
      slots,
      mustAttend,
      title,
      deadlineIso: normalizedDeadline,
      organizerTimezone,
    });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
