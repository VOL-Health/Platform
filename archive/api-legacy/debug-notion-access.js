module.exports = async function handler(req, res) {
  try {
    const notionApiKey = process.env.NOTION_API_KEY;

    if (!notionApiKey) {
      return res.status(500).json({ success: false, error: "Missing NOTION_API_KEY" });
    }

    const response = await fetch("https://api.notion.com/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${notionApiKey}`,
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28"
      },
      body: JSON.stringify({
        filter: {
          value: "database",
          property: "object"
        },
        page_size: 20
      })
    });

    const data = await response.json();

    return res.status(response.status).json({
      success: response.ok,
      results: (data.results || []).map(item => ({
        id: item.id,
        title: item.title?.map(t => t.plain_text).join("") || "",
        url: item.url
      })),
      raw_error: response.ok ? null : data
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};