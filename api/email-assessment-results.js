import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const notionApiKey = process.env.NOTION_API_KEY;
    const databaseId = process.env.NOTION_ASSESSMENTS_DATABASE_ID;
    const resendApiKey = process.env.RESEND_API_KEY;

    if (!notionApiKey) {
      return res.status(500).json({
        success: false,
        error: "Missing NOTION_API_KEY"
      });
    }

    if (!databaseId) {
      return res.status(500).json({
        success: false,
        error: "Missing NOTION_ASSESSMENTS_DATABASE_ID"
      });
    }

    if (!resendApiKey) {
      return res.status(500).json({
        success: false,
        error: "Missing RESEND_API_KEY"
      });
    }

    const body = req.body || {};
    const sessionId = cleanText(body.sessionId || body.assessment_session_id);
    const recipientEmail = cleanText(body.email);

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: "Missing sessionId"
      });
    }

    if (!recipientEmail) {
      return res.status(400).json({
        success: false,
        error: "Missing email"
      });
    }

    const notionResp = await fetch(
      `https://api.notion.com/v1/databases/${databaseId}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${notionApiKey}`,
          "Content-Type": "application/json",
          "Notion-Version": "2022-06-28"
        },
        body: JSON.stringify({
          filter: {
            property: "Assessment Session ID",
            rich_text: {
              equals: sessionId
            }
          },
          page_size: 1
        })
      }
    );

    if (!notionResp.ok) {
      const raw = await notionResp.text();
      return res.status(500).json({
        success: false,
        error: "Notion API failed",
        status: notionResp.status,
        raw
      });
    }

    const notionData = await notionResp.json();

    if (!notionData || !Array.isArray(notionData.results)) {
      return res.status(500).json({
        success: false,
        error: "Invalid Notion response"
      });
    }

    if (notionData.results.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Assessment not found",
        sessionId
      });
    }

    const page = notionData.results[0];
    const props = page.properties || {};

    const communityName =
      getPlainText(props["Community Name"]) ||
      getPlainText(props["Name"]) ||
      "Community";

    const operator = getPlainText(props["Operator"]);
    const city = getPlainText(props["City"]);
    const state = getPlainText(props["State"]);
    const market = getPlainText(props["Market"]);

    const finalRecommendation =
      getPlainText(props["Final Recommendation"]) ||
      getPlainText(props["Final Recommendations"]) ||
      "";

    const priorityActionsRaw =
      getPlainText(props["Priority Actions"]) ||
      getPlainText(props["Priority Action"]) ||
      "";

    const currentCostRaw =
      getPlainText(props["Current Cost"]) ||
      getPlainText(props["Current Costs"]) ||
      "";

    const priorityActions = parsePriorityActions(priorityActionsRaw);
    const currentCostItems = parsePriorityActions(currentCostRaw);

    if (!cleanText(finalRecommendation) && priorityActions.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Recommendations not ready yet"
      });
    }

    const viScoreCurrent = getNumber(props["VI Score (Current)"]);
    const viScoreStabilized = getNumber(props["VI Score (Stabilized)"]);
    const wsiScore = getNumber(props["WSI Score"]);
    const wsiScoreStabilized = getNumber(props["WSI Score (Stabilized)"]);
    const dominantDomain =
      getPlainText(props["VI Dominant Domain"]) ||
      getPlainText(props["Primary Constraint"]);

    const locationLine = [city, state].filter(Boolean).join(", ");
    const contextLine = [operator, market || locationLine].filter(Boolean).join(" • ");

    const html = buildVolHealthEmailHtml({
      communityName,
      contextLine,
      finalRecommendation,
      priorityActions,
      currentCostItems,
      viScoreCurrent,
      viScoreStabilized,
      wsiScore,
      wsiScoreStabilized,
      dominantDomain
    });

    const { data, error } = await resend.emails.send({
      from: "VOL Health <hud@volhealth.ai>",
      to: recipientEmail,
      subject: `VOL Health Recommendations — ${communityName}`,
      html
    });

    console.log("RESEND DATA:", JSON.stringify(data, null, 2));
    console.log("RESEND ERROR:", JSON.stringify(error, null, 2));

    if (error) {
      return res.status(500).json({
        success: false,
        error: "Resend failed to send email",
        details: {
          name: error.name || null,
          message: error.message || null,
          statusCode: error.statusCode || null
        }
      });
    }

    return res.status(200).json({
      success: true,
      message: "Email sent",
      resendId: data?.id || null,
      sessionId,
      email: recipientEmail
    });
  } catch (error) {
    console.error("EMAIL ASSESSMENT RESULTS ERROR:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Unknown server error"
    });
  }
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

  if (prop.select?.name) {
    return cleanText(prop.select.name);
  }

  if (prop.status?.name) {
    return cleanText(prop.status.name);
  }

  if (typeof prop === "string") {
    return cleanText(prop);
  }

  return "";
}

