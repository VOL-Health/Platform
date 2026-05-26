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

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const sessionId = cleanText(body.sessionId || body.assessment_session_id);

    if (!sessionId) {
      return res.status(400).json({ success: false, error: "Missing sessionId" });
    }

    const schema = await getDatabaseSchema({ notionApiKey, databaseId });
    const existingPage = await findPageBySessionId({ notionApiKey, databaseId, sessionId });
    const now = new Date().toISOString();
    const existingProps = existingPage?.properties || {};
    const operatingDate = cleanText(body.operating_date) || now.slice(0, 10);
    const followUpBatchKey = cleanText(body.follow_up_batch_key) || `${sessionId}:${operatingDate}`;
    const operatorEmail = cleanText(body.operator_email || body.email);
    const operatorName = cleanText(body.operator_name || body.submitted_by || body.name);
    const hasFollowUpContact = isValidEmail(operatorEmail);
    const firstReactionAt = getDateStart(existingProps["First Action Reaction At"]) || now;
    const scheduledAt = hasFollowUpContact
      ? (getDateStart(existingProps["Follow-Up Scheduled At"]) || addHours(firstReactionAt, 24))
      : "";
    const properties = {};

    setProp(properties, schema, "Name", cleanText(body.community_name) || `Ask VOL Operational Read ${sessionId.slice(-6)}`);
    setProp(properties, schema, "Community Name", body.community_name);
    setProp(properties, schema, "Assessment Session ID", sessionId);
    setProp(properties, schema, "Email", operatorEmail);
    setProp(properties, schema, "Submitted By", operatorName);
    setProp(properties, schema, "Follow-Up Contact Email", operatorEmail);
    setProp(properties, schema, "Follow-Up Contact Name", operatorName);

    setProp(properties, schema, "Operator Alignment", body.operator_alignment);
    setProp(properties, schema, "Top Priority Action", body.top_priority_action);
    setProp(properties, schema, "Execution Confidence", body.execution_confidence);
    setProp(properties, schema, "Recommendation Status", body.recommendation_status);
    setProp(properties, schema, "Assigned Owner", body.assigned_owner);
    setProp(properties, schema, "Follow-Up Date", body.follow_up_date);
    setProp(properties, schema, "Outcome Observed", body.outcome_observed);
    setProp(properties, schema, "Execution Barrier", body.execution_barrier);
    setProp(properties, schema, "Notes", body.notes);
    setProp(properties, schema, "Operational Pulse", body.operational_pulse);
    setProp(properties, schema, "Action Pulse Summary", body.operational_pulse);
    setProp(properties, schema, "Action ID", body.action_id);
    setProp(properties, schema, "Action Number", body.action_number);
    setProp(properties, schema, "Action Title", body.action_title);
    setProp(properties, schema, "Action Text", body.action_text);
    setProp(properties, schema, "Signal Type", body.signal_type);
    setProp(properties, schema, "Impact / Risk", body.impact_risk);
    setProp(properties, schema, "Suggested Owner", body.suggested_owner);
    setProp(properties, schema, "Actionability Response", body.actionability_response);
    setProp(properties, schema, "Follow-Up Batch Key", followUpBatchKey);
    setProp(properties, schema, "Follow-Up Status", hasFollowUpContact ? "Pending" : "Contact Missing");
    setProp(properties, schema, "Follow-Up Contact Missing", !hasFollowUpContact);
    setProp(properties, schema, "First Action Reaction At", firstReactionAt);
    setProp(properties, schema, "Latest Action Reaction At", now);
    if (hasFollowUpContact) setProp(properties, schema, "Follow-Up Scheduled At", scheduledAt);
    setProp(properties, schema, "Reacted Actions", body.operational_pulse);
    setProp(properties, schema, "Last Updated", now);

    setProp(properties, schema, "User Question", body.user_question);
    setProp(properties, schema, "VOL Response", body.vol_response);
    setProp(properties, schema, "Best Next Moves", arrayToText(body.best_next_moves));
    setProp(properties, schema, "Watch Item", body.watch_item);
    setProp(properties, schema, "Operational Read Timestamp", body.timestamp || now);

    setProp(properties, schema, "VI Score (Current)", body.vi_score_current);
    setProp(properties, schema, "VI Score (Stabilized)", body.vi_score_stabilized);
    setProp(properties, schema, "VI Volatility Drag", body.vi_volatility_drag);
    setProp(properties, schema, "VI Dominant Domain", body.vi_dominant_domain);
    setProp(properties, schema, "WSI Score", body.wsi_score);
    setProp(properties, schema, "WSI Score (Current)", body.wsi_score_current ?? body.wsi_score);
    setProp(properties, schema, "WSI Score (Stabilized)", body.wsi_score_stabilized);
    setProp(properties, schema, "WSI Risk Level", body.wsi_risk_level);
    setProp(properties, schema, "Combined Stability Score", body.combined_stability_score);
    setProp(properties, schema, "Stability Tier", body.stability_tier);
    setProp(properties, schema, "Scoring Source", body.scoring_source);
    setProp(properties, schema, "Scoring Version", body.scoring_version);
    setProp(properties, schema, "Score Confidence", body.score_confidence);
    setProp(properties, schema, "Missing Inputs", arrayToText(body.missing_inputs));

    const savedFields = Object.keys(properties);
    if (savedFields.length === 0) {
      return res.status(200).json({
        success: true,
        sessionId,
        saved_fields: [],
        skipped_reason: "No matching Notion properties were found."
      });
    }

    const notionResponse = existingPage?.id
      ? await fetch(`https://api.notion.com/v1/pages/${existingPage.id}`, {
          method: "PATCH",
          headers: baseHeaders(notionApiKey),
          body: JSON.stringify({ properties })
        })
      : await fetch("https://api.notion.com/v1/pages", {
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
        error: notionResult.message || "Notion request failed",
        details: notionResult,
        saved_fields_attempted: savedFields
      });
    }

    return res.status(200).json({
      success: true,
      sessionId,
      assessment_session_id: sessionId,
      record_id: notionResult.id,
      page_id: notionResult.id,
      created: !existingPage?.id,
      saved_fields: savedFields,
      saved_field_count: savedFields.length,
      last_updated: now,
      follow_up_batch_key: followUpBatchKey,
      follow_up_scheduled_at: scheduledAt || null,
      follow_up_contact_missing: !hasFollowUpContact
    });
  } catch (error) {
    console.error("SAVE OPERATIONAL READ ERROR:", error);
    return res.status(500).json({ success: false, error: error.message || "Unknown server error" });
  }
};

