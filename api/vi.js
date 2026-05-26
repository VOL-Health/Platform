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
    const sessionId = cleanText(body.assessment_session_id);

    if (!sessionId) {
      return res.status(400).json({ success: false, error: "Missing sessionId" });
    }

    const existingPage = await findPageBySessionId({ notionApiKey, databaseId, sessionId });
    const schema = await getDatabaseSchema({ notionApiKey, databaseId });

    const existingProps = existingPage?.properties || {};
    const hasWSISubmitted = getCheckbox(existingProps["WSI Submitted"]);
    const currentAgentStatus =
      getSelectName(existingProps["Agent Status"]) ||
      getStatusName(existingProps["Agent Status"]) ||
      "Not Run";
    const currentFinishedState =
      getSelectName(existingProps["Finished State"]) ||
      getStatusName(existingProps["Finished State"]) ||
      "";

    const safeCommunityName = cleanText(body.community_name || body.entity_name) || "Community";
    const safeOperator = cleanText(body.operator);
    const safeCity = cleanText(body.city);
    const safeState = cleanText(body.state);
    const safeSubmittedBy = cleanText(body.submitted_by);
    const safeEmail = cleanText(body.email);
    const safeRoleTitle = cleanText(body.role_title);
    const safeMarket = safeCity && safeState ? `${safeCity}, ${safeState}` : "";

    const viScoreCurrent = toNumberOrNull(body.vi_score_current);
    const viScoreStabilized = toNumberOrNull(body.vi_score_stabilized);
    const volatilityDrag = toNumberOrNull(body.volatility_drag);
    const projectedGain = toNumberOrNull(body.projected_gain);
    const safeDominantDomain = normalizeVIDominantDomain(body.dominant_domain);
    const safeInterpretation = cleanText(body.vi_interpretation);

    const nextVISubmitted = viScoreCurrent !== null && viScoreStabilized !== null;
    const shouldBeReady = nextVISubmitted && hasWSISubmitted;

    let nextAgentStatus = currentAgentStatus;
    if (currentFinishedState === "Processed" || currentAgentStatus === "Processed") {
      nextAgentStatus = "Processed";
    } else if (currentAgentStatus === "Processing") {
      nextAgentStatus = "Processing";
    } else if (shouldBeReady) {
      nextAgentStatus = "Ready";
    } else if (!existingPage?.id) {
      nextAgentStatus = "Not Run";
    }

    const properties = {};
    setProp(properties, schema, "Name", safeCommunityName);
    setProp(properties, schema, "Community Name", safeCommunityName);
    setProp(properties, schema, "Operator", safeOperator);
    setProp(properties, schema, "Market", safeMarket);
    setProp(properties, schema, "City", safeCity);
    setProp(properties, schema, "State", safeState);
    setProp(properties, schema, "Submitted By", safeSubmittedBy);
    setProp(properties, schema, "Email", safeEmail);
    setProp(properties, schema, "Role / Title", safeRoleTitle);
    setProp(properties, schema, "Community Type", cleanText(body.community_type));
    setProp(properties, schema, "Assessment Session ID", sessionId);

    setProp(properties, schema, "VI Score (Current)", viScoreCurrent);
    setProp(properties, schema, "VI Score (Stabilized)", viScoreStabilized);
    setProp(properties, schema, "VI Volatility Drag", volatilityDrag);
    setProp(properties, schema, "VI Projected Gain", projectedGain);
    setProp(properties, schema, "VI Dominant Domain", safeDominantDomain);
    setProp(properties, schema, "VI Interpretation", safeInterpretation);

    setProp(properties, schema, "Census Volatility", body.census_volatility);
    setProp(properties, schema, "Acuity Variability", body.acuity_variability);
    setProp(properties, schema, "Leadership Bandwidth", body.leadership_bandwidth);
    setProp(properties, schema, "Workflow Disruption", body.workflow_disruption);
    setProp(properties, schema, "Care Coordination Strain", body.care_coordination_strain);
    setProp(properties, schema, "Schedule Stress", body.schedule_stress);
    setProp(properties, schema, "Coverage Fragility", body.coverage_fragility);
    setProp(properties, schema, "Overtime Pressure", body.overtime_pressure);
    setProp(properties, schema, "Survey Exposure", body.survey_exposure);
    setProp(properties, schema, "Reimbursement Pressure", body.reimbursement_pressure);

    setProp(properties, schema, "VI Submitted", nextVISubmitted);
    setProp(properties, schema, "Ready for Recommendations", shouldBeReady);
    setProp(properties, schema, "Assessment Source", "website");
    setProp(properties, schema, "Agent Status", nextAgentStatus);

    let notionResponse;
    if (existingPage?.id) {
      notionResponse = await fetch(`https://api.notion.com/v1/pages/${existingPage.id}`, {
        method: "PATCH",
        headers: baseHeaders(notionApiKey),
        body: JSON.stringify({ properties })
      });
    } else {
      notionResponse = await fetch("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: baseHeaders(notionApiKey),
        body: JSON.stringify({
          parent: { database_id: databaseId },
          properties
        })
      });
    }

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
      recordId: notionResult.id,
      record_id: notionResult.id,
      sessionId,
      assessment_session_id: sessionId,
      vi_submitted: nextVISubmitted,
      ready_for_recommendations: shouldBeReady,
      agent_status: nextAgentStatus,
      message: existingPage?.id ? "VI assessment updated" : "VI assessment created"
    });
  } catch (error) {
    console.error("VI API ERROR:", error);
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
        rich_text: { equals: sessionId }
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

async function getDatabaseSchema({ notionApiKey, databaseId }) {
  const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
    method: "GET",
    headers: baseHeaders(notionApiKey)
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.message || "Unable to read Notion database");
  }
  return result.properties || {};
}

