const LOCAL_WEEKLY_SIGNALS_DATABASE_ID = "3613f11f-1bd5-80af-965f-f304805122ec";
const { deriveVolScoresFromNormalizedData } = require("../lib/vol-scoring");

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
    const databaseId =
  process.env.NOTION_WEEKLY_SIGNALS_DATABASE_ID ||
  LOCAL_WEEKLY_SIGNALS_DATABASE_ID;
    console.log("DATABASE ID:", databaseId);

    if (!notionApiKey) {
      return res.status(500).json({ success: false, error: "Missing NOTION_API_KEY" });
    }

    if (!databaseId) {
      return res.status(500).json({ success: false, error: "Missing NOTION_WEEKLY_SIGNALS_DATABASE_ID" });
    }

    const schema = await getDatabaseSchema({ notionApiKey, databaseId });

    const body = req.body || {};
    const communityProfile = body.community_profile || {};
    const weeklySignals = body.weekly_operational_signals || body.normalized?.weekly_operational_signals || [];

    if (!Array.isArray(weeklySignals) || weeklySignals.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Missing weekly_operational_signals array"
      });
    }

    const communityName =
  cleanText(body.community_name) ||
  cleanText(communityProfile.community_name?.value) ||
  cleanText(communityProfile.community_name) ||
  cleanText(weeklySignals[0]?.community_name) ||
  "Community";

    const communityId =
  cleanText(body.community_id) ||
  cleanText(communityProfile.community_id?.value) ||
  cleanText(communityProfile.community_id) ||
  cleanText(weeklySignals[0]?.community_id) ||
  "";

    const communityType =
  cleanText(body.community_type) ||
  cleanText(communityProfile.community_type?.value) ||
  cleanText(communityProfile.community_type) ||
  cleanText(weeklySignals[0]?.community_type) ||
  "";

    const created = [];

    const enrichedWeeklySignals = weeklySignals.map(row => appendDerivedScoring(row));

    for (const row of enrichedWeeklySignals) {
      const week = toNumber(row.week);
      const rowCommunityName = cleanText(row.community_name) || communityName;
      const rowCommunityId = cleanText(row.community_id) || communityId;
      const rowCommunityType = cleanText(row.community_type) || communityType;

      const recordName = `${rowCommunityName} | Week ${week || ""}`.trim();

      const properties = {};
      setProp(properties, schema, "Record Name", recordName);
      setProp(properties, schema, "Community ID", rowCommunityId);
      setProp(properties, schema, "Community Name", rowCommunityName);
      setProp(properties, schema, "Community Type", rowCommunityType);
      setProp(properties, schema, "Week", week);
      setProp(properties, schema, "Week Start", row.week_start);
      setProp(properties, schema, "Assessment Session ID", body.assessment_session_id || row.assessment_session_id);

      setProp(properties, schema, "VI Score Current", row.vi_score_current);
      setProp(properties, schema, "VI Score (Current)", row.vi_score_current);
      setProp(properties, schema, "VI Score Stabilized", row.vi_score_stabilized);
      setProp(properties, schema, "VI Score (Stabilized)", row.vi_score_stabilized);
      setProp(properties, schema, "VI Volatility Drag", row.vi_volatility_drag);
      setProp(properties, schema, "VI Dominant Domain", row.vi_dominant_domain);
      setProp(properties, schema, "VI Interpretation", row.vi_interpretation);
      setProp(properties, schema, "WSI Score", row.wsi_score);
      setProp(properties, schema, "WSI Score (Current)", row.wsi_score_current ?? row.wsi_score);
      setProp(properties, schema, "WSI Score Stabilized", row.wsi_score_stabilized);
      setProp(properties, schema, "WSI Score (Stabilized)", row.wsi_score_stabilized);
      setProp(properties, schema, "WSI Risk Level", row.wsi_risk_level);
      setProp(properties, schema, "Coverage Stability", row.coverage_stability);
      setProp(properties, schema, "Workforce Reliability", row.workforce_reliability);
      setProp(properties, schema, "Agency Dependency", row.agency_dependency);
      setProp(properties, schema, "Burnout Risk", row.burnout_risk);
      setProp(properties, schema, "Primary Constraint", row.primary_constraint);
      setProp(properties, schema, "Economic Pressure", row.economic_pressure);
      setProp(properties, schema, "Elasticity State", row.elasticity_state);
      setProp(properties, schema, "WSI Interpretation", row.wsi_interpretation);
      setProp(properties, schema, "Combined Stability Score", row.combined_stability_score);
      setProp(properties, schema, "Stability Tier", row.stability_tier);
      setProp(properties, schema, "Scoring Source", row.scoring_source);
      setProp(properties, schema, "scoring_source", row.scoring_source);
      setProp(properties, schema, "Scoring Version", row.scoring_version);
      setProp(properties, schema, "scoring_version", row.scoring_version);
      setProp(properties, schema, "Score Confidence", row.score_confidence);
      setProp(properties, schema, "score_confidence", row.score_confidence);
      setProp(properties, schema, "Missing Inputs", Array.isArray(row.missing_inputs) ? row.missing_inputs.join(", ") : row.missing_inputs);
      setProp(properties, schema, "missing_inputs", Array.isArray(row.missing_inputs) ? row.missing_inputs.join(", ") : row.missing_inputs);

      setProp(properties, schema, "Census Volatility", row.census_volatility);
      setProp(properties, schema, "Acuity Variability", row.acuity_variability);
      setProp(properties, schema, "Leadership Bandwidth", row.leadership_bandwidth);
      setProp(properties, schema, "Workflow Disruption", row.workflow_disruption);
      setProp(properties, schema, "Care Coordination Strain", row.care_coordination_strain);
      setProp(properties, schema, "Schedule Stress", row.schedule_stress);
      setProp(properties, schema, "Coverage Fragility", row.coverage_fragility);
      setProp(properties, schema, "Overtime Pressure", row.overtime_pressure);
      setProp(properties, schema, "Survey Exposure", row.survey_exposure);
      setProp(properties, schema, "Reimbursement Pressure", row.reimbursement_pressure);

      setProp(properties, schema, "Open Shifts", row.open_shifts ?? row.open_shifts_per_week);
      setProp(properties, schema, "Open Shifts per Week", row.open_shifts_per_week ?? row.open_shifts);
      setProp(properties, schema, "Last Minute Calloffs", row.last_minute_calloffs ?? row.last_minute_calloffs_per_week);
      setProp(properties, schema, "Last-Minute Call-Offs per Week", row.last_minute_calloffs_per_week ?? row.last_minute_calloffs);
      setProp(properties, schema, "Overtime Hours", row.overtime_hours ?? row.monthly_overtime_hours);
      setProp(properties, schema, "Monthly Overtime Hours", row.monthly_overtime_hours ?? row.overtime_hours);
      setProp(properties, schema, "Agency Shift Percent", row.agency_shift_percent ?? row.agency_shift_pct);
      setProp(properties, schema, "% of Shifts Covered by Agency/PRN", row.percent_shifts_prn ?? row.agency_shift_pct ?? row.agency_shift_percent);
      setProp(properties, schema, "Avg Time To Fill Days", row.avg_time_to_fill_days);
      setProp(properties, schema, "Average Time-to-Fill Days", row.avg_time_to_fill_days);
      setProp(properties, schema, "Open Roles", row.open_roles);
      setProp(properties, schema, "Open Clinical FTE Vacancies", row.open_clinical_fte_vacancies);
      setProp(properties, schema, "Coverage Resolution", row.coverage_resolution);
      setProp(properties, schema, "PBJ Exposure / Risk Score", row.pbj_risk_score);
      setProp(properties, schema, "Leadership Turnover Events", row.leadership_turnover_events);
      setProp(properties, schema, "Monthly Recruiting Spend", row.monthly_recruiting_spend);

      setProp(properties, schema, "Regular Labor Cost", row.regular_labor_cost);
      setProp(properties, schema, "Overtime Cost", row.overtime_cost);
      setProp(properties, schema, "Agency Cost", row.agency_cost);
      setProp(properties, schema, "Recruiting Cost", row.recruiting_cost);
      setProp(properties, schema, "Estimated Volatility Drag", row.estimated_volatility_drag);
      setProp(properties, schema, "Total Labor Cost", row.total_labor_cost);

      setProp(properties, schema, "Move Ins", row.move_ins);
      setProp(properties, schema, "Move Outs", row.move_outs);
      setProp(properties, schema, "Hospital Transfers", row.hospital_transfers);
      setProp(properties, schema, "Total Census", row.total_census);
      setProp(properties, schema, "Occupancy Percent", row.occupancy_percent ?? row.occupancy_pct);

      setProp(properties, schema, "Dominant Pattern", row.dominant_pattern || row.vi_dominant_domain || row.primary_constraint);
      setProp(properties, schema, "Recommended Focus", row.recommended_focus);
      setProp(properties, schema, "Notes", row.notes);

      const notionResponse = await fetch("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: baseHeaders(notionApiKey),
        body: JSON.stringify({
          parent: { database_id: databaseId },
          properties
        })
      });

      const notionResult = await notionResponse.json();

      if (!notionResponse.ok) {
        return res.status(notionResponse.status || 500).json({
          success: false,
          error: notionResult.message || "Notion create page failed",
          failed_week: week,
          details: notionResult
        });
      }

      created.push({
        week,
        page_id: notionResult.id,
        record_name: recordName,
        scoring_source: row.scoring_source,
        vi_score_current: row.vi_score_current,
        wsi_score: row.wsi_score,
        combined_stability_score: row.combined_stability_score,
        stability_tier: row.stability_tier
      });
    }

    return res.status(200).json({
      success: true,
      created_count: created.length,
      created,
      weekly_operational_signals: enrichedWeeklySignals
    });
  } catch (error) {
    console.error("WRITE WEEKLY SIGNALS ERROR:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Unknown server error"
    });
  }
};