function getNumber(prop) {
  return typeof prop?.number === "number" ? prop.number : null;
}

function parsePriorityActions(value) {
  const raw = cleanText(value);
  if (!raw) return [];

  return raw
    .split(/\r?\n+/)
    .map(line => line.replace(/^\s*([-•*]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatMetricCard(label, value, accent = "#2c6cff") {
  if (typeof value !== "number") return "";

  return `
    <td style="padding:6px;">
      <div style="
        background:#101c36;
        border:1px solid rgba(76,123,255,0.25);
        border-radius:14px;
        padding:14px 14px 12px;
      ">
        <div style="
          color:#9fb2d2;
          font-size:11px;
          line-height:1.3;
          text-transform:uppercase;
          letter-spacing:0.08em;
          font-weight:700;
          margin-bottom:8px;
        ">
          ${escapeHtml(label)}
        </div>
        <div style="
          color:${accent};
          font-size:26px;
          line-height:1;
          font-weight:900;
        ">
          ${escapeHtml(String(value))}
        </div>
      </div>
    </td>
  `;
}

function buildVolHealthEmailHtml({
  communityName,
  contextLine,
  finalRecommendation,
  priorityActions,
  currentCostItems,
  viScoreCurrent,
  viScoreStabilized,
  wsiScore,
  wsiScoreStabilized,
  dominantDomain
}) {
  const actionCards = priorityActions.length
    ? priorityActions
        .map((action, index) => {
          return `
            <tr>
              <td style="padding-top:${index === 0 ? "0" : "10px"};">
                <div style="
                  background:#101c36;
                  border:1px solid rgba(255,255,255,0.08);
                  border-radius:16px;
                  padding:16px 18px;
                ">
                  <div style="
                    color:#9fb2d2;
                    font-size:11px;
                    line-height:1.3;
                    text-transform:uppercase;
                    letter-spacing:0.08em;
                    font-weight:800;
                    margin-bottom:8px;
                  ">
                    Priority Action ${index + 1}
                  </div>
                  <div style="
                    color:#eef4ff;
                    font-size:16px;
                    line-height:1.65;
                    font-weight:500;
                  ">
                    ${escapeHtml(action)}
                  </div>
                </div>
              </td>
            </tr>
          `;
        })
        .join("")
    : `
      <tr>
        <td>
          <div style="
            background:#101c36;
            border:1px solid rgba(255,255,255,0.08);
            border-radius:16px;
            padding:16px 18px;
            color:#eef4ff;
            font-size:16px;
            line-height:1.65;
          ">
            No discrete priority actions were returned for this assessment.
          </div>
        </td>
      </tr>
    `;

  const currentCostCards = Array.isArray(currentCostItems) && currentCostItems.length
    ? currentCostItems
        .map((item, index) => {
          return `
            <tr>
              <td style="padding-top:${index === 0 ? "0" : "10px"};">
                <div style="
                  background:#101c36;
                  border:1px solid rgba(255,255,255,0.08);
                  border-radius:16px;
                  padding:16px 18px;
                ">
                  <div style="
                    color:#9fb2d2;
                    font-size:11px;
                    line-height:1.3;
                    text-transform:uppercase;
                    letter-spacing:0.08em;
                    font-weight:800;
                    margin-bottom:8px;
                  ">
                    Cost Signal ${index + 1}
                  </div>
                  <div style="
                    color:#eef4ff;
                    font-size:16px;
                    line-height:1.65;
                    font-weight:500;
                  ">
                    ${escapeHtml(item)}
                  </div>
                </div>
              </td>
            </tr>
          `;
        })
        .join("")
    : "";

  const metricCards = [
    formatMetricCard("VI Current", viScoreCurrent, "#6ea8ff"),
    formatMetricCard("VI Stabilized", viScoreStabilized, "#35c67a"),
    formatMetricCard("WSI Current", wsiScore, "#6ea8ff"),
    formatMetricCard("WSI Stabilized", wsiScoreStabilized, "#35c67a")
  ].filter(Boolean);

  const metricsTable =
    metricCards.length > 0
      ? `
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr>
            ${metricCards.join("")}
          </tr>
        </table>
      `
      : "";

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="color-scheme" content="dark light" />
        <meta name="supported-color-schemes" content="dark light" />
        <title>VOL Health Recommendations</title>
      </head>
      <body style="margin:0;padding:0;background:#07111f;font-family:Inter,Arial,Helvetica,sans-serif;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#07111f;margin:0;padding:0;">
          <tr>
            <td align="center" style="padding:24px 12px 36px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:920px;">
                <tr>
                  <td style="
                    background:linear-gradient(180deg,#06132a 0%,#08172f 100%);
                    border:1px solid rgba(255,255,255,0.08);
                    border-radius:24px;
                    padding:24px 24px 26px;
                  ">
                    <div style="
                      display:inline-block;
                      padding:7px 14px;
                      border-radius:999px;
                      border:1px solid rgba(76,123,255,0.35);
                      background:rgba(44,108,255,0.12);
                      color:#dbe6ff;
                      font-size:12px;
                      line-height:1;
                      font-weight:800;
                      letter-spacing:0.05em;
                      text-transform:uppercase;
                    ">
                      VOL Health™ Diagnostic Layer
                    </div>

                    <div style="padding-top:18px;">
                      <div style="
                        color:#eef4ff;
                        font-size:18px;
                        line-height:1.2;
                        font-weight:800;
                        letter-spacing:0.06em;
                        text-transform:uppercase;
                        opacity:0.92;
                      ">
                        VOL Health Final Recommendations
                      </div>

                      <div style="
                        color:#ffffff;
                        font-size:40px;
                        line-height:1.08;
                        font-weight:900;
                        padding-top:12px;
                      ">
                        ${escapeHtml(communityName)}
                      </div>

                      ${
                        contextLine
                          ? `
                            <div style="
                              color:#b9cae7;
                              font-size:18px;
                              line-height:1.5;
                              font-weight:500;
                              padding-top:12px;
                            ">
                              ${escapeHtml(contextLine)}
                            </div>
                          `
                          : ""
                      }

                      <div style="
                        color:#d7e2f7;
                        font-size:16px;
                        line-height:1.7;
                        padding-top:18px;
                        max-width:760px;
                      ">
                        This recommendation set combines the volatility story from VI with the workforce system picture from WSI to clarify what matters most now and what smart next actions should look like.
                      </div>
                    </div>
                  </td>
                </tr>

                <tr><td style="height:16px;"></td></tr>

                <tr>
                  <td style="
                    background:#0b1730;
                    border:1px solid rgba(255,255,255,0.08);
                    border-radius:22px;
                    padding:22px 22px 24px;
                  ">
                    <div style="
                      color:#9fb2d2;
                      font-size:12px;
                      line-height:1.3;
                      font-weight:800;
                      letter-spacing:0.09em;
                      text-transform:uppercase;
                      margin-bottom:12px;
                    ">
                      Final Recommendation
                    </div>

                    <div style="
                      background:#101c36;
                      border:1px solid rgba(255,255,255,0.08);
                      border-radius:18px;
                      padding:20px 20px 22px;
                      color:#eef4ff;
                      font-size:17px;
                      line-height:1.78;
                      font-weight:500;
                    ">
                      ${escapeHtml(finalRecommendation || "Recommendation text was not returned.")}
                    </div>
                  </td>
                </tr>

                ${
                  currentCostCards
                    ? `
                      <tr><td style="height:16px;"></td></tr>

                      <tr>
                        <td style="
                          background:#0b1730;
                          border:1px solid rgba(255,255,255,0.08);
                          border-radius:22px;
                          padding:22px 22px 24px;
                        ">
                          <div style="
                            color:#9fb2d2;
                            font-size:12px;
                            line-height:1.3;
                            font-weight:800;
                            letter-spacing:0.09em;
                            text-transform:uppercase;
                            margin-bottom:12px;
                          ">
                            Current Cost
                          </div>

                          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                            ${currentCostCards}
                          </table>
                        </td>
                      </tr>
                    `
                    : ""
                }

                <tr><td style="height:16px;"></td></tr>

                <tr>
                  <td style="
                    background:#0b1730;
                    border:1px solid rgba(255,255,255,0.08);
                    border-radius:22px;
                    padding:22px 22px 24px;
                  ">
                    <div style="
                      color:#9fb2d2;
                      font-size:12px;
                      line-height:1.3;
                      font-weight:800;
                      letter-spacing:0.09em;
                      text-transform:uppercase;
                      margin-bottom:12px;
                    ">
                      Priority Actions
                    </div>

                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                      ${actionCards}
                    </table>
                  </td>
                </tr>

                ${
                  metricsTable
                    ? `
                      <tr><td style="height:16px;"></td></tr>

                      <tr>
                        <td style="
                          background:#0b1730;
                          border:1px solid rgba(255,255,255,0.08);
                          border-radius:22px;
                          padding:22px 22px 18px;
                        ">
                          <div style="
                            color:#9fb2d2;
                            font-size:12px;
                            line-height:1.3;
                            font-weight:800;
                            letter-spacing:0.09em;
                            text-transform:uppercase;
                            margin-bottom:12px;
                          ">
                            Assessment Snapshot
                          </div>

                          ${metricsTable}

                          ${
                            dominantDomain
                              ? `
                                <div style="
                                  margin-top:14px;
                                  color:#c9d7f0;
                                  font-size:14px;
                                  line-height:1.65;
                                ">
                                  <strong style="color:#eef4ff;">Dominant signal:</strong> ${escapeHtml(dominantDomain)}
                                </div>
                              `
                              : ""
                          }
                        </td>
                      </tr>
                    `
                    : ""
                }

                <tr><td style="height:16px;"></td></tr>

                <tr>
                  <td style="
                    background:#0b1730;
                    border:1px solid rgba(53,198,122,0.22);
                    border-radius:22px;
                    padding:22px;
                  ">
                    <div style="
                      color:#eef4ff;
                      font-size:18px;
                      line-height:1.4;
                      font-weight:800;
                      margin-bottom:10px;
                    ">
                      Review these results with VOL
                    </div>
                    <div style="
                      color:#b9cae7;
                      font-size:14px;
                      line-height:1.65;
                      margin-bottom:16px;
                    ">
                      Walk through the recommendation set with VOL and clarify the first operating move.
                    </div>
                    <a href="https://calendly.com/hud-volhealth/connect" target="_blank" rel="noopener" style="
                      display:inline-block;
                      background:#35c67a;
                      color:#06101d;
                      text-decoration:none;
                      font-size:14px;
                      line-height:1.2;
                      font-weight:800;
                      padding:12px 16px;
                      border-radius:999px;
                    ">Review these results with VOL</a>
                  </td>
                </tr>

                <tr><td style="height:16px;"></td></tr>

                <tr>
                  <td style="
                    background:linear-gradient(180deg,#08172f 0%,#07111f 100%);
                    border:1px solid rgba(255,255,255,0.06);
                    border-radius:20px;
                    padding:18px 20px;
                    color:#9fb2d2;
                    font-size:13px;
                    line-height:1.7;
                  ">
                    Generated by VOL Health from the shared VI + WSI assessment session.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}
