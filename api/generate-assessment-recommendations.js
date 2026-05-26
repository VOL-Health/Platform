const { ASK_VOL_OPERATING_IDENTITY } = require("../lib/ask-vol-operating-prompt");

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

    const viSubmitted = getCheckbox(props["VI Submitted"]);
    const wsiSubmitted = getCheckbox(props["WSI Submitted"]);

    const currentAgentStatus =
      getSelectName(props["Agent Status"]) ||
      getStatusName(props["Agent Status"]);

    const finishedState =
      getSelectName(props["Finished State"]) ||
      getStatusName(props["Finished State"]) ||
      getPlainText(props["Finished State"]);

    if (hasProcessedRecommendation(props)) {
      if (currentAgentStatus !== "Processed") {
      await updateAgentStatusSafely({
        notionApiKey,
        databaseId,
        pageId: page.id,
        status: "Processed"
      });
      }

      return res.status(200).json({
        success: true,
        message: "Assessment already processed",
        sessionId,
        notionPageId: page.id,
        communityName: getPlainText(props["Community Name"]) || getPlainText(props["Name"]),
        viSubmitted,
        wsiSubmitted,
        readyForRecommendations: getCheckbox(props["Ready for Recommendations"]),
        agentStatus: "Processed",
        finishedState: "Processed",
        viScoreCurrent: getNumber(props["VI Score (Current)"]),
        wsiScore: getNumber(props["WSI Score"])
      });
    }

    if (!viSubmitted || !wsiSubmitted) {
      return res.status(400).json({
        success: false,
        error: "VI and WSI must both be submitted first"
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      await updateAgentStatusSafely({
        notionApiKey,
        databaseId,
        pageId: page.id,
        status: "Error"
      });

      return res.status(500).json({
        success: false,
        error: "Missing OPENAI_API_KEY",
        sessionId,
        agentStatus: "Error",
        finishedState
      });
    }

    if (currentAgentStatus && !["Ready", "Error"].includes(currentAgentStatus)) {
      return res.status(400).json({
        success: false,
        error: `Assessment not eligible for processing. Current status: ${currentAgentStatus}`
      });
    }

    await updateAgentStatus({
      notionApiKey,
      databaseId,
      pageId: page.id,
      status: "Processing"
    });

    try {
      const recommendation = await generateRecommendationsWithOpenAI({
        props
      });

      await writeRecommendationResults({
        notionApiKey,
        databaseId,
        pageId: page.id,
        recommendation
      });
    } catch (error) {
      console.error("RECOMMENDATION GENERATION ERROR:", error);
      await updateAgentStatusSafely({
        notionApiKey,
        databaseId,
        pageId: page.id,
        status: "Error"
      });
      throw error;
    }

    return res.status(200).json({
      success: true,
      message: "Recommendations generated and written to Notion",
      sessionId,
      notionPageId: page.id,
      communityName: getPlainText(props["Community Name"]) || getPlainText(props["Name"]),
      viSubmitted,
      wsiSubmitted,
      readyForRecommendations: getCheckbox(props["Ready for Recommendations"]),
      agentStatus: "Processed",
      finishedState: "Processed",
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

async function updateAgentStatus({ notionApiKey, databaseId, pageId, status }) {
  const schema = databaseId
    ? await getDatabaseProperties({ notionApiKey, databaseId })
    : {};
  const agentStatusProperty = makeSchemaAwareProperty({
    schema,
    propertyName: "Agent Status",
    value: status,
    fallbackType: "select"
  });

  const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
    headers: baseHeaders(notionApiKey),
    body: JSON.stringify({
      properties: {
        "Agent Status": agentStatusProperty
      }
    })
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || "Unable to update Agent Status");
  }

  return result;
}

async function updateAgentStatusSafely({ notionApiKey, databaseId, pageId, status }) {
  try {
    return await updateAgentStatus({ notionApiKey, databaseId, pageId, status });
  } catch (error) {
    console.error(`Unable to set Agent Status to ${status}:`, error);
    return null;
  }
}

async function getDatabaseProperties({ notionApiKey, databaseId }) {
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

function makeSchemaAwareProperty({ schema, propertyName, value, fallbackType = "rich_text" }) {
  const propertyType = schema?.[propertyName]?.type || fallbackType;
  const safe = cleanText(value);

  if (propertyType === "status") {
    return { status: { name: safe } };
  }

  if (propertyType === "select") {
    return { select: { name: safe } };
  }

  return makeRichText(safe);
}

function makeRichText(value) {
  const safe = cleanText(value);
  return {
    rich_text: safe
      ? [
          {
            text: {
              content: safe.slice(0, 2000)
            }
          }
        ]
      : []
  };
}

async function generateRecommendationsWithOpenAI({ props }) {
  const openAiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  if (!openAiKey) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  const snapshot = buildAssessmentSnapshot(props);
  const bestPracticeContext = buildBestPracticeContext(snapshot);

  const prompt = `
${ASK_VOL_OPERATING_IDENTITY}

Use the assessment data to infer the dominant operating pattern and produce a specific executive recommendation. Use the best-practice context only when it strengthens a recommendation that clearly matches the active VOL pattern.

Response substance:
- Interpret the signals, identify the dominant instability pattern, explain what matters most now, identify hidden tradeoffs, prioritize action, and reduce executive cognitive load.
- Surface what matters most, why it matters, what is compounding, what is being masked, the operational consequence, and the best stabilization action.
- In final_recommendation, write the Operational Read, What Matters Most Right Now, Hidden Tradeoff, Operational Consequence, and Stabilization Priority as concise executive prose.
- In current_cost, write what the current pattern is costing the community if left unaddressed.
- In priority_actions, sequence the fastest stabilization moves first.

Important interpretation rule:
Driver values are internal severity codes used only to infer the operating pattern. Never quote, list, reference, or expose individual driver numbers in the output. Do not write phrases such as "at 5", "at 9", "score of 5", "score 9", "rated 5", "rated 9", "VI driver value", "WSI driver value", "census volatility at 5", "acuity variability at 5", "overtime pressure at 9", or "leadership bandwidth at 5".

Never mention individual numeric driver values. Never write phrases like 'at 5,' 'of 9,' 'score of 9,' or 'rated high.' The driver values are invisible internal severity codes. Translate them into plain operating language.

Internal interpretation map:
- 0 to 2 = Baseline. The area appears to be within normal baseline variation.
- 3 to 6 = Elevated. Pressure is visible, creating rework, consuming leader attention, or reducing consistency.
- 7 to 10 = Reactive. The area is actively shaping daily operations, masking instability, or forcing repeated intervention.

Use the numeric values only to translate the assessment into plain operating reality language: Baseline, Elevated, Reactive, building pressure, coverage fragility, daily rework, leadership compression, margin drag, or stabilization priority. The output must describe the pain implied by the severity level, not the number.

Return ONLY valid raw JSON with this exact structure:
{
  "final_recommendation": "string",
  "current_cost": ["cost statement 1", "cost statement 2", "cost statement 3"],
  "priority_actions": ["action 1", "action 2", "action 3"]
}

Style:
- Clean, confident, concise, practical, executive-grade, and senior-living-operator friendly.
- Translate operational noise into decision clarity.
- Do not sound like a survey report, generic SaaS output, clinical AI, compliance audit, or AI explanation.
- Do not mechanically restate every input field.
- Avoid repeated use of "signal", "pressure", "volatility", "instability", and "operational" in tight spaces.
- Avoid long framework explanations.

Final recommendation requirements:
- 90 to 140 words.
- 1 to 3 short paragraphs.
- No bullets inside final_recommendation.
- Follow this flow: Pattern; what it likely feels like; what it is costing; what to do first.
- Name the pattern in plain language, such as "Resident demand-driven coverage strain" or "Leadership-constrained execution".

Current cost requirements:
- Exactly 3 concise cost statements.
- Each statement should describe what the current pattern is costing the community if left unaddressed.
- Use operator-real costs such as leader time, overtime, schedule rework, burnout risk, coverage fragility, delayed follow-through, inconsistent execution, or margin pressure.
- Do not list raw metrics unless they were explicitly provided as hard operating facts and can be framed naturally.

Priority action requirements:
- Exactly 3 actions.
- Each action should be one sentence.
- Be specific, practical, and operator-friendly.
- Do not begin every action with generic verbs like "Develop" or "Implement" if a more direct operator phrase works.

Rules:
- Do not wrap the JSON in markdown code fences.
- Do not include explanatory text before or after the JSON.
- Never expose individual VI or WSI driver numbers in final_recommendation, current_cost, or priority_actions.
- Never use "score", "rated", "at 5", "of 9", "rated high", "coverage as unstable", "burnout risk as high", "WSI shows", "VI shows", or similar assessment-mechanics phrasing in recommendation prose.
- Be specific and decisive.
- Use senior living best practices selectively based on the assessment data.
- Do not cite source names or industry organizations directly.
- For AL / MC communities, do not over-weight PBJ, survey, or reimbursement signals if they are 0.
- Focus on the dominant operating pattern.
- Avoid generic advice.

Assessment data:
${JSON.stringify(snapshot, null, 2)}

Best-practice context:
${bestPracticeContext}
`;

  let recommendation = await requestOpenAIJson({
    openAiKey,
    model,
    prompt
  });

  if (hasDriverNumberLanguage(recommendation)) {
    recommendation = await requestOpenAIJson({
      openAiKey,
      model,
      prompt: buildDriverNumberCorrectionPrompt(recommendation)
    });
  }

  if (hasDriverNumberLanguage(recommendation)) {
    throw new Error("Recommendation generation failed. Please try again.");
  }

  return sanitizeAndValidateRecommendation(recommendation);
}

async function requestOpenAIJson({ openAiKey, model, prompt }) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: prompt
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || "OpenAI request failed");
  }

  const text =
    data.output_text ||
    data.output?.[0]?.content?.[0]?.text ||
    "";

  if (!text) {
    throw new Error("OpenAI response did not include output text");
  }

  return parseOpenAIJson(text);
}

