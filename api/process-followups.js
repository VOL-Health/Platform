const { Resend } = require("resend");

module.exports = async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const notionApiKey = process.env.NOTION_API_KEY;
    const databaseId = process.env.NOTION_ASSESSMENTS_DATABASE_ID;
    const resendApiKey = process.env.RESEND_API_KEY;
    const fallbackRecipient = cleanText(process.env.OPERATIONAL_FOLLOWUP_EMAIL || process.env.FOLLOWUP_RECIPIENT_EMAIL);

    if (!notionApiKey) return res.status(500).json({ success: false, error: "Missing NOTION_API_KEY" });
    if (!databaseId) return res.status(500).json({ success: false, error: "Missing NOTION_ASSESSMENTS_DATABASE_ID" });
    if (!resendApiKey) return res.status(500).json({ success: false, error: "Missing RESEND_API_KEY" });

    const schema = await getDatabaseSchema({ notionApiKey, databaseId });
    if (!schema["Follow-Up Status"] || !schema["Follow-Up Scheduled At"]) {
      return res.status(200).json({
        success: true,
        skipped: true,
        reason: "Follow-up batch properties are not present in the Notion schema."
      });
    }

    const pendingPages = await queryPendingFollowUps({ notionApiKey, databaseId, schema });
    const resend = new Resend(resendApiKey);
    const results = [];

    for (const page of pendingPages) {
      const props = page.properties || {};
      const recipient = getEmail(props["Follow-Up Email"]) || getEmail(props.Email) || fallbackRecipient;
      if (!recipient) {
        results.push({ page_id: page.id, skipped: true, reason: "No follow-up recipient configured" });
        continue;
      }

      const sessionId = getPlainText(props["Assessment Session ID"]);
      const communityName = getPlainText(props["Community Name"]) || getPlainText(props.Name) || "Community";
      const userQuestion = getPlainText(props["User Question"]);
      const volResponse = getPlainText(props["VOL Response"]);
      const reactedActions = parseReactedActions(getPlainText(props["Reacted Actions"]) || getPlainText(props["Action Pulse Summary"]) || getPlainText(props["Best Next Moves"]));
      const baseUrl = getBaseUrl(req);

      const html = buildFollowUpEmailHtml({
        baseUrl,
        sessionId,
        communityName,
        userQuestion,
        volResponse,
        reactedActions
      });

      const { data, error } = await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL || "VOL Health <hud@volhealth.ai>",
        to: recipient,
        subject: `VOL follow-up: ${communityName}`,
        html
      });

      if (error) {
        results.push({ page_id: page.id, success: false, error: error.message || "Resend failed" });
        continue;
      }

      await updateFollowUpSent({ notionApiKey, pageId: page.id, schema });
      results.push({
        page_id: page.id,
        success: true,
        resend_id: data?.id || null,
        session_id: sessionId,
        action_count: reactedActions.length
      });
    }

    return res.status(200).json({
      success: true,
      pending_count: pendingPages.length,
      sent_count: results.filter(item => item.success).length,
      results
    });
  } catch (error) {
    console.error("PROCESS FOLLOWUPS ERROR:", error);
    return res.status(500).json({ success: false, error: error.message || "Unknown server error" });
  }
};

async function queryPendingFollowUps({ notionApiKey, databaseId, schema }) {
  const statusType = schema["Follow-Up Status"]?.type;
  const statusFilter = statusType === "status"
    ? { property: "Follow-Up Status", status: { equals: "Pending" } }
    : { property: "Follow-Up Status", select: { equals: "Pending" } };

  const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: "POST",
    headers: baseHeaders(notionApiKey),
    body: JSON.stringify({
      filter: {
        and: [
          statusFilter,
          { property: "Follow-Up Scheduled At", date: { on_or_before: new Date().toISOString() } }
        ]
      },
      page_size: 25
    })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || "Unable to query pending follow-ups");
  return result.results || [];
}

async function updateFollowUpSent({ notionApiKey, pageId, schema }) {
  const properties = {};
  const now = new Date().toISOString();
  setProp(properties, schema, "Follow-Up Status", "Sent");
  setProp(properties, schema, "Follow-Up Sent At", now);
  setProp(properties, schema, "Last Updated", now);
  await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
    headers: baseHeaders(notionApiKey),
    body: JSON.stringify({ properties })
  });
}

async function getDatabaseSchema({ notionApiKey, databaseId }) {
  const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
    method: "GET",
    headers: baseHeaders(notionApiKey)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || "Unable to read Notion database schema");
  return result.properties || {};
}

