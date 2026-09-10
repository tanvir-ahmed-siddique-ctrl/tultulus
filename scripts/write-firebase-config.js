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
const apiKeyProperty = `apiKey: ${JSON.stringify(apiKey)}`;
// Accept either quote style in the tracked template. JSON.stringify also keeps the
// generated JavaScript valid if a value ever contains a character that needs escaping.
const quotedApiKeyPattern = /(\bapiKey\s*:\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/;
const anyApiKeyPattern = /(\bapiKey\s*:\s*)[^,\r\n}]+/;
let updated = original;
if (quotedApiKeyPattern.test(original)) {
  updated = original.replace(quotedApiKeyPattern, `$1${JSON.stringify(apiKey)}`);
}

// Older or manually-edited templates may use an unquoted expression, or omit apiKey.
// Replace any property value first; otherwise add the property to firebaseConfig.
if (!quotedApiKeyPattern.test(original) && anyApiKeyPattern.test(original)) {
  updated = original.replace(
    anyApiKeyPattern,
    `$1${JSON.stringify(apiKey)}`,
  );
}
if (!quotedApiKeyPattern.test(original) && !anyApiKeyPattern.test(original)) {
  updated = original.replace(
    /(const\s+firebaseConfig\s*=\s*\{)(\r?\n)/,
    `$1$2  ${apiKeyProperty},$2`,
  );
}
if (!/const\s+firebaseConfig\s*=\s*\{/.test(original)) {
  console.error("Could not find the firebaseConfig object in firebase-config.js.");
  process.exit(1);
}

fs.writeFileSync(filePath, updated);
console.log("Wrote Firebase web API key into firebase-config.js from env.");
