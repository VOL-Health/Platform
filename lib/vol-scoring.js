const VI_INPUT_FIELDS = [
  "census_volatility",
  "acuity_variability",
  "leadership_bandwidth",
  "workflow_disruption",
  "care_coordination_strain",
  "schedule_stress",
  "coverage_fragility",
  "overtime_pressure",
  "survey_exposure",
  "reimbursement_pressure"
];

const WSI_INPUT_FIELDS = [
  "open_shifts_per_week",
  "percent_shifts_prn",
  "last_minute_calloffs_per_week",
  "coverage_resolution",
  "monthly_ot_hours",
  "ot_premium_percent",
  "agency_premium_percent",
  "pbj_risk_score",
  "survey_citations_staffing",
  "leadership_turnover_events",
  "annual_clinical_turnover_rate",
  "open_clinical_fte_vacancies",
  "avg_time_to_fill_days",
  "monthly_recruiting_spend"
];

const NATURAL_WSI_CAP = 80;
const MAX_WSI_STABILIZED = 95;

const VI_DOMAIN_TITLES = {
  resident: "Resident Demand",
  operations: "Operational System",
  workforce: "Workforce Strain",
  external: "External Pressure"
};

const WSI_DEFAULTS = {
  openShifts: 4,
  percentPRN: 0,
  callOffs: 3,
  coverageResolution: "overtime",
  otHours: 96,
  otPremium: 50,
  agencyPremium: 35,
  pbjRisk: 2,
  surveyCitations: 1,
  leaderTurnover: 1,
  turnoverRate: 42,
  vacancies: 3,
  timeToFill: 45,
  recruitSpend: 5000
};

function deriveVIScore(input = {}) {
  const values = normalizeVIInputs(input);
  const includesExternal = includesExternalSignals(input.community_type);

  const residentAvg = (values.census + values.acuity) / 2;
  const operationsAvg = (values.leadership + values.workflow + values.coordination) / 3;
  const workforceAvg = (values.schedule + values.coverage + values.overtime) / 3;
  const externalAvg = includesExternal ? (values.survey + values.reimbursement) / 2 : 0;

  const domainAverages = {
    resident: residentAvg,
    operations: operationsAvg,
    workforce: workforceAvg,
    external: externalAvg
  };

  const activeDomains = includesExternal
    ? ["resident", "operations", "workforce", "external"]
    : ["resident", "operations", "workforce"];

  const dragRaw = activeDomains.reduce((sum, key) => sum + domainAverages[key], 0);
  const drag = Math.round((dragRaw / activeDomains.length) * 5);
  const viScoreCurrent = clamp(Math.round(80 - drag), 0, 100);
  const optimizationHeadroom = Math.max(0, 100 - viScoreCurrent);
  const projectedGain = drag === 0
    ? Math.max(4, Math.round(optimizationHeadroom * 0.3))
    : Math.max(3, Math.round(drag * 0.55));
  const viScoreStabilized = clamp(
    Math.round(viScoreCurrent + Math.min(projectedGain, optimizationHeadroom)),
    0,
    100
  );

  const dominantDomainKey = [...activeDomains].sort((a, b) => domainAverages[b] - domainAverages[a])[0];
  const dominantDomain = VI_DOMAIN_TITLES[dominantDomainKey] || dominantDomainKey;
  const modeLabel = cleanText(input.mode_label) || "Single Community";

  return {
    inputs: values,
    domainAverages,
    includesExternal,
    viScoreCurrent,
    viScoreStabilized,
    volatilityDrag: drag,
    projectedGain,
    optimizationHeadroom,
    dominantDomain,
    dominantDomainKey,
    interpretation: viSummaryFor(viScoreCurrent, dominantDomain, drag, modeLabel),
    margin: marginSignalFor(drag),
    zone: zoneLabelFor(viScoreCurrent)
  };
}

