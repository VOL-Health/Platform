const DEMO_SOURCE_NOTE = "Demo mode: this public demo uses synthetic PHI-free operating context.";
const { loadLocalEnv } = require("../lib/load-local-env");
const { ASK_VOL_OPERATING_IDENTITY } = require("../lib/ask-vol-operating-prompt");
const { deriveVolScoresFromNormalizedData } = require("../lib/vol-scoring");

loadLocalEnv();

const DEMO_NORMALIZED_OPERATING_DATA = {
  community_type: "AL / MC",
  open_shifts_per_week: 5,
  last_minute_calloffs_per_week: 4,
  monthly_overtime_hours: 42,
  agency_shift_pct: 8,
  percent_shifts_prn: 8,
  avg_time_to_fill_days: 45,
  open_clinical_fte_vacancies: 3,
  census_volatility: 3,
  acuity_variability: 4,
  leadership_bandwidth: 5,
  workflow_disruption: 5,
  care_coordination_strain: 5,
  schedule_stress: 5,
  coverage_fragility: 5,
  overtime_pressure: 5,
  pbj_risk_score: 2,
  coverage_resolution: "overtime",
  leadership_turnover_events: 1,
  monthly_recruiting_spend: 5000
};

const DEMO_CONTEXT = {
  mode: "public_demo",
  dataStatus: "synthetic_phi_free_demo_context",
  communityName: "Demo Community",
  reportingWindow: "This week",
  normalized_operating_data: DEMO_NORMALIZED_OPERATING_DATA,
  derivedScores: buildDerivedScoreSummary(DEMO_NORMALIZED_OPERATING_DATA),
  staffing: {
    overtimeHoursThisWeek: 42,
    overtimeHoursLastWeek: 36,
    openShiftsThisWeek: 5,
    callOffsThisWeek: 4,
    agencyShiftPercent: 8,
    weekendCoverageRisk: "moderate",
    weekendRiskReason: "open shifts and call-offs remain active heading into the next 72 hours"
  },
  residentAndFamilyFollowUp: {
    pendingFamilyTouchpoints: [
      "Ruth, daughter of Room 303, is expecting a follow-up call today"
    ],
    residentFollowUps: [
      "Room 414 requested a meal preference change last week",
      "Room 295 requested help with a recurring housekeeping concern"
    ]
  },
  recognition: {
    moments: [
      "Pedro, Executive Chef, has a birthday today"
    ]
  },
  serviceRecovery: {
    activeSignals: [
      "Dining, housekeeping, and family communication follow-ups are clustering",
      "One housekeeping concern has been reopened twice",
      "Minor maintenance follow-up is aging beyond target"
    ]
  },
  priorityActions: [
    {
      title: "Confirm family follow-up closure",
      explanation: "Two resident/family touchpoints may need confirmation before end of day.",
      signal: "Resident / Family Touchpoint",
      owner: "ED or Business Office",
      urgency: "Review Today",
      status: "Open"
    },
    {
      title: "Review service recovery cluster",
      explanation: "Dining, housekeeping, and family communication follow-ups are clustering.",
      signal: "Operational Watch Item",
      owner: "Department Heads",
      urgency: "Standup Review",
      status: "Review Today"
    },
    {
      title: "Recognize Pedro, Executive Chef",
      explanation: "Culture touchpoint detected. Recognition moment may support team engagement.",
      signal: "Recognition Moment",
      owner: "ED",
      urgency: "Today",
      status: "Open"
    },
    {
      title: "Check Room 303 communication expectation",
      explanation: "Ruth, daughter of Room 303, is expecting a follow-up call.",
      signal: "Resident / Family Touchpoint",
      owner: "Care Team / ED",
      urgency: "Review Today",
      status: "Open"
    },
    {
      title: "Monitor request backlog",
      explanation: "Repeated follow-up items suggest possible closure drift.",
      signal: "Follow-Up Risk",
      owner: "Leadership Team",
      urgency: "Monitor",
      status: "Monitor"
    }
  ],
  incidentsAndClinicalVisibility: {
    currentDemoIncludesIncidentData: false,
    currentDemoIncludesIllnessCensus: false,
    currentDemoIncludesClinicalTransfers: false,
    approvedDeploymentCouldUse: [
      "incident trends",
      "acuity changes",
      "wellness-check volume",
      "hospital transfer workflows",
      "transport coordination",
      "staffing impact from resident events"
    ]
  },
  operationalReasoningCategories: [
    "staffing / scheduling",
    "family communication",
    "resident requests",
    "service recovery",
    "maintenance / building systems",
    "HVAC / cooling / heating disruption",
    "food / dining",
    "transportation",
    "activities",
    "incidents / accidents",
    "illness / outbreak strain",
    "weather / emergency operations",
    "leadership prioritization",
    "weekend coverage",
    "vendor escalation",
    "resident comfort and safety operations"
  ],
  unavailableInDemo: [
    "live resident clinical data",
    "illness census",
    "incident logs",
    "hospital transfer data",
    "medication data",
    "treatment plans",
    "resident travel plans",
    "live facilities data",
    "building systems telemetry",
    "HVAC outage status",
    "vendor work orders"
  ]
};

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed. Use POST.",
      demo_mode: true,
      source_note: DEMO_SOURCE_NOTE
    });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const question = String(body.question || "").trim();

    if (!question) {
      return res.status(400).json({
        success: false,
        error: "Question is required.",
        demo_mode: true,
        source_note: DEMO_SOURCE_NOTE
      });
    }

    if (question.length > 1000) {
      return res.status(400).json({
        success: false,
        error: "Question is too long. Please keep it under 1,000 characters.",
        demo_mode: true,
        source_note: DEMO_SOURCE_NOTE
      });
    }

    const demoFallbackRequested = body.demo_mode === true || body.demo_fallback === true;
    const clientContext = body.context && typeof body.context === "object" ? enrichAskVolContext(body.context) : {};
    const result = demoFallbackRequested
      ? {
          answer: fallbackAnswer(question),
          responseSource: "fallback",
          fallbackReason: "demo_fallback_requested",
          liveAttempted: false
        }
      : await getDailySignalsAnswer(question, clientContext);

    const fallbackStructured = buildStructuredFallback({ question, context: clientContext, answer: result.answer });
    const structured = {
      ...fallbackStructured,
      ...(result.structured || {}),
      volRead: normalizeVolRead(result.structured?.volRead, fallbackStructured.volRead),
      governedVisibilityCards: normalizeGovernedVisibilityCards(result.structured?.governedVisibilityCards, fallbackStructured.governedVisibilityCards),
      derivedScores: fallbackStructured.derivedScores,
      priorityActions: Array.isArray(result.structured?.priorityActions) && result.structured.priorityActions.length
        ? normalizePriorityActions(result.structured.priorityActions, fallbackStructured.priorityActions)
        : fallbackStructured.priorityActions,
      leadershipActionBriefing: Array.isArray(result.structured?.leadershipActionBriefing) && result.structured.leadershipActionBriefing.length
        ? normalizeLeadershipBriefing(result.structured.leadershipActionBriefing, fallbackStructured.leadershipActionBriefing)
        : fallbackStructured.leadershipActionBriefing
    };
    const cleanAnswer = structuredToAnswer(structured);
    return res.status(200).json({
      success: true,
      answer: cleanAnswer,
      volRead: structured.volRead,
      leadershipActionBriefing: structured.leadershipActionBriefing,
      priorityActions: structured.priorityActions,
      governedVisibilityCards: structured.governedVisibilityCards,
      derivedScores: structured.derivedScores,
      metadata: {
        sessionId: body.sessionId || body.assessment_session_id || null,
        scoringSource: clientContext.derivedScores?.scoring_source || "",
        scoringVersion: clientContext.derivedScores?.scoring_version || "",
        openAiAttempted: Boolean(result.liveAttempted),
        fallbackUsed: result.responseSource !== "live",
        errorCategory: result.fallbackReason || null
      },
      demo_mode: result.responseSource !== "live",
      response_source: result.responseSource,
      fallback_reason: result.fallbackReason || null,
      live_attempted: Boolean(result.liveAttempted),
      normalized_operating_data: clientContext.normalized_operating_data || null,
      derived_scores: clientContext.derivedScores || null,
      dominant_instability_pattern: clientContext.dominant_instability_pattern || null,
      volatility_drag: clientContext.volatility_drag ?? null,
      stability_tier: clientContext.stability_tier || null,
      source_note: DEMO_SOURCE_NOTE
    });
  } catch (error) {
    console.error("daily-signals error", {
      message: error?.message || "Unknown error"
    });

    const structured = buildStructuredFallback({ question: "", context: {}, answer: fallbackAnswer("") });
    return res.status(200).json({
      success: true,
      answer: structuredToAnswer(structured),
      volRead: structured.volRead,
      leadershipActionBriefing: structured.leadershipActionBriefing,
      priorityActions: structured.priorityActions,
      governedVisibilityCards: structured.governedVisibilityCards,
      derivedScores: structured.derivedScores,
      metadata: {
        sessionId: null,
        scoringSource: "",
        scoringVersion: "",
        openAiAttempted: false,
        fallbackUsed: true,
        errorCategory: "api_error"
      },
      demo_mode: true,
      response_source: "fallback",
      fallback_reason: "api_error",
      live_attempted: false,
      source_note: DEMO_SOURCE_NOTE
    });
  }
};

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function getDailySignalsAnswer(question, clientContext = {}) {
  const openAiKey = process.env.OPENAI_API_KEY;
  let openAiAttempted = false;

  console.log("daily-signals OpenAI env debug", {
    hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
    envKeyNames: Object.keys(process.env).filter((key) => key.includes("OPENAI"))
  });

  console.info("daily-signals OpenAI status", {
    hasOpenAIKey: Boolean(openAiKey),
    openAiAttempted: false,
    fallbackUsed: !openAiKey,
    errorCategory: openAiKey ? null : "missing_api_key"
  });

  if (!openAiKey) {
    return {
      answer: fallbackAnswer(question),
      responseSource: "fallback",
      fallbackReason: "missing_openai_api_key",
      liveAttempted: false
    };
  }

  try {
    openAiAttempted = true;
    const aiResult = await requestOpenAIAnswer({
      openAiKey,
      model: process.env.OPENAI_DAILY_SIGNALS_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini",
      question,
      clientContext
    });
    const answer = aiResult?.answer || "";
    const structured = aiResult?.structured || null;
    const hasUsableOutput = Boolean(answer || structured);
    console.info("daily-signals OpenAI result", {
      hasOpenAIKey: true,
      openAiAttempted,
      fallbackUsed: !hasUsableOutput,
      errorCategory: hasUsableOutput ? null : (aiResult?.errorCategory || "empty_ai_response")
    });
    if (!hasUsableOutput) {
      console.warn("daily-signals fallback used despite configured OpenAI key", {
        hasOpenAIKey: true,
        openAiAttempted,
        fallbackUsed: true,
        errorCategory: aiResult?.errorCategory || "empty_ai_response"
      });
    }
    return {
      answer: answer || fallbackAnswer(question),
      structured,
      responseSource: hasUsableOutput ? "live" : "fallback",
      fallbackReason: hasUsableOutput ? null : (aiResult?.errorCategory || "empty_llm_response"),
      liveAttempted: true
    };
  } catch (error) {
    const errorCategory = categorizeOpenAIError(error);
    console.warn("daily-signals fallback used despite configured OpenAI key", {
      hasOpenAIKey: true,
      openAiAttempted,
      fallbackUsed: true,
      errorCategory,
      message: error?.message || "OpenAI request failed"
    });
    return {
      answer: fallbackAnswer(question),
      structured: null,
      responseSource: "fallback",
      fallbackReason: errorCategory,
      liveAttempted: true
    };
  }
}

