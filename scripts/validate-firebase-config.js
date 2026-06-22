const fs = require("fs");
const path = require("path");

const root = process.cwd();
const failures = [];

function fail(message) {
  failures.push(message);
}

function absolute(relPath) {
  return path.join(root, relPath);
}

function readText(relPath) {
  const file = absolute(relPath);
  if (!fs.existsSync(file)) {
    fail(`${relPath} is referenced but missing`);
    return "";
  }
  return fs.readFileSync(file, "utf8");
}

function readJson(relPath) {
  const text = readText(relPath);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${relPath} is not valid JSON: ${error.message}`);
    return null;
  }
}

function rejectOpenFirestoreRules(rulesPath, rules) {
  const forbidden = [
    /allow\s+(?:read|write|create|update|delete)(?:\s*,\s*(?:read|write|create|update|delete))*\s*:\s*if\s+true\s*;/i,
    /allow\s+read\s*,\s*write\s*:\s*if\s+request\.auth\s*==\s*null\s*;/i,
    /allow\s+read\s*,\s*write\s*:\s*if\s+request\.time\s*</i,
  ];

  for (const pattern of forbidden) {
    if (pattern.test(rules)) {
      fail(`${rulesPath} contains a broadly open Firestore rule`);
    }
  }
}

function validateFirestore(config) {
  if (!config || typeof config !== "object") {
    fail("firebase.json firestore config must be an object");
    return;
  }

  if (typeof config.rules !== "string") {
    fail("firebase.json firestore.rules must point to a rules file");
    return;
  }

  const rules = readText(config.rules);
  if (!/rules_version\s*=\s*['"]2['"]\s*;/.test(rules)) {
    fail(`${config.rules} must use rules_version = '2'`);
  }
  if (!/service\s+cloud\.firestore/.test(rules)) {
    fail(`${config.rules} must declare service cloud.firestore`);
  }
  if (!/match\s+\/\{document=\*\*\}/.test(rules)) {
    fail(`${config.rules} must include a default recursive match`);
  }
  if (!/allow\s+read\s*,\s*write\s*:\s*if\s+false\s*;/.test(rules)) {
    fail(`${config.rules} must end with a deny-by-default rule`);
  }
  rejectOpenFirestoreRules(config.rules, rules);

  if (typeof config.indexes === "string") {
    const indexes = readJson(config.indexes);
    if (indexes) {
      if (!Array.isArray(indexes.indexes)) {
        fail(`${config.indexes} must define an indexes array`);
      }
      if (!Array.isArray(indexes.fieldOverrides)) {
        fail(`${config.indexes} must define a fieldOverrides array`);
      }
    }
  }
}

function validateRealtimeRuleTree(node, rulePath) {
  if (!node || typeof node !== "object") return;

  for (const [key, value] of Object.entries(node)) {
    const nextPath = `${rulePath}/${key}`;
    if ((key === ".read" || key === ".write") && value === true) {
      fail(`${nextPath} grants unconditional public access`);
    }
    if ((key === ".read" || key === ".write") && typeof value === "string" && value.trim().toLowerCase() === "true") {
      fail(`${nextPath} grants unconditional public access`);
    }
    if (value && typeof value === "object") {
      validateRealtimeRuleTree(value, nextPath);
    }
  }
}

function validateRealtimeDatabase(config) {
  if (!config || typeof config !== "object") {
    fail("firebase.json database config must be an object");
    return;
  }

  if (typeof config.rules !== "string") {
    fail("firebase.json database.rules must point to a rules file");
    return;
  }

  const databaseRules = readJson(config.rules);
  if (!databaseRules || !databaseRules.rules || typeof databaseRules.rules !== "object") {
    fail(`${config.rules} must define a root rules object`);
    return;
  }
  if (databaseRules.rules[".read"] !== false) {
    fail(`${config.rules} must keep root .read closed`);
  }
  if (databaseRules.rules[".write"] !== false) {
    fail(`${config.rules} must keep root .write closed`);
  }
  validateRealtimeRuleTree(databaseRules.rules, "rules");
}

const firebaseConfig = readJson("firebase.json");
const firebaseRc = readJson(".firebaserc");

if (firebaseRc) {
  if (!firebaseRc.projects || typeof firebaseRc.projects.default !== "string" || firebaseRc.projects.default.length < 3) {
    fail(".firebaserc must define projects.default");
  }
}

let configuredProducts = 0;
if (firebaseConfig) {
  if (firebaseConfig.firestore) {
    configuredProducts += 1;
    validateFirestore(firebaseConfig.firestore);
  }
  if (firebaseConfig.database) {
    configuredProducts += 1;
    validateRealtimeDatabase(firebaseConfig.database);
  }
  if (configuredProducts === 0) {
    fail("firebase.json must configure firestore or database");
  }
}

if (failures.length) {
  console.error("FIREBASE_CONFIG_FAILED");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`FIREBASE_CONFIG_OK products=${configuredProducts}`);