function buildDriverNumberCorrectionPrompt(recommendation) {
  return `
${ASK_VOL_OPERATING_IDENTITY}

Rewrite this recommendation without mentioning any individual driver scores, internal values, or assessment mechanics. Keep only operator-facing operating language. Preserve hard operating facts such as open shifts, overtime hours, and time to fill. Return only valid JSON.

Rules:
- Do not write "at 0", "at 1", "at 2", "at 3", "at 4", "at 5", "at 6", "at 7", "at 8", "at 9", or "at 10".
- Do not write "of 0", "of 1", "of 2", "of 3", "of 4", "of 5", "of 6", "of 7", "of 8", "of 9", or "of 10" when referring to an assessment driver.
- Do not use the words "score", "scores", "rated", "VI driver value", "WSI driver value", "driver value", or "internal value".
- Do not write phrases like "coverage as unstable", "burnout risk as high", "WSI shows", or "VI shows".
- Translate any internal driver values into operating reality language: Baseline, Elevated, Reactive, daily rework, coverage fragility, leadership compression, or margin drag.
- Keep final_recommendation to 90 to 140 words.
- Keep exactly 3 current_cost statements and exactly 3 priority_actions.
- Return only this JSON shape:
{
  "final_recommendation": "string",
  "current_cost": ["cost statement 1", "cost statement 2", "cost statement 3"],
  "priority_actions": ["action 1", "action 2", "action 3"]
}

Output to rewrite:
${JSON.stringify(recommendation, null, 2)}
`.trim();
}

