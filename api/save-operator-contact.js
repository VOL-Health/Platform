module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const email = cleanText(body.email || body.operator_email);
    const name = cleanText(body.name || body.operator_name || body.submitted_by);
    const communityName = cleanText(body.community_name);
    const sessionId = cleanText(body.sessionId || body.assessment_session_id);

    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, error: "Invalid email" });
    }

    const contact = {
      email,
      name,
      community_name: communityName,
      saved_at: new Date().toISOString()
    };

    const notionApiKey = process.env.NOTION_API_KEY;
    const databaseId = process.env.NOTION_ASSESSMENTS_DATABASE_ID;
    if (!notionApiKey || !databaseId || !sessionId) {
      return res.status(200).json({ success: true, contact, notion_saved: false });
    }

    const schema = await getDatabaseSchema({ notionApiKey, databaseId });
    const existingPage = await findPageBySessionId({ notionApiKey, databaseId, sessionId, schema });
    if (!existingPage?.id) {
      return res.status(200).json({ success: true, contact, notion_saved: false, skipped_reason: "Session record not found" });
    }

    const properties = {};
    setProp(properties, schema, "Email", email);
    setProp(properties, schema, "Submitted By", name);
    setProp(properties, schema, "Community Name", communityName);
    setProp(properties, schema, "Follow-Up Contact Email", email);
    setProp(properties, schema, "Follow-Up Contact Name", name);
    setProp(properties, schema, "Follow-Up Contact Missing", false);
    setProp(properties, schema, "Last Updated", contact.saved_at);

    const hasPendingReaction = Boolean(getPlainText(existingPage.properties?.["Reacted Actions"]) || getPlainText(existingPage.properties?.["Action Pulse Summary"]));
    if (hasPendingReaction) {
      setProp(properties, schema, "Follow-Up Status", "Pending");
      setProp(properties, schema, "Follow-Up Scheduled At", getDateStart(existingPage.properties?.["Follow-Up Scheduled At"]) || addHours(contact.saved_at, 24));
    }

    if (Object.keys(properties).length) {
      await fetch(`https://api.notion.com/v1/pages/${existingPage.id}`, {
        method: "PATCH",
        headers: baseHeaders(notionApiKey),
        body: JSON.stringify({ properties })
      });
    }

    return res.status(200).json({ success: true, contact, notion_saved: true });
  } catch (error) {
    console.error("SAVE OPERATOR CONTACT ERROR:", error);
    return res.status(500).json({ success: false, error: error.message || "Unknown server error" });
  }
};

async function findPageBySessionId({ notionApiKey, databaseId, sessionId, schema }) {
  if (!schema["Assessment Session ID"]) return null;
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
  if (def.type === "email") {
    const safe = cleanText(value);
    target[propertyName] = { email: safe || null };
    return;
  }
  if (def.type === "rich_text") {
    const safe = cleanText(value);
    target[propertyName] = safe ? { rich_text: [{ text: { content: safe } }] } : { rich_text: [] };
    return;
  }
  if (def.type === "title") {
    const safe = cleanText(value);
    if (safe) target[propertyName] = { title: [{ text: { content: safe } }] };
    return;
  }
  if (def.type === "checkbox") {
    target[propertyName] = { checkbox: Boolean(value) };
    return;
  }
  if (def.type === "date") {
    const safe = cleanText(value);
    target[propertyName] = safe ? { date: { start: safe } } : { date: null };
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
  }
}

function getPlainText(prop) {
  if (!prop) return "";
  if (Array.isArray(prop.rich_text)) return prop.rich_text.map(item => item?.plain_text || "").join("").trim();
  if (Array.isArray(prop.title)) return prop.title.map(item => item?.plain_text || "").join("").trim();
  return "";
}

function getDateStart(prop) {
  return cleanText(prop?.date?.start);
}

function addHours(value, hours) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  date.setHours(date.getHours() + hours);
  return date.toISOString();
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

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanText(value));
}

function hasOption(options, value) {
  if (!Array.isArray(options) || options.length === 0) return true;
  const safe = cleanText(value).toLowerCase();
  return options.some(option => cleanText(option.name).toLowerCase() === safe);
}
