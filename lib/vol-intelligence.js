(function(root, factory){
  const api = factory();
  if(typeof module === "object" && module.exports){
    module.exports = api;
  }
  root.VolIntelligence = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function(){
  function num(row, key, fallback){
    const value = row && row[key];
    if(value === null || value === undefined || value === "") return fallback || 0;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : (fallback || 0);
  }

  function clamp(value, min, max){
    return Math.max(min, Math.min(max, value));
  }

  function score(parts){
    return clamp(Math.round(parts.reduce((sum, value) => sum + value, 0)), 0, 100);
  }

  function scoreDirection(current, previous){
    if(!previous) return "Stable";
    const currentScore = num(current, "vi_score_current") + num(current, "wsi_score");
    const previousScore = num(previous, "vi_score_current") + num(previous, "wsi_score");
    const delta = currentScore - previousScore;
    if(delta >= 3) return "Improving";
    if(delta <= -3) return "Deteriorating";
    return "Stable";
  }

  function pressureDirection(current, previous){
    if(!previous) return "Stable";
    const currentPressure = current.care_demand_pressure +
      current.workforce_absorption_pressure +
      current.leadership_execution_pressure +
      current.financial_drag_pressure +
      current.schedule_fragility_pressure;
    const previousPressure = previous.care_demand_pressure +
      previous.workforce_absorption_pressure +
      previous.leadership_execution_pressure +
      previous.financial_drag_pressure +
      previous.schedule_fragility_pressure;
    const delta = currentPressure - previousPressure;
    if(delta <= -10) return "Improving";
    if(delta >= 10) return "Deteriorating";
    return scoreDirection(current, previous);
  }

  function buildPressures(row){
    const agencyPct = num(row, "agency_shift_pct");
    const openShifts = num(row, "open_shifts", num(row, "open_shifts_per_week"));
    const calloffs = num(row, "last_minute_calloffs", num(row, "last_minute_calloffs_per_week"));
    const overtime = num(row, "overtime_hours");
    const totalLaborCost = Math.max(num(row, "total_labor_cost"), 1);

    return {
      care_demand_pressure: score([
        num(row, "census_volatility") * 5,
        num(row, "acuity_variability") * 7,
        num(row, "hospital_transfers") * 5,
        num(row, "behavior_events") * 5,
        num(row, "falls") * 4,
        num(row, "med_errors") * 5,
        num(row, "family_complaints") * 4,
        num(row, "care_coordination_breakdowns") * 6
      ]),
      workforce_absorption_pressure: score([
        openShifts * 5,
        calloffs * 6,
        overtime * 0.45,
        agencyPct * 160,
        num(row, "med_tech_vacancies") * 9,
        num(row, "caregiver_vacancies") * 6,
        num(row, "schedule_changes") * 2
      ]),
      leadership_execution_pressure: score([
        num(row, "manager_hours_on_staffing") * 2.2,
        num(row, "schedule_rebuild_events") * 5,
        num(row, "escalations") * 4,
        num(row, "incident_followup_lag_days") * 7,
        Math.max(0, 80 - num(row, "leadership_bandwidth_score", 80)) * 1.1
      ]),
      financial_drag_pressure: score([
        num(row, "estimated_volatility_drag") / 240,
        num(row, "overtime_cost") / 260,
        num(row, "agency_cost") / 260,
        num(row, "recruiting_cost") / 520,
        (num(row, "estimated_volatility_drag") / totalLaborCost) * 85
      ]),
      schedule_fragility_pressure: score([
        openShifts * 5.5,
        calloffs * 7,
        num(row, "schedule_changes") * 2.5,
        num(row, "schedule_rebuild_events") * 5,
        agencyPct * 120
      ])
    };
  }

  function detectRisk(row, previous, pressures){
    const vi = num(row, "vi_score_current");
    const wsi = num(row, "wsi_score");
    const agencyPct = num(row, "agency_shift_pct");
    const direction = pressureDirection({...row, ...pressures}, previous);
    const avgScore = (vi + wsi) / 2;
    const previousAvg = previous ? (num(previous, "vi_score_current") + num(previous, "wsi_score")) / 2 : avgScore;

    if(agencyPct >= 0.14 || (pressures.financial_drag_pressure >= 72 && num(row, "agency_cost") >= num(row, "overtime_cost") * 0.75)){
      return "Agency Dependency With Financial Drag";
    }
    if(previous && avgScore >= previousAvg + 3 && avgScore < 82 && direction === "Improving" && pressures.financial_drag_pressure < 75){
      return "Recovery Stabilization";
    }
    if(pressures.leadership_execution_pressure >= 70 || num(row, "leadership_bandwidth_score", 80) <= 55){
      return "Leadership-Constrained Execution";
    }
    if(pressures.care_demand_pressure >= 66 && pressures.care_demand_pressure >= pressures.workforce_absorption_pressure - 8){
      return "Acuity-Driven Compression";
    }
    if(pressures.schedule_fragility_pressure >= 68 || (num(row, "schedule_changes") >= 18 && num(row, "schedule_rebuild_events") >= 6)){
      return "Schedule Fragility";
    }
    if(pressures.workforce_absorption_pressure >= 62 || wsi < 70){
      return "Workforce Absorption Strain";
    }
    return "Contained Variability";
  }

  function intelligenceForRisk(row, risk, pressures){
    const openShifts = num(row, "open_shifts", num(row, "open_shifts_per_week"));
    const overtime = num(row, "overtime_hours");
    const agencyPct = num(row, "agency_shift_pct");

    const library = {
      "Contained Variability": {
        vol_read: "Operating variance is contained within current staffing capacity.",
        recommended_action: "Lock core caregiver assignments for the next two schedules.",
        action_options: [
          "Review weekend call-off patterns before posting the next schedule.",
          "Keep PRN backup aligned to the same high-risk shifts.",
          "Avoid unnecessary schedule redesign while coverage is holding."
        ],
        watch_metric: openShifts >= 3 ? "open_shifts" : "last_minute_calloffs"
      },
      "Workforce Absorption Strain": {
        vol_read: overtime >= 65 ? "OT is masking caregiver strain on recurring coverage gaps." : "Open shifts are starting to outrun internal coverage.",
        recommended_action: "Stabilize med-tech backup coverage before accepting additional move-ins.",
        action_options: [
          "Assign one owner to close repeat open shifts by role.",
          "Lock weekend caregiver assignments for the next two schedules.",
          "Add temporary evening flex coverage for 10-14 days."
        ],
        watch_metric: overtime >= 65 ? "overtime_hours" : "open_shifts"
      },
      "Acuity-Driven Compression": {
        vol_read: "Acuity movement is compressing evening coverage.",
        recommended_action: "Add temporary evening flex coverage for 10-14 days.",
        action_options: [
          "Rebalance caregiver assignments around higher-acuity residents.",
          "Review transfers, falls, and care coordination misses in daily standup.",
          "Delay new move-ins until evening coverage stabilizes."
        ],
        watch_metric: pressures.care_demand_pressure >= 75 ? "acuity_variability" : "hospital_transfers"
      },
      "Leadership-Constrained Execution": {
        vol_read: "Leadership bandwidth is the limiting factor for stabilization.",
        recommended_action: "Reduce ED/DON schedule rebuild work by assigning one owner for daily staffing recovery.",
        action_options: [
          "Move same-day staffing recovery to a named scheduler or department lead.",
          "Limit ED/DON involvement to exception review for two weeks.",
          "Close incident follow-up lag before adding new initiatives."
        ],
        watch_metric: "manager_hours_on_staffing"
      },
      "Agency Dependency With Financial Drag": {
        vol_read: agencyPct >= 0.16 ? "Agency use is becoming structural, not temporary." : "External coverage is converting instability into financial drag.",
        recommended_action: "Replace repeated agency use on the same shift with a recurring PRN block.",
        action_options: [
          "Identify the three repeat agency-covered shifts and assign internal replacements.",
          "Set a weekly agency reduction target by shift, not only by spend.",
          "Rebuild consistent weekday coverage before reducing agency support."
        ],
        watch_metric: "agency_shift_pct"
      },
      "Recovery Stabilization": {
        vol_read: "Recovery is improving, but staffing gains are not yet durable.",
        recommended_action: "Hold census growth pressure until call-offs and OT trend down for two consecutive weeks.",
        action_options: [
          "Keep repaired caregiver assignments in place for the next two schedules.",
          "Review whether overtime is falling with open shifts, not replacing them.",
          "Delay census pressure until WSI and VI move together."
        ],
        watch_metric: "wsi_score"
      },
      "Schedule Fragility": {
        vol_read: "Reactive schedule changes are creating operating fragility.",
        recommended_action: "Reduce reactive schedule rebuilds by locking core caregiver assignments.",
        action_options: [
          "Freeze nonessential schedule changes for the next posted schedule.",
          "Assign one daily staffing recovery owner.",
          "Use PRN blocks for repeat gaps instead of same-day rebuilds."
        ],
        watch_metric: "schedule_changes"
      }
    };

    return library[risk] || library["Contained Variability"];
  }

  function buildWeeklyIntelligence(weeklySignals){
    if(!Array.isArray(weeklySignals)) return [];
    const sorted = [...weeklySignals].sort((a, b) => num(a, "week") - num(b, "week"));
    const enriched = [];

    sorted.forEach((row, index) => {
      const previous = enriched[index - 1];
      const pressures = buildPressures(row);
      const risk = detectRisk(row, previous, pressures);
      const intelligence = intelligenceForRisk(row, risk, pressures);
      const trendDirection = pressureDirection({...row, ...pressures}, previous);
      const patternShiftDetected = Boolean(previous && previous.dominant_operating_risk !== risk);

      enriched.push({
        ...row,
        ...pressures,
        dominant_operating_risk: risk,
        vol_read: intelligence.vol_read.slice(0, 120),
        recommended_action: intelligence.recommended_action,
        action_options: intelligence.action_options,
        watch_metric: intelligence.watch_metric,
        pattern_shift_detected: patternShiftDetected,
        trend_direction: trendDirection
      });
    });

    return enriched;
  }

  return { buildWeeklyIntelligence };
});
