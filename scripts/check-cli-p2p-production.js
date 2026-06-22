const fs = require("fs");
const path = require("path");

const root = process.cwd();
const failures = [];

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

function fail(message) {
  failures.push(message);
}

function mustMatch(relPath, pattern, message) {
  const text = read(relPath);
  if (!pattern.test(text)) fail(`${relPath}: ${message}`);
}

function mustNotMatch(relPath, pattern, message) {
  const text = read(relPath);
  if (pattern.test(text)) fail(`${relPath}: ${message}`);
}

mustMatch("script.js", /const CLI_P2P_LIMITS = Object\.freeze/, "production limits must be centralized");
mustMatch("script.js", /window\.CLI_P2P_LIMITS = CLI_P2P_LIMITS/, "limits must be inspectable in production smoke checks");
mustMatch("script.js", /crypto\.getRandomValues/, "room/session randomness must use Web Crypto");
mustMatch("script.js", /limitToLast\(CLI_P2P_LIMITS\.history\)/, "message history reads must be bounded");
mustMatch("script.js", /limitToLast\(CLI_P2P_LIMITS\.presence\)/, "presence reads must be bounded");
mustMatch("script.js", /replaceChildren/, "user-rendered lists and clears must use DOM APIs");
mustMatch("script.js", /textContent/, "user text must be rendered as text");
mustMatch("script.js", /sendCooldownMs/, "message sending must have a client-side cooldown");
mustMatch("script.js", /uid: state\.uid/, "writes must include authenticated uid binding");
mustNotMatch("script.js", /\.innerHTML\s*=/, "script must not inject user-controlled HTML");

mustMatch("database.rules.json", /query\.orderByChild == 'created_at'/, "message reads must require created_at ordering");
mustMatch("database.rules.json", /query\.limitToLast <= 100/, "message reads must be capped");
mustMatch("database.rules.json", /query\.orderByChild == 'updated_at'/, "presence reads must require updated_at ordering");
mustMatch("database.rules.json", /query\.limitToLast <= 200/, "presence reads must be capped");
mustMatch("database.rules.json", /newData\.child\('uid'\)\.val\(\) == auth\.uid/, "writes must bind payload uid to auth uid");
mustMatch("database.rules.json", /newData\.child\('created_at'\)\.val\(\) == now/, "message timestamps must use server time");
mustMatch("database.rules.json", /newData\.child\('updated_at'\)\.val\(\) == now/, "presence timestamps must use server time");
mustMatch("database.rules.json", /newData\.child\('text'\)\.val\(\)\.length <= 500/, "message text must be size-limited");
mustMatch("database.rules.json", /"\.read"\s*:\s*false/, "root read must stay closed");
mustMatch("database.rules.json", /"\.write"\s*:\s*false/, "root write must stay closed");

mustMatch("index.html", /maxlength="500"/, "message input must enforce the production text limit");
mustMatch("style.css", /white-space:pre-wrap/, "terminal text must preserve intentional line breaks safely");

if (failures.length) {
  console.error("CLI_P2P_PRODUCTION_CHECK_FAILED");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("CLI_P2P_PRODUCTION_CHECK_OK");