function appendDerivedScoring(row) {
  const hasNormalizedSignals = [
    "open_shifts_per_week",
    "open_shifts",
    "last_minute_calloffs_per_week",
    "last_minute_calloffs",
    "monthly_overtime_hours",
    "overtime_hours",
    "agency_shift_pct",
    "agency_shift_percent",
    "percent_shifts_prn",
    "census_volatility",
    "acuity_variability",
    "leadership_bandwidth",
    "workflow_disruption",
    "schedule_stress",
    "coverage_fragility",
    "overtime_pressure"
  ].some(key => hasObservedValue(row, key));

  if (!hasNormalizedSignals) {
    return row;
  }

  const normalizedForScoring = {
    ...row,
    open_shifts_per_week: firstObserved(row.open_shifts_per_week, row.open_shifts),
    last_minute_calloffs_per_week: firstObserved(row.last_minute_calloffs_per_week, row.last_minute_calloffs),
    monthly_overtime_hours: firstObserved(row.monthly_overtime_hours, row.overtime_hours),
    agency_shift_pct: firstObserved(row.agency_shift_pct, row.agency_shift_percent),
    percent_shifts_prn: firstObserved(row.percent_shifts_prn, row.agency_shift_percent, row.agency_shift_pct)
  };

  const scores = deriveVolScoresFromNormalizedData(normalizedForScoring);

  return {
    ...row,
    vi_score_current: scores["VI Score (Current)"],
    vi_score_stabilized: scores["VI Score (Stabilized)"],
    vi_volatility_drag: scores["VI Volatility Drag"],
    vi_dominant_domain: scores["VI Dominant Domain"],
    vi_interpretation: scores["VI Interpretation"],
    wsi_score: scores["WSI Score"],
    wsi_score_current: scores["WSI Score (Current)"],
    wsi_score_stabilized: scores["WSI Score (Stabilized)"],
    wsi_risk_level: scores["WSI Risk Level"],
    coverage_stability: scores["Coverage Stability"],
    workforce_reliability: scores["Workforce Reliability"],
    agency_dependency: scores["Agency Dependency"],
    burnout_risk: scores["Burnout Risk"],
    primary_constraint: scores["Primary Constraint"],
    economic_pressure: scores["Economic Pressure"],
    elasticity_state: scores["Elasticity State"],
    wsi_interpretation: scores["WSI Interpretation"],
    combined_stability_score: scores["Combined Stability Score"],
    stability_tier: scores["Stability Tier"],
    scoring_source: "derived_normalized_data",
    scoring_version: "vol-scoring-v1",
    score_confidence: scores.score_confidence,
    missing_inputs: scores.missing_inputs
  };
}

