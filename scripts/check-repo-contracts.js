const fs = require("fs");
const path = require("path");

const root = process.cwd();
const repoName = path.basename(root);
const failures = [];

const requiredFiles = [
  ".gitattributes",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/dependabot.yml",
  ".github/pull_request_template.md",
  ".github/workflows/codeql.yml",
  ".github/workflows/quality.yml",
  "404.html",
  "CONTRIBUTING.md",
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "firebase.json",
  "robots.txt",
  "scripts/check-html-assets.js",
  "scripts/check-repo-contracts.js",
  "scripts/check-workflows.js",
  "scripts/validate-firebase-config.js",
  "sitemap.xml",
];

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

function exists(relPath) {
  return fs.existsSync(path.join(root, relPath));
}

for (const relPath of requiredFiles) {
  if (!exists(relPath)) failures.push(`required file missing: ${relPath}`);
}

if (exists("LICENSE") && !read("LICENSE").includes("MIT License")) {
  failures.push("LICENSE must contain MIT License text");
}

if (exists("robots.txt")) {
  const expected = `Sitemap: https://non-s.github.io/${repoName}/sitemap.xml`;
  if (!read("robots.txt").includes(expected)) {
    failures.push(`robots.txt must include ${expected}`);
  }
}

if (exists("sitemap.xml")) {
  const expected = `<loc>https://non-s.github.io/${repoName}/</loc>`;
  if (!read("sitemap.xml").includes(expected)) {
    failures.push(`sitemap.xml must include ${expected}`);
  }
}

if (exists(".github/workflows/quality.yml")) {
  const quality = read(".github/workflows/quality.yml");
  for (const token of ["check-workflows.js", "validate-firebase-config.js", "check-html-assets.js", "check-repo-contracts.js"]) {
    if (!quality.includes(token)) failures.push(`quality workflow must run ${token}`);
  }
}

if (failures.length) {
  console.error("REPO_CONTRACTS_FAILED");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("REPO_CONTRACTS_OK");
