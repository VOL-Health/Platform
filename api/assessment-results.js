module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const notionApiKey = process.env.NOTION_API_KEY;
    const databaseId = process.env.NOTION_ASSESSMENTS_DATABASE_ID;

    if (!notionApiKey) {
      return res.status(500).json({
        success: false,
        error: "Missing NOTION_API_KEY"
      });
    }

    if (!databaseId) {
      return res.status(500).json({
        success: false,
        error: "Missing NOTION_ASSESSMENTS_DATABASE_ID"
      });
    }

    const sessionId = cleanText(
      req.query?.sessionId || req.query?.assessment_session_id
    );

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

    const finishedState =
      getSelectName(props["Finished State"]) ||
      getStatusName(props["Finished State"]) ||
      getPlainText(props["Finished State"]) ||
      "";

    const agentStatus =
      getSelectName(props["Agent Status"]) ||
      getStatusName(props["Agent Status"]) ||
      getPlainText(props["Agent Status"]) ||
      "";

    const finalRecommendation =
      getPlainText(props["Final Recommendation"]) ||
      getPlainText(props["Final Recommendations"]) ||
      "";

    const priorityActionsRaw =
      getPlainText(props["Priority Actions"]) ||
      getPlainText(props["Priority Action"]) ||
      "";

    const currentCost =
      getPlainText(props["Current Cost"]) ||
      getPlainText(props["Current Costs"]) ||
      "";

    const priorityActions = parsePriorityActions(priorityActionsRaw);

    const hasFinalRecommendation = !!cleanText(finalRecommendation);
    const hasPriorityActions = Array.isArray(priorityActions) && priorityActions.length > 0;

    const isProcessed =
      finishedState === "Processed" ||
      hasFinalRecommendation ||
      hasPriorityActions;

    return res.status(200).json({
      success: true,
      sessionId,
      assessment_session_id: sessionId,
      finishedState: isProcessed && !finishedState ? "Processed" : finishedState,
      agentStatus: isProcessed && !agentStatus ? "Processed" : agentStatus,
      viSubmitted: getCheckbox(props["VI Submitted"]),
      wsiSubmitted: getCheckbox(props["WSI Submitted"]),
      viScoreCurrent: getNumber(props["VI Score (Current)"]) ?? getNumber(props["VI Score Current"]),
      viScoreStabilized: getNumber(props["VI Score (Stabilized)"]) ?? getNumber(props["VI Score Stabilized"]),
      viVolatilityDrag: getNumber(props["VI Volatility Drag"]),
      viDominantDomain: getSelectName(props["VI Dominant Domain"]) || getPlainText(props["VI Dominant Domain"]),
      viInterpretation: getPlainText(props["VI Interpretation"]),
      wsiScore: getNumber(props["WSI Score"]),
      wsiScoreCurrent: getNumber(props["WSI Score (Current)"]) ?? getNumber(props["WSI Score"]),
      wsiScoreStabilized: getNumber(props["WSI Score (Stabilized)"]) ?? getNumber(props["WSI Score Stabilized"]),
      wsiRiskLevel: getSelectName(props["WSI Risk Level"]) || getPlainText(props["WSI Risk Level"]),
      coverageStability: getSelectName(props["Coverage Stability"]) || getPlainText(props["Coverage Stability"]),
      workforceReliability: getSelectName(props["Workforce Reliability"]) || getPlainText(props["Workforce Reliability"]),
      agencyDependency: getSelectName(props["Agency Dependency"]) || getPlainText(props["Agency Dependency"]),
      burnoutRisk: getSelectName(props["Burnout Risk"]) || getPlainText(props["Burnout Risk"]),
      primaryConstraint: getSelectName(props["Primary Constraint"]) || getPlainText(props["Primary Constraint"]),
      economicPressure: getSelectName(props["Economic Pressure"]) || getPlainText(props["Economic Pressure"]),
      elasticityState: getSelectName(props["Elasticity State"]) || getPlainText(props["Elasticity State"]),
      wsiInterpretation: getPlainText(props["WSI Interpretation"]),
      combinedStabilityScore: getNumber(props["Combined Stability Score"]),
      stabilityTier: getSelectName(props["Stability Tier"]) || getPlainText(props["Stability Tier"]),
      scoringSource: getSelectName(props["Scoring Source"]) || getPlainText(props["Scoring Source"]),
      scoringVersion: getPlainText(props["Scoring Version"]),
      scoreConfidence: getNumber(props["Score Confidence"]),
      missingInputs: parseMissingInputs(getPlainText(props["Missing Inputs"])),
      finalRecommendation,
      currentCost,
      current_cost: currentCost,
      priorityActions,
      isProcessed
    });
  } catch (error) {
    console.error("ASSESSMENT RESULTS API ERROR:", error);

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

  if (typeof prop.plain_text === "string") {
    return cleanText(prop.plain_text);
  }

  // fallback if the property is unexpectedly plain-text-like in another shape
  if (typeof prop === "string") {
    return cleanText(prop);
  }

  return "";
}

function getSelectName(prop) {
  return cleanText(prop?.select?.name);
}

function getStatusName(prop) {
  return cleanText(prop?.status?.name);
}

function getCheckbox(prop) {
  return Boolean(prop?.checkbox);
}

function getNumber(prop) {
  const value = prop?.number;
  return Number.isFinite(value) ? value : null;
}

function parsePriorityActions(value) {
  const raw = cleanText(value);
  if (!raw) return [];

  return raw
    .split(/\r?\n+/)
    .map(line => line.replace(/^\s*([-•*]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
}

function parseMissingInputs(value) {
  const raw = cleanText(value);
  if (!raw) return [];
  return raw.split(",").map(item => item.trim()).filter(Boolean);
}
