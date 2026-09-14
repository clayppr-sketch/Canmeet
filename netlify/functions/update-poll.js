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

    // Must-Attend roster update
    if (Array.isArray(body.mustAttend)) {
      for (const name of body.mustAttend) {
        if (!hasFirstAndLast(name)) {
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
      for (const s of body.addSlots) {
        if (!isValidIso(s.iso)) {
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
      } else if (isValidIso(body.deadlineIso)) {
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
      } else {
        const currentSlots = JSON.parse(pollRow.get("slots_json") || "[]");
        if (!currentSlots.some((s) => s.id === body.finalizedSlotId)) {
          return { statusCode: 400, body: JSON.stringify({ error: "Unknown slot to finalize." }) };
        }
        pollRow.set("finalized_slot_id", body.finalizedSlotId);
      }
    }

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
      }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