async function requestOpenAIAnswer({ openAiKey, model, question, clientContext = {} }) {
  const systemPrompt = `${ASK_VOL_OPERATING_IDENTITY}

You must answer the actual question asked.

You are allowed to reason operationally from the scenario the user provides, even if the demo dataset does not contain that exact signal.

You must clearly distinguish:
- what is visible in the demo context
- what is inferred from the user's question
- what would require live connected data

Use VOL metrics as internal interpretation signals. Do not make VI, WSI, or Volatility Drag the headline of the response. Translate scores into plain operational meaning. Lead with the operational pattern, not the metric.

When derived VI/WSI scoring context is present, treat it as backend-derived interpretation context from normalized operating data. Use it to understand the operating pattern, not to produce a score report.

Do not force unrelated demo signals into the answer.

If the user provides a scenario, respond to that scenario directly.

Response substance:
- Interpret the signals, identify the dominant instability pattern, explain what matters most now, identify hidden tradeoffs, prioritize action, and reduce executive cognitive load.
- Surface what pressure is forming, what needs attention first, what is being masked, the coordination opportunity, and the best same-day stabilization action.
- In volRead.summary, write the Operational Read and What Matters First in plain executive language.
- In volRead.watchItem, write the Hidden Tradeoff: what the operation is currently using to stay functional.
- In volRead.operationalConsequence, write the Coordination Opportunity and Action for Today in one concise operational paragraph.
- In leadershipActionBriefing and priorityActions, sequence the fastest stabilization moves first.

Keep responses concise, tactical, practical, and senior-living-leader friendly. Prioritize what leadership should do first, second, and third.
Avoid leading with metric labels, score values, or scoring mechanics. Do not write "VI indicates," "WSI indicates," "VI score," "WSI score," "Volatility Drag," or similar score-report language unless the user specifically asks for those metrics.

Avoid clinical advice, diagnosis, or treatment recommendations.

Return valid JSON only. Do not wrap it in markdown.

JSON shape:
{
  "volRead": {"title": "", "summary": "", "watchItem": "", "operationalConsequence": ""},
  "leadershipActionBriefing": [{"title": "", "description": "", "owner": "", "urgency": ""}],
  "priorityActions": [{"id": "", "number": 1, "title": "", "description": "", "signal": "", "impact": "", "owner": "", "actionabilityDefault": ""}]
}

Priority action requirements:
- Return exactly 5 priorityActions.
- Each priority action must be specific to the user's question and available operating signals.
- Never use placeholder titles such as "Priority action 4", "Operational Priority", "Monitor issue", or "Confirm owner, timing, and follow-through".
- Each action must be something an ED, DON, scheduler, HR lead, or department head could act on today.
- Each action must include a specific title, short description, signal, owner, impact, and urgency.
- Stabilize the next 24 hours first when coverage, call-offs, resignations, or CNA staffing pressure are involved.

For urgent staffing/coverage scenarios, include sequencing around tomorrow's schedule, resident impact protection, supervisor escalation, agency/PRN calls, overtime tradeoffs, assignments, communication, and next-72-hour coverage risk.

Do not give generic summaries. Do not stop at "moderate pressure detected."`;

  const userPrompt = `Demo context:
${JSON.stringify(DEMO_CONTEXT, null, 2)}

Additional client context:
${JSON.stringify(clientContext, null, 2)}

User question:
${question}

Answer as VOL Daily Signals.

Requirements:
- Answer the actual question.
- If the requested signal is unavailable, say so clearly.
- Reason operationally from the scenario the user provided.
- Do not force unrelated demo signals into the answer.
- Use available related demo signals only when relevant.
- If derived VI/WSI scoring is present, use it silently to interpret the operating pattern. Mention internal scores only if clearly useful and never as the headline.
- Suggest practical senior living leadership next actions with clear sequencing.
- Produce exactly 5 priority actions that are operator-native and usable today.
- Avoid vague action titles, abstract strategy language, filler, or placeholder text.
- Keep it under 220 words unless the question requires more.
- Include the phrase: "${DEMO_SOURCE_NOTE}"`;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: userPrompt
        }
      ],
      max_output_tokens: 1200
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || "OpenAI request failed");
  }

  console.info("daily-signals OpenAI response shape", {
    keys: Object.keys(data || {}),
    outputTextLength: typeof data?.output_text === "string" ? data.output_text.length : 0,
    outputLength: Array.isArray(data?.output) ? data.output.length : 0,
    choicesLength: Array.isArray(data?.choices) ? data.choices.length : 0
  });

  const output = extractOpenAIText(data);
  console.info("daily-signals raw model output starts with", String(output || "").slice(0, 120));
  const structured = normalizeAskVolResponse(output);
  if (structured?.volRead) {
    console.info("daily-signals parsed structured response keys", Object.keys(structured));
    const answer = structuredToAnswer(structured);
    return { answer, structured };
  }
  const reason = output ? "malformed_ai_response" : "empty_ai_response";
  const sanitizedOutput = output ? sanitizeOpenAITextOutput(output) : "";
  if (sanitizedOutput) {
    console.warn("daily-signals using live text response with structured fallback sections", {
      reason: "non_structured_ai_response"
    });
    return {
      answer: sanitizedOutput,
      structured: null,
      errorCategory: "non_structured_ai_response"
    };
  }
  console.warn("daily-signals using fallback structured response", { reason });
  return {
    answer: "",
    structured: null,
    errorCategory: reason
  };
}

