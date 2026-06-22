const fs = require("fs");
const path = require("path");

const root = process.cwd();
const workflowsDir = path.join(root, ".github", "workflows");
const failures = [];

function fail(file, message) {
  failures.push(`${path.relative(root, file)}: ${message}`);
}

function jobBlocks(text) {
  const lines = text.split(/\r?\n/);
  const jobsLine = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (jobsLine < 0) return [];

  const blocks = [];
  let current = null;
  for (let i = jobsLine + 1; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (match) {
      if (current) blocks.push(current);
      current = { name: match[1], body: "" };
      continue;
    }
    if (current) current.body += `${line}\n`;
  }
  if (current) blocks.push(current);
  return blocks;
}

for (const entry of fs.readdirSync(workflowsDir, { withFileTypes: true })) {
  if (!entry.isFile() || !/\.ya?ml$/i.test(entry.name)) continue;
  const file = path.join(workflowsDir, entry.name);
  const text = fs.readFileSync(file, "utf8");

  if (/pull_request_target\s*:/i.test(text)) {
    fail(file, "pull_request_target is not allowed for this repository");
  }
  if (!/^permissions:\s*$/m.test(text)) {
    fail(file, "must declare explicit top-level permissions");
  }
  if (/^permissions:\s*write-all\s*$/mi.test(text)) {
    fail(file, "write-all permissions are not allowed");
  }
  if (!/^concurrency:\s*$/m.test(text)) {
    fail(file, "must declare concurrency to prevent duplicate production runs");
  }
  for (const match of text.matchAll(/uses:\s*['"]?([^'"\s]+)['"]?/g)) {
    if (/@(?:main|master|HEAD)$/i.test(match[1])) {
      fail(file, `action ${match[1]} must use a released version`);
    }
  }
  const jobs = jobBlocks(text);
  if (!jobs.length) {
    fail(file, "must define at least one job");
  }
  for (const job of jobs) {
    if (!/^\s{4}timeout-minutes:\s*\d+\s*$/m.test(job.body)) {
      fail(file, `job ${job.name} must set timeout-minutes`);
    }
  }
}

if (failures.length) {
  console.error("WORKFLOW_CONTRACTS_FAILED");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("WORKFLOW_CONTRACTS_OK");
