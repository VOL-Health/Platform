(function(){
  let demos = [
    {
      id: "maple-glen",
      name: "Maple Glen Assisted Living",
      scenario: "Stable / Low Volatility",
      severity: "stable",
      file: "data/demo-maple-glen.json"
    },
    {
      id: "cedar-ridge",
      name: "Cedar Ridge Assisted Living",
      scenario: "Workforce Absorption Strain",
      severity: "strained",
      file: "data/demo-cedar-ridge.json"
    },
    {
      id: "willow-creek",
      name: "Willow Creek Assisted Living",
      scenario: "Leadership Turnover Drag",
      severity: "high",
      file: "data/demo-willow-creek.json"
    },
    {
      id: "river-bend",
      name: "River Bend Assisted Living",
      scenario: "Agency-Reliant Financial Pressure",
      severity: "critical",
      file: "data/demo-river-bend.json"
    },
    {
      id: "oak-hollow",
      name: "Oak Hollow Assisted Living",
      scenario: "Recovery / Stabilization",
      severity: "recovery",
      file: "data/demo-oak-hollow.json"
    }
  ];

  const state = {
    selectedId: demos[0].id,
    dataById: new Map(),
    communitiesById: new Map(),
    replayMode: "with"
  };

  const cardsEl = document.getElementById("communityCards");
  const outputEl = document.getElementById("demoOutput");
  const buildWeeklyIntelligence = window.VolIntelligence?.buildWeeklyIntelligence || ((weeklySignals) => weeklySignals || []);
  const buildDecisionReplay = window.VolDecisionReplay?.buildDecisionReplay || ((weeklySignals, mode) => ({
    mode: mode || "with",
    summary: "",
    cumulative_drag: cumulativeDrag(weeklySignals || []),
    intervention_windows: [],
    enriched_rows: weeklySignals || []
  }));
  const projectStabilizedPath = window.VolStabilizationModel?.projectStabilizedPath || (({ weeklySignals }) => ({
    actual_drag: cumulativeDrag(weeklySignals || []),
    projected_drag_low: cumulativeDrag(weeklySignals || []),
    projected_drag_high: cumulativeDrag(weeklySignals || []),
    projected_reduction_pct_low: 0,
    projected_reduction_pct_high: 0,
    projected_effects: { actual_path: {}, stabilized_path: {} },
    assumptions: []
  }));

  function escapeHtml(value){
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatNumber(value){
    if(value === null || value === undefined || value === "") return "n/a";
    return new Intl.NumberFormat("en-US").format(Number(value));
  }

  function formatCurrency(value){
    if(value === null || value === undefined || value === "") return "n/a";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0
    }).format(Number(value));
  }

  function formatPercent(value){
    if(value === null || value === undefined || value === "") return "n/a";
    const numeric = Number(value);
    const display = numeric <= 1 ? numeric * 100 : numeric;
    return `${display.toFixed(display >= 10 ? 0 : 1)}%`;
  }

  function formatDate(value){
    if(!value) return "n/a";
    const date = new Date(`${value}T00:00:00`);
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric"
    }).format(date);
  }

  function slugify(value){
    return window.VolDemoCommunityState?.slugify
      ? window.VolDemoCommunityState.slugify(value)
      : String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function severityFromCommunity(community){
    const vi = Number(community.viScoreCurrent || 0);
    const wsi = Number(community.wsiScore || 0);
    const agency = Number(community.staffingSignals?.agencyShiftPercent || 0);
    const economic = String(community.economicSignals?.economicPressure || "").toLowerCase();
    if(vi < 60 || wsi < 60 || agency >= 16 || economic.includes("high")) return "critical";
    if(vi < 70 || wsi < 70) return "high";
    if(vi < 80 || wsi < 80) return "strained";
    if(String(community.demoPattern || "").toLowerCase().includes("recovery")) return "recovery";
    return "stable";
  }

  function demoFromCommunity(community){
    const id = community.id || slugify(community.communityName);
    return {
      id,
      name: community.sourceCommunityName || `${community.communityName} ${community.communityType || ""}`.trim(),
      scenario: community.demoPattern || community.dominantPattern || "Demo community",
      severity: severityFromCommunity(community),
      file: "",
      community
    };
  }

  async function loadCanonicalDemoCommunities(){
    if(!window.VolDemoCommunityState?.loadDemoCommunities) return false;
    const payload = await window.VolDemoCommunityState.loadDemoCommunities();
    const communities = payload.communities || [];
    if(!communities.length) return false;
    demos = communities.map(demoFromCommunity);
    state.communitiesById = new Map(communities.map((community) => [community.id || slugify(community.communityName), community]));
    state.dataById = new Map(communities.map((community) => [community.id || slugify(community.communityName), community.rawSource || { normalized: {} }]));
    const selected = await window.VolDemoCommunityState.getSelectedDemoCommunity();
    state.selectedId = selected?.id || demos[0].id;
    return true;
  }

  function sortWeeks(weeks){
    return [...weeks].sort((a, b) => Number(a.week || 0) - Number(b.week || 0));
  }

  function getLatestWeek(weeks){
    const sorted = sortWeeks(weeks);
    return sorted[sorted.length - 1] || {};
  }

  function pressureLanguage(latest){
    const agency = Number(latest.agency_shift_pct ?? 0);
    const overtime = Number(latest.overtime_hours ?? 0);
    const calloffs = Number(latest.last_minute_calloffs ?? latest.last_minute_calloffs_per_week ?? 0);
    const openShifts = Number(latest.open_shifts ?? latest.open_shifts_per_week ?? 0);

    if(agency >= 0.18){
      return "Coverage is being stabilized through agency usage, which protects the schedule but pushes labor economics out of balance.";
    }
    if(overtime >= 70 || openShifts >= 12){
      return "The schedule is absorbing demand through overtime and repeated gap management, creating strain before the week starts.";
    }
    if(calloffs >= 5){
      return "Repeated short-notice disruption is forcing leaders to spend bandwidth on coverage instead of operating rhythm.";
    }
    if(Number(latest.vi_score_current ?? 100) >= 80 && Number(latest.wsi_score ?? 100) >= 80){
      return "The community is holding a stable operating rhythm with contained schedule and acuity variation.";
    }
    return "Operating pressure is present but not yet concentrated in one metric, so leaders should review repeat open shifts before next week's schedule is posted.";
  }

  function mattersLanguage(latest){
    const drag = Number(latest.estimated_volatility_drag ?? 0);
    const bandwidth = Number(latest.leadership_bandwidth_score ?? 100);
    const economicPressure = latest.economic_pressure || "Moderate";

    if(drag >= 9000){
      return `The latest week shows ${formatCurrency(drag)} in estimated volatility drag, making instability visible as an economic decision.`;
    }
    if(bandwidth <= 55){
      return "Leadership capacity is becoming the constraint, so even manageable staffing issues can linger and compound.";
    }
    if(String(economicPressure).toLowerCase().includes("high")){
      return "The labor model is protecting care coverage at a cost level that needs executive visibility.";
    }
    return "The signal matters because low-grade volatility can look operationally normal until it becomes recurring labor cost or leadership drag.";
  }

  function nextActionLanguage(latest){
    const agency = Number(latest.agency_shift_pct ?? 0);
    const overtime = Number(latest.overtime_hours ?? 0);
    const openShifts = Number(latest.open_shifts ?? latest.open_shifts_per_week ?? 0);
    const calloffs = Number(latest.last_minute_calloffs ?? latest.last_minute_calloffs_per_week ?? 0);
    const bandwidth = Number(latest.leadership_bandwidth_score ?? 100);
    const acuity = Number(latest.acuity_variability ?? 0);

    if(agency >= 0.18) return "Rebuild consistent weekday coverage before reducing agency support.";
    if(agency >= 0.10) return "Convert repeat agency-covered shifts into named internal assignments.";
    if(overtime >= 70 && openShifts >= 10) return "Stabilize weekend med-tech coverage before overtime dependence returns.";
    if(overtime >= 70) return "Cap repeat overtime by assigning open shifts to specific recruiting and schedule repair owners.";
    if(calloffs >= 5) return "Reduce leadership time spent on same-day staffing recovery.";
    if(bandwidth <= 55) return "Clear ED and DON time for daily follow-up on staffing repairs.";
    if(acuity >= 8) return "Rebalance caregiver assignments before acuity swings force reactive scheduling.";
    if(Number(latest.vi_score_current ?? 100) >= 80 && Number(latest.wsi_score ?? 100) >= 80) return "Lock core caregiver assignments and watch weekend variance.";
    return "Reduce reactive schedule rebuilds by locking core caregiver assignments.";
  }

  function buildExecutiveSummary(latest){
    return {
      pattern: latest.dominant_operating_risk || latest.dominant_pattern || "Operating Stability Pattern",
      happening: pressureLanguage(latest),
      matters: mattersLanguage(latest),
      action: latest.recommended_action || nextActionLanguage(latest)
    };
  }

  function cumulativeDrag(weeks){
    return sortWeeks(weeks).reduce((sum, week) => sum + Number(week.estimated_volatility_drag || 0), 0);
  }

  function baselineGap(week){
    const viGap = 80 - Number(week.vi_score_current || 0);
    const wsiGap = 80 - Number(week.wsi_score || 0);
    return Math.max(0, Math.round((viGap + wsiGap) / 2));
  }

  function directionForWeeks(weeks){
    const sorted = sortWeeks(weeks);
    if(sorted.length < 2) return "Stable";
    const latest = sorted[sorted.length - 1];
    const previous = sorted[sorted.length - 2];
    const delta = (Number(latest.vi_score_current || 0) + Number(latest.wsi_score || 0)) -
      (Number(previous.vi_score_current || 0) + Number(previous.wsi_score || 0));
    if(delta >= 3) return "Improving";
    if(delta <= -3) return "Deteriorating";
    return "Stable";
  }

  function trendDirection(current, previous){
    if(!previous) return "→ Stable";
    const delta = (Number(current.vi_score_current || 0) + Number(current.wsi_score || 0)) -
      (Number(previous.vi_score_current || 0) + Number(previous.wsi_score || 0));
    if(delta >= 3) return "↗ Improving";
    if(delta <= -3) return "↘ Deteriorating";
    return "→ Stable";
  }

  function severityFor(latest){
    const vi = Number(latest.vi_score_current || 0);
    const wsi = Number(latest.wsi_score || 0);
    const drag = Number(latest.estimated_volatility_drag || 0);
    const agency = Number(latest.agency_shift_pct || 0);
    if(vi < 60 || wsi < 60 || drag >= 12000 || agency >= 0.16) return "Critical";
    if(vi < 70 || wsi < 70 || drag >= 8000) return "High";
    if(vi < 80 || wsi < 80 || drag >= 4000) return "Building";
    return "Controlled";
  }

  function operationalState(latest){
    const agency = Number(latest.agency_shift_pct || 0);
    const overtime = Number(latest.overtime_hours || 0);
    const bandwidth = Number(latest.leadership_bandwidth_score || 100);
    if(agency >= 0.16) return "Agency dependence embedded";
    if(overtime >= 70) return "Overtime masking workforce fragility";
    if(bandwidth <= 55) return "Leadership-constrained execution";
    if(Number(latest.vi_score_current || 0) >= 80 && Number(latest.wsi_score || 0) >= 80) return "Operational strain contained";
    return "Workforce absorption building";
  }

  function executiveInterpretation(demo, latest){
    const copy = {
      "maple-glen": "Operational strain appears contained with workforce capacity remaining stable and volatility drag held to a manageable level.",
      "cedar-ridge": "Workforce absorption is recovering, but earlier erosion shows where open shifts and overtime can compound if leadership releases focus too early.",
      "willow-creek": "Leadership disruption is creating recurring operating variability, making execution capacity the primary constraint on stabilization.",
      "river-bend": "Agency dependence has become structurally embedded in the operating model, converting coverage pressure into recurring financial drag.",
      "oak-hollow": "Recovery is visible in both workforce stability and operating pressure, but leadership should hold census pressure until core coverage stays consistent."
    };
    return copy[demo.id] || pressureLanguage(latest);
  }

  function topIntervention(demo, latest){
    if(demo.id === "river-bend") return "Replace repeat agency shifts with named weekday coverage owners";
    if(demo.id === "willow-creek") return "Reduce same-day staffing recovery work for ED and DON";
    if(demo.id === "cedar-ridge") return "Stabilize weekend med-tech and caregiver coverage";
    if(demo.id === "oak-hollow") return "Protect staffing gains before reopening census growth pressure";
    return "Lock core caregiver assignments and review call-off clusters";
  }

  function leadershipPriority(demo){
    const priorities = {
      "maple-glen": "Keep weekend coverage named and avoid unnecessary schedule churn.",
      "cedar-ridge": "Repair recurring open shifts before they convert into overtime fatigue.",
      "willow-creek": "Give regional support to daily staffing follow-through until leadership load eases.",
      "river-bend": "Set shift-level agency replacement targets with weekly accountability.",
      "oak-hollow": "Hold census growth pressure until core coverage stays consistent for several weeks."
    };
    return priorities[demo.id] || "Assign ownership for the repeat shifts creating the most weekly instability.";
  }

  function scoreClass(value){
    const score = Number(value || 0);
    if(score >= 80) return "score-good";
    if(score >= 65) return "score-amber";
    return "score-red";
  }

  function dragClass(value){
    const drag = Number(value || 0);
    if(drag >= 9000) return "drag-severe";
    if(drag >= 4000) return "drag-moderate";
    return "drag-low";
  }

  function leadershipImpact(week){
    const agency = Number(week.agency_shift_pct || 0);
    const overtime = Number(week.overtime_hours || 0);
    const bandwidth = Number(week.leadership_bandwidth_score || 100);
    if(agency >= 0.16) return "Agency dependence compounding";
    if(overtime >= 70) return "Coverage absorbing strain";
    if(bandwidth <= 55) return "Leadership execution narrowing";
    if(Number(week.vi_score_current || 0) >= 80 && Number(week.wsi_score || 0) >= 80) return "Leadership stabilization improving";
    return "Workflow pressure rising";
  }

  function keySignalInterpretation(week){
    const agency = Number(week.agency_shift_pct || 0);
    const overtime = Number(week.overtime_hours || 0);
    if(agency >= 0.16) return "External labor is no longer acting like an exception.";
    if(overtime >= 70) return "Overtime is absorbing instability before it shows up as agency.";
    if(Number(week.last_minute_calloffs || 0) >= 5) return "Short-notice disruption is weakening schedule reliability.";
    return "Weekly movement is within the current operating pattern.";
  }

  function sentenceCasePattern(value){
    const text = String(value || "Operating stability pattern").trim();
    if(!text) return "Operating stability pattern";
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  }

  function rowSeverityClass(week){
    const vi = Number(week.vi_score_current || 0);
    const wsi = Number(week.wsi_score || 0);
    const drag = Number(week.estimated_volatility_drag || 0);
    if(vi < 65 || wsi < 65 || drag >= 9000) return "row-severe";
    if(vi < 80 || wsi < 80 || drag >= 4000) return "row-building";
    return "row-stable";
  }

  function rowHighlightClass(type){
    if(type === "critical_window" || type === "recommended_action") return "is-critical";
    if(type === "escalation_window") return "is-escalation";
    if(type === "stabilization_watch") return "is-stabilization";
    if(type === "optimization_opportunity") return "is-optimization";
    return "";
  }

  function interventionTextClass(type){
    if(type === "critical_window" || type === "recommended_action") return "action-critical";
    if(type === "escalation_window") return "action-escalation";
    if(type === "stabilization_watch" || type === "optimization_opportunity") return "action-stabilization";
    return "";
  }

  function renderExecutiveIntelligenceSummary(demo, weeks){
    const sorted = sortWeeks(weeks);
    const latest = getLatestWeek(sorted);
    const summary = buildExecutiveSummary(latest);
    return `
      <section>
        <div class="section-head">
          <div>
            <h2>Executive Intelligence Summary</h2>
            <p>Demo context: ${escapeHtml(demo.community?.communityName || demo.name)}. Directional operating signal, financial drag, and leadership focus for the selected community.</p>
          </div>
        </div>
        <article class="executive-intel-card">
          <div class="exec-intel-main">
            <div class="exec-left">
              <div class="exec-interpretation-strip">
                <div>
                  <span>Pattern</span>
                  <strong>${escapeHtml(sentenceCasePattern(summary.pattern))}</strong>
                </div>
                <div>
                  <span>State</span>
                  <strong>${escapeHtml(operationalState(latest))}</strong>
                </div>
                <div>
                  <span>Direction</span>
                  <strong>${escapeHtml(directionForWeeks(sorted))}</strong>
                </div>
                <div>
                  <span>Severity</span>
                  <strong>${escapeHtml(severityFor(latest))}</strong>
                </div>
              </div>
            </div>
            <div class="exec-right">
              <div class="exec-metric">
                <span>Current weekly volatility drag</span>
                <strong>${escapeHtml(formatCurrency(latest.estimated_volatility_drag))}</strong>
              </div>
              <div class="exec-metric">
                <span>12-week cumulative volatility drag</span>
                <strong>${escapeHtml(formatCurrency(cumulativeDrag(sorted)))}</strong>
              </div>
              <div class="exec-metric">
                <span>Latest VI / WSI</span>
                <strong>${escapeHtml(latest.vi_score_current)} / ${escapeHtml(latest.wsi_score)}</strong>
              </div>
              <div class="exec-metric">
                <span>Avg Gap to Baseline</span>
                <strong>${escapeHtml(baselineGap(latest))} pts</strong>
                <em>Average distance from VI / WSI 80 target</em>
              </div>
            </div>
          </div>
          <p class="exec-interpretation">${escapeHtml(executiveInterpretation(demo, latest))}</p>
          <div class="exec-cta-grid">
            <div>
              <div class="label">Recommended operational focus</div>
              <strong>${escapeHtml(summary.action)}</strong>
            </div>
            <div>
              <div class="label">Top intervention area</div>
              <strong>${escapeHtml(topIntervention(demo, latest))}</strong>
            </div>
            <div>
              <div class="label">Suggested leadership priority</div>
              <strong>${escapeHtml(leadershipPriority(demo))}</strong>
            </div>
          </div>
          <div class="exec-booking-row">
            <a class="btn primary" href="https://calendly.com/hud-volhealth/connect" target="_blank" rel="noopener">Book a guided data review</a>
          </div>
        </article>
      </section>
    `;
  }

  function renderCards(){
    cardsEl.innerHTML = demos.map((demo, index) => `
      <button class="community-card severity-${escapeHtml(demo.severity)} ${demo.id === state.selectedId ? "active" : ""}" type="button" data-demo-id="${escapeHtml(demo.id)}" aria-pressed="${demo.id === state.selectedId}">
        <span class="eyebrow">Demo ${index + 1}</span>
        <strong>${escapeHtml(demo.name)}</strong>
        <span class="scenario-tag">${escapeHtml(demo.scenario)}</span>
      </button>
    `).join("");
  }

  function metricCard(label, value, note){
    return `
      <article class="metric-card">
        <div class="label">${escapeHtml(label)}</div>
        <div class="metric-value">${escapeHtml(value)}</div>
        <div class="metric-note">${escapeHtml(note)}</div>
      </article>
    `;
  }

  function profileCell(label, value){
    return `
      <div class="profile-cell">
        <div class="label">${escapeHtml(label)}</div>
        <div class="value">${escapeHtml(value)}</div>
      </div>
    `;
  }

  function profileGroup(title, cells){
    return `
      <article class="profile-group">
        <div class="profile-group-title">${escapeHtml(title)}</div>
        <div class="profile-group-cells">
          ${cells.join("")}
        </div>
      </article>
    `;
  }

  function summaryItem(label, copy){
    return `
      <article class="summary-item">
        <div class="label">${escapeHtml(label)}</div>
        <p>${escapeHtml(copy)}</p>
      </article>
    `;
  }

  function renderDecisionBadge(label, urgency){
    if(!label && !urgency) return "";
    const labelClass = String(label || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return `
      <span class="decision-badge-row">
        ${label ? `<span class="decision-badge intervention-badge tier-${escapeHtml(labelClass)}">${escapeHtml(label)}</span>` : ""}
        ${urgency ? `<span class="urgency-tag leverage-badge">${escapeHtml(urgency)}</span>` : ""}
      </span>
    `;
  }

  function withoutVolActionNote(week, index, total){
    const agency = Number(week.agency_shift_pct || 0);
    const overtime = Number(week.overtime_hours || 0);
    const rebuilds = Number(week.schedule_rebuild_events || 0);
    const bandwidth = Number(week.leadership_bandwidth_score || 100);
    const calloffs = Number(week.last_minute_calloffs ?? week.last_minute_calloffs_per_week ?? 0);
    const openShifts = Number(week.open_shifts ?? week.open_shifts_per_week ?? 0);
    const drag = Number(week.estimated_volatility_drag || 0);
    const phase = total > 1 ? index / (total - 1) : 0;
    const choose = (items) => items[Math.abs(index) % items.length];

    if(phase >= 0.78){
      if(agency >= 0.14) return choose([
        "Agency drag now materially affecting operating continuity.",
        "External coverage dependence now visible in the operating model.",
        "Agency reliance now part of the continuity burden."
      ]);
      if(bandwidth <= 55 || rebuilds >= 6) return choose([
        "Leadership recovery burden now visible through recurring rebuilds.",
        "Same-day staffing recovery now consuming leadership capacity.",
        "Repeated rebuilds now making leadership strain visible."
      ]);
      if(openShifts >= 8 || calloffs >= 5) return choose([
        "Staffing instability now affecting broader operational continuity.",
        "Coverage friction now visible beyond the weekly schedule.",
        "Workforce instability now complicating operating continuity."
      ]);
      return choose([
        "Stabilization complexity increasing as workforce strain compounds.",
        "Operational drift now visible as a broader stabilization problem.",
        "Continuity burden now clear after weeks of accumulated friction."
      ]);
    }

    if(phase >= 0.55){
      if(agency >= 0.10) return choose([
        "Agency use becoming operationally embedded.",
        "External coverage becoming predictable rather than exceptional.",
        "Agency dependence becoming easier to normalize."
      ]);
      if(openShifts >= 8 || overtime >= 70) return choose([
        "Workforce strain now visibly compounding.",
        "Open shifts and OT now reinforcing the same pressure pattern.",
        "Coverage strain now showing up as repeated labor absorption."
      ]);
      if(rebuilds >= 5 || bandwidth <= 60) return choose([
        "Reactive staffing cycles becoming normalized.",
        "Leadership recovery burden increasing as escalation compounds.",
        "Schedule recovery work becoming part of the operating rhythm."
      ]);
      return choose([
        "Operational strain becoming harder to separate from routine work.",
        "Recurring friction now looking like normal weekly operations.",
        "Escalation pattern becoming visible only in hindsight."
      ]);
    }

    if(phase >= 0.30){
      if(overtime >= 55) return choose([
        "OT becoming normalized before intervention timing becomes clear.",
        "Overtime absorbing strain before the escalation pattern is clear.",
        "Internal labor pressure increasing without a clear trigger point."
      ]);
      if(rebuilds >= 4 || openShifts >= 5) return choose([
        "Schedule rebuild frequency increasing across recurring coverage gaps.",
        "Recurring gaps beginning to create routine schedule repair work.",
        "Coverage gaps repeating before the pattern is elevated."
      ]);
      if(bandwidth <= 65 || calloffs >= 4) return choose([
        "Leadership attention increasingly absorbed by same-day staffing recovery.",
        "Same-day coverage recovery starting to consume leadership time.",
        "Short-notice staffing friction becoming harder to ignore."
      ]);
      return choose([
        "Coverage strain becoming operationally routine.",
        "Operating friction becoming easier to absorb than escalate.",
        "The pattern is building, but timing remains unclear."
      ]);
    }

    if(openShifts >= 4 || overtime >= 45) return choose([
      "Coverage pressure building beneath stable staffing.",
      "Staffing friction increasing beneath normal coverage appearance.",
      "Coverage strain present but not yet operationally elevated."
    ]);
    if(calloffs >= 3) return choose([
      "Staffing friction increasing beneath normal coverage appearance.",
      "Short-notice disruption present but still easy to treat as routine.",
      "Call-off friction emerging before the broader pattern is clear."
    ]);
    if(rebuilds >= 2 || drag >= 2500) return choose([
      "Minor schedule instability emerging beneath routine operations.",
      "Low-grade variability present but not yet elevated operationally.",
      "Small operating friction visible but not yet prioritized."
    ]);
    return choose([
      "Low-grade variability present but not yet elevated operationally.",
      "Signals present, but still easy to interpret as normal variation.",
      "Minor operating movement visible without clear escalation timing."
    ]);
  }

  function withVolOptimizationNote(week){
    const agency = Number(week.agency_shift_pct || 0);
    const overtime = Number(week.overtime_hours || 0);
    const calloffs = Number(week.last_minute_calloffs ?? week.last_minute_calloffs_per_week ?? 0);
    const openShifts = Number(week.open_shifts ?? week.open_shifts_per_week ?? 0);
    if(agency >= 0.08) return "Coordinate recurring external coverage.";
    if(overtime >= 55) return "Contain repeat overtime absorption.";
    if(calloffs >= 3 || openShifts >= 3) return "Review repeat coverage friction.";
    return "Preserve current staffing consistency.";
  }

  function renderDecisionDetails(week, index, total){
    if(week.replay_mode === "without"){
      return `<div class="decision-row-details calm"><p>${escapeHtml(withoutVolActionNote(week, index, total))}</p></div>`;
    }
    if(!week.recommended_action && !week.consequence_statement && !week.likely_effect && !week.watch_metric){
      return `<div class="decision-row-details calm"><p>${escapeHtml(withVolOptimizationNote(week))}</p></div>`;
    }
    return `
      <div class="decision-row-details">
        ${week.recommended_action ? `<p><b>Action</b> ${escapeHtml(week.recommended_action)}</p>` : ""}
        ${week.likely_effect ? `<p><b>Effect</b> ${escapeHtml(week.likely_effect)}</p>` : ""}
      </div>
    `;
  }

  function annotateModeledDrag(weeks, model, mode){
    const sorted = sortWeeks(weeks);
    if(mode !== "with" || !model){
      return sorted.map((week) => ({
        ...week,
        observed_drag: Number(week.estimated_volatility_drag || 0),
        modeled_with_vol_drag: null,
        modeled_drag_delta: 0
      }));
    }

    const interventionWeek = Number(model.projected_effects?.intervention_week || sorted[0]?.week || 1);
    const postDrag = sorted.reduce((sum, week) => {
      const weekNumber = Number(week.week || 0);
      return weekNumber >= interventionWeek ? sum + Number(week.estimated_volatility_drag || 0) : sum;
    }, 0);
    const modeledMidpoint = (Number(model.projected_drag_low || 0) + Number(model.projected_drag_high || 0)) / 2;
    const projectedReduction = Math.max(0, Number(model.actual_drag || 0) - modeledMidpoint);
    const reductionFactor = postDrag > 0 ? Math.min(0.45, projectedReduction / postDrag) : 0;

    return sorted.map((week) => {
      const observed = Number(week.estimated_volatility_drag || 0);
      const applies = Number(week.week || 0) >= interventionWeek;
      const modeled = applies ? Math.max(0, Math.round(observed * (1 - reductionFactor))) : observed;
      return {
        ...week,
        observed_drag: observed,
        modeled_with_vol_drag: modeled,
        modeled_drag_delta: Math.max(0, observed - modeled)
      };
    });
  }

  function renderFinancialDragCell(week){
    const observed = Number(week.observed_drag ?? week.estimated_volatility_drag ?? 0);
    if(week.replay_mode !== "with" || week.modeled_with_vol_drag === null || week.modeled_with_vol_drag === undefined){
      return `<span class="${dragClass(observed)}">${escapeHtml(formatCurrency(observed))}</span>`;
    }

    const modeled = Number(week.modeled_with_vol_drag || 0);
    const delta = Number(week.modeled_drag_delta || 0);
    const deltaClass = week.row_highlight_type ? "modeled-delta emphasized" : "modeled-delta";
    return `
      <div class="drag-stack">
        <span><b>Observed</b> <strong class="${dragClass(observed)}">${escapeHtml(formatCurrency(observed))}</strong></span>
        <span><b>With VOL</b> <strong>${escapeHtml(formatCurrency(modeled))}</strong></span>
        <em class="${escapeHtml(deltaClass)}">&darr; ${escapeHtml(formatCurrency(delta))}</em>
      </div>
    `;
  }

  function renderTrendRows(weeks){
    const sorted = sortWeeks(weeks);
    const latestWeek = sorted[sorted.length - 1]?.week;
    return sorted.map((week, index) => {
      const previous = sorted[index - 1];
      const pattern = week.dominant_operating_risk || week.dominant_pattern;
      const patternShift = week.pattern_shift_detected ||
        (previous && (previous.dominant_operating_risk || previous.dominant_pattern) !== pattern);
      const highlightClass = rowHighlightClass(week.row_highlight_type);
      const actionTextClass = interventionTextClass(week.row_highlight_type);
      const rowClass = [
        "trend-row",
        week.week === latestWeek ? "latest-row" : "",
        highlightClass || (week.replay_mode !== "with" ? rowSeverityClass(week) : "row-calm")
      ].filter(Boolean).join(" ");
      return `
      <tr class="${escapeHtml(rowClass)}">
        <td class="week-cell">
          <strong>Week ${escapeHtml(week.week)}</strong>
          <span>${escapeHtml(formatDate(week.week_start))}</span>
        </td>
        <td class="score-cluster">
          <span><b>VI</b><i class="score-pill ${scoreClass(week.vi_score_current)}">${escapeHtml(week.vi_score_current)}</i></span>
          <span><b>WSI</b><i class="score-pill ${scoreClass(week.wsi_score)}">${escapeHtml(week.wsi_score)}</i></span>
        </td>
        <td class="pattern-cell" tabindex="0">
          ${renderDecisionBadge(week.decision_marker, week.intervention_urgency)}
          <strong class="${escapeHtml(actionTextClass)}">${escapeHtml(week.trend_statement || week.vol_read || sentenceCasePattern(pattern))}</strong>
          ${!week.decision_marker ? `<span class="pattern-direction">${escapeHtml(week.trend_direction || trendDirection(week, previous))}</span>` : ""}
          ${patternShift && week.decision_marker ? `<span class="pattern-shift">Pattern shift</span>` : ""}
          ${week.decision_marker ? `
            <div class="row-intel-popover">
              <strong>${escapeHtml(week.recommended_action || nextActionLanguage(week))}</strong>
              ${week.consequence_statement ? `<p>${escapeHtml(week.consequence_statement)}</p>` : ""}
              ${week.likely_effect ? `<p><b>Effect:</b> ${escapeHtml(week.likely_effect)}</p>` : ""}
              ${week.watch_metric ? `<p><b>Metric:</b> ${escapeHtml(week.watch_metric)}</p>` : ""}
            </div>
          ` : ""}
        </td>
        <td class="vol-read-cell">
          ${renderDecisionDetails(week, index, sorted.length)}
        </td>
        <td class="coverage-cell">
          <div class="coverage-labels" aria-hidden="true">
            <span>Open</span>
            <span>CO</span>
            <span>OT</span>
            <span>Agency</span>
          </div>
          <div class="coverage-values">
            <span>${escapeHtml(week.open_shifts ?? week.open_shifts_per_week)}</span>
            <span>${escapeHtml(week.last_minute_calloffs ?? week.last_minute_calloffs_per_week ?? "n/a")}</span>
            <span>${escapeHtml(week.overtime_hours)}</span>
            <span>${escapeHtml(formatPercent(week.agency_shift_pct))}</span>
          </div>
        </td>
        <td class="drag-cell">${renderFinancialDragCell(week)}</td>
      </tr>
    `}).join("");
  }

  function pressureScore(week){
    const viGap = 90 - Number(week.vi_score_current || 0);
    const wsiGap = 90 - Number(week.wsi_score || 0);
    const drag = Math.min(12, Number(week.estimated_volatility_drag || 0) / 1400);
    return viGap + wsiGap + drag;
  }

  function interpretationFor(demo){
    const interpretations = {
      "maple-glen": "Stable operating rhythm with workforce capacity holding above baseline.",
      "cedar-ridge": "Workforce strain emerged mid-period, then began to recover.",
      "willow-creek": "Leadership disruption produced recurring instability week to week.",
      "river-bend": "Sustained decline signals structural agency and cost pressure.",
      "oak-hollow": "Recovery is moving the community back toward baseline stability."
    };
    return interpretations[demo.id] || "Operating stability movement is visible across VI and WSI.";
  }

  function trendDisplayWeeks(weeks, demo){
    const patterns = {
      "maple-glen": {
        vi: [82, 83, 83, 82, 81, 82, 81, 82, 82, 83, 84, 84],
        wsi: [84, 84, 85, 84, 83, 82, 81, 82, 83, 84, 84, 85]
      },
      "cedar-ridge": {
        vi: [78, 76, 73, 70, 67, 64, 62, 63, 65, 67, 69, 71],
        wsi: [77, 74, 71, 67, 63, 60, 58, 59, 61, 64, 66, 68]
      },
      "willow-creek": {
        vi: [74, 66, 72, 61, 69, 58, 67, 60, 66, 57, 64, 61],
        wsi: [72, 64, 69, 58, 65, 55, 63, 57, 61, 54, 60, 57]
      },
      "river-bend": {
        vi: [66, 63, 60, 57, 55, 53, 51, 50, 49, 48, 47, 46],
        wsi: [64, 61, 58, 55, 53, 51, 49, 48, 47, 46, 45, 44]
      },
      "oak-hollow": {
        vi: [58, 60, 62, 64, 67, 69, 71, 73, 75, 77, 79, 81],
        wsi: [56, 58, 60, 62, 65, 67, 70, 72, 74, 76, 78, 80]
      }
    };
    const pattern = patterns[demo.id];
    if(!pattern) return weeks;

    return weeks.map((week, index) => {
      const viTarget = pattern.vi[index] ?? week.vi_score_current;
      const wsiTarget = pattern.wsi[index] ?? week.wsi_score;
      return {
        ...week,
        vi_score_current: Math.round((Number(week.vi_score_current) * 0.35) + (viTarget * 0.65)),
        wsi_score: Math.round((Number(week.wsi_score) * 0.35) + (wsiTarget * 0.65))
      };
    });
  }

  function renderOperatingFingerprint(weeks, demo){
    const sourceWeeks = sortWeeks(weeks).filter((week) => (
      Number.isFinite(Number(week.wsi_score)) && Number.isFinite(Number(week.vi_score_current))
    ));

    if(!sourceWeeks.length){
      return `<div class="loading-state">Operating trend data is not available for this community.</div>`;
    }

    const sorted = trendDisplayWeeks(sourceWeeks, demo);
    const pressure = sorted.reduce((worst, week) => (
      pressureScore(week) > pressureScore(worst) ? week : worst
    ), sorted[0]);
    const latest = sorted[sorted.length - 1];
    const width = 1120;
    const height = 224;
    const chart = { left: 40, right: 1092, top: 22, bottom: 164 };
    const minScore = 40;
    const maxScore = 90;
    const scoreToX = (week) => {
      const weekNumber = Math.max(1, Math.min(12, Number(week.week) || 1));
      return chart.left + ((weekNumber - 1) / 11) * (chart.right - chart.left);
    };
    const scoreToY = (score) => {
      const safeScore = Math.max(minScore, Math.min(maxScore, Number(score) || minScore));
      return chart.bottom - ((safeScore - minScore) / (maxScore - minScore)) * (chart.bottom - chart.top);
    };
    const linePath = (field) => sorted.map((week, index) => {
      const command = index === 0 ? "M" : "L";
      return `${command} ${scoreToX(week).toFixed(1)} ${scoreToY(week[field]).toFixed(1)}`;
    }).join(" ");
    const baselineY = scoreToY(80);
    const stabilizedY = scoreToY(85);
    const pressureX = scoreToX(pressure);
    const pressureY = scoreToY(Math.min(Number(pressure.vi_score_current), Number(pressure.wsi_score)));
    const latestX = scoreToX(latest);
    const latestVIY = scoreToY(latest.vi_score_current);
    const latestWSIY = scoreToY(latest.wsi_score);

    return `
      <div class="fingerprint-chart-shell">
        <svg class="fingerprint-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Operating fingerprint trend showing VI current and WSI current across weeks 1 through 12.">
          <defs>
            <linearGradient id="stabilizedZone" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#35c67a" stop-opacity="0.18"/>
              <stop offset="100%" stop-color="#35c67a" stop-opacity="0.04"/>
            </linearGradient>
          </defs>

          <rect x="0" y="0" width="${width}" height="${height}" rx="18" fill="#0d1224" stroke="rgba(255,255,255,0.10)"/>
          <rect x="${chart.left}" y="${chart.top}" width="${chart.right - chart.left}" height="${stabilizedY - chart.top}" fill="url(#stabilizedZone)"/>

          <line x1="${chart.left}" y1="${baselineY}" x2="${chart.right}" y2="${baselineY}" stroke="rgba(255,255,255,0.45)" stroke-width="1.6" stroke-dasharray="7 8"/>

          <path class="fingerprint-line vi-line" d="${linePath("vi_score_current")}"/>
          <path class="fingerprint-line wsi-line" d="${linePath("wsi_score")}"/>

          <line x1="${pressureX}" y1="${chart.top}" x2="${pressureX}" y2="${chart.bottom}" class="pressure-marker"/>
          <circle cx="${pressureX.toFixed(1)}" cy="${pressureY.toFixed(1)}" r="5" class="pressure-dot"/>
          <text x="${Math.min(chart.right - 132, pressureX + 10)}" y="${Math.max(chart.top + 20, pressureY - 12)}" class="pressure-label">Pressure point</text>

          <circle cx="${latestX.toFixed(1)}" cy="${latestVIY.toFixed(1)}" r="6.5" fill="#35c67a" stroke="#ffffff" stroke-width="1.8"/>
          <circle cx="${latestX.toFixed(1)}" cy="${latestWSIY.toFixed(1)}" r="6.5" fill="#2c6cff" stroke="#ffffff" stroke-width="1.8"/>

          <g class="fingerprint-axis">
            <line x1="${chart.left}" y1="${chart.bottom}" x2="${chart.right}" y2="${chart.bottom}"/>
            <line x1="${chart.left}" y1="${chart.top}" x2="${chart.left}" y2="${chart.bottom}"/>
          </g>

          <g class="fingerprint-ticks">
            <text x="16" y="${scoreToY(90) + 4}">90</text>
            <text x="16" y="${baselineY + 4}">80</text>
            <text x="16" y="${scoreToY(70) + 4}">70</text>
            <text x="16" y="${scoreToY(60) + 4}">60</text>
            <text x="16" y="${scoreToY(50) + 4}">50</text>
            <text x="16" y="${chart.bottom + 4}">40</text>
            ${sorted.map((week) => `
              <text x="${scoreToX(week).toFixed(1)}" y="${chart.bottom + 28}" text-anchor="middle">${escapeHtml(week.week)}</text>
            `).join("")}
          </g>

          <text x="${width / 2}" y="${height - 8}" class="fingerprint-axis-label" text-anchor="middle">Weeks 1-12</text>
          <text x="18" y="116" class="fingerprint-axis-label" transform="rotate(-90 18 116)" text-anchor="middle">Stability score</text>
        </svg>

        <div class="fingerprint-legend">
          <span><i class="legend-vi"></i> VI current</span>
          <span><i class="legend-wsi"></i> WSI current</span>
          <span><i class="legend-baseline"></i> Baseline 80</span>
        </div>
        <p class="fingerprint-interpretation">${escapeHtml(interpretationFor(demo))}</p>
      </div>
    `;
  }

  function intelligenceEventsFor(demo){
    const events = {
      "maple-glen": [
        {
          week: 3,
          signal: "Low volatility held despite mild acuity movement",
          interpretation: "Schedule routines were absorbing normal demand variation without creating downstream labor pressure.",
          mattered: "The community was stable, but VOL still watched for small shifts that can be hidden inside otherwise healthy metrics.",
          action: "Keep core caregiver assignments locked and review weekend coverage variance.",
          outcome: "Stability remained above baseline and leadership load stayed contained."
        },
        {
          week: 7,
          signal: "Overtime rose while agency stayed contained",
          interpretation: "Internal coverage absorbed a short-term staffing fluctuation before it became structural agency dependence.",
          mattered: "This protected labor economics while preserving caregiver assignment continuity.",
          action: "Review repeat open shifts and confirm whether the same roles were carrying the extra hours.",
          outcome: "The pattern normalized without turning into a broader workforce absorption problem."
        }
      ],
      "cedar-ridge": [
        {
          week: 4,
          signal: "Open shifts and overtime began rising together",
          interpretation: "Workforce absorption was weakening before the operating score fully deteriorated.",
          mattered: "The early signal showed staffing strain was becoming a system pattern, not a single difficult week.",
          action: "Prioritize recurring open shifts by role and protect the highest-fragility shifts first.",
          outcome: "Leadership could intervene before the erosion became permanent instability."
        },
        {
          week: 7,
          signal: "WSI reached its lowest point while VI remained under pressure",
          interpretation: "The workforce was no longer absorbing operating volatility at the prior rate.",
          mattered: "Without action, coverage gaps would likely convert into overtime fatigue or agency dependency.",
          action: "Reset the recruiting focus around schedule-critical roles and reduce nonessential shift churn.",
          outcome: "The trend began stabilizing in the following weeks."
        },
        {
          week: 11,
          signal: "Workforce score improved while volatility remained elevated",
          interpretation: "The operating system was recovering, but not yet back to baseline resilience.",
          mattered: "Leadership needed to keep pressure on the root cause instead of declaring recovery too early.",
          action: "Continue targeted coverage repair until WSI and VI move together.",
          outcome: "The community moved from erosion toward controlled stabilization."
        }
      ],
      "willow-creek": [
        {
          week: 2,
          signal: "Sharp week-to-week score movement appeared early",
          interpretation: "Instability was oscillating rather than following a clean decline or recovery path.",
          mattered: "Jagged movement often indicates leadership-constrained execution, not just staffing volume.",
          action: "Separate operational follow-through issues from pure coverage shortages.",
          outcome: "The leadership drag pattern became visible before it was buried in weekly noise."
        },
        {
          week: 6,
          signal: "Leadership load and workflow disruption compressed together",
          interpretation: "Execution capacity was becoming the bottleneck for stabilization.",
          mattered: "Even correct staffing actions can fail when leaders lack bandwidth to sustain them.",
          action: "Remove low-value administrative load and assign single-owner follow-up for schedule repairs.",
          outcome: "The next actions became more targeted around leadership capacity, not just staffing counts."
        },
        {
          week: 10,
          signal: "Recurring instability returned after temporary improvement",
          interpretation: "The community was experiencing relapse risk because the underlying execution pattern was still open.",
          mattered: "This prevented leadership from mistaking a short improvement for true stabilization.",
          action: "Assign one owner for open staffing escalations before adding new initiatives.",
          outcome: "The pattern was reframed as recurring operational instability requiring disciplined execution support."
        }
      ],
      "river-bend": [
        {
          week: 3,
          signal: "Agency percentage and overtime pressure rose in parallel",
          interpretation: "External labor was beginning to become part of the operating model rather than an exception.",
          mattered: "Agency use can preserve coverage while quietly creating structural financial drag.",
          action: "Identify repeat agency-covered shifts and assign internal replacement targets.",
          outcome: "Leadership could see the cost pattern before it was normalized as unavoidable."
        },
        {
          week: 6,
          signal: "Estimated volatility drag crossed a sustained high-pressure level",
          interpretation: "Instability was no longer only operational; it had become an economic signal.",
          mattered: "This changed the decision from staffing cleanup to executive labor model intervention.",
          action: "Set an agency reduction path tied to priority shifts, not broad hiring goals.",
          outcome: "The operating conversation shifted from weekly coverage to structural cost recovery."
        },
        {
          week: 10,
          signal: "Scores remained low despite continued coverage",
          interpretation: "Coverage was being maintained, but the system was not becoming more stable.",
          mattered: "This showed that filling shifts alone was not restoring resilience.",
          action: "Rebuild core coverage on the most fragile shifts and reduce dependency before adding new demand.",
          outcome: "VOL identified sustained instability that required executive action, not routine schedule management."
        }
      ],
      "oak-hollow": [
        {
          week: 3,
          signal: "Early recovery appeared in WSI before full operating stability returned",
          interpretation: "Workforce capacity was improving ahead of the broader VI signal.",
          mattered: "This suggested recovery was real, but still fragile.",
          action: "Protect the staffing improvements and avoid adding new workflow burden too soon.",
          outcome: "The recovery path continued instead of being disrupted by premature change."
        },
        {
          week: 7,
          signal: "VI and WSI began moving upward together",
          interpretation: "The community was transitioning from isolated improvement to system stabilization.",
          mattered: "When both signals move together, leadership can shift from emergency response to operating discipline.",
          action: "Keep the repaired caregiver assignments in place and close repeat call-off clusters.",
          outcome: "The trend moved steadily toward baseline."
        },
        {
          week: 12,
          signal: "Latest week approached baseline stability",
          interpretation: "Recovery had become visible as an operating pattern, not a one-week rebound.",
          mattered: "Leadership could now focus on sustaining the gains rather than chasing urgent symptoms.",
          action: "Hold weekly coverage review and avoid reopening census growth pressure too quickly.",
          outcome: "The community showed a credible stabilization trajectory."
        }
      ]
    };

    return events[demo.id] || [];
  }

  function renderIntelligenceTimeline(demo){
    const events = intelligenceEventsFor(demo);
    if(!events.length){
      return `<div class="loading-state">Operational intelligence events are not available for this community.</div>`;
    }

    return `
      <div class="intelligence-panel">
        <div class="intelligence-flow" aria-hidden="true">
          <span>Signal detected</span>
          <span>Why it mattered</span>
          <span>Decision</span>
          <span>Outcome</span>
        </div>
        <div class="timeline-list">
          ${events.map((event, index) => `
            <details class="timeline-event" ${index === 0 ? "open" : ""}>
              <summary>
                <span class="timeline-week">Week ${escapeHtml(event.week)}</span>
                <span class="timeline-signal">${escapeHtml(event.signal)}</span>
                <span class="timeline-toggle">View intelligence</span>
              </summary>
              <div class="timeline-body">
                <div class="intel-cell">
                  <div class="label">Why it mattered</div>
                  <p>${escapeHtml(event.mattered)}</p>
                </div>
                <div class="intel-cell">
                  <div class="label">Recommended leadership action</div>
                  <p>${escapeHtml(event.action)}</p>
                </div>
                <div class="intel-cell">
                  <div class="label">Subsequent operational outcome</div>
                  <p>${escapeHtml(event.outcome)}</p>
                </div>
              </div>
            </details>
          `).join("")}
        </div>
      </div>
    `;
  }

  function renderReplayModeToggle(activeMode){
    const modes = [
      { id: "without", label: "Without VOL" },
      { id: "with", label: "With VOL" }
    ];
    return `
      <div class="decision-toggle" role="group" aria-label="Decision Replay mode">
        ${modes.map((mode) => `
          <button
            type="button"
            class="decision-toggle-btn ${activeMode === mode.id ? "active" : ""}"
            data-replay-mode="${escapeHtml(mode.id)}"
            aria-pressed="${activeMode === mode.id}"
          >${escapeHtml(mode.label)}</button>
        `).join("")}
      </div>
    `;
  }

  function renderInterventionWindow(window, index){
    return `
      <article class="decision-window">
        <div class="decision-window-head">
          <span>Week ${escapeHtml(window.week)}</span>
          <strong>${escapeHtml(window.label)}</strong>
        </div>
        <div class="decision-window-grid">
          <div>
            <div class="label">Signal</div>
            <p>${escapeHtml(window.signal_detected)}</p>
          </div>
          <div>
            <div class="label">Action</div>
            <p>${escapeHtml(window.recommended_action)}</p>
          </div>
          <div>
            <div class="label">Projected effect</div>
            <p>${escapeHtml(window.likely_effect)}</p>
          </div>
        </div>
      </article>
    `;
  }

  function projectedDragReduction(model){
    const reductionLow = Math.max(0, model.actual_drag - model.projected_drag_high);
    const reductionHigh = Math.max(reductionLow, model.actual_drag - model.projected_drag_low);
    return { reductionLow, reductionHigh };
  }

  function renderTrendSummary(replay, model){
    const reduction = projectedDragReduction(model);
    if(replay.mode !== "with"){
      return `
        <div class="drag-summary">
          <div class="drag-summary-item">
            <span>12-Week Volatility Drag</span>
            <strong>${escapeHtml(formatCurrency(model.actual_drag))}</strong>
            <em>Observed cumulative drag from instability signals.</em>
          </div>
        </div>
      `;
    }

    return `
      <div class="drag-summary drag-summary-modeled">
        <div class="drag-summary-item">
          <span>Observed Drag</span>
          <strong>${escapeHtml(formatCurrency(model.actual_drag))}</strong>
          <em>Actual 12-week volatility drag.</em>
        </div>
        <div class="drag-summary-item">
          <span>Modeled With VOL</span>
          <strong>${escapeHtml(formatCurrency(model.projected_drag_low))}-${escapeHtml(formatCurrency(model.projected_drag_high))}</strong>
          <em>Likely stabilized drag range.</em>
        </div>
        <div class="drag-summary-item">
          <span>Projected Reduction</span>
          <strong>${escapeHtml(formatCurrency(reduction.reductionLow))}-${escapeHtml(formatCurrency(reduction.reductionHigh))}</strong>
          <em>Estimated reduction from earlier intervention timing.</em>
        </div>
      </div>
    `;
  }

  function renderDecisionReplay(replay, model){
    const windows = replay.intervention_windows || [];
    const windowCountClass = `window-count-${Math.min(Math.max(windows.length, 1), 4)}`;
    const reduction = projectedDragReduction(model);
    const stabilized = model.projected_effects?.stabilized_path || {};
    const isWithVol = replay.mode === "with";
    return `
      <section>
        <div class="section-head decision-section-head">
          <div>
            <h2>Decision Replay</h2>
            <p>Same building. Different visibility. Different intervention timing. Different projected stabilization path.</p>
          </div>
          ${renderReplayModeToggle(replay.mode)}
        </div>
        <div class="panel decision-replay-panel mode-${escapeHtml(replay.mode)}">
          <div class="decision-summary">
            <div>
              <span>${replay.mode === "with" ? "With VOL" : "Without VOL"}</span>
              <p>${escapeHtml(replay.summary)}</p>
            </div>
            <div class="decision-drag">
              <span>${isWithVol ? "Modeled stabilized path" : "Observed cumulative drag"}</span>
              <strong class="${isWithVol ? "modeled-stabilized-path-value" : ""}">${isWithVol
                ? `${escapeHtml(formatCurrency(model.projected_drag_low))}-<wbr>${escapeHtml(formatCurrency(model.projected_drag_high))}`
                : escapeHtml(formatCurrency(model.actual_drag))}</strong>
              ${isWithVol ? `<em>Likely stabilized drag range with earlier intervention timing.</em>` : ""}
            </div>
          </div>
          <div class="decision-timing-chain" aria-label="Decision timing comparison">
            <div>
              <span>Same building</span>
              <strong>Observed operating pattern</strong>
            </div>
            <div class="${replay.mode === "without" ? "active" : ""}">
              <span>Without VOL</span>
              <strong>Fragmented signals; timing lagged</strong>
            </div>
            <div class="${replay.mode === "with" ? "active" : ""}">
              <span>With VOL</span>
              <strong>Earlier visibility; intervention timing improved</strong>
            </div>
            <div class="${replay.mode === "with" ? "active" : ""}">
              <span>Projected path</span>
              <strong>${replay.mode === "with" ? "Lower modeled drag range" : "Drag compounds before action"}</strong>
            </div>
          </div>
          ${replay.mode === "with" ? `
            <div class="decision-value-grid secondary-value-grid">
              <div class="decision-value-card">
                <span>Projected drag reduction</span>
                <strong>${escapeHtml(formatCurrency(reduction.reductionLow))}-${escapeHtml(formatCurrency(reduction.reductionHigh))}</strong>
                <em>${escapeHtml(model.projected_reduction_pct_low)}-${escapeHtml(model.projected_reduction_pct_high)}% modeled reduction. Reduced compounding OT, agency, and leadership recovery burden.</em>
              </div>
              <div class="decision-value-card continuity">
                <span>Projected stabilization effect</span>
                <strong>Continuity preserved earlier.</strong>
                <em>${escapeHtml(stabilized.projected_stabilization_effect || "Earlier intervention likely preserved staffing consistency, reduced reactive recovery work, and protected leadership capacity.")}</em>
              </div>
            </div>
            <div class="decision-preservation-note">
              <strong>Stability preservation before drift compounds</strong>
              <p>VOL supports operational stabilization intelligence for stable, recovering, or drifting buildings. The work is earlier recognition, clearer ownership, and fewer reactive recovery cycles.</p>
            </div>
          ` : `
            <div class="decision-without-note">
              <strong>Timing implication</strong>
              <p>Signals remained fragmented and intervention timing likely lagged until pressure became visible through OT, agency use, or leadership load.</p>
            </div>
          `}
          ${replay.mode === "with" ? `
            <div class="decision-window-list ${escapeHtml(windowCountClass)}">
              ${windows.map(renderInterventionWindow).join("")}
            </div>
          ` : `
            <div class="decision-without-note">
              <strong>What leadership likely sees first</strong>
              <p>Weekly metrics are available, but the cross-signal pattern is not elevated until strain is already visible through labor cost, agency dependence, or repeated leadership workflow disruption.</p>
            </div>
          `}
        </div>
      </section>
    `;
  }

  function renderEffectItem(label, value){
    return `
      <div class="path-effect-item">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value || "n/a")}</strong>
      </div>
    `;
  }

  function interventionTypeFor(window){
    const text = `${window?.type || ""} ${window?.recommended_action || ""} ${window?.label || ""}`.toLowerCase();
    if(text.includes("agency") || text.includes("prn")) return "PRN block replacement";
    if(text.includes("owner") || text.includes("ed/don") || text.includes("leadership")) return "Leadership recovery ownership";
    if(text.includes("flex")) return "Temporary flex coverage";
    if(text.includes("caregiver") || text.includes("weekend")) return "Weekend caregiver stabilization";
    if(text.includes("critical")) return "PRN block replacement";
    return "Targeted stabilization action";
  }

  function renderProjectedStabilizedPath(model){
    const actual = model.projected_effects?.actual_path || {};
    const stabilized = model.projected_effects?.stabilized_path || {};
    const interventionWeek = model.projected_effects?.intervention_week || "n/a";
    const interventionType = model.projected_effects?.intervention_type || "Targeted stabilization action";
    const reduction = projectedDragReduction(model);
    const continuityEffects = stabilized.continuity_effects || [];
    return `
      <section>
        <div class="section-head">
          <div>
            <h2>Modeled Stabilized Path</h2>
            <p>Modeled stabilization path if earlier action occurred during the escalation window.</p>
          </div>
        </div>
        <div class="panel stabilized-path-panel">
          <div class="stabilized-path-grid">
            <article class="path-column actual-path">
              <div class="path-column-head">
                <span>Actual Path</span>
                <strong>${escapeHtml(formatCurrency(model.actual_drag))}</strong>
                <em>Cumulative volatility drag</em>
              </div>
              <div class="path-effect-list">
                ${renderEffectItem("OT trend", actual.ot_trend)}
                ${renderEffectItem("Agency trend", actual.agency_trend)}
                ${renderEffectItem("Leadership load", actual.leadership_pressure)}
                ${renderEffectItem("Workforce strain progression", actual.workforce_strain_progression)}
              </div>
              <p class="path-note">Escalation windows were identified only after operational strain became visible through OT and agency growth.</p>
            </article>

            <article class="path-column projected-path">
              <div class="path-column-head">
                <span>Modeled Stabilized Path</span>
                <strong>${escapeHtml(formatCurrency(model.projected_drag_low))}-${escapeHtml(formatCurrency(model.projected_drag_high))}</strong>
                <em>Likely stabilized drag range with earlier intervention timing.</em>
              </div>
              <div class="projected-reduction-callout">
                <span>Projected drag reduction</span>
                <strong>${escapeHtml(formatCurrency(reduction.reductionLow))}-${escapeHtml(formatCurrency(reduction.reductionHigh))}</strong>
                <em>${escapeHtml(model.projected_reduction_pct_low)}-${escapeHtml(model.projected_reduction_pct_high)}% modeled reduction. Reduced compounding OT, agency, and leadership recovery burden.</em>
              </div>
              <div class="projected-stabilization-callout">
                <span>Projected stabilization effect</span>
                <strong>Continuity preserved before drift compounded.</strong>
                <em>${escapeHtml(stabilized.projected_stabilization_effect || "Earlier intervention likely preserved staffing consistency, reduced reactive recovery work, and protected leadership capacity.")}</em>
              </div>
              <div class="path-effect-list">
                ${renderEffectItem("Intervention type", interventionType)}
                ${renderEffectItem("Projected OT reduction", stabilized.projected_ot_reduction)}
                ${renderEffectItem("Projected agency reduction", stabilized.projected_agency_reduction)}
                ${renderEffectItem("Projected rebuild reduction", stabilized.projected_rebuild_reduction)}
                ${renderEffectItem("Stabilization trajectory", stabilized.projected_stabilization_trajectory)}
                ${renderEffectItem("Leadership relief", stabilized.projected_leadership_relief)}
              </div>
              <div class="continuity-effect-list">
                <span>Operational continuity implications</span>
                ${continuityEffects.map((effect) => `<p>${escapeHtml(effect)}</p>`).join("")}
              </div>
              <p class="path-note">${escapeHtml(stabilized.stability_preservation_effect || "Earlier stabilization actions likely would have reduced cumulative volatility drag, slowed workforce strain acceleration, and preserved operational continuity before drift compounded.")}</p>
            </article>
          </div>
          <div class="model-assumptions">
            <span>Model assumptions</span>
            ${model.assumptions.map((assumption) => `<p>${escapeHtml(assumption)}</p>`).join("")}
          </div>
        </div>
      </section>
    `;
  }

  function renderSupportingOperatingContext(demo, profile, latest){
    const leadershipContext = profile.leadership_context || latest.leadership_context || "n/a";
    const bottleneck = profile.primary_operational_bottleneck || latest.dominant_pattern || "n/a";
    return `
      <section>
        <div class="section-head">
          <div>
            <h2>Supporting Operating Context</h2>
            <p>Community profile and operating conditions grounding the case reconstruction.</p>
          </div>
        </div>
        <div class="panel operating-context-panel">
          <div class="profile-grid">
            ${profileGroup("Operating Story", [
              profileCell("Scenario", profile.scenario_label || demo.scenario),
              profileCell("Leadership context", leadershipContext)
            ])}
            ${profileGroup("Scale", [
              profileCell("Licensed units", formatNumber(profile.licensed_units)),
              profileCell("Starting census", formatNumber(profile.starting_occupied_residents))
            ])}
            ${profileGroup("Environment", [
              profileCell("Market", profile.market || "Synthetic market"),
              profileCell("Ownership", profile.ownership_style || "Synthetic operator")
            ])}
            ${profileGroup("Structural Constraint", [
              profileCell("Community type", profile.community_type || "Assisted Living"),
              profileCell("Bottleneck", bottleneck)
            ])}
          </div>
        </div>
      </section>
    `;
  }

  function renderRawSupportingMetrics(latest){
    return `
      <section>
        <div class="section-head">
          <div>
            <h2>Raw Supporting Metrics</h2>
            <p>Validation details from the latest normalized weekly signal row.</p>
          </div>
        </div>
        <div class="metric-grid">
          ${metricCard("Open shifts", formatNumber(latest.open_shifts ?? latest.open_shifts_per_week), "Uncovered weekly schedule demand")}
          ${metricCard("Call-offs", formatNumber(latest.last_minute_calloffs ?? latest.last_minute_calloffs_per_week), "Short-notice coverage disruption")}
          ${metricCard("Overtime hours", formatNumber(latest.overtime_hours), "Internal labor absorption pressure")}
          ${metricCard("Agency %", formatPercent(latest.agency_shift_pct), "External coverage dependency")}
          ${metricCard("Total labor cost", formatCurrency(latest.total_labor_cost), "Regular, overtime, agency, and recruiting cost")}
          ${metricCard("Estimated volatility drag", formatCurrency(latest.estimated_volatility_drag), "Modeled weekly economic drag from instability")}
          ${metricCard("Leadership Load", formatNumber(latest.leadership_bandwidth_score), "Modeled operational recovery burden")}
          ${metricCard("Acuity variability", formatNumber(latest.acuity_variability), "Care-demand variation signal")}
        </div>
      </section>
    `;
  }

  function renderDemo(demo, payload){
    const normalized = payload.normalized || {};
    const profile = normalized.community_profile || {};
    const weeks = buildWeeklyIntelligence(normalized.weekly_operational_signals || []);
    const replay = buildDecisionReplay(weeks, state.replayMode);
    const interventionWindow = replay.intervention_windows?.[0] || {};
    const stabilizedModel = projectStabilizedPath({
      weeklySignals: weeks,
      interventionWeek: interventionWindow.week || 1,
      interventionType: interventionTypeFor(interventionWindow)
    });
    const replayWeeks = annotateModeledDrag(replay.enriched_rows || weeks, stabilizedModel, state.replayMode);
    const latest = getLatestWeek(weeks);

    outputEl.innerHTML = `
      ${renderExecutiveIntelligenceSummary(demo, weeks)}

      ${renderSupportingOperatingContext(demo, profile, latest)}

      ${renderDecisionReplay(replay, stabilizedModel)}

      <section>
        <div class="section-head">
          <div>
            <h2>Weekly Trend Table</h2>
            <p>${state.replayMode === "with"
              ? "VOL highlights intervention rows where earlier action could change the stabilization path."
              : "The same weekly data remains mostly metric-focused, with weak hindsight notes after strain compounds."}</p>
          </div>
        </div>
        <div class="panel trend-table-panel">
          ${renderTrendSummary(replay, stabilizedModel)}
          <div class="table-wrap">
            <table class="trend-table">
              <thead>
                <tr>
                  <th>Week</th>
                  <th>VI / WSI</th>
                  <th>Trend</th>
                  <th>Action / Effect</th>
                  <th>Coverage</th>
                  <th>Financial Drag</th>
                </tr>
              </thead>
              <tbody>${renderTrendRows(replayWeeks)}</tbody>
            </table>
          </div>
        </div>
      </section>

      ${renderProjectedStabilizedPath(stabilizedModel)}

      ${renderRawSupportingMetrics(latest)}
    `;
  }

  async function selectDemo(id){
    state.selectedId = id;
    renderCards();
    const demo = demos.find((item) => item.id === id);
    if(!demo) return;
    if(window.VolDemoCommunityState?.setSelectedDemoCommunity){
      await window.VolDemoCommunityState.setSelectedDemoCommunity(id).catch(() => {});
    }

    outputEl.innerHTML = `<div class="loading-state">Loading ${escapeHtml(demo.name)}...</div>`;

    try{
      if(!state.dataById.has(id)){
        const response = await fetch(demo.file);
        if(!response.ok) throw new Error(`Unable to load ${demo.file}`);
        const payload = await response.json();
        state.dataById.set(id, payload);
      }
      renderDemo(demo, state.dataById.get(id));
    }catch(error){
      outputEl.innerHTML = `
        <div class="error-state">
          Demo data could not be loaded. Run this page from the local site/server so the browser can fetch files from /data.
        </div>
      `;
      console.error(error);
    }
  }

  cardsEl.addEventListener("click", (event) => {
    const card = event.target.closest("[data-demo-id]");
    if(!card) return;
    selectDemo(card.getAttribute("data-demo-id"));
  });

  outputEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-replay-mode]");
    if(!button) return;
    state.replayMode = button.getAttribute("data-replay-mode") || "with";
    const demo = demos.find((item) => item.id === state.selectedId);
    const payload = state.dataById.get(state.selectedId);
    if(demo && payload) renderDemo(demo, payload);
  });

  async function initializeDataDemo(){
    try{
      await loadCanonicalDemoCommunities();
    }catch(error){
      console.warn("Unable to load canonical demo communities; using legacy demo files.", error);
    }
    renderCards();
    selectDemo(state.selectedId);
  }

  initializeDataDemo();
})();
