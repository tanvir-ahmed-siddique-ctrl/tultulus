const fs = require("fs");
const path = require("path");

function loadDotEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq < 1) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

const apiKey = String(process.env.FIREBASE_WEB_API_KEY || "").trim();
if (!apiKey) {
  console.error(
    "FIREBASE_WEB_API_KEY is missing. Set it in Netlify env vars (or local .env).",
  );
  process.exit(1);
}

const filePath = path.join(__dirname, "..", "firebase-config.js");
const original = fs.readFileSync(filePath, "utf8");
const updated = original.replace(/apiKey:\s*"[^"]*"/, `apiKey: "${apiKey}"`);

if (updated === original) {
  console.error("Could not find apiKey in firebase-config.js to replace.");
  process.exit(1);
}

fs.writeFileSync(filePath, updated);
console.log("Wrote Firebase web API key into firebase-config.js from env.");