function deriveWSIScore(input = {}) {
  const inputs = normalizeWSIInputs(input);
  const severities = {
    openShifts: severityFromRaw(inputs.openShifts, 50),
    percentPRN: severityFromRaw(inputs.percentPRN, 100),
    callOffs: severityFromRaw(inputs.callOffs, 20),
    coverageResolution: {
      internal_float: 2,
      external: 4,
      overtime: 7,
      unfilled: 9
    }[inputs.coverageResolution] ?? 5,
    otHours: severityFromRaw(inputs.otHours, 500),
    otPremium: severityFromRaw(inputs.otPremium, 100),
    agencyPremium: severityFromRaw(inputs.agencyPremium, 100),
    pbjRisk: clamp(inputs.pbjRisk, 0, 10),
    surveyCitations: clamp(inputs.surveyCitations, 0, 10),
    leaderTurnover: clamp(inputs.leaderTurnover, 0, 10),
    turnoverRate: severityFromRaw(inputs.turnoverRate, 100),
    vacancies: severityFromRaw(inputs.vacancies, 20),
    timeToFill: severityFromRaw(inputs.timeToFill, 120),
    recruitSpend: severityFromRaw(inputs.recruitSpend, 50000)
  };

  const staffingDomain = weightedHealthFromSeverities(severities, {
    openShifts: 1.20,
    percentPRN: 1.05,
    callOffs: 0.95,
    coverageResolution: 1.10
  });
  const financialDomain = weightedHealthFromSeverities(severities, {
    otHours: 1.15,
    otPremium: 0.95,
    agencyPremium: 0.95
  });
  const opsDomain = weightedHealthFromSeverities(severities, {
    pbjRisk: 1.20,
    surveyCitations: 1.00,
    leaderTurnover: 1.10
  });
  const pipelineDomain = weightedHealthFromSeverities(severities, {
    turnoverRate: 1.15,
    vacancies: 1.25,
    timeToFill: 1.00,
    recruitSpend: 0.80
  });

  const domainWeights = {
    staffing: 1.15,
    financial: 1.00,
    ops: 1.10,
    pipeline: 1.20
  };

  const totalWeightedPenalty =
    (staffingDomain.strainPct * domainWeights.staffing) +
    (financialDomain.strainPct * domainWeights.financial) +
    (opsDomain.strainPct * domainWeights.ops) +
    (pipelineDomain.strainPct * domainWeights.pipeline);
  const totalDomainWeight = Object.values(domainWeights).reduce((sum, value) => sum + value, 0);
  const totalStrainPct = totalDomainWeight === 0 ? 0 : Math.min(1, totalWeightedPenalty / totalDomainWeight);

  const wsiScore = clamp(Math.round(NATURAL_WSI_CAP - (totalStrainPct * NATURAL_WSI_CAP)), 0, NATURAL_WSI_CAP);
  const recoverableGap = Math.max(0, MAX_WSI_STABILIZED - wsiScore);
  const modeledRecoveryPct = Math.min(0.58, 0.34 + (totalStrainPct * 0.22) + (pipelineDomain.strainPct * 0.08));
  const withSourcingWsiScore = clamp(Math.round(wsiScore + (recoverableGap * modeledRecoveryPct)), 0, MAX_WSI_STABILIZED);

  const annualVolatilityCost = Math.round(totalStrainPct * 2000000);
  const stabilizableUpside = Math.round(annualVolatilityCost * Math.min(0.55, 0.18 + (totalStrainPct * 0.36)));
  const workforceDragCost = Math.round(((1 - (pipelineDomain.health / 100)) * 650000) + ((1 - (staffingDomain.health / 100)) * 350000));

  const coverageResilience = staffingDomain.health;
  const costControl = financialDomain.health;
  const operationalReliability = opsDomain.health;
  const pipelineStrength = pipelineDomain.health;
  const elasticity = deriveElasticity(inputs, coverageResilience);

  const results = {
    inputs,
    severities,
    domainDetail: {
      staffing: staffingDomain,
      financial: financialDomain,
      ops: opsDomain,
      pipeline: pipelineDomain
    },
    totalStrainPct,
    wsiScore,
    rawWsiScore: Math.round(100 - (totalStrainPct * 100)),
    withSourcingWsiScore,
    annualVolatilityCost,
    stabilizableUpside,
    workforceDragCost,
    coverageResilience,
    costControl,
    operationalReliability,
    pipelineStrength,
    elasticity
  };

  return {
    ...results,
    riskLevel: deriveWSIRiskLevel(wsiScore),
    coverageStability: deriveCoverageStability(inputs),
    workforceReliability: deriveWorkforceReliability(wsiScore),
    agencyDependency: deriveAgencyDependency(inputs.percentPRN),
    burnoutRisk: deriveBurnoutRisk(inputs),
    primaryConstraint: getPrimaryConstraint(results),
    economicPressure: getEconomicPressureLabel(results),
    interpretation: buildWsiInterpretation(results)
  };
}

