const { getDoc, getPollsSheet } = require("./lib/sheets");
const { hasValidOrganizerToken } = require("./lib/auth");

const MAX_TITLE = 200;
const MAX_SLOTS = 30;
const MAX_MUST_ATTEND = 50;
const MAX_NAME = 120;

function normalizeName(name) {
  return String(name || "").trim().replace(/\s+/g, " ");
}
function nameKey(name) {
  return normalizeName(name).toLocaleLowerCase("en");
}
function hasFirstAndLast(name) {
  return normalizeName(name).split(" ").filter(Boolean).length >= 2;
}
function slugify(str, index) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") + "-" + index;
}
function isValidIso(s) {
  if (typeof s !== "string") return false;
  return !Number.isNaN(new Date(s).getTime());
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
  if (!pollId) return json(400, { error: "Missing poll id." });

  try {
    const doc = await getDoc();
    const pollsSheet = await getPollsSheet(doc);
    const pollRows = await pollsSheet.getRows();
    const pollRow = pollRows.find((r) => r.get("poll_id") === pollId);
    if (!pollRow) return json(404, { error: "Poll not found." });
    if (!hasValidOrganizerToken(pollRow, event)) return json(403, { error: "Organizer authorization failed." });

    let slots = safeJsonArray(pollRow.get("slots_json"));
    let deadlineIso = pollRow.get("deadline_iso") || "";

    if (Array.isArray(body.mustAttend)) {
      if (body.mustAttend.length > MAX_MUST_ATTEND) return json(400, { error: `A poll can have at most ${MAX_MUST_ATTEND} Must-Attend participants.` });
      const names = [];
      const seen = new Set();
      for (const rawName of body.mustAttend) {
        const name = normalizeName(rawName);
        if (!hasFirstAndLast(name)) return json(400, { error: `"${name}" needs a first and last name.` });
        if (name.length > MAX_NAME) return json(400, { error: `Must-Attend names are limited to ${MAX_NAME} characters.` });
        const key = nameKey(name);
        if (seen.has(key)) return json(400, { error: `"${name}" appears more than once in the Must-Attend list.` });
        seen.add(key);
        names.push(name);
      }
      pollRow.set("must_attend_json", JSON.stringify(names));
    }

    if (Array.isArray(body.addSlots) && body.addSlots.length > 0) {
      if (slots.length + body.addSlots.length > MAX_SLOTS) return json(400, { error: `A poll can have at most ${MAX_SLOTS} proposed times.` });
      const existingIso = new Set(slots.map((s) => new Date(s.iso).toISOString()));
      const newOnes = [];
      for (let i = 0; i < body.addSlots.length; i++) {
        const s = body.addSlots[i];
        if (!s || !isValidIso(s.iso)) return json(400, { error: "Each proposed time needs a valid date and time." });
        const iso = new Date(s.iso).toISOString();
        if (existingIso.has(iso)) return json(400, { error: "Remove duplicate proposed times." });
        if (deadlineIso && new Date(deadlineIso) >= new Date(iso)) return json(400, { error: "The response deadline must be before every proposed meeting time." });
        existingIso.add(iso);
        newOnes.push({ id: slugify(iso, slots.length + i), iso });
      }
      slots = [...slots, ...newOnes];
      pollRow.set("slots_json", JSON.stringify(slots));
    }

    if (typeof body.title === "string") {
      const title = body.title.trim();
      if (!title) return json(400, { error: "Poll title cannot be blank." });
      if (title.length > MAX_TITLE) return json(400, { error: `Poll title is limited to ${MAX_TITLE} characters.` });
      pollRow.set("title", title);
    }

    if (typeof body.deadlineIso === "string") {
      if (body.deadlineIso === "") {
        deadlineIso = "";
      } else if (isValidIso(body.deadlineIso)) {
        deadlineIso = new Date(body.deadlineIso).toISOString();
        if (slots.some((s) => new Date(deadlineIso) >= new Date(s.iso))) {
          return json(400, { error: "The response deadline must be before every proposed meeting time." });
        }
      } else {
        return json(400, { error: "Invalid response deadline." });
      }
      pollRow.set("deadline_iso", deadlineIso);
    }

    if (typeof body.finalizedSlotId === "string") {
      if (body.finalizedSlotId === "") {
        pollRow.set("finalized_slot_id", "");
      } else {
        if (!slots.some((s) => s.id === body.finalizedSlotId)) return json(400, { error: "Unknown slot to finalize." });
        pollRow.set("finalized_slot_id", body.finalizedSlotId);
      }
    }

    await pollRow.save();

    return json(200, {
      ok: true,
      title: pollRow.get("title"),
      slots,
      mustAttend: safeJsonArray(pollRow.get("must_attend_json")),
      deadlineIso: pollRow.get("deadline_iso") || null,
      finalizedSlotId: pollRow.get("finalized_slot_id") || null,
    });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
