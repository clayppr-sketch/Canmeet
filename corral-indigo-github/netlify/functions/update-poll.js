const { authorized, normalize, validName, validIso, json, sheetsError } = require("./lib/security");
const { getDoc, getPollsSheet } = require("./lib/sheets");

function hasFirstAndLast(name) {
  return name.trim().replace(/\s+/g, " ").split(" ").filter(Boolean).length >= 2;
}

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

  const pollId = (body.pollId || "").trim();
  if (!pollId) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing poll id." }) };
  }

  try {
    const doc = await getDoc();
    const pollsSheet = await getPollsSheet(doc);
    const pollRows = await pollsSheet.getRows();
    const pollRow = pollRows.find((r) => r.get("poll_id") === pollId);

    if (!pollRow) {
      return { statusCode: 404, body: JSON.stringify({ error: "Poll not found." }) };
    }

    if (!authorized(pollRow, body.organizerToken)) return json(403, {error:"Private organizer link required."});
    if (typeof body.showGroupCounts === "boolean") {
      pollRow.set("show_group_counts", String(body.showGroupCounts));
    }
    if (body.durationMinutes !== undefined) {
      if (![30, 60, 90, 120, 180].includes(Number(body.durationMinutes))) return json(400, {error:"Choose a valid meeting duration."});
      pollRow.set("duration_minutes", Number(body.durationMinutes));
    }
    // Must-Attend roster update
    if (Array.isArray(body.mustAttend)) {
      if (body.mustAttend.length > 40 || new Set(body.mustAttend.map(normalize)).size !== body.mustAttend.length) return json(400, {error:"Must-Attend names must be unique (up to 40)."});
      for (const name of body.mustAttend) {
        if (!validName(name)) {
          return {
            statusCode: 400,
            body: JSON.stringify({ error: `"${name}" needs a first and last name.` }),
          };
        }
      }
      pollRow.set("must_attend_json", JSON.stringify(body.mustAttend.map((n) => n.trim().replace(/\s+/g, " "))));
    }

    // Add new proposed times (existing slots are kept as-is to avoid
    // invalidating already-submitted responses tied to slot ids).
    if (Array.isArray(body.addSlots) && body.addSlots.length > 0) {
      const existing = JSON.parse(pollRow.get("slots_json") || "[]");
      if (existing.length + body.addSlots.length > 30) return json(400, {error:"Maximum 30 proposed times."});
      for (const s of body.addSlots) {
        if (!s || !validIso(s.iso)) {
          return { statusCode: 400, body: JSON.stringify({ error: "Each proposed time needs a valid date and time." }) };
        }
      }
      const newOnes = body.addSlots.map((s, i) => ({
        id: slugify(new Date(s.iso).toISOString(), existing.length + i),
        iso: new Date(s.iso).toISOString(),
      }));
      pollRow.set("slots_json", JSON.stringify([...existing, ...newOnes]));
    }

    if (typeof body.title === "string" && body.title.trim()) {
      pollRow.set("title", body.title.trim());
    }

    // Response deadline: pass a valid ISO string to set, or an empty
    // string to clear it.
    if (typeof body.deadlineIso === "string") {
      if (body.deadlineIso === "") {
        pollRow.set("deadline_iso", "");
      } else if (validIso(body.deadlineIso)) {
        pollRow.set("deadline_iso", new Date(body.deadlineIso).toISOString());
      } else {
        return { statusCode: 400, body: JSON.stringify({ error: "Invalid response deadline." }) };
      }
    }

    // Finalize / lock in a time: pass a slot id to set, or an empty
    // string to un-finalize (organizer changed their mind).
    if (typeof body.finalizedSlotId === "string") {
      if (body.finalizedSlotId === "") {
        pollRow.set("finalized_slot_id", "");
        pollRow.set("meeting_url", "");
      } else {
        const currentSlots = JSON.parse(pollRow.get("slots_json") || "[]");
        if (!currentSlots.some((s) => s.id === body.finalizedSlotId)) {
          return { statusCode: 400, body: JSON.stringify({ error: "Unknown slot to finalize." }) };
        }
        if (pollRow.get("finalized_slot_id") !== body.finalizedSlotId) pollRow.set("meeting_url", "");
        pollRow.set("finalized_slot_id", body.finalizedSlotId);
      }
    }
    if (body.meetingUrl !== undefined) {
      if (typeof body.meetingUrl !== "string" || body.meetingUrl.length > 4000) return json(400, {error:"Meeting link is too long."});
      let value = body.meetingUrl.trim();
      if (value) {
        let url;
        try { url = new URL(value); } catch { return json(400, {error:"Enter a complete HTTPS meeting link."}); }
        if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return json(400, {error:"Enter a complete HTTPS meeting link."});
        if (!pollRow.get("finalized_slot_id")) return json(400, {error:"Finalize a time before adding a meeting link."});
        value = url.href;
      }
      pollRow.set("meeting_url", value);
    }

    const proposed = JSON.parse(pollRow.get("slots_json") || "[]");
    const deadline = pollRow.get("deadline_iso");
    if (deadline && ((typeof body.deadlineIso === "string" && Date.parse(deadline) <= Date.now()) || proposed.some(s => Date.parse(s.iso) <= Date.parse(deadline)))) return json(400, {error:"Deadline must be before each proposed time; a newly set deadline must be in the future."});
    if ((pollRow.get("title") || "").length > 140) return json(400, {error:"Title is too long."});
    await pollRow.save();

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        title: pollRow.get("title"),
        slots: JSON.parse(pollRow.get("slots_json") || "[]"),
        mustAttend: JSON.parse(pollRow.get("must_attend_json") || "[]"),
        deadlineIso: pollRow.get("deadline_iso") || null,
        finalizedSlotId: pollRow.get("finalized_slot_id") || null,
        showGroupCounts: pollRow.get("show_group_counts") !== "false",
        durationMinutes: Number(pollRow.get("duration_minutes")) || 60,
        meetingUrl: pollRow.get("finalized_slot_id") ? pollRow.get("meeting_url") || null : null,
      }),
    };
  } catch (err) { console.error('update-poll failed', err); return sheetsError(err); }
};