async function findPageBySessionId({ notionApiKey, databaseId, sessionId }) {
  const schema = await getDatabaseSchema({ notionApiKey, databaseId });
  if (!schema["Assessment Session ID"]) return null;

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
    throw new Error(result.message || "Unable to read Notion database schema");
  }
  return result.properties || {};
}

function setProp(target, schema, propertyName, value) {
  const def = schema?.[propertyName];
  if (!def || value === undefined) return;

  if (def.type === "title") {
    const safe = cleanText(value) || "Ask VOL Operational Read";
    target[propertyName] = { title: [{ text: { content: safe } }] };
    return;
  }
  if (def.type === "rich_text") {
    const safe = cleanText(value);
    target[propertyName] = safe ? { rich_text: [{ text: { content: safe } }] } : { rich_text: [] };
    return;
  }
  if (def.type === "email") {
    const safe = cleanText(value);
    target[propertyName] = { email: safe || null };
    return;
  }
  if (def.type === "number") {
    target[propertyName] = { number: toNumberOrNull(value) };
    return;
  }
  if (def.type === "select") {
    const safe = cleanText(value);
    if (!safe) {
      target[propertyName] = { select: null };
      return;
    }
    if (!hasOption(def.select?.options, safe)) return;
    target[propertyName] = { select: { name: safe } };
    return;
  }
  if (def.type === "status") {
    const safe = cleanText(value);
    if (!safe) {
      target[propertyName] = { status: null };
      return;
    }
    if (!hasOption(def.status?.options, safe)) return;
    target[propertyName] = { status: { name: safe } };
    return;
  }
  if (def.type === "date") {
    const safe = cleanText(value);
    target[propertyName] = safe ? { date: { start: safe } } : { date: null };
    return;
  }
  if (def.type === "checkbox") {
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

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function addHours(value, hours) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  date.setHours(date.getHours() + hours);
  return date.toISOString();
}

function getDateStart(prop) {
  return cleanText(prop?.date?.start);
}

function arrayToText(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join("\n");
  return cleanText(value);
}

function hasOption(options, value) {
  if (!Array.isArray(options) || options.length === 0) return true;
  const safe = cleanText(value).toLowerCase();
  return options.some(option => cleanText(option.name).toLowerCase() === safe);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanText(value));
}