function parseOpenAIJson(text) {
  const raw = cleanText(text);
  const candidates = [
    raw,
    stripMarkdownJsonFence(raw),
    extractJsonObject(raw)
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      // Try the next normalized candidate.
    }
  }

  throw new Error(`OpenAI returned invalid JSON: ${raw}`);
}

function stripMarkdownJsonFence(text) {
  const match = cleanText(text).match(/^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1].trim() : "";
}

function extractJsonObject(text) {
  const value = cleanText(text);
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    return "";
  }

  return value.slice(start, end + 1).trim();
}

function hasDriverNumberLanguage(recommendation) {
  const text = recommendationOutputText(recommendation);
  return driverNumberLanguagePattern().test(text);
}

function recommendationOutputText(recommendation) {
  return [
    recommendation?.final_recommendation,
    ...(Array.isArray(recommendation?.current_cost) ? recommendation.current_cost : [recommendation?.current_cost]),
    ...(Array.isArray(recommendation?.priority_actions) ? recommendation.priority_actions : [recommendation?.priority_actions])
  ].map(cleanText).filter(Boolean).join(" ");
}

function driverNumberLanguagePattern() {
  return /\b(?:(?:at|rated)\s+(?:10|[0-9])|(?:score(?:s)?(?:\s+of)?|driver\s+score(?:s)?|driver\s+value(?:s)?|internal\s+value(?:s)?|VI\s+driver\s+value(?:s)?|WSI\s+driver\s+value(?:s)?)(?:\s+(?:10|[0-9]))?|(?:pressure|volatility|variability|fragility|stress|strain|bandwidth|disruption|risk|dependency|stability|reliability)\s+of\s+(?:10|[0-9])|(?:coverage\s+as|burnout\s+risk\s+as|workforce\s+reliability\s+as|agency\s+dependency\s+as|coverage\s+stability\s+as)\s+[a-z]+|(?:WSI|VI)\s+shows)\b/i;
}