function deriveCombinedStabilityScore(input = {}) {
  const vi = input.vi || deriveVIScore(input);
  const wsi = input.wsi || deriveWSIScore(input);
  const viScore = toNumberOrNull(vi.viScoreCurrent) ?? toNumberOrNull(input.vi_score_current) ?? 0;
  const wsiScore = toNumberOrNull(wsi.wsiScore) ?? toNumberOrNull(input.wsi_score) ?? 0;
  const combinedStabilityScore = clamp(Math.round((viScore * 0.52) + (wsiScore * 0.48)), 0, 100);

  return {
    combinedStabilityScore,
    stabilityTier: stabilityTierFor(combinedStabilityScore)
  };
}

function deriveVolScoresFromNormalizedData(normalizedData = {}) {
  const missingInputs = [];
  const viInput = mapNormalizedToVIInput(normalizedData, missingInputs);
  const wsiInput = mapNormalizedToWSIInput(normalizedData, missingInputs);
  const vi = deriveVIScore(viInput);
  const wsi = deriveWSIScore(wsiInput);
  const combined = deriveCombinedStabilityScore({ vi, wsi });
  const expectedInputs = VI_INPUT_FIELDS.length + WSI_INPUT_FIELDS.length;
  const scoreConfidence = clamp(Number(((expectedInputs - missingInputs.length) / expectedInputs).toFixed(2)), 0, 1);

  return {
    vi,
    wsi,
    combined,
    vi_input: viInput,
    wsi_input: wsiInput,
    "VI Score (Current)": vi.viScoreCurrent,
    "VI Score (Stabilized)": vi.viScoreStabilized,
    "VI Volatility Drag": vi.volatilityDrag,
    "VI Dominant Domain": vi.dominantDomain,
    "VI Interpretation": vi.interpretation,
    "WSI Score": wsi.wsiScore,
    "WSI Score (Current)": wsi.wsiScore,
    "WSI Score (Stabilized)": wsi.withSourcingWsiScore,
    "WSI Risk Level": wsi.riskLevel,
    "Coverage Stability": wsi.coverageStability,
    "Workforce Reliability": wsi.workforceReliability,
    "Agency Dependency": wsi.agencyDependency,
    "Burnout Risk": wsi.burnoutRisk,
    "Primary Constraint": wsi.primaryConstraint,
    "Economic Pressure": wsi.economicPressure,
    "Elasticity State": wsi.elasticity.healthState,
    "WSI Interpretation": wsi.interpretation,
    "Combined Stability Score": combined.combinedStabilityScore,
    "Stability Tier": combined.stabilityTier,
    score_confidence: scoreConfidence,
    missing_inputs: [...new Set(missingInputs)]
  };
}

function mapNormalizedToVIInput(data, missingInputs) {
  const mapped = {
    community_type: data.community_type
  };
  const direct = {
    census_volatility: "census",
    acuity_variability: "acuity",
    leadership_bandwidth: "leadership",
    workflow_disruption: "workflow",
    care_coordination_strain: "coordination",
    schedule_stress: "schedule",
    coverage_fragility: "coverage",
    overtime_pressure: "overtime",
    survey_exposure: "survey",
    reimbursement_pressure: "reimbursement"
  };

  Object.entries(direct).forEach(([source, target]) => {
    if (hasObservedValue(data, source)) {
      mapped[target] = clamp(data[source], 0, 10);
    } else {
      missingInputs.push(source);
      mapped[target] = 0;
    }
  });

  return mapped;
}

