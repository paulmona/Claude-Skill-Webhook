const express = require("express");
const { execFile } = require("child_process");

// Wrapper that closes stdin to prevent CLI from hanging waiting for input
function execFileAsync(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, opts, (err, stdout, stderr) => {
      if (err) { err.stdout = stdout; err.stderr = stderr; return reject(err); }
      resolve({ stdout, stderr });
    });
    child.stdin.end();
  });
}

const PORT = process.env.PORT || 3131;
const API_TOKEN = process.env.API_TOKEN;
const CLAUDE_TIMEOUT_MS = parseInt(process.env.CLAUDE_TIMEOUT_MS, 10) || 120000;
const HEALTH_TIMEOUT_MS = 15000;

// Clean env for child processes — strip CLAUDECODE to avoid nested-session errors
const childEnv = { ...process.env };
delete childEnv.CLAUDECODE;

const app = express();
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  const { method, url } = req;
  console.log(`→ ${method} ${url}${req.body && Object.keys(req.body).length ? " " + JSON.stringify(req.body) : ""}`);
  res.on("finish", () => {
    console.log(`← ${method} ${url} ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

// Bearer token auth middleware — skip auth when API_TOKEN is not set
app.use((req, res, next) => {
  if (!API_TOKEN) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${API_TOKEN}`) {
    return res.status(403).json({ error: "Forbidden" });
  }

  next();
});

// Lightweight auth check — runs a tiny prompt to verify Claude CLI can reach the API
async function checkClaudeAuth() {
  try {
    await execFileAsync("claude", ["-p", "ping", "--output-format", "json"], {
      timeout: HEALTH_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      env: childEnv,
    });
    return { authenticated: true };
  } catch (err) {
    return { authenticated: false };
  }
}

// GET /health — check Claude CLI auth status
app.get("/health", async (req, res) => {
  const { authenticated } = await checkClaudeAuth();
  if (authenticated) {
    return res.json({ status: "ok" });
  }
  return res.status(401).json({ status: "unauthenticated" });
});

// POST /skill — execute a Claude CLI skill (slash command)
app.post("/skill", async (req, res) => {
  const { skill } = req.body || {};

  if (!skill || typeof skill !== "string") {
    return res.status(400).json({ error: "skill is required" });
  }

  // Only allow alphanumeric, hyphens, and underscores in skill names
  if (!/^[a-zA-Z0-9_-]+$/.test(skill)) {
    return res.status(400).json({ error: "invalid skill name" });
  }

  const args = ["-p", `/${skill}`, "--output-format", "json", "--permission-mode", "bypassPermissions"];

  try {
    console.log(`[skill:${skill}] executing: claude ${args.join(" ")}`);
    const { stdout, stderr } = await execFileAsync("claude", args, {
      timeout: CLAUDE_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
      env: childEnv,
    });

    if (stderr) {
      console.warn(`[skill:${skill}] stderr: ${stderr}`);
    }

    const result = JSON.parse(stdout);
    console.log(`[skill:${skill}] turns=${result.num_turns} duration=${result.duration_ms}ms input_tokens=${result.input_tokens} output_tokens=${result.output_tokens} error=${result.is_error}`);
    console.log(`[skill:${skill}] result: ${result.result}`);
    return res.json(result);
  } catch (err) {
    if (err.killed) {
      console.error(`[skill:${skill}] TIMEOUT after ${CLAUDE_TIMEOUT_MS}ms`);
      if (err.stdout) console.error(`[skill:${skill}] partial stdout: ${err.stdout}`);
      if (err.stderr) console.error(`[skill:${skill}] stderr: ${err.stderr}`);
      return res.status(504).json({ error: "Claude CLI timed out" });
    }
    console.error(`[skill:${skill}] ERROR code=${err.code}`);
    if (err.stdout) console.error(`[skill:${skill}] stdout: ${err.stdout}`);
    if (err.stderr) console.error(`[skill:${skill}] stderr: ${err.stderr}`);
    return res.status(500).json({
      error: `Claude CLI exited with code ${err.code}`,
      stderr: err.stderr || "",
    });
  }
});

// POST /run — execute a raw prompt via Claude CLI
app.post("/run", async (req, res) => {
  const { prompt, system } = req.body || {};

  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "prompt is required" });
  }

  // Auth pre-check
  const { authenticated } = await checkClaudeAuth();
  if (!authenticated) {
    return res.status(401).json({ status: "unauthenticated" });
  }

  const args = ["-p", prompt, "--output-format", "json"];
  if (system && typeof system === "string") {
    args.push("--system-prompt", system);
  }

  try {
    console.log(`[run] executing: claude ${args.join(" ")}`);
    const { stdout, stderr } = await execFileAsync("claude", args, {
      timeout: CLAUDE_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
      env: childEnv,
    });

    if (stderr) {
      console.warn(`[run] stderr: ${stderr}`);
    }

    const result = JSON.parse(stdout);
    console.log(`[run] turns=${result.num_turns} duration=${result.duration_ms}ms input_tokens=${result.input_tokens} output_tokens=${result.output_tokens} error=${result.is_error}`);
    console.log(`[run] result: ${result.result}`);
    return res.json(result);
  } catch (err) {
    if (err.killed) {
      console.error(`[run] TIMEOUT after ${CLAUDE_TIMEOUT_MS}ms`);
      if (err.stdout) console.error(`[run] partial stdout: ${err.stdout}`);
      if (err.stderr) console.error(`[run] stderr: ${err.stderr}`);
      return res.status(504).json({ error: "Claude CLI timed out" });
    }
    console.error(`[run] ERROR code=${err.code}`);
    if (err.stdout) console.error(`[run] stdout: ${err.stdout}`);
    if (err.stderr) console.error(`[run] stderr: ${err.stderr}`);
    return res.status(500).json({
      error: `Claude CLI exited with code ${err.code}`,
      stderr: err.stderr || "",
    });
  }
});

app.listen(PORT, () => {
  console.log(`claude-skills-runner listening on port ${PORT}`);
  if (!API_TOKEN) {
    console.warn("WARNING: API_TOKEN is not set — all requests will be unauthenticated");
  }
});
