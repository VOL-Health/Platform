const XLSX = require("xlsx");
const { formidable } = require("formidable");
const fs = require("fs");
const { deriveVolScoresFromNormalizedData } = require("../lib/vol-scoring");

module.exports.config = {
  api: {
    bodyParser: false
  }
};

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
    const { filePath, originalFilename } = await parseUploadedFile(req);

    const workbook = XLSX.readFile(filePath, {
      cellDates: true,
      raw: false
    });

    const parsedSheets = {};

    workbook.SheetNames.forEach(sheetName => {
      const worksheet = workbook.Sheets[sheetName];

      const rows = XLSX.utils.sheet_to_json(worksheet, {
        defval: "",
        raw: false
      });

      const normalizedSheetKey = detectSheetType(sheetName);

    if (normalizedSheetKey === "ignore_dashboard") {
  return;
}

      parsedSheets[normalizedSheetKey] = {
        source_sheet_name: sheetName,
        rows: rows.map(normalizeRow)
      };
    });

    const normalized = normalizeVolWorkbook(parsedSheets);

   const responsePayload = {
  success: true,
  file_name: originalFilename,
  detected_sheets: Object.keys(parsedSheets),
  raw_sheets: parsedSheets,
  normalized
};

return res
  .status(200)
  .setHeader("Content-Type", "application/json")
  .send(JSON.stringify(responsePayload, null, 2));

  } catch (error) {
    console.error("PARSE VOL WORKBOOK ERROR:", error);

    return res.status(500).json({
      success: false,
      error: error.message || "Unable to parse workbook"
    });
  }
};

function parseUploadedFile(req) {
  return new Promise((resolve, reject) => {
    const form = formidable({
      multiples: false,
      keepExtensions: true
    });

    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);

      const uploaded = files.file?.[0] || files.file;

      if (!uploaded) {
        return reject(new Error("Missing uploaded file. Expected field name: file"));
      }

      resolve({
        filePath: uploaded.filepath,
        originalFilename: uploaded.originalFilename || uploaded.newFilename || "uploaded_workbook.xlsx"
      });
    });
  });
}

function detectSheetType(sheetName) {
  const key = cleanKey(sheetName);

  if (key.includes("community") && key.includes("profile")) {
    return "community_profile";
  }

  if (key.includes("resident") || key.includes("acuity") || key.includes("ehr")) {
    return "resident_acuity_snapshot";
  }

  if (key.includes("workforce") || key.includes("schedule") || key.includes("coverage")) {
    return "workforce_schedule_summary";
  }

  if (key.includes("census") || key.includes("move")) {
    return "census_movements";
  }

  if (key.includes("labor") || key.includes("financial") || key.includes("payroll")) {
    return "labor_financials";
  }

  if (key.includes("leadership") || key.includes("workflow")) {
    return "leadership_workflow";
  }

  if (key.includes("care") || key.includes("incident")) {
    return "care_events";
  }

  if (key.includes("vol") || key.includes("signal") || key.includes("summary")) {
    return "vol_weekly_signal_summary";
  }

  if (key.includes("hr") || key.includes("recruit") || key.includes("hiring")) {
  return "hr_recruiting";
  }

if (key.includes("dashboard")) {
  return "ignore_dashboard";
}

  return `unmapped_${key}`;
}

function normalizeCommunityProfile(rows = []) {
  const profile = {};

  rows.forEach(row => {
    const field = cleanKey(row.field || row.vol_health_synthetic_al_dataset || row.community_profile || "");
    const value = row.value ?? row.empty ?? row.empty_1 ?? "";

    if (!field) return;

    profile[field] = value;
  });

  return profile;
}

function normalizeRow(row) {
  const normalized = {};

  Object.entries(row || {}).forEach(([key, value]) => {
    const normalizedKey = normalizeColumnName(key);
    normalized[normalizedKey] = cleanValue(value);
  });

  return normalized;
}

