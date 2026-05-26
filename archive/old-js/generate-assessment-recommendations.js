module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
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
      return res.status(400).json({
        success: false,
        error: "Missing sessionId"
      });
    }

    const page = await findPageBySessionId({
      notionApiKey,
      databaseId,
      sessionId
    });

    if (!page) {
      return res.status(404).json({
        success: false,
        error: "Assessment session not found",
        sessionId
      });
    }

    const props = page.properties || {};

    return res.status(200).json({
      success: true,
      message: "Assessment row found",
      sessionId,
      notionPageId: page.id,
      communityName: getPlainText(props["Community Name"]) || getPlainText(props["Name"]),
      viSubmitted: getCheckbox(props["VI Submitted"]),
      wsiSubmitted: getCheckbox(props["WSI Submitted"]),
      readyForRecommendations: getCheckbox(props["Ready for Recommendations"]),
      agentStatus: getSelectName(props["Agent Status"]) || getStatusName(props["Agent Status"]),
      finishedState: getSelectName(props["Finished State"]) || getStatusName(props["Finished State"]),
      viScoreCurrent: getNumber(props["VI Score (Current)"]),
      wsiScore: getNumber(props["WSI Score"])
    });
  } catch (error) {
    console.error("GENERATE RECOMMENDATIONS FETCH ERROR:", error);

    return res.status(500).json({
      success: false,
      error: error.message || "Unknown server error"
    });
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

function getPlainText(prop) {
  if (!prop) return "";

  if (Array.isArray(prop.rich_text)) {
    return prop.rich_text.map(item => item?.plain_text || "").join("").trim();
  }

  if (Array.isArray(prop.title)) {
    return prop.title.map(item => item?.plain_text || "").join("").trim();
  }

  if (typeof prop === "string") {
    return cleanText(prop);
  }

  return "";
}

function getNumber(prop) {
  return typeof prop?.number === "number" ? prop.number : null;
}

function getCheckbox(prop) {
  return Boolean(prop?.checkbox);
}

function getSelectName(prop) {
  return cleanText(prop?.select?.name);
}

function getStatusName(prop) {
  return cleanText(prop?.status?.name);
}