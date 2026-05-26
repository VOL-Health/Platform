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

    const existingPage = await findPageBySessionId({
      notionApiKey,
      databaseId,
      sessionId
    });

   const schema = await getPropertySchema({
      notionApiKey,
      databaseId
    });

    const existingProps = existingPage?.properties || {};
    const hasVISubmitted = getCheckbox(existingProps["VI Submitted"]);
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

    const wsiScore = toNumberOrNull(body.wsi_score);
    const wsiScoreStabilized = cleanText(body.wsi_score_stabilized);
    const annualVolatilityCost = toNumberOrNull(body.annual_volatility_cost);
    const stabilizableUpside = toNumberOrNull(body.stabilizable_upside);
    const workforceDragCost = toNumberOrNull(body.workforce_drag_cost);

    const openShifts = cleanText(body.open_shifts_per_week);
    const percentShiftsPrn = cleanText(body.percent_shifts_prn);
    const lastMinuteCalloffs = cleanText(body.last_minute_calloffs_per_week);
    const coverageResolution = normalizeCoverageResolution(body.coverage_resolution);
    const monthlyOtHours = cleanText(body.monthly_ot_hours);
    const otPremiumPercent = cleanText(body.ot_premium_percent);
    const agencyPremiumPercent = cleanText(body.agency_premium_percent);
    const pbjRiskScore = cleanText(body.pbj_risk_score);
    const surveyCitationsStaffing = cleanText(body.survey_citations_staffing);
    const leadershipTurnoverEvents = cleanText(body.leadership_turnover_events);
    const annualClinicalTurnoverRate = cleanText(body.annual_clinical_turnover_rate);
    const openClinicalFteVacancies = cleanText(body.open_clinical_fte_vacancies);
    const avgTimeToFillDays = cleanText(body.avg_time_to_fill_days);
    const monthlyRecruitingSpend = cleanText(body.monthly_recruiting_spend);

    const safeWSIRiskLevel = normalizeWSIRiskLevel(body.wsi_risk_level, wsiScore);
    const safeCoverageStability = normalizeCoverageStability(body.coverage_stability, {
      openShifts,
      lastMinuteCalloffs,
      coverageResolution
    });
    const safeWorkforceReliability = normalizeWorkforceReliability(body.workforce_reliability, wsiScore);
    const safeAgencyDependency = normalizeAgencyDependency(body.agency_dependency, percentShiftsPrn);
    const safeBurnoutRisk = normalizeBurnoutRisk(body.burnout_risk);
    const safePrimaryConstraint = normalizePrimaryConstraint(body.primary_constraint);
    const safeEconomicPressure = normalizeEconomicPressure(body.economic_pressure, annualVolatilityCost);
    const safeElasticityState = cleanText(body.elasticity_state);
    const safeElasticityMeaning = cleanText(body.elasticity_meaning);
    const safeInterpretation = cleanText(body.wsi_interpretation);

    const hasRequiredWSICore =
      wsiScore !== null &&
      !!cleanText(wsiScoreStabilized) &&
      annualVolatilityCost !== null &&
      stabilizableUpside !== null &&
      workforceDragCost !== null;

    const nextWSISubmitted = hasRequiredWSICore;
    const shouldBeReady = hasVISubmitted && nextWSISubmitted;

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
    setProp(properties, schema, "Assessment Session ID", sessionId);

    setProp(properties, schema, "WSI Score", wsiScore);
    setProp(properties, schema, "WSI Score (Current)", wsiScore);
    setProp(properties, schema, "WSI Score (Stabilized)", cleanText(wsiScoreStabilized));
    setProp(properties, schema, "WSI Risk Level", safeWSIRiskLevel);
    setProp(properties, schema, "Coverage Stability", safeCoverageStability);
    setProp(properties, schema, "Workforce Reliability", safeWorkforceReliability);
    setProp(properties, schema, "Agency Dependency", safeAgencyDependency);
    setProp(properties, schema, "Burnout Risk", safeBurnoutRisk);
    setProp(properties, schema, "Primary Constraint", safePrimaryConstraint);
    setProp(properties, schema, "Economic Pressure", safeEconomicPressure);
    setProp(properties, schema, "Elasticity State", safeElasticityState);
    setProp(properties, schema, "Elasticity Meaning", safeElasticityMeaning);
    setProp(properties, schema, "WSI Interpretation", safeInterpretation);

    setProp(properties, schema, "Estimated Annual Volatility Exposure", annualVolatilityCost);
    setProp(properties, schema, "Annual Volatility Cost", annualVolatilityCost);
    setProp(properties, schema, "Stabilizable Upside", stabilizableUpside);
    setProp(properties, schema, "Workforce Drag Cost", workforceDragCost);

    setProp(properties, schema, "Open Shifts per Week", openShifts);
    setProp(properties, schema, "% of Shifts Covered by Agency/PRN", percentShiftsPrn);
    setProp(properties, schema, "Last-Minute Call-Offs per Week", lastMinuteCalloffs);
    setProp(properties, schema, "Coverage Resolution", coverageResolution);
    setProp(properties, schema, "Monthly Overtime Hours", monthlyOtHours);
    setProp(properties, schema, "Overtime Premium (% Above Base)", otPremiumPercent);
    setProp(properties, schema, "Agency/PRN Premium (% vs Core Staff)", agencyPremiumPercent);
    setProp(properties, schema, "PBJ Exposure / Risk Score", pbjRiskScore);
    setProp(properties, schema, "Survey Citations Related to Staffing", surveyCitationsStaffing);
    setProp(properties, schema, "Leadership Turnover Events", leadershipTurnoverEvents);
    setProp(properties, schema, "Annual Clinical Staff Turnover Rate", annualClinicalTurnoverRate);
    setProp(properties, schema, "Open Clinical FTE Vacancies", openClinicalFteVacancies);
    setProp(properties, schema, "Average Time-to-Fill Days", avgTimeToFillDays);
    setProp(properties, schema, "Monthly Recruiting Spend", monthlyRecruitingSpend);

    setProp(properties, schema, "WSI Submitted", nextWSISubmitted);
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
      wsi_submitted: nextWSISubmitted,
      ready_for_recommendations: shouldBeReady,
      agent_status: nextAgentStatus,
      message: existingPage?.id ? "WSI assessment updated" : "WSI assessment created"
    });
  } catch (error) {
    console.error("WSI API ERROR:", error);
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

async function getPropertySchema({ notionApiKey, databaseId }) {
  const dbResp = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
    method: "GET",
    headers: baseHeaders(notionApiKey)
  });
  const dbJson = await dbResp.json();

  if (!dbResp.ok) {
    throw new Error(dbJson.message || "Unable to read Notion database");
  }

  return dbJson.properties || {};
}

