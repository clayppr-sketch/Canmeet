const crypto = require("crypto");
const {hashToken, normalize, validName, json, sheetsError} = require("./lib/security");
const { getDoc, getPollsSheet, getResponsesSheet, getCalendarSheet } = require("./lib/sheets");

function normalizeName(n) {
  return n.trim().replace(/\s+/g, " ").toLowerCase();
}

function hasFirstAndLast(n) {
  return normalizeName(n).split(" ").filter(Boolean).length >= 2;
}

const VALID_RESPONSES = ["yes", "if_needed", "no"];

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

  const pollId = (body.pollId || "").trim();
  const participantName = (body.participantName || "").trim().replace(/\s+/g, " ");
  const responses = body.responses || {}; // { slotId: "yes"|"if_needed"|"no" }

  if (!pollId) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing poll id." }) };
  }
  if (!validName(participantName)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Enter first and last name." }),
    };
  }
  if (!responses || typeof responses !== "object" || Array.isArray(responses)) return json(400, {error:"Invalid responses."});
  const slotIds = Object.keys(responses);
  if (slotIds.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: "No responses provided." }) };
  }
  for (const slotId of slotIds) {
    if (!VALID_RESPONSES.includes(responses[slotId])) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: `Invalid response value for ${slotId}.` }),
      };
    }
  }

  try {
    const doc = await getDoc();
    const pollsSheet = await getPollsSheet(doc);
    const pollRows = await pollsSheet.getRows();
    const pollRow = pollRows.find((r) => r.get("poll_id") === pollId);

    if (!pollRow) {
      return { statusCode: 404, body: JSON.stringify({ error: "Poll not found." }) };
    }

    const validSlotIds = new Set(JSON.parse(pollRow.get("slots_json") || "[]").map((s) => s.id));
    if (slotIds.length !== validSlotIds.size) return json(400, {error:"Please answer for every proposed time."});
    for (const slotId of slotIds) {
      if (!validSlotIds.has(slotId)) {
        return { statusCode: 400, body: JSON.stringify({ error: `Unknown slot: ${slotId}` }) };
      }
    }

    const finalizedSlotId = pollRow.get("finalized_slot_id");
    if (finalizedSlotId) {
      return {
        statusCode: 409,
        body: JSON.stringify({ error: "This meeting time has already been finalized by the organizer." }),
      };
    }

    const deadlineIso = pollRow.get("deadline_iso");
    if (deadlineIso && new Date() > new Date(deadlineIso)) {
      return {
        statusCode: 409,
        body: JSON.stringify({ error: "The response deadline for this poll has passed." }),
      };
    }

    const mustAttend = JSON.parse(pollRow.get("must_attend_json") || "[]");

    // Exact-match only, same rule as poll creation: full names make exact
    // matching reliable, so no fuzzy fallback that could link the wrong person.
    let linkedMustAttend = null;
    const exact = mustAttend.find((m) => normalizeName(m) === normalizeName(participantName));
    if (exact) linkedMustAttend = exact;

    const responsesSheet = await getResponsesSheet(doc);
    const existing = (await responsesSheet.getRows()).filter(r => r.get("poll_id") === pollId);
    if (linkedMustAttend && existing.some(r => normalize(r.get("participant_name")) !== normalize(participantName) && normalize(r.get("linked_must_attend")) === normalize(linkedMustAttend))) return json(409, {error:"That Must-Attend person has already responded under another name."});
    if (existing.length > 1500 && !existing.some(r => normalize(r.get("participant_name")) === normalize(participantName))) return json(429, {error:"Poll response limit reached."});
    // Preserve original display spelling across repeated submissions.
    const original = existing.find(r => normalize(r.get("participant_name")) === normalize(participantName));
    const displayName = original ? original.get("participant_name") : participantName;
    const now = new Date().toISOString();
    const rowsToAdd = slotIds.map((slotId) => ({
      poll_id: pollId,
      participant_name: displayName,
      slot_id: slotId,
      response: responses[slotId],
      linked_must_attend: linkedMustAttend || "",
      submitted_at: now,
    }));

    const calendarToken = crypto.randomBytes(32).toString("base64url");
    await (await getCalendarSheet(doc)).addRow({
      poll_id: pollId, participant_name: displayName,
      token_hash: hashToken(calendarToken), created_at: now,
    });
    await responsesSheet.addRows(rowsToAdd);

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, linkedMustAttend, calendarToken }),
    };
  } catch (err) {
    console.error('submit-response failed', err);
    return sheetsError(err);
  }
};
