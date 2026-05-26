(function(root, factory){
  const api = factory();
  if(typeof module === "object" && module.exports){
    module.exports = api;
  }
  root.VolStabilizationModel = api;
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

  function sortWeeks(weeklySignals){
    return Array.isArray(weeklySignals)
      ? [...weeklySignals].sort((a, b) => num(a, "week") - num(b, "week"))
      : [];
  }

  function average(rows, getter){
    if(!rows.length) return 0;
    return rows.reduce((sum, row) => sum + getter(row), 0) / rows.length;
  }

  function pctTrend(rows, getter){
    if(rows.length < 2) return 0;
    const first = getter(rows[0]);
    const last = getter(rows[rows.length - 1]);
    if(first === 0 && last === 0) return 0;
    return ((last - first) / Math.max(Math.abs(first), 1)) * 100;
  }

  function effectProfile(interventionType){
    const type = String(interventionType || "").toLowerCase();
    if(type.includes("agency") || type.includes("prn") || type.includes("critical")){
      return {
        drag_low: 0.18,
        drag_high: 0.27,
        ot_low: 0.04,
        ot_high: 0.08,
        agency_low: 0.06,
        agency_high: 0.14,
        rebuild_low: 0.04,
        rebuild_high: 0.08,
        label: "PRN block replacement"
      };
    }
    if(type.includes("leadership") || type.includes("ownership")){
      return {
        drag_low: 0.14,
        drag_high: 0.23,
        ot_low: 0.05,
        ot_high: 0.10,
        agency_low: 0.03,
        agency_high: 0.07,
        rebuild_low: 0.10,
        rebuild_high: 0.18,
        label: "Leadership recovery ownership"
      };
    }
    if(type.includes("flex")){
      return {
        drag_low: 0.15,
        drag_high: 0.24,
        ot_low: 0.07,
        ot_high: 0.12,
        agency_low: 0.05,
        agency_high: 0.12,
        rebuild_low: 0.07,
        rebuild_high: 0.14,
        label: "Temporary flex coverage"
      };
    }
    if(type.includes("stabilization") || type.includes("caregiver") || type.includes("weekend")){
      return {
        drag_low: 0.12,
        drag_high: 0.20,
        ot_low: 0.08,
        ot_high: 0.15,
        agency_low: 0.02,
        agency_high: 0.06,
        rebuild_low: 0.05,
        rebuild_high: 0.10,
        label: "Weekend caregiver stabilization"
      };
    }
    return {
      drag_low: 0.13,
      drag_high: 0.21,
      ot_low: 0.06,
      ot_high: 0.12,
      agency_low: 0.04,
      agency_high: 0.09,
      rebuild_low: 0.06,
      rebuild_high: 0.12,
      label: "Targeted stabilization action"
    };
  }

  function describeTrend(percent, up, down, stable){
    if(percent >= 8) return up;
    if(percent <= -8) return down;
    return stable;
  }

  function projectStabilizedPath({ weeklySignals, interventionWeek, interventionType } = {}){
    const weeks = sortWeeks(weeklySignals);
    const actualDrag = weeks.reduce((sum, row) => sum + num(row, "estimated_volatility_drag"), 0);
    const chosenWeek = Number(interventionWeek || weeks[0]?.week || 1);
    const postRows = weeks.filter((row) => num(row, "week") >= chosenWeek);
    const preRows = weeks.filter((row) => num(row, "week") < chosenWeek);
    const profile = effectProfile(interventionType);

    const postDrag = postRows.reduce((sum, row) => sum + num(row, "estimated_volatility_drag"), 0);
    const dragReductionLow = postDrag * profile.drag_low;
    const dragReductionHigh = postDrag * profile.drag_high;
    const projectedDragLow = Math.max(0, Math.round(actualDrag - dragReductionHigh));
    const projectedDragHigh = Math.max(projectedDragLow, Math.round(actualDrag - dragReductionLow));
    const reductionPctLow = actualDrag ? (dragReductionLow / actualDrag) * 100 : 0;
    const reductionPctHigh = actualDrag ? (dragReductionHigh / actualDrag) * 100 : 0;

    const otTrend = pctTrend(weeks, (row) => num(row, "overtime_hours"));
    const agencyTrend = pctTrend(weeks, (row) => num(row, "agency_shift_pct"));
    const rebuildTrend = pctTrend(weeks, (row) => num(row, "schedule_rebuild_events"));
    const wsiTrend = pctTrend(weeks, (row) => num(row, "wsi_score"));
    const avgLeadershipPressure = average(weeks, (row) => Math.max(0, 80 - num(row, "leadership_bandwidth_score", 80)));
    const avgWorkforceStrain = average(weeks, (row) => (
      num(row, "open_shifts", num(row, "open_shifts_per_week")) +
      num(row, "last_minute_calloffs", num(row, "last_minute_calloffs_per_week")) +
      (num(row, "overtime_hours") / 20)
    ));

    const projectedOtLow = clamp(profile.ot_low * 100, 0, 30);
    const projectedOtHigh = clamp(profile.ot_high * 100, projectedOtLow, 35);
    const projectedAgencyLow = clamp(profile.agency_low * 100, 0, 30);
    const projectedAgencyHigh = clamp(profile.agency_high * 100, projectedAgencyLow, 35);
    const projectedRebuildLow = clamp(profile.rebuild_low * 100, 0, 30);
    const projectedRebuildHigh = clamp(profile.rebuild_high * 100, projectedRebuildLow, 35);

    return {
      actual_drag: Math.round(actualDrag),
      projected_drag_low: projectedDragLow,
      projected_drag_high: projectedDragHigh,
      projected_reduction_pct_low: Math.round(reductionPctLow),
      projected_reduction_pct_high: Math.round(reductionPctHigh),
      projected_effects: {
        intervention_week: chosenWeek,
        intervention_type: profile.label,
        actual_path: {
          ot_trend: describeTrend(otTrend, "OT pressure increased across the period.", "OT pressure eased across the period.", "OT pressure stayed relatively flat."),
          agency_trend: describeTrend(agencyTrend, "Agency use increased across the period.", "Agency use eased across the period.", "Agency use stayed relatively flat."),
          leadership_pressure: avgLeadershipPressure >= 22 ? "Leadership load stayed elevated." : avgLeadershipPressure >= 12 ? "Leadership load was building." : "Leadership load stayed contained.",
          workforce_strain_progression: avgWorkforceStrain >= 16 ? "Workforce strain compounded across the path." : avgWorkforceStrain >= 10 ? "Workforce strain was building." : "Workforce strain stayed contained."
        },
        stabilized_path: {
          projected_ot_reduction: `${Math.round(projectedOtLow)}-${Math.round(projectedOtHigh)}%`,
          projected_agency_reduction: `${Math.round(projectedAgencyLow)}-${Math.round(projectedAgencyHigh)}%`,
          projected_rebuild_reduction: `${Math.round(projectedRebuildLow)}-${Math.round(projectedRebuildHigh)}%`,
          projected_stabilization_trajectory: wsiTrend >= 4 ? "Stabilization path likely reinforces existing recovery." : "Stabilization path likely slows workforce strain acceleration.",
          projected_leadership_relief: "Likely fewer schedule rebuilds and clearer ownership for operational follow-through.",
          projected_stabilization_effect: "Earlier intervention likely preserved staffing consistency, reduced reactive recovery work, and protected leadership capacity.",
          stability_preservation_effect: "Supports stability preservation before operational drift compounds: staffing consistency, leadership follow-through, and fewer reactive recovery cycles.",
          continuity_effects: [
            "More consistent caregiver assignment continuity.",
            "Reduced reactive staffing disruption.",
            "Improved leadership availability for resident engagement.",
            "Fewer workflow interruptions during high-demand periods.",
            "Stronger staffing consistency during acuity shifts.",
            "Reduced leadership recovery burden."
          ]
        }
      },
      assumptions: [
        "Modeled from synthetic weekly operating signals.",
        "Projection applies only from the selected intervention week forward.",
        "Projected ranges use deterministic operating assumptions, not promised savings.",
        "VOL supports leadership timing and judgment; it does not replace operational execution."
      ]
    };
  }

  return { projectStabilizedPath };
});
