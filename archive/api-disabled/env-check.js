const { loadLocalEnv } = require("../lib/load-local-env");

loadLocalEnv();

module.exports = function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed. Use GET."
    });
  }

  return res.status(200).json({
    hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
    hasTestVar: Boolean(process.env.TEST_VAR),
    envKeyNames: Object.keys(process.env).filter((key) => key.includes("OPENAI") || key.includes("TEST"))
  });
};
