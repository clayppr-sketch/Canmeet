const { getDoc, getPollsSheet, getResponsesSheet } = require("./lib/sheets");
const { getOrganizerToken, hasValidOrganizerToken } = require("./lib/auth");

function normalizeName(name) {
  return String(name || "").trim().replace(/\s+/g, " ");
}

function nameKey(name) {
  return normalizeName(name).toLocaleLowerCase("en");
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
  if (event.httpMethod && event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });

  const pollId = event.queryStringParameters && event.queryStringParameters.id;
  if (!pollId) return json(400, { error: "Missing poll id." });

  try {
    const doc = await getDoc();
    const pollsSheet = await getPollsSheet(doc);
    const pollRows = await pollsSheet.getRows();
    const pollRow = pollRows.find((r) => r.get("poll_id") === pollId);
    if (!pollRow) return json(404, { error: "Poll not found." });

    const slots = safeJsonArray(pollRow.get("slots_json"));
    const mustAttend = safeJsonArray(pollRow.get("must_attend_json")).map(normalizeName);
    const title = pollRow.get("title");
    const deadlineIso = pollRow.get("deadline_iso") || null;
    const finalizedSlotId = pollRow.get("finalized_slot_id") || null;
    const organizerTimezone = pollRow.get("organizer_timezone") || null;

    const publicData = { pollId, title, slots, mustAttend, deadlineIso, finalizedSlotId };
    const suppliedOrganizerToken = getOrganizerToken(event);
    if (!suppliedOrganizerToken) return json(200, { ...publicData, isOrganizer: false });
    if (!hasValidOrganizerToken(pollRow, event)) {
      return json(403, { error: "This organizer link is invalid or belongs to an older unsecured version of the poll." });
    }

    const responsesSheet = await getResponsesSheet(doc);
    const responseRows = await responsesSheet.getRows();
    const people = new Map();

    // Group case-insensitively so "Alice Smith" and "alice smith" are one
    // participant. Later appended rows overwrite earlier answers for the same
    // slot, preserving the existing "latest submission wins" behaviour.
    responseRows
      .filter((r) => r.get("poll_id") === pollId)
      .forEach((r) => {
        const displayName = normalizeName(r.get("participant_name"));
        if (!displayName) return;
        const key = nameKey(displayName);
        if (!people.has(key)) people.set(key, { key, displayName, responses: {}, manualLink: null });
        const person = people.get(key);
        person.displayName = displayName;
        const slotId = r.get("slot_id");
        const response = r.get("response");
        if (slotId) person.responses[slotId] = response;
        const linked = normalizeName(r.get("linked_must_attend"));
        if (linked) person.manualLink = linked;
      });

    const mustAttendByKey = new Map(mustAttend.map((name) => [nameKey(name), name]));
    const linkedByKey = new Map();
    const claimed = new Set();

    // Exact current-name matches always take precedence. This also means that
    // adding someone to Must-Attend after they already responded immediately
    // links their existing response without modifying historical rows.
    for (const person of people.values()) {
      const exact = mustAttendByKey.get(person.key);
      if (exact) {
        linkedByKey.set(person.key, exact);
        claimed.add(nameKey(exact));
      }
    }

    // Preserve legitimate manual links for spelling/nickname differences, but
    // only one participant can occupy a given Must-Attend identity.
    for (const person of people.values()) {
      if (linkedByKey.has(person.key) || !person.manualLink) continue;
      const canonical = mustAttendByKey.get(nameKey(person.manualLink));
      if (canonical && !claimed.has(nameKey(canonical))) {
        linkedByKey.set(person.key, canonical);
        claimed.add(nameKey(canonical));
      }
    }

    const participants = [];
    const responses = {};
    const linkedMustAttend = {};
    [...people.values()]
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .forEach((person) => {
        participants.push(person.displayName);
        responses[person.displayName] = person.responses;
        linkedMustAttend[person.displayName] = linkedByKey.get(person.key) || null;
      });

    return json(200, {
      ...publicData,
      isOrganizer: true,
      organizerTimezone,
      participants,
      responses,
      linkedMustAttend,
    });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