function extractOpenAIText(data) {
  if (!data || typeof data !== "object") return "";

  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const chatContent = data.choices?.[0]?.message?.content;
  const chatText = extractContentText(chatContent);
  if (chatText) return chatText;

  const outputTexts = [];
  if (Array.isArray(data.output)) {
    for (const item of data.output) {
      const itemText = extractContentText(item?.content) || extractContentText(item?.text);
      if (itemText) outputTexts.push(itemText);
    }
  }
  if (outputTexts.length) return outputTexts.join("\n").trim();

  return extractContentText(data.message?.content) || extractContentText(data.content) || "";
}

function sanitizeOpenAITextOutput(output) {
  const text = cleanMarkdownText(String(output || "")).trim();
  if (!text) return "";
  if (/^[{\[]/.test(text)) return "";
  if (/["']?volRead["']?\s*:/.test(text)) {
    const json = extractFirstJsonObject(text);
    if (!json) return "";
    return text.replace(json, "").trim();
  }
  return text;
}

function stripEmbeddedJsonObject(text) {
  const json = extractFirstJsonObject(text);
  return json ? String(text || "").replace(json, "").trim() : String(text || "");
}

function extractContentText(content) {
  if (!content) return "";
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (!item) return "";
        if (typeof item === "string") return item;
        return item.text || item.output_text || item.content || "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  if (typeof content === "object") {
    return String(content.text || content.output_text || content.content || "").trim();
  }
  return "";
}

function enrichAskVolContext(context = {}) {
  const normalizedRows =
    arrayFrom(context.weekly_operational_signals) ||
    arrayFrom(context.normalized?.weekly_operational_signals) ||
    arrayFrom(context.normalizedData?.weekly_operational_signals);

  const latestNormalizedRow = normalizedRows?.length ? normalizedRows[normalizedRows.length - 1] : null;
  const directNormalized =
    latestNormalizedRow ||
    context.normalized_operating_data ||
    context.normalizedData ||
    context.normalized ||
    null;

  if (!directNormalized || Array.isArray(directNormalized)) {
    return context;
  }

  const derivedScores = deriveVolScoresFromNormalizedData(directNormalized);
  const derivedSummary = buildDerivedScoreSummary(directNormalized, derivedScores);
  return {
    ...context,
    normalized_operating_data: directNormalized,
    derivedScores: derivedSummary,
    dominant_instability_pattern:
      derivedScores["VI Dominant Domain"] ||
      derivedScores["Primary Constraint"] ||
      context.dominant_instability_pattern,
    volatility_drag: derivedScores["VI Volatility Drag"],
    stability_tier: derivedScores["Stability Tier"],
    priority_signals: [
      derivedScores["VI Dominant Domain"],
      derivedScores["Primary Constraint"],
      derivedScores["WSI Risk Level"],
      derivedScores["Elasticity State"]
    ].filter(Boolean)
  };
}

function buildDerivedScoreSummary(normalizedData, precomputedScores = null) {
  const derivedScores = precomputedScores || deriveVolScoresFromNormalizedData(normalizedData);
  return {
    scoring_source: "derived_normalized_data",
    scoring_version: "vol-scoring-v1",
    score_confidence: derivedScores.score_confidence,
    missing_inputs: derivedScores.missing_inputs,
    vi_score_current: derivedScores["VI Score (Current)"],
    vi_score_stabilized: derivedScores["VI Score (Stabilized)"],
    vi_volatility_drag: derivedScores["VI Volatility Drag"],
    vi_dominant_domain: derivedScores["VI Dominant Domain"],
    vi_interpretation: derivedScores["VI Interpretation"],
    wsi_score: derivedScores["WSI Score"],
    wsi_score_current: derivedScores["WSI Score (Current)"],
    wsi_score_stabilized: derivedScores["WSI Score (Stabilized)"],
    wsi_risk_level: derivedScores["WSI Risk Level"],
    coverage_stability: derivedScores["Coverage Stability"],
    workforce_reliability: derivedScores["Workforce Reliability"],
    agency_dependency: derivedScores["Agency Dependency"],
    burnout_risk: derivedScores["Burnout Risk"],
    primary_constraint: derivedScores["Primary Constraint"],
    economic_pressure: derivedScores["Economic Pressure"],
    elasticity_state: derivedScores["Elasticity State"],
    wsi_interpretation: derivedScores["WSI Interpretation"],
    combined_stability_score: derivedScores["Combined Stability Score"],
    stability_tier: derivedScores["Stability Tier"]
  };
}

function buildStructuredFallback({ question, context = {}, answer = "" }) {
  const normalizedData = context.normalized_operating_data || DEMO_NORMALIZED_OPERATING_DATA;
  const derivedScores = context.derivedScores || buildDerivedScoreSummary(normalizedData);
  const safeAnswer = ensureDemoNote(answer || fallbackAnswer(question));
  const volRead = parseVolRead(safeAnswer);
  const actions = parseNumberedActions(safeAnswer);
  const priorityActions = buildPriorityActions(actions, normalizedData, derivedScores, question);
  const leadershipActionBriefing = priorityActions.slice(0, 5).map((action) => ({
    title: action.title,
    description: action.description,
    owner: action.owner,
    urgency: action.urgency || "Review Today"
  }));
  return {
    answer: safeAnswer,
    volRead,
    leadershipActionBriefing,
    priorityActions,
    governedVisibilityCards: buildGovernedVisibilityCards(normalizedData, derivedScores),
    derivedScores: {
      viScoreCurrent: derivedScores.vi_score_current ?? null,
      viScoreStabilized: derivedScores.vi_score_stabilized ?? null,
      viVolatilityDrag: derivedScores.vi_volatility_drag ?? null,
      viDominantDomain: derivedScores.vi_dominant_domain || "",
      wsiScore: derivedScores.wsi_score ?? null,
      wsiScoreStabilized: derivedScores.wsi_score_stabilized ?? null,
      wsiRiskLevel: derivedScores.wsi_risk_level || "",
      combinedStabilityScore: derivedScores.combined_stability_score ?? null,
      stabilityTier: derivedScores.stability_tier || ""
    }
  };
}

function normalizeAskVolResponse(raw) {
  if (!raw) return null;
  if (typeof raw === "object") {
    return raw.volRead ? raw : null;
  }
  const parsed = parseJsonObject(raw);
  if (!parsed || typeof parsed !== "object") return null;
  if (parsed.volRead) return parsed;
  if (typeof parsed.answer === "string") {
    return parseJsonObject(parsed.answer);
  }
  return null;
}

function parseJsonObject(value) {
  let text = String(value || "").trim();
  if (!text) return null;
  text = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  const direct = tryJsonParse(text);
  if (direct) return direct;
  const extracted = extractFirstJsonObject(text);
  if (!extracted) return null;
  return tryJsonParse(extracted);
}

function tryJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractFirstJsonObject(text) {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function structuredToAnswer(structured) {
  const briefing = Array.isArray(structured.leadershipActionBriefing)
    ? structured.leadershipActionBriefing.map((item, index) => `${index + 1}. ${item.title || item.description || ""}`).join("\n")
    : "";
  const firstAction = briefing.split("\n")[0] || "";
  return `${DEMO_SOURCE_NOTE}
Operational Read:
${structured.volRead?.summary || ""}

What Matters First:
${firstAction.replace(/^\d+[.)]\s*/, "")}

Hidden Tradeoff:
${structured.volRead?.watchItem || ""}

Coordination Opportunity:
${structured.volRead?.operationalConsequence || ""}

Action for Today:
${briefing}`.trim();
}

function cleanMarkdownText(value) {
  return String(value || "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .trim();
}

function normalizeVolRead(volRead = {}, fallback = {}) {
  return {
    title: cleanMarkdownText(volRead.title) || fallback.title || "Operational Read",
    summary: cleanMarkdownText(volRead.summary) || fallback.summary || "",
    watchItem: cleanMarkdownText(volRead.watchItem) || fallback.watchItem || "",
    operationalConsequence: cleanMarkdownText(volRead.operationalConsequence) || fallback.operationalConsequence || ""
  };
}

function normalizeLeadershipBriefing(items = [], fallback = []) {
  const normalized = items.slice(0, 5).map((item, index) => ({
    title: cleanMarkdownText(item.title || item.description) || fallback[index]?.title || `Leadership action ${index + 1}`,
    description: cleanMarkdownText(item.description) || fallback[index]?.description || "",
    owner: cleanMarkdownText(item.owner) || fallback[index]?.owner || "Leadership Team",
    urgency: cleanMarkdownText(item.urgency) || fallback[index]?.urgency || "Review Today"
  }));
  const needed = Math.max(3, Math.min(5, fallback.length || 5));
  while (normalized.length < needed) {
    normalized.push(fallback[normalized.length] || {
      title: "Lock the next operating-day priority",
      description: "Choose the highest-risk operating item, name one accountable owner, and confirm the closure point before the next leadership handoff.",
      owner: "Executive Director",
      urgency: "Review Today"
    });
  }
  return normalized.slice(0, 5);
}

function normalizeGovernedVisibilityCards(cards = [], fallback = []) {
  const requiredTitles = [
    "Care and service notes",
    "Staffing and schedule context",
    "Resident and family requests",
    "Recognition moments",
    "Dining, housekeeping, and maintenance notes",
    "Census and occupancy movement",
    "Labor cost and coverage pressure",
    "Quality and operational risk signals"
  ];
  return requiredTitles.map((title, index) => {
    const incoming = Array.isArray(cards) ? cards.find(card => cleanMarkdownText(card.title).toLowerCase() === title.toLowerCase()) : null;
    const safe = incoming || fallback[index] || {};
    return {
      title,
      bullets: Array.isArray(safe.bullets) && safe.bullets.length
        ? safe.bullets.slice(0, 3).map(cleanMarkdownText)
        : (fallback[index]?.bullets || ["Demo fallback context unavailable."]),
      insight: cleanMarkdownText(safe.insight) || fallback[index]?.insight || "Demo fallback: operational context will update when data is available.",
      source_status: ["live", "derived", "demo_fallback", "missing"].includes(safe.source_status) ? safe.source_status : "demo_fallback",
      fields_used: Array.isArray(safe.fields_used) ? safe.fields_used : []
    };
  });
}

function parseVolRead(answer) {
  const text = String(answer || "");
  return {
    title: "Operational Read",
    summary: extractSection(text, "Operational Read") || extractSection(text, "VOL Read") || extractSection(text, "Direct read") || text.split("\n").filter(Boolean).slice(0, 2).join(" "),
    watchItem: extractSection(text, "Hidden Tradeoff") || extractSection(text, "Watch Item") || "",
    operationalConsequence: extractSection(text, "Coordination Opportunity") || extractSection(text, "Operational Consequence") || ""
  };
}

function extractSection(text, label) {
  const pattern = new RegExp(`${label}:\\s*([\\s\\S]*?)(?:\\n\\s*(?:Operational Read|What Matters First|Hidden Tradeoff|Coordination Opportunity|Action for Today|VOL Read|Leadership Action Briefing|Best next moves|Watch Item|Operational Consequence|Direct read):|$)`, "i");
  return text.match(pattern)?.[1]?.trim() || "";
}

function parseNumberedActions(answer) {
  const text = extractSection(String(answer || ""), "Action for Today") || extractSection(String(answer || ""), "Leadership Action Briefing") || extractSection(String(answer || ""), "Best next moves") || String(answer || "");
  const actions = [];
  for (const match of text.matchAll(/(?:^|\n)\s*\d+[.)]\s+([^\n]+)/g)) {
    const value = match[1].trim();
    if (value) actions.push(value);
  }
  return actions.slice(0, 5);
}

function buildPriorityActions(actions, normalizedData, derivedScores, question = "") {
  const fallbackActions = buildDataDrivenPriorityActions(normalizedData, derivedScores, question);
  if (isStaffingCrisisQuestion(question)) {
    return fallbackActions.slice(0, 5);
  }
  const incoming = Array.isArray(actions) ? actions.slice(0, 5) : [];
  const normalized = incoming.map((title, index) => {
    const fallback = fallbackActions[index] || fallbackActions[0];
    const action = {
      id: `ask-vol-action-${index + 1}`,
      number: index + 1,
      title: cleanMarkdownText(title),
      description: inferActionDescription(title, normalizedData),
      signal: inferActionSignal(title),
      impact: inferActionImpact(title, derivedScores),
      owner: inferActionOwner(title),
      urgency: index < 2 ? "Immediate" : "Review Today",
      actionabilityDefault: ""
    };
    return validatePriorityAction(action, fallback, index);
  });
  while (normalized.length < 5) {
    const index = normalized.length;
    normalized.push({ ...fallbackActions[index], number: index + 1, source_status: "demo_fallback" });
  }
  return normalized.slice(0, 5);
}

function normalizePriorityActions(actions, fallbackActions = []) {
  const normalized = actions.slice(0, 5).map((action, index) => {
    const fallback = fallbackActions[index] || {};
    return validatePriorityAction({
      id: cleanMarkdownText(action.id) || fallback.id || `ask-vol-action-${index + 1}`,
      number: action.number || index + 1,
      title: cleanMarkdownText(action.title) || fallback.title || "",
      description: cleanMarkdownText(action.description) || fallback.description || "",
      signal: cleanMarkdownText(action.signal) || fallback.signal || "",
      impact: cleanMarkdownText(action.impact) || fallback.impact || "",
      owner: cleanMarkdownText(action.owner) || fallback.owner || "",
      urgency: cleanMarkdownText(action.urgency) || fallback.urgency || "Review Today",
      actionabilityDefault: cleanMarkdownText(action.actionabilityDefault) || ""
    }, fallback, index);
  });
  while (normalized.length < 5) {
    const index = normalized.length;
    const fallback = fallbackActions[index] || fallbackActions[0] || {};
    normalized.push({
      id: fallback.id || `ask-vol-action-${index + 1}`,
      number: index + 1,
      title: fallback.title || "Lock tomorrow's coverage gaps",
      description: fallback.description || "Review open shifts and call-offs before end of day and assign one leader to close the highest-risk gaps.",
      signal: fallback.signal || "Coverage Pressure",
      impact: fallback.impact || "Reduces resident-care disruption risk in the next operating day.",
      owner: fallback.owner || "Scheduler / ED",
      urgency: fallback.urgency || "Review Today",
      actionabilityDefault: "",
      source_status: "demo_fallback"
    });
  }
  return normalized.slice(0, 5);
}

function buildDataDrivenPriorityActions(data = {}, derived = {}, question = "") {
  const normalized = data || {};
  const q = String(question || "").toLowerCase();
  const openShifts = normalized.open_shifts_per_week ?? normalized.open_shifts;
  const calloffs = normalized.last_minute_calloffs_per_week ?? normalized.last_minute_calloffs;
  const overtime = normalized.monthly_overtime_hours ?? normalized.overtime_hours;
  const agency = normalized.agency_shift_pct ?? normalized.agency_usage_pct;
  const prn = normalized.percent_shifts_prn;
  const acuity = normalized.acuity_variability;
  const census = normalized.census_volatility;
  const workflow = normalized.workflow_disruption;
  const coordination = normalized.care_coordination_strain;
  const leadership = normalized.leadership_bandwidth;
  const recruitingSpend = normalized.monthly_recruiting_spend;
  const crisis = isStaffingCrisisQuestion(q);
  const value = (v, fallback) => (v === 0 || v ? v : fallback);
  const actions = [];
  const add = (score, action) => actions.push({
    score,
    action: {
      id: action.id,
      number: actions.length + 1,
      title: action.title,
      description: action.description,
      signal: action.signal,
      impact: action.impact,
      owner: action.owner,
      urgency: action.urgency || (score >= 90 ? "Immediate" : "Review Today"),
      actionabilityDefault: "",
      source_status: action.source_status || "derived"
    }
  });

  add(crisis ? 120 : 90 + scorePresence(openShifts) + scorePresence(calloffs), {
    id: "coverage-gap-lock",
    title: crisis ? "Lock tomorrow's CNA coverage gaps" : "Lock tomorrow's coverage gaps",
    description: `Review the ${value(openShifts, "visible")} open shifts and ${value(calloffs, "recent")} call-offs before end of day; assign one owner to close the highest-risk gaps by unit and shift.`,
    signal: "Coverage Pressure",
    owner: "Scheduler / ED",
    impact: "Reduces resident-care disruption risk in the next operating day.",
    urgency: "Immediate"
  });

  add(crisis ? 112 : 78 + scorePresence(acuity) + scorePresence(census), {
    id: "resident-risk-coverage",
    title: "Match assignments to resident risk first",
    description: `Place the strongest available staff around higher-acuity residents and essential routines before moving lower-risk service tasks.`,
    signal: "Resident Flow",
    owner: "DON / Clinical Leadership",
    impact: "Protects care continuity when staffing coverage is unstable.",
    urgency: "Immediate"
  });

  add(82 + scorePresence(prn) + scorePresence(agency), {
    id: "prn-agency-call-sequence",
    title: "Run the PRN and agency call sequence now",
    description: `Contact reliable PRN and part-time staff first, then use agency only for remaining uncovered blocks where resident-care continuity is at risk.`,
    signal: "Coverage Dependency",
    owner: "Scheduler / Regional Ops",
    impact: `Limits avoidable agency dependence while preserving coverage for critical shifts${agency === 0 || agency ? ` (${agency}% agency context)` : ""}.`,
    urgency: crisis ? "Immediate" : "Review Today"
  });

  add(80 + scorePresence(overtime), {
    id: "overtime-fatigue-protection",
    title: "Protect the core team from repeat overtime",
    description: `Check who is carrying the ${value(overtime, "current")} overtime-hour burden and avoid solving tomorrow by overloading the same people again.`,
    signal: "Recovery Burden",
    owner: "ED / Scheduler",
    impact: "Reduces the chance that today's coverage fix creates the next 48-72 hour call-off cycle.",
    urgency: "Review Today"
  });

  add(76 + scorePresence(workflow) + scorePresence(coordination), {
    id: "service-followup-closure",
    title: "Close resident and family follow-ups before they cluster",
    description: "Assign one leader to confirm open family, dining, housekeeping, and service recovery follow-ups before coverage strain turns them into escalations.",
    signal: "Service Recovery",
    owner: "ED / Department Heads",
    impact: "Prevents small service misses from compounding while leadership attention is absorbed by staffing.",
    urgency: "Today"
  });

  add(72 + scorePresence(leadership), {
    id: "single-owner-shift-command",
    title: "Name one 24-hour coverage owner",
    description: "Put one accountable leader over tomorrow's coverage board, escalation calls, and department-head updates until the schedule is stable.",
    signal: "Leadership Load",
    owner: "Executive Director",
    impact: "Reduces handoff confusion and keeps urgent staffing decisions from diffusing across the team.",
    urgency: crisis ? "Immediate" : "Standup Review"
  });

  add(68 + scorePresence(recruitingSpend), {
    id: "separate-stabilization-from-hiring",
    title: "Separate tonight's stabilization from hiring recovery",
    description: "Solve the next operating day first, then create a separate recruiting and retention lane for the vacancy or resignation recovery work.",
    signal: "Workforce Reliability",
    owner: "ED / HR",
    impact: "Keeps immediate resident coverage from being diluted by longer-cycle hiring work.",
    urgency: "Review Today"
  });

  add(62, {
    id: "recognition-retention-touchpoint",
    title: "Use recognition to steady the team after the scramble",
    description: "After coverage is assigned, recognize the staff who absorbed the disruption and check for fatigue before the next schedule cycle.",
    signal: "Culture Stabilization",
    owner: "ED / Department Heads",
    impact: "Supports retention and lowers the risk that pressure transfers to the remaining team.",
    urgency: "Today"
  });

  const unique = [];
  const seen = new Set();
  actions
    .sort((a, b) => b.score - a.score)
    .forEach(({ action }) => {
      if (!seen.has(action.id)) {
        seen.add(action.id);
        unique.push(action);
      }
    });
  return unique.slice(0, 5).map((action, index) => ({ ...action, number: index + 1 }));
}

function scorePresence(value) {
  return value === 0 || value ? 8 : 0;
}

function isStaffingCrisisQuestion(value) {
  const text = String(value || "").toLowerCase();
  return matches(text, ["quit", "quits", "resigned", "resignation", "walked out", "short staffed", "short-staffed", "cna", "cnas", "caregiver", "caregivers"])
    && matches(text, ["shift", "shifts", "coverage", "staff", "staffing", "filled", "tomorrow", "schedule"]);
}

function validatePriorityAction(action, fallback, index) {
  const safeFallback = fallback || {};
  const candidate = {
    ...action,
    id: action.id || safeFallback.id || `ask-vol-action-${index + 1}`,
    number: action.number || index + 1,
    title: cleanMarkdownText(action.title),
    description: cleanMarkdownText(action.description),
    signal: cleanMarkdownText(action.signal),
    impact: cleanMarkdownText(action.impact),
    owner: cleanMarkdownText(action.owner),
    urgency: cleanMarkdownText(action.urgency) || safeFallback.urgency || "Review Today"
  };
  if (isWeakPriorityAction(candidate)) {
    return {
      ...safeFallback,
      id: safeFallback.id || candidate.id,
      number: candidate.number,
      actionabilityDefault: cleanMarkdownText(candidate.actionabilityDefault) || "",
      source_status: candidate.source_status || safeFallback.source_status || "demo_fallback"
    };
  }
  return {
    ...candidate,
    source_status: candidate.source_status || "derived"
  };
}

function isWeakPriorityAction(action) {
  const genericPatterns = [
    /^priority action\s*\d*$/i,
    /^operational priority$/i,
    /^monitor issue$/i,
    /^review today$/i,
    /confirm owner,?\s*timing/i,
    /operational follow-through/i,
    /operational drift/i,
    /monitor staffing pressure/i,
    /consider reviewing/i
  ];
  const fields = [action.title, action.description, action.signal, action.impact, action.owner].map(value => cleanMarkdownText(value));
  if (!fields[0] || fields[0].length < 12 || genericPatterns.some(pattern => pattern.test(fields[0]))) return true;
  if (!fields[1] || fields[1].length < 48 || genericPatterns.some(pattern => pattern.test(fields[1]))) return true;
  if (!fields[2] || genericPatterns.some(pattern => pattern.test(fields[2]))) return true;
  if (!fields[3] || fields[3].length < 35 || genericPatterns.some(pattern => pattern.test(fields[3]))) return true;
  if (!fields[4] || /leadership team/i.test(fields[4])) return true;
  return false;
}

function inferActionSignal(title) {
  const text = String(title || "").toLowerCase();
  if (matches(text, ["coverage", "shift", "staff", "agency", "prn", "overtime"])) return "Coverage Pressure";
  if (matches(text, ["resident", "care", "routine", "acuity"])) return "Resident Flow";
  if (matches(text, ["owner", "standup", "department", "leadership"])) return "Leadership Load";
  return "Operating Signal";
}

function inferActionOwner(title) {
  const text = String(title || "").toLowerCase();
  if (matches(text, ["coverage", "shift", "schedule", "prn", "agency"])) return "Scheduler / ED";
  if (matches(text, ["resident", "care", "acuity", "routine"])) return "DON / Clinical Leadership";
  if (matches(text, ["department", "standup", "owner"])) return "Executive Director";
  return "Leadership Team";
}

function inferActionDescription(title, normalizedData) {
  const openShifts = normalizedData.open_shifts_per_week ?? normalizedData.open_shifts;
  const calloffs = normalizedData.last_minute_calloffs_per_week ?? normalizedData.last_minute_calloffs;
  const overtime = normalizedData.monthly_overtime_hours ?? normalizedData.overtime_hours;
  const acuity = normalizedData.acuity_variability;
  const workflow = normalizedData.workflow_disruption;
  const coordination = normalizedData.care_coordination_strain;
  if (inferActionSignal(title) === "Coverage Pressure") {
    return `Use current coverage context${openShifts || calloffs ? ` (${openShifts ?? "unknown"} open shifts, ${calloffs ?? "unknown"} call-offs)` : ""} to close the highest-risk shift gaps before the next schedule handoff.`;
  }
  if (inferActionSignal(title) === "Resident Flow") {
    return `Use resident risk, acuity variability${acuity || acuity === 0 ? ` (${acuity})` : ""}, and essential care routines to decide what must be protected first.`;
  }
  if (inferActionSignal(title) === "Leadership Load") {
    return "Name one accountable leader for the next operating window so schedule decisions, escalations, and department updates do not fragment.";
  }
  if (matches(String(title || "").toLowerCase(), ["service", "family", "dining", "housekeeping", "maintenance"])) {
    return `Close the visible service and family follow-up cluster${workflow || coordination ? ` while workflow strain remains active` : ""} before it turns into avoidable escalation.`;
  }
  if (matches(String(title || "").toLowerCase(), ["overtime", "fatigue", "burnout"])) {
    return `Check the ${overtime ?? "current"} overtime-hour burden and avoid solving today's pressure by overloading the same core staff again.`;
  }
  return "Translate the operating read into a same-day leadership action with a named owner, visible next step, and clear closure point.";
}

function inferActionImpact(title, derivedScores) {
  return derivedScores.wsi_risk_level
    ? "Translates workforce pressure into a same-day operating decision before it becomes broader recovery work."
    : "Protects resident experience by turning the operating read into a same-day leadership action.";
}

function buildGovernedVisibilityCards(data = {}, derived = {}) {
  const openShifts = data.open_shifts_per_week ?? data.open_shifts;
  const calloffs = data.last_minute_calloffs_per_week ?? data.last_minute_calloffs;
  const overtime = data.monthly_overtime_hours ?? data.overtime_hours;
  const agency = data.agency_shift_pct ?? data.agency_usage_pct;
  const prn = data.percent_shifts_prn;
  const workflow = data.workflow_disruption;
  const coordination = data.care_coordination_strain;
  const acuity = data.acuity_variability;
  const censusVolatility = data.census_volatility;
  const wsiRisk = derived.wsi_risk_level;
  const hasStaffing = [openShifts, calloffs, overtime, agency, prn].some(v => v === 0 || v);
  const status = hasStaffing ? (data.source_status === "demo_fallback" ? "demo_fallback" : "live") : "demo_fallback";
  return [
    card("Care and service notes", ["Service follow-through requires closure confirmation", coordination ? `${coordination} care coordination strain level` : "Resident/service follow-ups use demo fallback context", "Service requests can compound when coverage is thin"], "Patterns in service follow-through may indicate early operational drift.", status, ["care_coordination_strain"]),
    card("Staffing and schedule context", [`${overtime ?? 42} overtime hours in the current context`, `${openShifts ?? 5} open shifts visible`, `${calloffs ?? 4} last-minute call-off events`], "Coverage strain is visible through schedule pressure and recovery burden.", status, ["monthly_overtime_hours", "open_shifts_per_week", "last_minute_calloffs_per_week"]),
    card("Resident and family requests", ["Family touchpoints require ownership", "Resident requests need closure confirmation", "Service recovery context should be checked against coverage"], "Unresolved follow-ups often surface before formal dissatisfaction.", "demo_fallback", ["family_touchpoints", "resident_followups"]),
    card("Recognition moments", ["Pedro, Executive Chef, birthday today", "Culture touchpoints use demo fallback when no live recognition feed exists", "Recognition can support retention during strain"], "Recognition visibility helps stabilize culture and retention.", "demo_fallback", ["recognition_moments"]),
    card("Dining, housekeeping, and maintenance notes", ["Service recovery items may cluster by shift", "Housekeeping and dining follow-through should be confirmed", "Maintenance aging can add family call pressure"], "Small service misses tend to compound before they escalate.", "demo_fallback", ["service_recovery_items"]),
    card("Census and occupancy movement", [`Census volatility: ${censusVolatility ?? "demo fallback"}`, `Acuity variability: ${acuity ?? "demo fallback"}`, "Resident transition activity can reshape staffing pressure"], "Resident movement often reshapes staffing pressure invisibly.", censusVolatility || acuity ? status : "demo_fallback", ["census_volatility", "acuity_variability"]),
    card("Labor cost and coverage pressure", [`${overtime ?? 42} overtime hours contributing to recovery burden`, `${agency ?? 8}% agency usage context`, wsiRisk ? "Workforce strain is active in the derived context" : "Workforce strain uses derived/demo context"], "Cost pressure is forming through coverage recovery, overtime, and dependency risk.", wsiRisk ? "derived" : status, ["monthly_overtime_hours", "agency_shift_pct", "wsi_risk_level"]),
    card("Quality and operational risk signals", [workflow ? `${workflow} workflow disruption level` : "Workflow disruption uses demo fallback context", coordination ? `${coordination} care coordination strain level` : "Coordination strain should be watched", "Service recovery tasks should not age during coverage disruption"], "Small execution gaps may indicate emerging coordination strain.", workflow || coordination ? status : "demo_fallback", ["workflow_disruption", "care_coordination_strain"])
  ];
}

function card(title, bullets, insight, source_status, fields_used) {
  return { title, bullets: bullets.filter(Boolean).slice(0, 3), insight, source_status, fields_used };
}

function arrayFrom(value) {
  return Array.isArray(value) ? value : null;
}

function ensureDemoNote(answer) {
  const text = String(answer || "").trim();
  if (!text) return fallbackAnswer("");
  if (text.includes(DEMO_SOURCE_NOTE)) return text;
  return `${DEMO_SOURCE_NOTE} ${text}`;
}

function fallbackAnswer(question) {
  const normalized = String(question || "").toLowerCase();
  if (isStaffingCrisisQuestion(normalized)) {
    return staffingCrisisAnswer(question);
  }
  if (isFacilitiesQuestion(normalized)) {
    return facilitiesDisruptionAnswer();
  }

  const unsupportedTopic = detectUnsupportedTopic(normalized);
  if (unsupportedTopic) {
    return unsupportedTopicAnswer(unsupportedTopic);
  }

  const topic = detectTopic(normalized);

  if (topic === "overtime") {
    return `${DEMO_SOURCE_NOTE} 42 overtime hours have been logged so far this week, up from 36 last week. What VOL can see is moderate coverage strain: 5 open shifts, 4 call-offs, and 8% agency/PRN coverage. Best next move: review the next 72 hours of coverage before standup.`;
  }

  if (topic === "family") {
    return `${DEMO_SOURCE_NOTE} One family touchpoint needs attention today: Ruth, daughter of Room 303, is expecting a follow-up call. Best next move: assign one owner before standup and confirm the call is completed today.`;
  }

  if (topic === "resident") {
    return `${DEMO_SOURCE_NOTE} Two resident follow-ups may need closure confirmation. Room 414 requested a meal preference change, and Room 295 raised a recurring housekeeping concern. Best next move: confirm both were not only logged, but actually experienced as resolved.`;
  }

  if (topic === "staffing") {
    return staffingStabilizationAnswer();
  }

  if (topic === "recognition") {
    return `${DEMO_SOURCE_NOTE} Pedro, the Executive Chef, has a birthday today. A short note from leadership would be a simple high-value recognition moment.`;
  }

  if (topic === "maintenance") {
    return `${DEMO_SOURCE_NOTE} One recurring housekeeping concern and one aging maintenance follow-up are currently active in the demo context. The larger signal is that small service issues may be clustering before they become formal dissatisfaction events. Best next move: confirm whether the open items were experienced as resolved, not only logged.`;
  }

  if (topic === "food") {
    return `${DEMO_SOURCE_NOTE} Dining signals are active in the demo context. Room 414 has a meal preference change that may need closure confirmation, and dining follow-ups are clustering with housekeeping and family communication items. Best next move: verify the preference change was actually experienced by the resident.`;
  }

  if (topic === "operations" || topic === "risk" || topic === "leadership") {
    return `${DEMO_SOURCE_NOTE}
Operational Read:
The operating risk is not one isolated task; it is follow-up fragmentation occurring alongside rising coverage strain. Resident requests, family communication, dining, and housekeeping follow-ups are clustering while overtime has increased from 36 to 42 hours.

What Matters First:
Assign one owner to each open resident/family follow-up before standup so coverage pressure does not pull leaders away from visible service recovery.

Hidden Tradeoff:
Small unresolved service issues may convert into family dissatisfaction if coverage strain pulls leaders away from follow-through.

Coordination Opportunity:
Department heads need one closure rhythm: what is assigned, what is actually resolved, and what needs escalation before the next handoff.

Action for Today:
1. Assign one owner to each open resident/family follow-up before standup.
2. Review tomorrow and next-72-hour coverage against open shifts, call-offs, and overtime exposure.
3. Separate must-close resident impact items from items that can wait 24 hours.
4. Have department heads confirm what is closed, not only what is assigned.`;
  }

  if (topic === "travel") {
    return unavailableTopicAnswer("travel-related resident signals", "upcoming resident travel plans, transportation coordination needs, temporary service adjustments, or family travel notifications");
  }

  if (topic === "transportation") {
    return unavailableTopicAnswer("transportation signals", "ride coordination, appointment transportation, resident outing logistics, family pickup notes, or staffing impact from transportation needs");
  }

  if (topic === "activities") {
    return unavailableTopicAnswer("activity-program signals", "attendance trends, transportation coordination, resident participation shifts, event-related staffing pressure, or follow-up needs after activities");
  }

  if (topic === "appointments") {
    return unavailableTopicAnswer("appointment-related signals", "upcoming appointment coordination, transportation needs, family notifications, service adjustments, or staffing impact around scheduled appointments");
  }

  if (topic === "weather") {
    return unavailableTopicAnswer("weather-related operating signals", "weather-driven staffing risk, transportation disruption, family communication needs, maintenance checks, or resident activity adjustments");
  }

  if (topic === "visitors") {
    return unavailableTopicAnswer("visitor-related signals", "expected visitor volume, family arrival notes, front-desk traffic patterns, communication follow-ups, or service coordination needs");
  }

  if (topic === "events") {
    return unavailableTopicAnswer("event-related signals", "community event readiness, staffing coverage, resident participation trends, service follow-up needs, or family communication timing");
  }

  if (topic === "scheduling") {
    return `${DEMO_SOURCE_NOTE} The current demo context contains staffing schedule pressure, not resident or event scheduling detail. This week shows 5 open shifts and 4 call-offs, which suggests the next 72 hours of coverage should be reviewed before standup. In a live deployment, VOL could also synthesize resident appointments, activities, transportation, and leadership calendar follow-ups.`;
  }

  if (topic === "weekend" || topic === "upcoming") {
    return `${DEMO_SOURCE_NOTE} The demo dataset does not contain a full upcoming calendar, but it does show open shifts concentrated in the current operating window and follow-up items that should be closed before the weekend. In a live deployment, VOL could synthesize weekend staffing, activities, transportation, family visits, and service recovery items into one leadership briefing.`;
  }

  if (topic === "communication") {
    return `${DEMO_SOURCE_NOTE} Communication follow-up is active in the demo context. Ruth, daughter of Room 303, is expecting a follow-up call today, and family communication follow-ups are clustering with dining and housekeeping items. Best next move: assign one owner and confirm completion today.`;
  }

  const inferredTopic = inferUnknownTopic(question);
  return `${DEMO_SOURCE_NOTE} The current demo dataset does not contain active signals related to ${inferredTopic}. In a live deployment, VOL could synthesize operational context related to this type of question and surface leadership-relevant follow-up, staffing impact, coordination risk, or workflow implications.`;
}

function matches(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function isFacilitiesQuestion(text) {
  return matches(text, [
    "maintenance",
    "hvac",
    "cooling",
    "heating",
    "air conditioning",
    " ac ",
    "a/c",
    "water",
    "power",
    "outage",
    "elevator",
    "building",
    "plumbing",
    "cooling tower",
    "chiller",
    "boiler",
    "temperature"
  ]) || /\bac\b/.test(text);
}

function isStaffingCrisisQuestion(text) {
  return matches(text, [
    "quit",
    "quits",
    "resigned",
    "resignation",
    "walked out",
    "no call",
    "short staffed",
    "short-staffed",
    "cna",
    "cnas",
    "caregiver",
    "caregivers",
    "shifts tomorrow",
    "tomorrow are filled",
    "residents do not suffer",
    "residents don't suffer"
  ]) && matches(text, ["shift", "shifts", "coverage", "staff", "staffing", "filled", "tomorrow", "schedule"]);
}

function staffingCrisisAnswer(question) {
  const countMatch = String(question || "").match(/\b(\d+)\s+(?:cna|cnas|caregivers|staff|employees|aides)\b/i);
  const lossCount = countMatch?.[1] || "multiple";
  return `${DEMO_SOURCE_NOTE}
Operational Read:
Treat this as an immediate coverage stabilization event, not a hiring problem yet. ${lossCount} CNA departures create tomorrow-shift risk, overtime risk, and resident-care continuity risk; the first priority is to protect essential resident coverage while leadership rebuilds the schedule.

What Matters First:
Reconcile tomorrow's shift grid by unit, shift, and minimum resident coverage need before the team starts solving the wrong gaps.

Hidden Tradeoff:
The next instability is burnout transfer: filling tomorrow with the same core staff may protect one shift but create call-offs 48-72 hours later.

Coordination Opportunity:
Put one leader over the coverage board, one over resident-risk protection, and one over staff outreach so the response does not fragment.

Action for Today:
1. Freeze nonessential work for 30 minutes and have the ED/DON/Scheduler reconcile tomorrow's shift grid by unit, shift, and minimum safe coverage need.
2. Identify the exact uncovered blocks, then call internal PRN, reliable part-time staff, and recently off-duty staff before agency. Offer split shifts only where resident continuity will not suffer.
3. Assign the strongest available aides to highest-acuity/resident-risk areas; move lower-risk tasks behind direct care, meals, toileting, and safety checks.
4. Escalate to regional support now if any shift remains uncovered after the first call round. Do not wait until morning.
5. Communicate a short plan to nurses and department heads: who is covering, what is deferred, and what resident risks need extra eyes.`;
}

function staffingStabilizationAnswer() {
  return `${DEMO_SOURCE_NOTE}
Operational Read:
The demo context shows active coverage pressure: 5 open shifts, 4 call-offs, 8% agency/PRN coverage, and 42 overtime hours. The practical issue is whether tomorrow's coverage is being stabilized through reliable assignments or absorbed by the same fatigued core team.

What Matters First:
Protect tomorrow's coverage consistency before the same people absorb another round of recovery work.

Hidden Tradeoff:
Coverage pressure may shift into resident experience if dining, toileting, rounds, or family communication are left to the thinnest parts of the schedule.

Coordination Opportunity:
Use one shared 72-hour coverage view so scheduling, nursing, and department heads are working from the same operating picture.

Action for Today:
1. Review the next 72 hours by shift and unit, starting with tomorrow's highest-risk coverage gaps.
2. Separate must-fill direct care gaps from work that can be delayed without resident impact.
3. Call internal PRN and part-time staff before adding agency; use agency only where continuity risk is lower than vacancy risk.
4. Watch overtime concentration by person, not only total hours, to avoid creating the next call-off.
5. Confirm the charge nurse knows which resident routines need extra protection during the coverage adjustment.`;
}

function detectUnsupportedTopic(question) {
  const text = String(question || "").toLowerCase();
  if (!text) return "";

  if (matches(text, ["accident", "accidents", "incident", "incidents", "fall", "falls", "injury", "injuries"])) {
    return {
      label: "incident or accident-log",
      sourceSystem: "incident or risk-management system"
    };
  }

  if (matches(text, ["flu", "covid", "sick", "illness", "infection", "fever", "outbreak", "virus", "symptom", "symptoms"])) {
    return {
      label: "illness census or protected resident clinical",
      sourceSystem: "illness census, infection-control, or wellness tracking system"
    };
  }

  if (matches(text, ["hospital", "hospitalization", "hospitalized", "emergency room", "emergency department", "ambulance", "transfer", "transported"]) || /\ber\b/.test(text)) {
    return {
      label: "hospital transfer or ambulance",
      sourceSystem: "transport, transfer, or clinical coordination system"
    };
  }

  if (matches(text, ["medication", "medications", "medicine", "meds", "prescription", "dose", "dosage", "pharmacy"])) {
    return {
      label: "medication or pharmacy",
      sourceSystem: "medication administration or pharmacy system"
    };
  }

  if (matches(text, ["treatment", "treatments", "diagnosis", "diagnoses", "diagnosed", "care plan", "clinical", "medical record", "chart", "phi", "hipaa"])) {
    return {
      label: "diagnosis, treatment, or protected clinical record",
      sourceSystem: "clinical record or care documentation system"
    };
  }

  if (matches(text, ["travel", "trip", "vacation", "away", "leave town", "transportation", "transport", "ride", "pickup", "drop-off", "bus", "driver"])) {
    return {
      label: "resident travel or transportation",
      sourceSystem: "transportation, scheduling, or family coordination system"
    };
  }

  return "";
}

function detectTopic(text) {
  if (!text) return "operations";

  if (matches(text, ["overtime", " ot ", "ot hours", "labor cost", "labor hours", "premium hours"])) return "overtime";
  if (matches(text, ["call-off", "calloff", "call off", "open shift", "open shifts", "coverage", "agency", "prn", "staffing", "staff", "shift", "shifts"])) return "staffing";
  if (matches(text, ["family", "daughter", "son", "spouse", "call back", "callback", "touchpoint", "touch point"])) return "family";
  if (matches(text, ["travel", "trip", "vacation", "away", "leave town"])) return "travel";
  if (matches(text, ["transportation", "transport", "ride", "pickup", "drop-off", "bus", "driver"])) return "transportation";
  if (matches(text, ["activity", "activities", "program", "outing"])) return "activities";
  if (matches(text, ["event", "events"])) return "events";
  if (matches(text, ["appointment", "appointments"])) return "appointments";
  if (matches(text, ["weather", "storm", "snow", "ice", "heat", "rain"])) return "weather";
  if (matches(text, ["visitor", "visitors", "visit", "visits", "front desk", "traffic"])) return "visitors";
  if (matches(text, ["resident", "room", "request", "missed", "follow-up", "follow up", "closure"])) return "resident";
  if (matches(text, ["recognize", "recognition", "birthday", "anniversary", "milestone", "celebrate"])) return "recognition";
  if (matches(text, ["maintenance", "housekeeping", "repair", "work order", "issue", "issues", "service recovery"])) return "maintenance";
  if (matches(text, ["meal", "food", "dining", "preference", "kitchen"])) return "food";
  if (matches(text, ["schedule", "scheduling", "calendar"])) return "scheduling";
  if (matches(text, ["weekend", "saturday", "sunday"])) return "weekend";
  if (matches(text, ["upcoming", "this week", "next week", "today", "tomorrow"])) return "upcoming";
  if (matches(text, ["communication", "communications", "message", "messages", "email", "phone"])) return "communication";
  if (matches(text, ["risk", "worry", "worried", "concern", "watch", "problem", "priority"])) return "risk";
  if (matches(text, ["leadership", "standup", "stand-up", "focus", "operations", "operational"])) return "leadership";

  return "unknown";
}

function unavailableTopicAnswer(signalLabel, liveExamples) {
  return `${DEMO_SOURCE_NOTE} No ${signalLabel} are currently active in this demo dataset. In a live environment, VOL could surface ${liveExamples} if those operational signals were connected.`;
}

function facilitiesDisruptionAnswer() {
  return `${DEMO_SOURCE_NOTE} This sounds like a facilities disruption. Direct read: the current demo does not include live facilities data, but a building systems issue should be managed around resident comfort, maintenance escalation, communication, and staffing support. Best next moves: confirm estimated downtime and affected zones with maintenance, identify residents or areas most affected, create a temporary mitigation plan, communicate a short update to department leads and families as appropriate, and review whether extra rounds or staffing support are needed. Watch item: facilities issues often create secondary strain through resident comfort concerns, family calls, and service recovery.`;
}

function unsupportedTopicAnswer(topic) {
  const signalLabel = topic?.label || "that";
  const sourceSystem = topic?.sourceSystem || "source system that owns that data";
  return `${DEMO_SOURCE_NOTE} The current demo dataset does not include ${signalLabel} visibility, so I cannot answer that directly. Based on available demo signals, VOL can currently see staffing pressure, open shifts, call-offs, overtime, family touchpoints, resident follow-ups, recognition moments, and service recovery signals. Best next move: review the ${sourceSystem}, then use VOL to connect any operational staffing or follow-up impact.`;
}

function categorizeOpenAIError(error) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("401") || message.includes("unauthorized") || message.includes("api key")) return "auth";
  if (message.includes("429") || message.includes("rate limit")) return "rate_limit";
  if (message.includes("timeout") || message.includes("timed out")) return "timeout";
  if (message.includes("network") || message.includes("fetch")) return "network";
  return "api_error";
}

function inferUnknownTopic(question) {
  const cleaned = String(question || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word && !STOP_WORDS.has(word));

  if (!cleaned.length) return "that topic";

  return cleaned.slice(0, 4).join(" ");
}

const STOP_WORDS = new Set([
  "a", "an", "any", "are", "about", "at", "be", "been", "by", "can", "could", "do", "does", "for", "from",
  "have", "how", "i", "in", "is", "it", "me", "need", "needs", "of", "on", "or", "our", "should", "that",
  "the", "there", "this", "to", "we", "what", "when", "where", "who", "with", "would", "you"
]);
