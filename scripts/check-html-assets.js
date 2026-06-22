const fs = require("fs");
const path = require("path");

const root = process.cwd();
const htmlFiles = [];
const failures = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    if (entry.isFile() && entry.name.endsWith(".html")) htmlFiles.push(full);
  }
}

function cleanReference(value) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("#")) return "";
  if (/^(?:https?:|mailto:|tel:|javascript:|data:|blob:|\/\/)/i.test(trimmed)) return "";
  return trimmed.split("#")[0].split("?")[0];
}

walk(root);

for (const file of htmlFiles) {
  const html = fs.readFileSync(file, "utf8");
  const refs = html.matchAll(/(?:src|href|poster)\s*=\s*["']([^"']+)["']/gi);
  for (const ref of refs) {
    const raw = ref[1];
    const clean = cleanReference(raw);
    if (!clean || clean.endsWith("/")) continue;
    if (clean.startsWith("/")) {
      failures.push(`${path.relative(root, file)} uses root-relative asset ${raw}`);
      continue;
    }
    const target = path.resolve(path.dirname(file), clean);
    if (!fs.existsSync(target)) {
      failures.push(`${path.relative(root, file)} references missing asset ${raw}`);
    }
  }
}

if (failures.length) {
  console.error("HTML_ASSET_CONTRACT_FAILED");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`HTML_ASSET_CONTRACT_OK files=${htmlFiles.length}`);