function normalizeColumnName(columnName) {
  const key = cleanKey(columnName);

  const aliases = {
    community: "community_name",
    community_name: "community_name",
    community_type: "community_type",
    market: "market",
    licensed_units: "licensed_units",
    occupied_units: "occupied_units",

    week: "week",
    open_shifts: "open_shifts",
    call_offs: "last_minute_calloffs",
    calloffs: "last_minute_calloffs",
    last_minute_calloffs: "last_minute_calloffs",
    last_minute_call_offs: "last_minute_calloffs",

    ot_hours: "overtime_hours",
    overtime_hours: "overtime_hours",
    monthly_ot_hours: "monthly_overtime_hours",

    agency_percent: "agency_shift_percent",
    agency_pct: "agency_shift_percent",
    agency_shift_percent: "agency_shift_percent",
    percent_agency: "agency_shift_percent",
    shifts_covered_by_agency_prn: "agency_shift_percent",

    schedule_changes: "schedule_changes",
    coverage_resolution: "coverage_resolution",

    move_ins: "move_ins",
    move_outs: "move_outs",
    hospital_transfers: "hospital_transfers",
    total_census: "total_census",
    census: "total_census",

    regular_labor_cost: "regular_labor_cost",
    overtime_cost: "overtime_cost",
    ot_cost: "overtime_cost",
    agency_cost: "agency_cost",
    recruiting_cost: "recruiting_cost",
    estimated_volatility_drag: "estimated_volatility_drag",
    total_labor_cost: "total_labor_cost",

    vi_score: "vi_score_current",
    vi_score_current: "vi_score_current",
    wsi_score: "wsi_score",
    wsi_score_current: "wsi_score",

    dominant_pattern: "dominant_pattern",
    economic_pressure: "economic_pressure"
  };

  return aliases[key] || key;
}

function normalizeVolWorkbook(parsedSheets) {
  const communityProfile = normalizeCommunityProfile(
  parsedSheets.community_profile?.rows || []
);

  const weeklySignals = parsedSheets.vol_weekly_signal_summary?.rows || [];
  const workforce = parsedSheets.workforce_schedule_summary?.rows || [];
  const census = parsedSheets.census_movements?.rows || [];
  const labor = parsedSheets.labor_financials?.rows || [];

 const leadership = parsedSheets.leadership_workflow?.rows || [];
const careEvents = parsedSheets.care_events?.rows || [];
const hrRecruiting = parsedSheets.hr_recruiting?.rows || [];

const weeklyOperationalSignals = mergeWeeklySignals({
  weeklySignals,
  workforce,
  census,
  labor,
  leadership,
  careEvents,
  hrRecruiting
}).map(row => ({
  community_id: communityProfile.community_id || "",
  community_name: communityProfile.community_name || "",
  community_type: communityProfile.community_type || "",
  scenario_label: communityProfile.scenario_label || "",
  market: communityProfile.market || "",
  ...row
})).map(appendDerivedVolScores);

  return {
    community_profile: communityProfile,
    resident_acuity_snapshot: parsedSheets.resident_acuity_snapshot?.rows || [],
    workforce_schedule_summary: workforce,
    census_movements: census,
    labor_financials: labor,
    leadership_workflow: parsedSheets.leadership_workflow?.rows || [],
    care_events: parsedSheets.care_events?.rows || [],
    vol_weekly_signal_summary: weeklyOperationalSignals,
    weekly_operational_signals: weeklyOperationalSignals,
  };
}

function mergeWeeklySignals({
  weeklySignals,
  workforce,
  census,
  labor,
  leadership = [],
  careEvents = [],
  hrRecruiting = []
}) {
  const byWeek = {};

  [weeklySignals, workforce, census, labor, leadership, careEvents, hrRecruiting].forEach(rows => {
    rows.forEach(row => {
      const week = Number(row.week);

      if (!week) return;

      if (!byWeek[week]) {
        byWeek[week] = { week };
      }

      byWeek[week] = {
        ...byWeek[week],
        ...row,
        week
      };
    });
  });

  return Object.values(byWeek).sort((a, b) => a.week - b.week);
}

function cleanKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[%/()]+/g, " ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function cleanValue(value) {
  if (value === null || value === undefined) return "";

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (trimmed === "") return "";

    const numeric = Number(trimmed.replace(/[$,%]/g, ""));

    if (!Number.isNaN(numeric) && /^[$,\d.%\s-]+$/.test(trimmed)) {
      return numeric;
    }

    return trimmed;
  }

  return value;
}

function appendDerivedVolScores(row) {
  const scores = deriveVolScoresFromNormalizedData(row);
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