function mapNormalizedToWSIInput(data, missingInputs) {
  const mapped = {};
  assignObserved(mapped, "openShifts", data, "open_shifts_per_week", WSI_DEFAULTS.openShifts, 0, 50, missingInputs);
  assignObserved(mapped, "callOffs", data, "last_minute_calloffs_per_week", WSI_DEFAULTS.callOffs, 0, 20, missingInputs);
  assignObserved(mapped, "otHours", data, "monthly_overtime_hours", WSI_DEFAULTS.otHours, 0, 500, missingInputs);
  assignObserved(mapped, "timeToFill", data, "avg_time_to_fill_days", WSI_DEFAULTS.timeToFill, 0, 120, missingInputs);
  assignObserved(mapped, "vacancies", data, "open_clinical_fte_vacancies", WSI_DEFAULTS.vacancies, 0, 20, missingInputs);
  assignObserved(mapped, "pbjRisk", data, "pbj_risk_score", WSI_DEFAULTS.pbjRisk, 0, 10, missingInputs);
  assignObserved(mapped, "leaderTurnover", data, "leadership_turnover_events", WSI_DEFAULTS.leaderTurnover, 0, 10, missingInputs);
  assignObserved(mapped, "recruitSpend", data, "monthly_recruiting_spend", WSI_DEFAULTS.recruitSpend, 0, 50000, missingInputs);

  if (hasObservedValue(data, "percent_shifts_prn")) {
    mapped.percentPRN = clamp(data.percent_shifts_prn, 0, 100);
  } else if (hasObservedValue(data, "agency_shift_pct")) {
    // Conservative assumption: agency shift percentage is treated as the closest available proxy for the old agency/PRN mix input.
    mapped.percentPRN = clamp(data.agency_shift_pct, 0, 100);
  } else {
    missingInputs.push("percent_shifts_prn");
    mapped.percentPRN = WSI_DEFAULTS.percentPRN;
  }

  if (hasObservedValue(data, "coverage_resolution")) {
    mapped.coverageResolution = normalizeCoverageResolution(data.coverage_resolution);
  } else {
    missingInputs.push("coverage_resolution");
    mapped.coverageResolution = WSI_DEFAULTS.coverageResolution;
  }

  if (hasObservedValue(data, "survey_exposure")) {
    // Conservative assumption: VI survey exposure is a 0-10 operational pressure signal, matching the WSI survey citation scale directionally.
    mapped.surveyCitations = clamp(data.survey_exposure, 0, 10);
  } else {
    missingInputs.push("survey_citations_staffing");
    mapped.surveyCitations = WSI_DEFAULTS.surveyCitations;
  }

  if (hasObservedValue(data, "open_roles") && !hasObservedValue(data, "open_clinical_fte_vacancies")) {
    // Conservative assumption: open roles are broader than clinical FTE vacancies, so cap to the old 0-20 vacancy range.
    mapped.vacancies = clamp(data.open_roles, 0, 20);
  }

  if (hasObservedValue(data, "overtime_pressure") && !hasObservedValue(data, "monthly_overtime_hours")) {
    // Conservative assumption: old VI overtime pressure is 0-10; map it proportionally to the old WSI 0-500 monthly overtime scale.
    mapped.otHours = clamp(Math.round((clamp(data.overtime_pressure, 0, 10) / 10) * 500), 0, 500);
  }

  mapped.otPremium = WSI_DEFAULTS.otPremium;
  mapped.agencyPremium = WSI_DEFAULTS.agencyPremium;
  mapped.turnoverRate = WSI_DEFAULTS.turnoverRate;

  if (!hasObservedValue(data, "ot_premium_percent")) missingInputs.push("ot_premium_percent");
  if (!hasObservedValue(data, "agency_premium_percent")) missingInputs.push("agency_premium_percent");
  if (!hasObservedValue(data, "annual_clinical_turnover_rate")) missingInputs.push("annual_clinical_turnover_rate");

  return mapped;
}

function normalizeVIInputs(input) {
  return {
    census: clamp(firstObserved(input.census, input.census_volatility, 0), 0, 10),
    acuity: clamp(firstObserved(input.acuity, input.acuity_variability, 0), 0, 10),
    leadership: clamp(firstObserved(input.leadership, input.leadership_bandwidth, 0), 0, 10),
    workflow: clamp(firstObserved(input.workflow, input.workflow_disruption, 0), 0, 10),
    coordination: clamp(firstObserved(input.coordination, input.care_coordination_strain, 0), 0, 10),
    schedule: clamp(firstObserved(input.schedule, input.schedule_stress, 0), 0, 10),
    coverage: clamp(firstObserved(input.coverage, input.coverage_fragility, 0), 0, 10),
    overtime: clamp(firstObserved(input.overtime, input.overtime_pressure, 0), 0, 10),
    survey: clamp(firstObserved(input.survey, input.survey_exposure, 0), 0, 10),
    reimbursement: clamp(firstObserved(input.reimbursement, input.reimbursement_pressure, 0), 0, 10)
  };
}

