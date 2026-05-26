module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const notionApiKey = process.env.NOTION_API_KEY;
    const databaseId = process.env.NOTION_ASSESSMENTS_DATABASE_ID;

    if (!notionApiKey) {
      return res.status(500).json({ success: false, error: "Missing NOTION_API_KEY" });
    }

    if (!databaseId) {
      return res.status(500).json({ success: false, error: "Missing NOTION_ASSESSMENTS_DATABASE_ID" });
    }

    const body = req.body || {};
    const sessionId = cleanText(body.sessionId || body.assessment_session_id);

    if (!sessionId) {
      return res.status(400).json({ success: false, error: "Missing sessionId" });
    }

    const page = await findPageBySessionId({ notionApiKey, databaseId, sessionId });

    if (!page?.id) {
      return res.status(404).json({ success: false, error: "Assessment session not found", sessionId });
    }

    const operatorAlignment = cleanText(body.operator_alignment);
    const topPriorityAction = cleanText(body.top_priority_action);
    const executionConfidence = cleanText(body.execution_confidence);

    const availableNames = await getAvailablePropertyNames({ notionApiKey, pageId: page.id });
    const properties = {};

    if (availableNames.has("Operator Alignment")) {
      properties["Operator Alignment"] = selectProp(operatorAlignment);
    }

    if (availableNames.has("Top Priority Action")) {
      properties["Top Priority Action"] = selectProp(topPriorityAction);
    }

    if (availableNames.has("Execution Confidence")) {
      properties["Execution Confidence"] = selectProp(executionConfidence);
    }

    if (availableNames.has("Last Updated")) {
      properties["Last Updated"] = dateProp(new Date().toISOString());
    }

    if (Object.keys(properties).length === 0) {
      return res.status(400).json({ success: false, error: "No matching alignment properties exist on this database" });
    }

    const notionResponse = await fetch(`https://api.notion.com/v1/pages/${page.id}`, {
      method: "PATCH",
      headers: baseHeaders(notionApiKey),
      body: JSON.stringify({ properties })
    });

    const notionResult = await notionResponse.json();

    if (!notionResponse.ok) {
      return res.status(notionResponse.status || 500).json({
        success: false,
        error: notionResult.message || "Notion request failed",
        details: notionResult
      });
    }

    return res.status(200).json({
      success: true,
      sessionId,
      message: "Assessment alignment updated",
      operator_alignment: operatorAlignment,
      top_priority_action: topPriorityAction,
      execution_confidence: executionConfidence
    });
  } catch (error) {
    console.error("UPDATE ASSESSMENT ALIGNMENT ERROR:", error);
    return res.status(500).json({ success: false, error: error.message || "Unknown server error" });
  }
};

async function findPageBySessionId({ notionApiKey, databaseId, sessionId }) {
  const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: "POST",
    headers: baseHeaders(notionApiKey),
    body: JSON.stringify({
      filter: {
        property: "Assessment Session ID",
        rich_text: {
          equals: sessionId
        }
      },
      page_size: 1
    })
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.message || "Unable to query Notion database");
  }

  return result.results?.[0] || null;
}

async function getAvailablePropertyNames({ notionApiKey, pageId }) {
  const pageResp = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "GET",
    headers: baseHeaders(notionApiKey)
  });

  const pageJson = await pageResp.json();

  if (!pageResp.ok) {
    throw new Error(pageJson.message || "Unable to read Notion page");
  }

  return new Set(Object.keys(pageJson.properties || {}));
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

function selectProp(value) {
  const safe = cleanText(value);
  return safe ? { select: { name: safe } } : { select: null };
}

function dateProp(value) {
  const safe = cleanText(value);
  return safe ? { date: { start: safe } } : { date: null };
}
