const { getDoc, getPollsSheet, getResponsesSheet } = require("./lib/sheets");

const VALID_RESPONSES = ["yes", "if_needed", "no"];
const MAX_NAME = 120;

function normalizeName(n) {
  return String(n || "").trim().replace(/\s+/g, " ");
}
function nameKey(n) {
  return normalizeName(n).toLocaleLowerCase("en");
}
function hasFirstAndLast(n) {
  return normalizeName(n).split(" ").filter(Boolean).length >= 2;
}
function safeJsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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

  const pollId = String(body.pollId || "").trim();
  const participantName = normalizeName(body.participantName);
  const responses = body.responses && typeof body.responses === "object" ? body.responses : {};
  const manualLinkRaw = normalizeName(body.manualLink);

  if (!pollId) return json(400, { error: "Missing poll id." });
  if (!hasFirstAndLast(participantName)) return json(400, { error: "Enter first and last name." });
  if (participantName.length > MAX_NAME) return json(400, { error: `Names are limited to ${MAX_NAME} characters.` });

  try {
    const doc = await getDoc();
    const pollsSheet = await getPollsSheet(doc);
    const pollRows = await pollsSheet.getRows();
    const pollRow = pollRows.find((r) => r.get("poll_id") === pollId);
    if (!pollRow) return json(404, { error: "Poll not found." });

    const slots = safeJsonArray(pollRow.get("slots_json"));
    const validSlotIds = slots.map((s) => s.id);
    const submittedSlotIds = Object.keys(responses);

    if (submittedSlotIds.length !== validSlotIds.length || validSlotIds.some((id) => !submittedSlotIds.includes(id))) {
      return json(400, { error: "Please answer every proposed time before submitting." });
    }
    for (const slotId of submittedSlotIds) {
      if (!validSlotIds.includes(slotId)) return json(400, { error: `Unknown slot: ${slotId}` });
      if (!VALID_RESPONSES.includes(responses[slotId])) return json(400, { error: `Invalid response value for ${slotId}.` });
    }

    const finalizedSlotId = pollRow.get("finalized_slot_id");
    if (finalizedSlotId) return json(409, { error: "This meeting time has already been finalized by the organizer." });

    const deadlineIso = pollRow.get("deadline_iso");
    if (deadlineIso && new Date() > new Date(deadlineIso)) {
      return json(409, { error: "The response deadline for this poll has passed." });
    }

    const mustAttend = safeJsonArray(pollRow.get("must_attend_json")).map(normalizeName);
    const mustAttendByKey = new Map(mustAttend.map((name) => [nameKey(name), name]));
    const participantKey = nameKey(participantName);

    let linkedMustAttend = mustAttendByKey.get(participantKey) || null;
    let requestedManualLink = null;
    if (!linkedMustAttend && manualLinkRaw) {
      requestedManualLink = mustAttendByKey.get(nameKey(manualLinkRaw)) || null;
      if (!requestedManualLink) return json(400, { error: "The selected Must-Attend participant is no longer on this poll." });
    }

    const responsesSheet = await getResponsesSheet(doc);
    const existingRows = await responsesSheet.getRows();
    const pollRowsOnly = existingRows.filter((r) => r.get("poll_id") === pollId);

    // Preserve an earlier manual link for the same participant when they are
    // simply updating availability and did not choose a different identity.
    if (!linkedMustAttend && !requestedManualLink) {
      for (const r of pollRowsOnly) {
        if (nameKey(r.get("participant_name")) !== participantKey) continue;
        const prior = normalizeName(r.get("linked_must_attend"));
        const canonical = prior ? mustAttendByKey.get(nameKey(prior)) : null;
        if (canonical) linkedMustAttend = canonical;
      }
    }
    if (requestedManualLink) linkedMustAttend = requestedManualLink;

    // Do not let two different current participant identities claim the same
    // Must-Attend person. Use each participant's latest stored link rather than
    // treating an old historical link as permanent.
    if (linkedMustAttend && nameKey(linkedMustAttend) !== participantKey) {
      const targetKey = nameKey(linkedMustAttend);
      const currentClaims = new Map();
      for (const r of pollRowsOnly) {
        const otherName = normalizeName(r.get("participant_name"));
        if (!otherName) continue;
        currentClaims.set(nameKey(otherName), normalizeName(r.get("linked_must_attend")) || null);
      }
      for (const [otherKey, otherLinked] of currentClaims.entries()) {
        if (otherKey === participantKey) continue;
        if (mustAttendByKey.get(otherKey) && otherKey === targetKey) {
          return json(409, { error: `${linkedMustAttend} is already linked to another participant response.` });
        }
        if (otherLinked && nameKey(otherLinked) === targetKey) {
          return json(409, { error: `${linkedMustAttend} is already linked to another participant response.` });
        }
      }
    }

    const now = new Date().toISOString();
    const rowsToAdd = validSlotIds.map((slotId) => ({
      poll_id: pollId,
      participant_name: participantName,
      slot_id: slotId,
      response: responses[slotId],
      linked_must_attend: linkedMustAttend || "",
      submitted_at: now,
    }));

    await responsesSheet.addRows(rowsToAdd);
    return json(200, { ok: true, linkedMustAttend });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