function normalizeWSIInputs(input) {
  return {
    openShifts: clamp(firstObserved(input.openShifts, input.open_shifts_per_week, WSI_DEFAULTS.openShifts), 0, 50),
    percentPRN: clamp(firstObserved(input.percentPRN, input.percent_shifts_prn, input.agency_shift_pct, WSI_DEFAULTS.percentPRN), 0, 100),
    callOffs: clamp(firstObserved(input.callOffs, input.last_minute_calloffs_per_week, WSI_DEFAULTS.callOffs), 0, 20),
    coverageResolution: normalizeCoverageResolution(firstObserved(input.coverageResolution, input.coverage_resolution, WSI_DEFAULTS.coverageResolution)),
    otHours: clamp(firstObserved(input.otHours, input.monthly_ot_hours, input.monthly_overtime_hours, WSI_DEFAULTS.otHours), 0, 500),
    otPremium: clamp(firstObserved(input.otPremium, input.ot_premium_percent, WSI_DEFAULTS.otPremium), 0, 100),
    agencyPremium: clamp(firstObserved(input.agencyPremium, input.agency_premium_percent, WSI_DEFAULTS.agencyPremium), 0, 100),
    pbjRisk: clamp(firstObserved(input.pbjRisk, input.pbj_risk_score, WSI_DEFAULTS.pbjRisk), 0, 10),
    surveyCitations: clamp(firstObserved(input.surveyCitations, input.survey_citations_staffing, WSI_DEFAULTS.surveyCitations), 0, 10),
    leaderTurnover: clamp(firstObserved(input.leaderTurnover, input.leadership_turnover_events, WSI_DEFAULTS.leaderTurnover), 0, 10),
    turnoverRate: clamp(firstObserved(input.turnoverRate, input.annual_clinical_turnover_rate, WSI_DEFAULTS.turnoverRate), 0, 100),
    vacancies: clamp(firstObserved(input.vacancies, input.open_clinical_fte_vacancies, input.open_roles, WSI_DEFAULTS.vacancies), 0, 20),
    timeToFill: clamp(firstObserved(input.timeToFill, input.avg_time_to_fill_days, WSI_DEFAULTS.timeToFill), 0, 120),
    recruitSpend: clamp(firstObserved(input.recruitSpend, input.monthly_recruiting_spend, WSI_DEFAULTS.recruitSpend), 0, 50000)
  };
}

function severityFromRaw(value, maxValue) {
  if (!maxValue) return 0;
  return clamp((Number(value) / maxValue) * 10, 0, 10);
}

function bandedPenalty(value) {
  const safe = clamp(value, 0, 10);
  if (safe <= 0) return 0;
  if (safe <= 3) return safe * 0.55;
  if (safe <= 6) return 1.65 + ((safe - 3) * 1.10);
  return 4.95 + ((safe - 6) * 1.85);
}

function maxBandedPenalty() {
  return bandedPenalty(10);
}

function weightedHealthFromSeverities(severities, metricWeights) {
  const keys = Object.keys(metricWeights);
  const weightedPenalty = keys.reduce((sum, key) => sum + (bandedPenalty(severities[key]) * metricWeights[key]), 0);
  const weightedMax = keys.reduce((sum, key) => sum + (maxBandedPenalty() * metricWeights[key]), 0);
  const strainPct = weightedMax === 0 ? 0 : Math.min(1, weightedPenalty / weightedMax);
  const health = Math.round(100 - (strainPct * 100));
  return { weightedPenalty, weightedMax, strainPct, health };
}

