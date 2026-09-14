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

  const title = (body.title || "").trim();
  const rawSlots = Array.isArray(body.slots) ? body.slots : [];
  const rawMustAttend = Array.isArray(body.mustAttend) ? body.mustAttend : [];
  const deadlineIso = body.deadlineIso ? String(body.deadlineIso) : "";
  const organizerTimezone = (body.organizerTimezone || "").trim();

  if (!title) {
    return { statusCode: 400, body: JSON.stringify({ error: "Poll title is required." }) };
  }
  if (rawSlots.length < 1) {
    return { statusCode: 400, body: JSON.stringify({ error: "At least one proposed time is required." }) };
  }
  for (const s of rawSlots) {
    if (!isValidIso(s.iso)) {
      return { statusCode: 400, body: JSON.stringify({ error: "Each proposed time needs a valid date and time." }) };
    }
  }
  if (deadlineIso && !isValidIso(deadlineIso)) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid response deadline." }) };
  }
  for (const name of rawMustAttend) {
    if (!hasFirstAndLast(name)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: `"${name}" needs a first and last name.` }),
      };
    }
  }

  const slots = rawSlots.map((s, i) => ({
    id: slugify(new Date(s.iso).toISOString(), i),
    iso: new Date(s.iso).toISOString(),
  }));

  const mustAttend = rawMustAttend.map((n) => n.trim().replace(/\s+/g, " "));

  try {
    const doc = await getDoc();
    const pollsSheet = await getPollsSheet(doc);
    const pollId = genId();

    await pollsSheet.addRow({
      poll_id: pollId,
      title,
      slots_json: JSON.stringify(slots),
      must_attend_json: JSON.stringify(mustAttend),
      created_at: new Date().toISOString(),
      deadline_iso: deadlineIso ? new Date(deadlineIso).toISOString() : "",
      finalized_slot_id: "",
      organizer_timezone: organizerTimezone,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ pollId, slots, mustAttend, title, deadlineIso, organizerTimezone }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
