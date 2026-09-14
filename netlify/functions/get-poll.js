const { getDoc, getPollsSheet, getResponsesSheet } = require("./lib/sheets");

exports.handler = async (event) => {
  const pollId = event.queryStringParameters && event.queryStringParameters.id;
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

    const slots = JSON.parse(pollRow.get("slots_json") || "[]");
    const mustAttend = JSON.parse(pollRow.get("must_attend_json") || "[]");
    const title = pollRow.get("title");
    const deadlineIso = pollRow.get("deadline_iso") || null;
    const finalizedSlotId = pollRow.get("finalized_slot_id") || null;
    const organizerTimezone = pollRow.get("organizer_timezone") || null;

    const responsesSheet = await getResponsesSheet(doc);
    const responseRows = await responsesSheet.getRows();

    // Reduce to latest response per participant per slot. Rows are appended
    // in submission order, so scanning top-to-bottom and overwriting means
    // the last row for a given (participant, slot) pair wins — i.e. a
    // resubmission naturally supersedes an earlier one.
    const byParticipant = {}; // { name: { slotId: response } }
    const linkedMustAttend = {}; // { name: mustAttendNameOrNull }

    responseRows
      .filter((r) => r.get("poll_id") === pollId)
      .forEach((r) => {
        const name = r.get("participant_name");
        const slotId = r.get("slot_id");
        const response = r.get("response");
        const linked = r.get("linked_must_attend") || null;
        if (!byParticipant[name]) byParticipant[name] = {};
        byParticipant[name][slotId] = response;
        linkedMustAttend[name] = linked;
      });

    const participants = Object.keys(byParticipant);

    return {
      statusCode: 200,
      body: JSON.stringify({
        pollId,
        title,
        slots,
        mustAttend,
        participants,
        responses: byParticipant,
        linkedMustAttend,
        deadlineIso,
        finalizedSlotId,
        organizerTimezone,
      }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