function setProp(target, schema, propertyName, value) {
  const def = schema?.[propertyName];
  if (!def) return;

  const propType = def.type;
  if (!propType) return;

  if (value === undefined) return;

  if (propType === "title") {
    const safe = cleanText(value) || "Community";
    target[propertyName] = {
      title: [{ text: { content: safe } }]
    };
    return;
  }

  if (propType === "rich_text") {
    const safe = cleanText(value);
    target[propertyName] = safe
      ? { rich_text: [{ text: { content: safe } }] }
      : { rich_text: [] };
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
    return;
  }
}

function normalizeOptionForProperty(propertyName, value, options) {
  const safe = cleanText(value);
  if (!safe) return "";

  const optionNames = Array.isArray(options) ? options.map(option => option.name) : [];

  const exact = findOption(optionNames, safe);
  if (exact) return exact;

  let candidate = safe;

  switch (propertyName) {
    case "WSI Risk Level":
      candidate = normalizeWSIRiskLevel(safe);
      break;
    case "Coverage Stability":
      candidate = normalizeCoverageStability(safe);
      break;
    case "Workforce Reliability":
      candidate = normalizeWorkforceReliability(safe);
      break;
    case "Agency Dependency":
      candidate = normalizeAgencyDependency(safe);
      break;
    case "Burnout Risk":
      candidate = normalizeBurnoutRisk(safe);
      break;
    case "Economic Pressure":
      candidate = normalizeEconomicPressure(safe);
      break;
    case "Primary Constraint":
      candidate = normalizePrimaryConstraint(safe);
      break;
    case "Assessment Source":
      candidate = "website";
      break;
    case "Agent Status":
      candidate = normalizeAgentStatus(safe);
      break;
    default:
      candidate = safe;
      break;
  }

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

function normalizeWSIRiskLevel(value, scoreMaybe = null) {
  const safe = cleanText(value);
  const score = toNumberOrNull(scoreMaybe);

  if (!safe && score !== null) {
    if (score < 50) return "Critical";
    if (score < 58) return "High";
    if (score < 78) return "Moderate";
    return "Low";
  }

  const lower = safe.toLowerCase();
  if (["low", "moderate", "high", "critical"].includes(lower)) {
    return capitalize(lower);
  }
  if (lower === "medium") return "Moderate";
  if (lower === "severe") return "High";
  return safe;
}

function normalizeCoverageStability(value, context = null) {
  const safe = cleanText(value);
  const lower = safe.toLowerCase();

  const map = {
    "stable": "Stable",
    "supported": "Mildly Unstable",
    "mildly unstable": "Mildly Unstable",
    "stressed": "Unstable",
    "unstable": "Unstable",
    "fragile": "Highly Unstable",
    "highly unstable": "Highly Unstable"
  };

  if (map[lower]) return map[lower];

  if (context) {
    const open = toNumberOrNull(context.openShifts) ?? 0;
    const calloffs = toNumberOrNull(context.lastMinuteCalloffs) ?? 0;
    const resolution = cleanText(context.coverageResolution).toLowerCase();

    if (resolution === "unfilled" || open >= 12 || calloffs >= 6) return "Highly Unstable";
    if (resolution === "overtime" || open >= 6 || calloffs >= 3) return "Unstable";
    if (resolution === "external" || resolution === "internal_float") return "Mildly Unstable";
    return "Stable";
  }

  return safe;
}

function normalizeWorkforceReliability(value, scoreMaybe = null) {
  const safe = cleanText(value);
  const lower = safe.toLowerCase();
  const score = toNumberOrNull(scoreMaybe);

  const map = {
    "strong": "Strong",
    "high": "Strong",
    "functional": "Functional",
    "moderate": "Functional",
    "fragile": "Fragile",
    "low": "Fragile",
    "failing": "Failing"
  };

  if (map[lower]) return map[lower];

  if (!safe && score !== null) {
    if (score < 50) return "Failing";
    if (score < 68) return "Fragile";
    if (score < 80) return "Functional";
    return "Strong";
  }

  return safe;
}

function normalizeAgencyDependency(value, percentMaybe = null) {
  const safe = cleanText(value);
  const lower = safe.toLowerCase();
  const pct = toNumberOrNull(percentMaybe);

  const map = {
    "minimal": "Minimal",
    "low": "Low",
    "moderate": "Moderate",
    "high": "Heavy",
    "heavy": "Heavy",
    "critical": "Critical"
  };

  if (map[lower]) return map[lower];

  if (!safe && pct !== null) {
    if (pct >= 50) return "Critical";
    if (pct >= 30) return "Heavy";
    if (pct >= 10) return "Moderate";
    if (pct > 0) return "Low";
    return "Minimal";
  }

  return safe;
}

function normalizeBurnoutRisk(value) {
  const safe = cleanText(value);
  const lower = safe.toLowerCase();

  const map = {
    "low": "Low",
    "moderate": "Moderate",
    "medium": "Moderate",
    "high": "High",
    "severe": "Severe",
    "critical": "Severe"
  };

  return map[lower] || safe;
}

function normalizeEconomicPressure(value, annualCostMaybe = null) {
  const safe = cleanText(value);
  const lower = safe.toLowerCase();
  const annualCost = toNumberOrNull(annualCostMaybe);

  const map = {
    "low": "Low",
    "contained": "Low",
    "moderate": "Moderate",
    "building": "Building",
    "high": "High",
    "meaningful": "High",
    "severe": "Severe",
    "critical": "Severe"
  };

  if (map[lower]) return map[lower];

  if (!safe && annualCost !== null) {
    if (annualCost < 250000) return "Low";
    if (annualCost < 500000) return "Moderate";
    if (annualCost < 750000) return "Building";
    if (annualCost < 1250000) return "High";
    return "Severe";
  }

  return safe;
}

function normalizePrimaryConstraint(value) {
  const safe = cleanText(value);
  const lower = safe.toLowerCase();

  const map = {
    "coverage instability": "Coverage Instability",
    "coverage fragility": "Coverage Instability",
    "coverage pressure": "Coverage Instability",
    "workforce fragility": "Workforce Fragility",
    "workforce reliability": "Workforce Fragility",
    "burnout pressure": "Burnout Pressure",
    "burnout risk": "Burnout Pressure",
    "agency dependency": "Agency Dependency",
    "pipeline weakness": "Pipeline Weakness",
    "recruiting weakness": "Pipeline Weakness",
    "financial pressure": "Financial Pressure",
    "economic pressure": "Financial Pressure",
    "compliance risk": "Compliance Risk",
    "survey risk": "Compliance Risk",
    "financial exposure": "Financial Exposure"
  };

  return map[lower] || safe;
}

function normalizeAgentStatus(value) {
  const safe = cleanText(value);
  const lower = safe.toLowerCase();
  if (lower === "processed") return "Processed";
  if (lower === "processing") return "Processing";
  if (lower === "ready") return "Ready";
  if (lower === "not run") return "Not Run";
  return safe;
}

function normalizeCoverageResolution(value) {
  const safe = cleanText(value);
  if (!safe) return "";

  const lower = safe.toLowerCase();
  const pretty = {
    overtime: "Overtime",
    internal_float: "Internal Float / PRN",
    external: "External Coverage",
    unfilled: "Unfilled"
  };

  return pretty[lower] || safe;
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

function capitalize(value) {
  const safe = cleanText(value);
  return safe ? safe.charAt(0).toUpperCase() + safe.slice(1) : "";
}