function deriveElasticity(inputs, coverageResilience) {
  const elasticityBalance = clamp(Math.round(((coverageResilience - 80) / 20) * 100), -100, 100);
  let archetype = "Balanced Elastic";
  let healthState = "Balanced Elastic";
  let meaning = "The workforce system is absorbing endemic strain in a way that still feels operationally manageable.";

  if (inputs.coverageResolution === "unfilled" || coverageResilience < 50) {
    archetype = "Elasticity Failure";
    healthState = "Elasticity Failure";
    meaning = "Coverage strain is outpacing the workforce system's ability to absorb normal disruption without visible instability.";
  } else if (inputs.coverageResolution === "overtime" || (severityFromRaw(inputs.otHours, 500) >= 6.5 && coverageResilience < 72)) {
    archetype = "Burnout Stabilized";
    healthState = "Burnout Stabilized";
    meaning = "The schedule is being held together primarily by stretching core staff rather than by a resilient workforce system.";
  } else if (inputs.coverageResolution === "external" || severityFromRaw(inputs.percentPRN, 100) >= 4.5) {
    archetype = "Agency Stabilized";
    healthState = "Agency Stabilized";
    meaning = "The workforce is being stabilized through external coverage at meaningful premium cost.";
  }

  return { archetype, healthState, meaning, elasticityBalance };
}

function deriveWSIRiskLevel(score) {
  const safe = Number(score) || 0;
  if (safe < 58) return "High";
  if (safe < 80) return "Moderate";
  return "Low";
}

function deriveCoverageStability(inputs) {
  const open = Number(inputs.openShifts) || 0;
  const calloffs = Number(inputs.callOffs) || 0;
  const resolution = inputs.coverageResolution;
  if (resolution === "unfilled" || open >= 12 || calloffs >= 6) return "Fragile";
  if (resolution === "overtime" || open >= 6 || calloffs >= 3) return "Stressed";
  if (resolution === "external") return "Supported";
  return "Stable";
}

function deriveWorkforceReliability(score) {
  const safe = Number(score) || 0;
  if (safe < 58) return "Low";
  if (safe < 80) return "Moderate";
  return "High";
}

function deriveAgencyDependency(percentPRN) {
  const safe = Number(percentPRN) || 0;
  if (safe >= 50) return "High";
  if (safe >= 20) return "Moderate";
  return "Low";
}

function deriveBurnoutRisk(inputs) {
  const ot = Number(inputs.otHours) || 0;
  const calloffs = Number(inputs.callOffs) || 0;
  const leadership = Number(inputs.leaderTurnover) || 0;
  const resolution = inputs.coverageResolution;
  const stressPoints =
    (ot >= 200 ? 2 : ot >= 100 ? 1 : 0) +
    (calloffs >= 5 ? 2 : calloffs >= 3 ? 1 : 0) +
    (leadership >= 3 ? 2 : leadership >= 1 ? 1 : 0) +
    (resolution === "overtime" ? 2 : resolution === "external" ? 1 : 0);
  if (stressPoints >= 5) return "High";
  if (stressPoints >= 2) return "Moderate";
  return "Low";
}

