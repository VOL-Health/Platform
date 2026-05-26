module.exports = async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const notionApiKey = process.env.NOTION_API_KEY;
    const databaseId = process.env.NOTION_ASSESSMENTS_DATABASE_ID;
    if (!notionApiKey) return res.status(500).send("Missing NOTION_API_KEY");
    if (!databaseId) return res.status(500).send("Missing NOTION_ASSESSMENTS_DATABASE_ID");

    const body = req.method === "POST"
      ? (typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}))
      : req.query || {};
    const sessionId = cleanText(body.sessionId || body.assessment_session_id);
    const actionNumber = cleanText(body.actionNumber || body.action_number);
    const outcome = cleanText(body.outcome);
    const blocker = cleanText(body.blocker || body.execution_barrier);
    const note = cleanText(body.note || body.notes);

    if (!sessionId) return res.status(400).send("Missing sessionId");
    if (!outcome && !blocker && !note) return res.status(400).send("Missing follow-up response");

    const schema = await getDatabaseSchema({ notionApiKey, databaseId });
    const page = await findPageBySessionId({ notionApiKey, databaseId, sessionId });
    if (!page?.id) return res.status(404).send("Follow-up batch not found");

    const now = new Date().toISOString();
    const existingSummary = getPlainText(page.properties?.["Follow-Up Response Summary"]);
    const summaryLine = [
      outcome && actionNumber ? `Action ${actionNumber}: ${outcome}` : "",
      blocker ? `Shared blocker: ${blocker}` : "",
      note ? `Note: ${note}` : ""
    ].filter(Boolean).join(" | ");

    const properties = {};
    setProp(properties, schema, "Follow-Up Status", "Responded");
    setProp(properties, schema, "Follow-Up Responded At", now);
    setProp(properties, schema, "Last Updated", now);
    setProp(properties, schema, "Execution Barrier", blocker);
    setProp(properties, schema, "Outcome Observed", outcome);
    setProp(properties, schema, "Follow-Up Response Summary", [existingSummary, summaryLine].filter(Boolean).join("\n"));
    if (actionNumber && outcome) {
      setProp(properties, schema, `Action ${actionNumber} Outcome`, outcome);
    }

    const response = await fetch(`https://api.notion.com/v1/pages/${page.id}`, {
      method: "PATCH",
      headers: baseHeaders(notionApiKey),
      body: JSON.stringify({ properties })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Unable to save follow-up response");

    if (req.method === "GET") {
      return res.status(200).send(renderThanks({ outcome, blocker }));
    }
    return res.status(200).json({ success: true, sessionId, saved_fields: Object.keys(properties) });
  } catch (error) {
    console.error("RECORD FOLLOWUP RESPONSE ERROR:", error);
    if (req.method === "GET") return res.status(500).send("Unable to save follow-up response.");
    return res.status(500).json({ success: false, error: error.message || "Unknown server error" });
  }
};

async function findPageBySessionId({ notionApiKey, databaseId, sessionId }) {
  const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: "POST",
    headers: baseHeaders(notionApiKey),
    body: JSON.stringify({
      filter: { property: "Assessment Session ID", rich_text: { equals: sessionId } },
      page_size: 1
    })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || "Unable to query Notion database");
  return result.results?.[0] || null;
}

async function getDatabaseSchema({ notionApiKey, databaseId }) {
  const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
    method: "GET",
    headers: baseHeaders(notionApiKey)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || "Unable to read Notion database schema");
  return result.properties || {};
}

function setProp(target, schema, propertyName, value) {
  const def = schema?.[propertyName];
  if (!def || value === undefined) return;
  if (def.type === "rich_text") {
    const safe = cleanText(value);
    target[propertyName] = safe ? { rich_text: [{ text: { content: safe } }] } : { rich_text: [] };
    return;
  }
  if (def.type === "select") {
    const safe = cleanText(value);
    if (!safe || !hasOption(def.select?.options, safe)) return;
    target[propertyName] = { select: { name: safe } };
    return;
  }
  if (def.type === "status") {
    const safe = cleanText(value);
    if (!safe || !hasOption(def.status?.options, safe)) return;
    target[propertyName] = { status: { name: safe } };
    return;
  }
  if (def.type === "date") {
    const safe = cleanText(value);
    target[propertyName] = safe ? { date: { start: safe } } : { date: null };
    return;
  }
}

function getPlainText(prop) {
  if (!prop) return "";
  if (Array.isArray(prop.rich_text)) return prop.rich_text.map(item => item?.plain_text || "").join("").trim();
  if (Array.isArray(prop.title)) return prop.title.map(item => item?.plain_text || "").join("").trim();
  return "";
}

function baseHeaders(key) {
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28"
  };
}

function cleanText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function hasOption(options, value) {
  if (!Array.isArray(options) || options.length === 0) return true;
  const safe = cleanText(value).toLowerCase();
  return options.some(option => cleanText(option.name).toLowerCase() === safe);
}

function renderThanks({ outcome, blocker }) {
  const message = outcome
    ? `Saved outcome: ${escapeHtml(outcome)}`
    : blocker
      ? `Saved blocker: ${escapeHtml(blocker)}`
      : "Saved follow-up response.";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VOL Follow-Up Saved</title></head><body style="margin:0;background:#0d1323;color:#f4f7fb;font-family:Inter,Arial,sans-serif;"><main style="max-width:560px;margin:12vh auto;padding:24px;"><div style="border:1px solid #24304a;border-radius:18px;background:#111a2f;padding:24px;"><div style="color:#7ce7b5;font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;">VOL follow-up</div><h1 style="margin:10px 0 8px;font-size:26px;">Response saved</h1><p style="color:#b8c4d8;line-height:1.55;">${message}</p></div></main></body></html>`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