async function getDatabaseSchema({ notionApiKey, databaseId }) {
  const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
    method: "GET",
    headers: baseHeaders(notionApiKey)
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.message || "Unable to read Notion database schema");
  }
  return result.properties || {};
}

function setProp(target, schema, propertyName, value) {
  const def = schema?.[propertyName];
  if (!def || value === undefined) return;

  const propType = def.type;
  if (propType === "title") {
    target[propertyName] = titleProp(value);
    return;
  }
  if (propType === "rich_text") {
    target[propertyName] = richTextProp(value);
    return;
  }
  if (propType === "number") {
    target[propertyName] = numberProp(value);
    return;
  }
  if (propType === "select") {
    const safe = cleanText(value);
    if (!safe) {
      target[propertyName] = { select: null };
      return;
    }
    if (!hasOption(def.select?.options, safe)) return;
    target[propertyName] = { select: { name: safe } };
    return;
  }
  if (propType === "date") {
    target[propertyName] = dateProp(value);
    return;
  }
  if (propType === "checkbox") {
    target[propertyName] = { checkbox: Boolean(value) };
  }
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

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function titleProp(value) {
  const safe = cleanText(value);
  return {
    title: [{ text: { content: safe || "Untitled Record" } }]
  };
}

function richTextProp(value) {
  const safe = cleanText(value);
  return {
    rich_text: safe ? [{ text: { content: safe } }] : []
  };
}

function numberProp(value) {
  const number = toNumber(value);
  return { number };
}

function selectProp(value) {
  const safe = cleanText(value);
  return safe ? { select: { name: safe } } : { select: null };
}

function dateProp(value) {
  const safe = cleanText(value);
  return safe ? { date: { start: safe } } : { date: null };
}

function firstObserved(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return undefined;
}

function hasObservedValue(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key) && obj[key] !== null && obj[key] !== undefined && obj[key] !== "";
}

function hasOption(options, value) {
  if (!Array.isArray(options) || options.length === 0) return true;
  const safe = cleanText(value).toLowerCase();
  return options.some(option => cleanText(option.name).toLowerCase() === safe);
}