function getPrimaryConstraint(results) {
  const entries = [
    ["Staffing Volatility", results.domainDetail.staffing.strainPct],
    ["Financial Exposure", results.domainDetail.financial.strainPct],
    ["Operational / Compliance Risk", results.domainDetail.ops.strainPct],
    ["Pipeline Strength", results.domainDetail.pipeline.strainPct]
  ];
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

function getEconomicPressureLabel(results) {
  if (results.annualVolatilityCost < 250000) return "Contained";
  if (results.annualVolatilityCost < 750000) return "Building";
  if (results.annualVolatilityCost < 1400000) return "Meaningful";
  return "Severe";
}

function buildWsiInterpretation(results) {
  const score = Number(results.wsiScore) || 0;
  const primaryConstraint = getPrimaryConstraint(results);
  const economicPressure = getEconomicPressureLabel(results);
  const elasticityState = results.elasticity?.healthState || "";
  const elasticityMeaning = results.elasticity?.meaning || "";
  const scoreText =
    score >= 78
      ? "The workforce system is operating from a comparatively healthy baseline."
      : score >= 68
        ? "The workforce system is functioning, but visible strain is building beneath the surface."
        : score >= 58
          ? "The workforce system is increasingly reactive and carrying meaningful stability drag."
          : "The workforce system is fragile and absorbing instability inefficiently.";

  return [
    `WSI score is ${score}.`,
    scoreText,
    `Primary constraint is ${primaryConstraint.toLowerCase()}.`,
    `Economic pressure is ${economicPressure.toLowerCase()}.`,
    elasticityState ? `Elasticity state is ${elasticityState.toLowerCase()}.` : "",
    elasticityMeaning
  ].filter(Boolean).join(" ");
}

function viSummaryFor(stability, dominantDomain, drag, modeLabel) {
  if (drag === 0) {
    return modeLabel === "Portfolio View"
      ? "This portfolio is inside normal baseline variation. VI will show where pressure starts to concentrate."
      : "This community is inside normal baseline variation. VI will show where pressure starts to build.";
  }
  if (stability >= 75) {
    return modeLabel === "Portfolio View"
      ? `${dominantDomain} is starting to create portfolio drag. It may still look manageable, but the pattern is visible.`
      : `${dominantDomain} is starting to create drag. It may still feel manageable, but the pattern is visible.`;
  }
  if (stability >= 65) {
    return modeLabel === "Portfolio View"
      ? `${dominantDomain} is now a clear portfolio drag. Intervene before more communities become reactive.`
      : `${dominantDomain} is now a clear drag. Intervene before the day becomes more reactive.`;
  }
  if (stability >= 55) {
    return modeLabel === "Portfolio View"
      ? `The portfolio is operating reactively. ${dominantDomain} is reducing operating room.`
      : `The community is operating reactively. ${dominantDomain} is reducing operating room.`;
  }
  return modeLabel === "Portfolio View"
    ? `The portfolio is exposed. ${dominantDomain} is now the clearest drag on consistency and capacity.`
    : `The community is exposed. ${dominantDomain} is now the clearest drag on consistency and capacity.`;
}

function marginSignalFor(drag) {
  if (drag <= 5) return { label: "Contained", text: "Pressure is contained. The operation still has room to improve." };
  if (drag <= 20) return { label: "Building", text: "Pressure is starting to consume operating room." };
  if (drag <= 40) return { label: "Meaningful", text: "Labor efficiency, leader capacity, and margin may be feeling it." };
  return { label: "Severe", text: "Pressure is materially affecting consistency, margin, and resident experience." };
}

function zoneLabelFor(score) {
  if (score >= 80) return "Optimized Range";
  if (score >= 60) return "Managed Stability";
  return "Exposed Range";
}

function stabilityTierFor(score) {
  if (score >= 80) return "Optimized Range";
  if (score >= 68) return "Managed Stability";
  if (score >= 58) return "Strained Stability";
  if (score >= 48) return "Reactive Operation";
  return "Exposed Operation";
}

function includesExternalSignals(communityType) {
  const safe = cleanText(communityType).toLowerCase();
  return safe.includes("snf") || safe.includes("hybrid") || safe.includes("ccrc");
}

function normalizeCoverageResolution(value) {
  const safe = cleanText(value).toLowerCase();
  if (["internal_float", "external", "overtime", "unfilled"].includes(safe)) return safe;
  if (safe.includes("unfilled")) return "unfilled";
  if (safe.includes("overtime") || safe.includes("late") || safe.includes("extra")) return "overtime";
  if (safe.includes("external") || safe.includes("agency")) return "external";
  if (safe.includes("internal") || safe.includes("float") || safe.includes("prn")) return "internal_float";
  return "overtime";
}

function assignObserved(target, targetKey, data, sourceKey, fallback, min, max, missingInputs) {
  if (hasObservedValue(data, sourceKey)) {
    target[targetKey] = clamp(data[sourceKey], min, max);
  } else {
    missingInputs.push(sourceKey);
    target[targetKey] = fallback;
  }
}

function firstObserved(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return undefined;
}

function hasObservedValue(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== null && obj[key] !== undefined && obj[key] !== "";
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function clamp(value, min, max) {
  value = Number(value);
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function cleanText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

module.exports = {
  VI_INPUT_FIELDS,
  WSI_INPUT_FIELDS,
  deriveVIScore,
  deriveWSIScore,
  deriveCombinedStabilityScore,
  deriveVolScoresFromNormalizedData
};