function setProp(target, schema, propertyName, value) {
  const def = schema?.[propertyName];
  if (!def || value === undefined) return;

  const propType = def.type;
  if (propType === "title") {
    const safe = cleanText(value) || "Community";
    target[propertyName] = { title: [{ text: { content: safe } }] };
    return;
  }
  if (propType === "rich_text") {
    const safe = cleanText(value);
    target[propertyName] = safe ? { rich_text: [{ text: { content: safe } }] } : { rich_text: [] };
    return;
  }
  if (propType === "number") {
    target[propertyName] = { number: toNumberOrNull(value) };
    return;
  }
  if (propType === "checkbox") {
    target[propertyName] = { checkbox: !!value };
    return;
  }
  if (propType === "select") {
    const normalized = normalizeOptionForProperty(propertyName, value, def.select?.options || []);
    target[propertyName] = normalized ? { select: { name: normalized } } : { select: null };
    return;
  }
  if (propType === "status") {
    const normalized = normalizeOptionForProperty(propertyName, value, def.status?.options || []);
    target[propertyName] = normalized ? { status: { name: normalized } } : { status: null };
    return;
  }
  if (propType === "email") {
    const safe = cleanText(value);
    target[propertyName] = { email: safe || null };
    return;
  }
  if (propType === "url") {
    const safe = cleanText(value);
    target[propertyName] = { url: safe || null };
    return;
  }
  if (propType === "phone_number") {
    const safe = cleanText(value);
    target[propertyName] = { phone_number: safe || null };
  }
}

function normalizeOptionForProperty(propertyName, value, options) {
  const safe = cleanText(value);
  if (!safe) return "";
  const optionNames = Array.isArray(options) ? options.map(option => option.name) : [];

  const exact = findOption(optionNames, safe);
  if (exact) return exact;

  let candidate = safe;
  if (propertyName === "VI Dominant Domain") candidate = normalizeVIDominantDomain(safe);
  if (propertyName === "Assessment Source") candidate = "website";
  if (propertyName === "Agent Status") candidate = normalizeAgentStatus(safe);

  return findOption(optionNames, candidate) || "";
}

function findOption(options, target) {
  const safeTarget = cleanText(target);
  if (!safeTarget) return "";
  const exact = options.find(name => cleanText(name) === safeTarget);
  if (exact) return exact;
  const lower = safeTarget.toLowerCase();
  return options.find(name => cleanText(name).toLowerCase() === lower) || "";
}

function normalizeVIDominantDomain(domain) {
  const normalized = cleanText(domain).toLowerCase();
  if (normalized === "resident" || normalized === "resident demand") return "Resident Demand";
  if (normalized === "operations" || normalized === "operational system") return "Operational System";
  if (normalized === "workforce" || normalized === "workforce strain") return "Workforce Strain";
  if (normalized === "external" || normalized === "external pressure") return "External Pressure";
  return cleanText(domain);
}

function normalizeAgentStatus(value) {
  const safe = cleanText(value);
  const lower = safe.toLowerCase();
  if (lower === "processed") return "Processed";
  if (lower === "processing") return "Processing";
  if (lower === "ready") return "Ready";
  if (lower === "not run") return "Not Run";
  if (lower === "error") return "Error";
  return safe;
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

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function getCheckbox(prop) {
  return !!prop?.checkbox;
}

function getSelectName(prop) {
  return cleanText(prop?.select?.name);
}

function getStatusName(prop) {
  return cleanText(prop?.status?.name);
}
