const { getDoc, getFeedbackSheet } = require("./lib/sheets");

const MAX_LEN = 4000;

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

  const workingWell = (body.workingWell || "").trim();
  const couldImprove = (body.couldImprove || "").trim();
  const pageContext = (body.pageContext || "").trim();

  if (!workingWell && !couldImprove) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Fill in at least one of the two fields." }),
    };
  }
  if (workingWell.length > MAX_LEN || couldImprove.length > MAX_LEN) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Each field is limited to ${MAX_LEN} characters.` }),
    };
  }

  try {
    const doc = await getDoc();
    const feedbackSheet = await getFeedbackSheet(doc);

    await feedbackSheet.addRow({
      submitted_at: new Date().toISOString(),
      working_well: workingWell,
      could_improve: couldImprove,
      page_context: pageContext,
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
