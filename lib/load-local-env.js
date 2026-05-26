const fs = require("fs");
const path = require("path");

let loaded = false;

function loadLocalEnv() {
  if (loaded) return;
  loaded = true;

  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;

  const contents = fs.readFileSync(envPath, "utf8");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) continue;

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (!key || process.env[key] !== undefined) continue;

    const quote = value[0];
    if ((quote === "\"" || quote === "'") && value.endsWith(quote)) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

module.exports = {
  loadLocalEnv
};