function buildFollowUpEmailHtml({ baseUrl, sessionId, communityName, userQuestion, volResponse, reactedActions }) {
  const actions = reactedActions.length ? reactedActions : [{ action: "Review current VOL priority actions", pulse: "No read captured" }];
  const actionRows = actions.map((item, index) => `
    <tr>
      <td style="padding:14px 0;border-top:1px solid #24304a;">
        <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8fd7ff;font-weight:700;">Action ${index + 1}</div>
        <div style="margin-top:5px;color:#f4f7fb;font-size:15px;line-height:1.45;font-weight:700;">${escapeHtml(item.action)}</div>
        <div style="margin-top:4px;color:#aab7cf;font-size:13px;line-height:1.45;">Initial read: ${escapeHtml(item.pulse || "No read captured")}</div>
        <div style="margin-top:10px;">
          ${["Completed", "Partially Completed", "Could Not Execute"].map(choice => followUpLink(baseUrl, sessionId, index + 1, choice)).join(" ")}
        </div>
      </td>
    </tr>
  `).join("");
  const blockerLinks = ["Staffing bandwidth", "Leadership bandwidth", "Competing priorities", "Budget constraints", "Hiring pipeline", "Other"]
    .map(blocker => blockerLink(baseUrl, sessionId, blocker))
    .join(" ");

  return `
    <div style="margin:0;padding:0;background:#0d1323;color:#f4f7fb;font-family:Inter,Arial,sans-serif;">
      <div style="max-width:680px;margin:0 auto;padding:28px 20px;">
        <div style="border:1px solid #24304a;border-radius:18px;background:#111a2f;padding:22px;">
          <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#7ce7b5;font-weight:800;">VOL operational follow-up</div>
          <h1 style="margin:8px 0 8px;font-size:24px;line-height:1.2;color:#fff;">${escapeHtml(communityName)}</h1>
          <p style="margin:0;color:#b8c4d8;font-size:14px;line-height:1.55;">A quick 24-hour read on the actions selected from the Ask VOL session.</p>
          ${userQuestion ? `<p style="margin:16px 0 0;color:#d8e2f2;font-size:14px;line-height:1.55;"><strong>Question:</strong> ${escapeHtml(userQuestion)}</p>` : ""}
          ${volResponse ? `<p style="margin:10px 0 0;color:#aab7cf;font-size:13px;line-height:1.55;"><strong>Context:</strong> ${escapeHtml(trimWords(volResponse, 70))}</p>` : ""}
          <table style="width:100%;border-collapse:collapse;margin-top:18px;">${actionRows}</table>
          <div style="margin-top:18px;padding-top:16px;border-top:1px solid #24304a;">
            <div style="color:#f4f7fb;font-size:14px;font-weight:800;margin-bottom:8px;">Primary blocker, if any</div>
            ${blockerLinks}
          </div>
          <p style="margin:18px 0 0;color:#8b98af;font-size:12px;line-height:1.5;">Optional note: reply to this email with any operational context that should be attached to the session.</p>
        </div>
      </div>
    </div>
  `;
}

function followUpLink(baseUrl, sessionId, actionNumber, outcome) {
  const href = `${baseUrl}/api/record-followup-response?sessionId=${encodeURIComponent(sessionId)}&actionNumber=${actionNumber}&outcome=${encodeURIComponent(outcome)}`;
  return `<a href="${href}" style="display:inline-block;margin:0 6px 6px 0;padding:8px 10px;border-radius:999px;background:#17243b;border:1px solid #2f4265;color:#dffbea;text-decoration:none;font-size:12px;font-weight:700;">${escapeHtml(outcome)}</a>`;
}

function blockerLink(baseUrl, sessionId, blocker) {
  const href = `${baseUrl}/api/record-followup-response?sessionId=${encodeURIComponent(sessionId)}&blocker=${encodeURIComponent(blocker)}`;
  return `<a href="${href}" style="display:inline-block;margin:0 6px 6px 0;padding:8px 10px;border-radius:999px;background:#17243b;border:1px solid #2f4265;color:#dffbea;text-decoration:none;font-size:12px;font-weight:700;">${escapeHtml(blocker)}</a>`;
}

function parseReactedActions(value) {
  return cleanText(value)
    .split(/\r?\n+/)
    .map(line => {
      const [action, ...rest] = line.split(":");
      return { action: cleanText(action), pulse: cleanText(rest.join(":")) };
    })
    .filter(item => item.action)
    .slice(0, 5);
}

function getBaseUrl(req) {
  const configured = cleanText(process.env.PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL);
  if (configured) return configured.replace(/\/$/, "");
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${host}`;
}

function setProp(target, schema, propertyName, value) {
  const def = schema?.[propertyName];
  if (!def || value === undefined) return;
  if (def.type === "date") {
    const safe = cleanText(value);
    target[propertyName] = safe ? { date: { start: safe } } : { date: null };
    return;
  }
  if (def.type === "select") {
    const safe = cleanText(value);
    if (!safe || !hasOption(def.select?.options, safe)) return;
    target[propertyName] = { select: { name: safe } };
    return;
  }
  if (def.type === "status") {
    const safe = cleanText(value);
    if (!safe || !hasOption(def.status?.options, safe)) return;
    target[propertyName] = { status: { name: safe } };
    return;
  }
}

function getPlainText(prop) {
  if (!prop) return "";
  if (Array.isArray(prop.rich_text)) return prop.rich_text.map(item => item?.plain_text || "").join("").trim();
  if (Array.isArray(prop.title)) return prop.title.map(item => item?.plain_text || "").join("").trim();
  if (prop.select?.name) return cleanText(prop.select.name);
  if (prop.status?.name) return cleanText(prop.status.name);
  return "";
}

function getEmail(prop) {
  return cleanText(prop?.email || getPlainText(prop));
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

function hasOption(options, value) {
  if (!Array.isArray(options) || options.length === 0) return true;
  const safe = cleanText(value).toLowerCase();
  return options.some(option => cleanText(option.name).toLowerCase() === safe);
}

function trimWords(value, limit) {
  const words = cleanText(value).split(/\s+/);
  return words.length > limit ? `${words.slice(0, limit).join(" ")}...` : words.join(" ");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