function sanitizeAndValidateRecommendation(recommendation) {
  if (hasDriverNumberLanguage(recommendation)) {
    throw new Error("Recommendation generation failed. Please try again.");
  }

  const safeRecommendation = sanitizeRecommendationLanguage(recommendation);

  if (hasDriverNumberLanguage(safeRecommendation)) {
    throw new Error("Recommendation generation failed. Please try again.");
  }

  return safeRecommendation;
}

function sanitizeRecommendationLanguage(recommendation) {
  return {
    ...recommendation,
    final_recommendation: sanitizeRecommendationText(recommendation?.final_recommendation),
    current_cost: sanitizeRecommendationList(recommendation?.current_cost),
    priority_actions: sanitizeRecommendationList(recommendation?.priority_actions)
  };
}

function sanitizeRecommendationList(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeRecommendationText).filter(Boolean).slice(0, 3);
  }

  const text = sanitizeRecommendationText(value);
  return text ? [text] : [];
}

function sanitizeRecommendationText(value) {
  return cleanText(value)
    .replace(/\b(?:census volatility|acuity variability|workflow disruption|leadership bandwidth|overtime pressure|coverage fragility|schedule stress|care coordination strain|survey exposure|reimbursement pressure)\s+at\s+(?:10|[0-9])\b/gi, match => {
      const label = match.replace(/\s+at\s+(?:10|[0-9])\b/i, "");
      return driverRealityPhrase(label);
    })
    .replace(/\b(?:census volatility|acuity variability|workflow disruption|leadership bandwidth|overtime pressure|coverage fragility|schedule stress|care coordination strain|survey exposure|reimbursement pressure)\s+of\s+(?:10|[0-9])\b/gi, match => {
      const label = match.replace(/\s+of\s+(?:10|[0-9])\b/i, "");
      return driverRealityPhrase(label);
    })
    .replace(/\s+\bat\s+(?:10|[0-9])\b/gi, "")
    .replace(/\b(?:with\s+)?(?:a\s+)?score(?:s)?(?:\s+of)?\s+(?:10|[0-9])\b/gi, "showing elevated strain")
    .replace(/\bscore(?:s)?\b/gi, "pattern")
    .replace(/\brated\s+(?:10|[0-9]|high|moderate|low|unstable|critical)\b/gi, "showing elevated strain")
    .replace(/\brated\b/gi, "showing")
    .replace(/\bcoverage\s+as\s+unstable\b/gi, "coverage is fragile")
    .replace(/\bburnout\s+risk\s+as\s+high\b/gi, "burnout risk is becoming a real operating constraint")
    .replace(/\b(?:WSI|VI)\s+shows\s+/gi, "")
    .replace(/\binternal\s+value(?:s)?\b/gi, "operating pattern")
    .replace(/\b(?:VI|WSI)\s+driver\s+value(?:s)?\b/gi, "operating pattern")
    .replace(/\bdriver\s+score(?:s)?\b/gi, "operating pattern")
    .replace(/\bdriver\s+value(?:s)?\b/gi, "operating pattern")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function driverRealityPhrase(label) {
  const key = cleanText(label).toLowerCase();
  const phrases = {
    "census volatility": "census movement is creating rework",
    "acuity variability": "care needs are becoming harder to absorb cleanly",
    "workflow disruption": "daily routines are starting to require more rework",
    "leadership bandwidth": "leader time is being pulled into daily stabilization",
    "overtime pressure": "overtime is masking coverage gaps",
    "coverage fragility": "coverage feels fragile and requires constant patching",
    "schedule stress": "the schedule is getting harder to hold together",
    "care coordination strain": "handoffs are becoming harder to keep clean",
    "survey exposure": "regulatory attention is pulling leadership focus",
    "reimbursement pressure": "economic constraint is tightening operating choices"
  };

  return phrases[key] || key;
}

function buildAssessmentSnapshot(props) {
  return {
    communityName: getPlainText(props["Community Name"]) || getPlainText(props["Name"]),
    communityType: getSelectName(props["Community Type"]) || getPlainText(props["Community Type"]),
    operator: getPlainText(props["Operator"]),
    market: getPlainText(props["Market"]),

    viScoreCurrent: getNumber(props["VI Score (Current)"]),
    viScoreStabilized: getNumber(props["VI Score (Stabilized)"]),
    viVolatilityDrag: getNumber(props["VI Volatility Drag"]),
    viDominantDomain: getSelectName(props["VI Dominant Domain"]) || getPlainText(props["VI Dominant Domain"]),

    wsiScore: getNumber(props["WSI Score"]),
    wsiScoreStabilized: getNumber(props["WSI Score (Stabilized)"]),
    wsiRiskLevel: getSelectName(props["WSI Risk Level"]) || getPlainText(props["WSI Risk Level"]),
    coverageStability: getSelectName(props["Coverage Stability"]) || getPlainText(props["Coverage Stability"]),
    workforceReliability: getSelectName(props["Workforce Reliability"]) || getPlainText(props["Workforce Reliability"]),
    burnoutRisk: getSelectName(props["Burnout Risk"]) || getPlainText(props["Burnout Risk"]),
    agencyDependency: getSelectName(props["Agency Dependency"]) || getPlainText(props["Agency Dependency"]),
    primaryConstraint: getSelectName(props["Primary Constraint"]) || getPlainText(props["Primary Constraint"]),
    economicPressure: getSelectName(props["Economic Pressure"]) || getPlainText(props["Economic Pressure"]),
    elasticityState: getSelectName(props["Elasticity State"]) || getPlainText(props["Elasticity State"]),

    censusVolatility: getNumber(props["Census Volatility"]),
    acuityVariability: getNumber(props["Acuity Variability"]),
    leadershipBandwidth: getNumber(props["Leadership Bandwidth"]),
    workflowDisruption: getNumber(props["Workflow Disruption"]),
    careCoordinationStrain: getNumber(props["Care Coordination Strain"]),
    scheduleStress: getNumber(props["Schedule Stress"]),
    coverageFragility: getNumber(props["Coverage Fragility"]),
    overtimePressure: getNumber(props["Overtime Pressure"]),
    surveyExposure: getNumber(props["Survey Exposure"]),
    reimbursementPressure: getNumber(props["Reimbursement Pressure"]),

    openShiftsPerWeek: getPlainText(props["Open Shifts per Week"]),
    lastMinuteCalloffsPerWeek: getPlainText(props["Last-Minute Call-Offs per Week"]),
    coverageResolution: getSelectName(props["Coverage Resolution"]) || getPlainText(props["Coverage Resolution"]),
    monthlyOvertimeHours: getPlainText(props["Monthly Overtime Hours"]),
    overtimePremiumPercent: getPlainText(props["Overtime Premium (% Above Base)"]),
    agencyPrnPremiumPercent: getPlainText(props["Agency/PRN Premium (% vs Core Staff)"]),
    percentShiftsAgencyPrn: getPlainText(props["% of Shifts Covered by Agency/PRN"]),
    pbjExposureRiskScore: getPlainText(props["PBJ Exposure / Risk Score"]),
    surveyCitationsStaffing: getPlainText(props["Survey Citations Related to Staffing"]),
    leadershipTurnoverEvents: getPlainText(props["Leadership Turnover Events"]),
    annualClinicalTurnoverRate: getPlainText(props["Annual Clinical Staff Turnover Rate"]),
    openClinicalFteVacancies: getPlainText(props["Open Clinical FTE Vacancies"]),
    averageTimeToFillDays: getPlainText(props["Average Time-to-Fill Days"]),
    monthlyRecruitingSpend: getPlainText(props["Monthly Recruiting Spend"])
  };
}

function hasProcessedRecommendation(props) {
  const finishedState =
    getSelectName(props["Finished State"]) ||
    getStatusName(props["Finished State"]) ||
    getPlainText(props["Finished State"]);
  const finalRecommendation =
    getPlainText(props["Final Recommendation"]) ||
    getPlainText(props["Final Recommendations"]);
  const priorityActions =
    getPlainText(props["Priority Actions"]) ||
    getPlainText(props["Priority Action"]);

  return (
    finishedState === "Processed" &&
    !!cleanText(finalRecommendation) &&
    !!cleanText(priorityActions)
  );
}

function buildBestPracticeContext(snapshot) {
  const communityType = cleanText(snapshot.communityType) || "senior living";
  const dominantPattern = cleanText(
    snapshot.viDominantDomain ||
    snapshot.primaryConstraint ||
    snapshot.wsiRiskLevel ||
    snapshot.coverageStability
  );

  return `
Apply this senior living operations guidance selectively for a ${communityType} assessment${dominantPattern ? ` where the active pattern is ${dominantPattern}` : ""}.

- Operations management: Strengthen daily operating cadence, role clarity, escalation paths, admissions/readiness discipline, census-acuity alignment, and cross-functional huddles when volatility, workflow disruption, leadership bandwidth, or care coordination strain are active signals.
- Workforce management: Prioritize schedule reliability, open-shift prevention, call-off management, overtime control, agency/PRN reduction, recruiting throughput, retention actions, and manager span-of-control relief when WSI, coverage fragility, overtime, burnout, vacancies, or agency dependency are active signals.
- Quality assurance: Connect instability to survey exposure, PBJ/staffing risk, incident trends, documentation reliability, audit cadence, and corrective-action follow-through when quality, compliance, or staffing-risk signals are present.
- Resident-centered operations: Protect consistency of caregivers, response times, service reliability, family communication, acuity matching, and move-in experience when census volatility, acuity variability, care coordination, or workforce disruption affects resident experience.
- Technology/data use: Recommend dashboards, trigger thresholds, workforce analytics, schedule/call-off visibility, acuity-census monitoring, and closed-loop action tracking only when data latency, fragmented visibility, or recurring instability patterns are implied by the assessment.
- Financial sustainability: Translate operational instability into margin drag, overtime/agency cost, recruiting expense, census risk, stabilizable upside, and prioritization of high-return interventions when current cost, volatility drag, workforce drag cost, or economic pressure are active.

Do not list best practices as a generic playbook. Convert only the relevant practices into concrete next actions tied to the assessment's values, setting, and dominant instability pattern.
`.trim();
}

async function writeRecommendationResults({ notionApiKey, databaseId, pageId, recommendation }) {
  const schema = databaseId
    ? await getDatabaseProperties({ notionApiKey, databaseId })
    : {};
  const safeRecommendation = sanitizeAndValidateRecommendation(recommendation);
  const finalRecommendation = cleanText(safeRecommendation.final_recommendation);
  const currentCost = Array.isArray(safeRecommendation.current_cost)
    ? safeRecommendation.current_cost.map(cleanText).filter(Boolean).map(item => `- ${item}`).join("\n")
    : cleanText(safeRecommendation.current_cost);

  const priorityActions = Array.isArray(safeRecommendation.priority_actions)
    ? safeRecommendation.priority_actions.map(cleanText).filter(Boolean).map(item => `- ${item}`).join("\n")
    : cleanText(safeRecommendation.priority_actions);

  const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
    headers: baseHeaders(notionApiKey),
    body: JSON.stringify({
      properties: {
        "Final Recommendation": makeRichText(finalRecommendation),
        "Current Cost": makeRichText(currentCost),
        "Priority Actions": makeRichText(priorityActions),
        "Finished State": makeRichText("Processed"),
        "Agent Status": makeSchemaAwareProperty({
          schema,
          propertyName: "Agent Status",
          value: "Processed",
          fallbackType: "select"
        })
      }
    })
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || "Unable to write recommendation results");
  }

  return result;
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
