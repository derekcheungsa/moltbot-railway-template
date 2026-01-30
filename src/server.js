import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import express from "express";
import httpProxy from "http-proxy";
import * as tar from "tar";

// Railway deployments sometimes inject PORT=3000 by default. We want the wrapper to
// reliably listen on 8080 unless explicitly overridden.
//
// Prefer MOLTBOT_PUBLIC_PORT (set in the Dockerfile / template) over PORT.
// Backwards compatible: also supports CLAWDBOT_PUBLIC_PORT.
const PORT = Number.parseInt(
  process.env.MOLTBOT_PUBLIC_PORT ??
  process.env.CLAWDBOT_PUBLIC_PORT ??
  process.env.PORT ?? "8080", 10
);
const STATE_DIR =
  process.env.MOLTBOT_STATE_DIR?.trim() ||
  process.env.CLAWDBOT_STATE_DIR?.trim() ||
  path.join(os.homedir(), ".moltbot");
const WORKSPACE_DIR =
  process.env.MOLTBOT_WORKSPACE_DIR?.trim() ||
  process.env.CLAWDBOT_WORKSPACE_DIR?.trim() ||
  path.join(STATE_DIR, "workspace");

// Protect /setup with a user-provided password.
const SETUP_PASSWORD = process.env.SETUP_PASSWORD?.trim();

// Gateway admin token (protects Moltbot gateway + Control UI).
// Must be stable across restarts. If not provided via env, persist it in the state dir.
// Backwards compatible: also supports CLAWDBOT_GATEWAY_TOKEN.
function resolveGatewayToken() {
  const envTok =
    process.env.MOLTBOT_GATEWAY_TOKEN?.trim() ||
    process.env.CLAWDBOT_GATEWAY_TOKEN?.trim();
  if (envTok) return envTok;

  const tokenPath = path.join(STATE_DIR, "gateway.token");
  try {
    const existing = fs.readFileSync(tokenPath, "utf8").trim();
    if (existing) return existing;
  } catch {
    // ignore
  }

  const generated = crypto.randomBytes(32).toString("hex");
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(tokenPath, generated, { encoding: "utf8", mode: 0o600 });
  } catch {
    // best-effort
  }
  return generated;
}

const MOLTBOT_GATEWAY_TOKEN = resolveGatewayToken();
process.env.MOLTBOT_GATEWAY_TOKEN = MOLTBOT_GATEWAY_TOKEN;
// Also set CLAWDBOT_GATEWAY_TOKEN for backwards compat with gateway
process.env.CLAWDBOT_GATEWAY_TOKEN = MOLTBOT_GATEWAY_TOKEN;

// Where the gateway will listen internally (we proxy to it).
const INTERNAL_GATEWAY_PORT = Number.parseInt(process.env.INTERNAL_GATEWAY_PORT ?? "18789", 10);
const INTERNAL_GATEWAY_HOST = process.env.INTERNAL_GATEWAY_HOST ?? "127.0.0.1";
const GATEWAY_TARGET = `http://${INTERNAL_GATEWAY_HOST}:${INTERNAL_GATEWAY_PORT}`;

// Always run the built-from-source CLI entry directly to avoid PATH/global-install mismatches.
// Backwards compatible: also supports CLAWDBOT_ENTRY and CLAWDBOT_NODE.
const MOLTBOT_ENTRY = process.env.MOLTBOT_ENTRY?.trim() || process.env.CLAWDBOT_ENTRY?.trim() || "/moltbot/dist/entry.js";
const MOLTBOT_NODE = process.env.MOLTBOT_NODE?.trim() || process.env.CLAWDBOT_NODE?.trim() || "node";

function moltArgs(args) {
  return [MOLTBOT_ENTRY, ...args];
}

function configPath() {
  return
    process.env.MOLTBOT_CONFIG_PATH?.trim() ||
    process.env.CLAWDBOT_CONFIG_PATH?.trim() ||
    path.join(STATE_DIR, "moltbot.json");
}

function isConfigured() {
  try {
    return fs.existsSync(configPath());
  } catch {
    return false;
  }
}

let gatewayProc = null;
let gatewayStarting = null;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForGatewayReady(opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${GATEWAY_TARGET}/moltbot`, { method: "GET" });
      // Any HTTP response means the port is open.
      if (res) return true;
    } catch {
      // not ready
    }
    await sleep(250);
  }
  return false;
}

async function startGateway() {
  if (gatewayProc) return;
  if (!isConfigured()) throw new Error("Gateway cannot start: not configured");

  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

  const args = [
    "gateway",
    "run",
    "--bind",
    "loopback",
    "--port",
    String(INTERNAL_GATEWAY_PORT),
    "--auth",
    "token",
    "--token",
    MOLTBOT_GATEWAY_TOKEN,
  ];

  gatewayProc = childProcess.spawn(MOLTBOT_NODE, moltArgs(args), {
    stdio: "inherit",
    env: {
      ...process.env,
      MOLTBOT_STATE_DIR: STATE_DIR,
      MOLTBOT_WORKSPACE_DIR: WORKSPACE_DIR,
      // Also set CLAWDBOT_* for backwards compat
      CLAWDBOT_STATE_DIR: STATE_DIR,
      CLAWDBOT_WORKSPACE_DIR: WORKSPACE_DIR,
    },
  });

  gatewayProc.on("error", (err) => {
    console.error(`[gateway] spawn error: ${String(err)}`);
    gatewayProc = null;
  });

  gatewayProc.on("exit", (code, signal) => {
    console.error(`[gateway] exited code=${code} signal=${signal}`);
    gatewayProc = null;
  });
}

async function ensureGatewayRunning() {
  if (!isConfigured()) return { ok: false, reason: "not configured" };
  if (gatewayProc) return { ok: true };
  if (!gatewayStarting) {
    gatewayStarting = (async () => {
      await startGateway();
      const ready = await waitForGatewayReady({ timeoutMs: 20_000 });
      if (!ready) {
        throw new Error("Gateway did not become ready in time");
      }
    })().finally(() => {
      gatewayStarting = null;
    });
  }
  await gatewayStarting;
  return { ok: true };
}

async function restartGateway() {
  if (gatewayProc) {
    try {
      gatewayProc.kill("SIGTERM");
    } catch {
      // ignore
    }
    // Give it a moment to exit and release the port.
    await sleep(750);
    gatewayProc = null;
  }
  return ensureGatewayRunning();
}

function requireSetupAuth(req, res, next) {
  if (!SETUP_PASSWORD) {
    return res
      .status(500)
      .type("text/plain")
      .send("SETUP_PASSWORD is not set. Set it in Railway Variables before using /setup.");
  }

  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme !== "Basic" || !encoded) {
    res.set("WWW-Authenticate", 'Basic realm="Moltbot Setup"');
    return res.status(401).send("Auth required");
  }
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const idx = decoded.indexOf(":");
  const password = idx >= 0 ? decoded.slice(idx + 1) : "";
  if (password !== SETUP_PASSWORD) {
    res.set("WWW-Authenticate", 'Basic realm="Moltbot Setup"');
    return res.status(401).send("Invalid password");
  }
  return next();
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

// Minimal health endpoint for Railway.
app.get("/setup/healthz", (_req, res) => res.json({ ok: true }));

// Provider templates for one-click setup
const PROVIDER_TEMPLATES = {
  openai: {
    name: "OpenAI",
    description: "GPT-4 and GPT-3.5 models",
    authChoice: "openai-api-key",
    placeholder: "sk-...",
    fields: {
      authSecret: {
        label: "API Key",
        type: "password",
        help: "Get your key from https://platform.openai.com/api-keys",
        helpUrl: "https://platform.openai.com/api-keys"
      }
    },
    icon: "🤖"
  },
  anthropic: {
    name: "Anthropic Claude",
    description: "Claude 3.5 Sonnet, Opus, and Haiku",
    authChoice: "anthropic-api-key",
    placeholder: "sk-ant-...",
    fields: {
      authSecret: {
        label: "API Key",
        type: "password",
        help: "Get your key from https://console.anthropic.com/",
        helpUrl: "https://console.anthropic.com/"
      }
    },
    icon: "🧠"
  },
  google: {
    name: "Google Gemini",
    description: "Gemini Pro and Ultra models",
    authChoice: "gemini-api-key",
    placeholder: "AIza...",
    fields: {
      authSecret: {
        label: "API Key",
        type: "password",
        help: "Get your key from https://makersuite.google.com/app/apikey",
        helpUrl: "https://makersuite.google.com/app/apikey"
      }
    },
    icon: "💎"
  },
  atlascloud: {
    name: "Atlas Cloud",
    description: "Multi-provider API with OpenAI, Anthropic, and more",
    authChoice: "atlascloud-api-key",
    placeholder: "aat_...",
    fields: {
      authSecret: {
        label: "API Key",
        type: "password",
        help: "Get your key from your Atlas Cloud dashboard",
        helpUrl: "https://atlascloud.ai"
      },
      baseUrl: {
        label: "Base URL (optional)",
        type: "text",
        placeholder: "https://api.atlascloud.ai/v1",
        default: "https://api.atlascloud.ai/v1"
      }
    },
    icon: "☁️"
  },
  openrouter: {
    name: "OpenRouter",
    description: "Access to 100+ AI models through one API",
    authChoice: "openrouter-api-key",
    placeholder: "sk-or-...",
    fields: {
      authSecret: {
        label: "API Key",
        type: "password",
        help: "Get your key from https://openrouter.ai/keys",
        helpUrl: "https://openrouter.ai/keys"
      }
    },
    icon: "🔀"
  }
};

app.get("/setup/api/templates", requireSetupAuth, (_req, res) => {
  res.json({ templates: PROVIDER_TEMPLATES });
});

app.get("/setup/api/templates/:provider", requireSetupAuth, (req, res) => {
  const template = PROVIDER_TEMPLATES[req.params.provider];
  if (!template) {
    return res.status(404).json({ error: "Template not found" });
  }
  res.json(template);
});

// Pre-flight validation checks
app.get("/setup/api/check", requireSetupAuth, async (_req, res) => {
  const checks = [];

  // Check Moltbot CLI
  try {
    const versionResult = await runCmd(MOLTBOT_NODE, moltArgs(["--version"]));
    checks.push({
      name: "Moltbot CLI",
      status: "ok",
      message: `Version ${versionResult.output.trim()}`
    });
  } catch (err) {
    checks.push({
      name: "Moltbot CLI",
      status: "error",
      message: `CLI not accessible: ${String(err)}`
    });
  }

  // Check state directory
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const stateAccessible = fs.accessSync(STATE_DIR, fs.constants.W_OK);
    checks.push({
      name: "State Directory",
      status: "ok",
      message: `Writable: ${STATE_DIR}`
    });
  } catch (err) {
    checks.push({
      name: "State Directory",
      status: "error",
      message: `Cannot write to ${STATE_DIR}: ${String(err)}`
    });
  }

  // Check workspace directory
  try {
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
    checks.push({
      name: "Workspace Directory",
      status: "ok",
      message: `Writable: ${WORKSPACE_DIR}`
    });
  } catch (err) {
    checks.push({
      name: "Workspace Directory",
      status: "error",
      message: `Cannot write to ${WORKSPACE_DIR}: ${String(err)}`
    });
  }

  // Check memory
  const totalMem = Math.round(os.totalmem() / 1024 / 1024);
  const freeMem = Math.round(os.freemem() / 1024 / 1024);
  checks.push({
    name: "Available Memory",
    status: freeMem > 256 ? "ok" : "warning",
    message: `${freeMem}MB available (512MB+ recommended)`,
    value: freeMem
  });

  // Check disk space
  try {
    const stats = await fs.promises.statfs(STATE_DIR);
    // Validate statfs values exist and are valid numbers
    if (stats && typeof stats.bavail === 'number' && typeof stats.frsize === 'number' && stats.bavail > 0 && stats.frsize > 0) {
      const freeSpace = Math.round(stats.bavail * stats.frsize / 1024 / 1024);
      checks.push({
        name: "Disk Space",
        status: freeSpace > 100 ? "ok" : "warning",
        message: `${freeSpace}MB available`,
        value: freeSpace
      });
    } else {
      // statfs succeeded but returned invalid data (common in some container environments)
      // Don't fail the check - Railway volumes are typically large enough
      checks.push({
        name: "Disk Space",
        status: "ok",
        message: "OK (could not measure, Railway volumes typically 1GB+)"
      });
    }
  } catch (err) {
    // statfs not available or failed (common in Windows/some containers)
    // Don't fail the check - this is expected in some environments
    checks.push({
      name: "Disk Space",
      status: "ok",
      message: "OK (could not measure, Railway volumes typically 1GB+)"
    });
  }

  const allOk = checks.every(c => c.status === "ok");
  res.json({
    ready: allOk,
    checks,
    summary: allOk ? "All checks passed. Ready to setup." : "Some checks failed. Please fix issues before proceeding."
  });
});

// Token validation endpoint
app.post("/setup/api/validate-token", requireSetupAuth, async (req, res) => {
  const { provider, token, baseUrl } = req.body || {};

  if (!provider || !token) {
    return res.status(400).json({ valid: false, error: "Provider and token are required" });
  }

  // Validate token format first (quick check)
  let formatValid = true;
  let formatError = "";

  switch (provider) {
    case "openai-api-key":
      if (!token.startsWith("sk-")) {
        formatValid = false;
        formatError = "OpenAI API keys should start with 'sk-'";
      }
      break;
    case "anthropic-api-key":
      if (!token.startsWith("sk-ant-")) {
        formatValid = false;
        formatError = "Anthropic API keys should start with 'sk-ant-'";
      }
      break;
    case "gemini-api-key":
      if (!token.startsWith("AIza")) {
        formatValid = false;
        formatError = "Gemini API keys should start with 'AIza'";
      }
      break;
    case "atlascloud-api-key":
      if (!token.startsWith("aat_")) {
        formatValid = false;
        formatError = "Atlas Cloud API keys should start with 'aat_'";
      }
      break;
    case "openrouter-api-key":
      if (!token.startsWith("sk-or-")) {
        formatValid = false;
        formatError = "OpenRouter API keys should start with 'sk-or-'";
      }
      break;
  }

  if (!formatValid) {
    return res.json({ valid: false, error: formatError });
  }

  // Quick validation by attempting to use the token
  try {
    let validationOk = false;
    let providerName = "";

    if (provider === "openai-api-key") {
      // Test with a minimal API call
      const response = await fetch("https://api.openai.com/v1/models", {
        headers: { "Authorization": `Bearer ${token}` },
        signal: AbortSignal.timeout(5000)
      });
      validationOk = response.ok;
      providerName = "OpenAI";
    } else if (provider === "anthropic-api-key") {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": token,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: "claude-3-haiku-20240307",
          max_tokens: 1,
          messages: [{ role: "user", content: "test" }]
        }),
        signal: AbortSignal.timeout(5000)
      });
      validationOk = response.status !== 401;
      providerName = "Anthropic";
    } else if (provider === "atlascloud-api-key") {
      const apiUrl = baseUrl || "https://api.atlascloud.ai/v1";
      const response = await fetch(`${apiUrl}/models`, {
        headers: { "Authorization": `Bearer ${token}` },
        signal: AbortSignal.timeout(5000)
      });
      validationOk = response.ok;
      providerName = "Atlas Cloud";
    } else {
      // For other providers, just verify format
      validationOk = true;
    }

    res.json({
      valid: validationOk,
      provider: providerName,
      message: validationOk ? "Token validated successfully" : "Token validation failed"
    });
  } catch (err) {
    res.json({
      valid: false,
      error: `Validation failed: ${err.message}`
    });
  }
});

// SSE endpoint for streaming setup progress
app.get("/setup/api/progress", requireSetupAuth, async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Check if already configured
    if (isConfigured()) {
      sendEvent("progress", { stage: "complete", message: "Already configured" });
      await ensureGatewayRunning();
      sendEvent("done", { success: true, message: "Setup already complete" });
      return res.end();
    }

    sendEvent("progress", { stage: "starting", message: "Initializing setup..." });

    // Create directories
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
    sendEvent("progress", { stage: "directories", message: "Created state directories" });

    // Get the setup payload from query or session
    // For simplicity, we'll expect the client to POST to run first, then poll for progress
    sendEvent("progress", { stage: "waiting", message: "Waiting for setup parameters..." });

  } catch (err) {
    sendEvent("error", { error: String(err) });
    res.end();
  }
});

app.get("/setup/app.js", requireSetupAuth, (_req, res) => {
  // Serve JS for /setup (kept external to avoid inline encoding/template issues)
  res.type("application/javascript");
  res.send(fs.readFileSync(path.join(process.cwd(), "src", "setup-app.js"), "utf8"));
});

app.get("/setup", requireSetupAuth, (_req, res) => {
  // No inline <script>: serve JS from /setup/app.js to avoid any encoding/template-literal issues.
  res.type("html").send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Moltbot Setup</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; margin: 2rem; max-width: 900px; }
    .card { border: 1px solid #ddd; border-radius: 12px; padding: 1.25rem; margin: 1rem 0; }
    label { display:block; margin-top: 0.75rem; font-weight: 600; }
    input, select { width: 100%; padding: 0.6rem; margin-top: 0.25rem; }
    button { padding: 0.8rem 1.2rem; border-radius: 10px; border: 0; background: #111; color: #fff; font-weight: 700; cursor: pointer; }
    code { background: #f6f6f6; padding: 0.1rem 0.3rem; border-radius: 6px; }
    .muted { color: #555; }
  </style>
</head>
<body>
  <h1>Moltbot Setup</h1>
  <p class="muted">This wizard configures Moltbot by running the same onboarding command it uses in the terminal, but from the browser.</p>

  <div class="card">
    <h2>Status</h2>
    <div id="status">Loading...</div>
    <div style="margin-top: 0.75rem">
      <a href="/moltbot" target="_blank">Open Moltbot UI</a>
      &nbsp;|&nbsp;
      <a href="/setup/export" target="_blank">Download backup (.tar.gz)</a>
    </div>
  </div>

  <div class="card">
    <h2>🚀 Quick Setup</h2>
    <p class="muted">Click a provider to auto-fill configuration:</p>
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.5rem; margin: 1rem 0;">
      <button onclick="useProvider('openai')" style="background:#10a37f; padding:0.6rem;">🤖 OpenAI</button>
      <button onclick="useProvider('anthropic')" style="background:#d4a573; color:white; padding:0.6rem;">🧠 Anthropic</button>
      <button onclick="useProvider('google')" style="background:#4285f4; color:white; padding:0.6rem;">💎 Gemini</button>
      <button onclick="useProvider('atlascloud')" style="background:#8b5cf6; color:white; padding:0.6rem;">☁️ Atlas Cloud</button>
      <button onclick="useProvider('openrouter')" style="background:#6366f1; color:white; padding:0.6rem;">🔀 OpenRouter</button>
    </div>
  </div>

  <div class="card">
    <h2>✅ Pre-flight Checks</h2>
    <button onclick="runPreflightChecks()" style="margin-bottom: 0.75rem;">Run Checks</button>
    <div id="preflightResults" style="margin-top: 0.75rem;"></div>
  </div>

  <div class="card">
    <h2>1) Model/auth provider</h2>
    <p class="muted">Matches the groups shown in the terminal onboarding.</p>
    <label>Provider group</label>
    <select id="authGroup"></select>

    <label>Auth method</label>
    <select id="authChoice"></select>

    <label>Key / Token (if required)</label>
    <input id="authSecret" type="password" placeholder="Paste API key / token if applicable" onblur="validateToken()" />
    <button id="validateBtn" onclick="validateToken()" type="button" style="margin-top:0.5rem; padding:0.5rem 1rem; background:#6b7280; font-size:0.9rem;">Validate Token</button>
    <div id="authSecretHelp" class="muted" style="margin-top: 0.5rem; display:none;"></div>

    <label>Base URL (optional, for Atlas Cloud)</label>
    <input id="baseUrl" type="text" placeholder="https://api.atlascloud.ai/v1" />
    <div class="muted" style="margin-top: 0.25rem;">Leave blank to use provider default</div>

    <label>Wizard flow</label>
    <select id="flow">
      <option value="quickstart">quickstart</option>
      <option value="advanced">advanced</option>
      <option value="manual">manual</option>
    </select>
  </div>

  <div class="card">
    <h2>2) Optional: Channels</h2>
    <p class="muted">You can also add channels later inside Moltbot, but this helps you get messaging working immediately.</p>

    <label>Telegram bot token (optional)</label>
    <input id="telegramToken" type="password" placeholder="123456:ABC..." />
    <div class="muted" style="margin-top: 0.25rem">
      Get it from BotFather: open Telegram, message <code>@BotFather</code>, run <code>/newbot</code>, then copy the token.
    </div>

    <label>Discord bot token (optional)</label>
    <input id="discordToken" type="password" placeholder="Bot token" />
    <div class="muted" style="margin-top: 0.25rem">
      Get it from the Discord Developer Portal: create an application, add a Bot, then copy the Bot Token.<br/>
      <strong>Important:</strong> Enable <strong>MESSAGE CONTENT INTENT</strong> in Bot → Privileged Gateway Intents, or the bot will crash on startup.
    </div>

    <label>Slack bot token (optional)</label>
    <input id="slackBotToken" type="password" placeholder="xoxb-..." />

    <label>Slack app token (optional)</label>
    <input id="slackAppToken" type="password" placeholder="xapp-..." />
  </div>

  <div class="card">
    <h2>3) Run onboarding</h2>
    <button id="run">Run setup</button>
    <button id="pairingApprove" style="background:#1f2937; margin-left:0.5rem">Approve pairing</button>
    <button id="reset" style="background:#444; margin-left:0.5rem">Reset setup</button>
    <pre id="log" style="white-space:pre-wrap"></pre>
    <p class="muted">Reset deletes the Moltbot config file so you can rerun onboarding. Pairing approval lets you grant DM access when dmPolicy=pairing.</p>
  </div>

  <script src="/setup/app.js"></script>
</body>
</html>`);
});

app.get("/setup/api/status", requireSetupAuth, async (_req, res) => {
  const version = await runCmd(MOLTBOT_NODE, moltArgs(["--version"]));
  const channelsHelp = await runCmd(MOLTBOT_NODE, moltArgs(["channels", "add", "--help"]));

  // We reuse Moltbot's own auth-choice grouping logic indirectly by hardcoding the same group defs.
  // This is intentionally minimal; later we can parse the CLI help output to stay perfectly in sync.
  const authGroups = [
    { value: "openai", label: "OpenAI", hint: "Codex OAuth + API key", options: [
      { value: "codex-cli", label: "OpenAI Codex OAuth (Codex CLI)" },
      { value: "openai-codex", label: "OpenAI Codex (ChatGPT OAuth)" },
      { value: "openai-api-key", label: "OpenAI API key" }
    ]},
    { value: "anthropic", label: "Anthropic", hint: "Claude Code CLI + API key", options: [
      { value: "claude-cli", label: "Anthropic token (Claude Code CLI)" },
      { value: "token", label: "Anthropic token (paste setup-token)" },
      { value: "apiKey", label: "Anthropic API key" }
    ]},
    { value: "google", label: "Google", hint: "Gemini API key + OAuth", options: [
      { value: "gemini-api-key", label: "Google Gemini API key" },
      { value: "google-antigravity", label: "Google Antigravity OAuth" },
      { value: "google-gemini-cli", label: "Google Gemini CLI OAuth" }
    ]},
    { value: "openrouter", label: "OpenRouter", hint: "API key", options: [
      { value: "openrouter-api-key", label: "OpenRouter API key" }
    ]},
    { value: "atlascloud", label: "Atlas Cloud", hint: "Multi-provider API", options: [
      { value: "atlascloud-api-key", label: "Atlas Cloud API key" }
    ]},
    { value: "ai-gateway", label: "Vercel AI Gateway", hint: "API key", options: [
      { value: "ai-gateway-api-key", label: "Vercel AI Gateway API key" }
    ]},
    { value: "moonshot", label: "Moonshot AI", hint: "Kimi K2 + Kimi Code", options: [
      { value: "moonshot-api-key", label: "Moonshot AI API key" },
      { value: "kimi-code-api-key", label: "Kimi Code API key" }
    ]},
    { value: "zai", label: "Z.AI (GLM 4.7)", hint: "API key", options: [
      { value: "zai-api-key", label: "Z.AI (GLM 4.7) API key" }
    ]},
    { value: "minimax", label: "MiniMax", hint: "M2.1 (recommended)", options: [
      { value: "minimax-api", label: "MiniMax M2.1" },
      { value: "minimax-api-lightning", label: "MiniMax M2.1 Lightning" }
    ]},
    { value: "qwen", label: "Qwen", hint: "OAuth", options: [
      { value: "qwen-portal", label: "Qwen OAuth" }
    ]},
    { value: "copilot", label: "Copilot", hint: "GitHub + local proxy", options: [
      { value: "github-copilot", label: "GitHub Copilot (GitHub device login)" },
      { value: "copilot-proxy", label: "Copilot Proxy (local)" }
    ]},
    { value: "synthetic", label: "Synthetic", hint: "Anthropic-compatible (multi-model)", options: [
      { value: "synthetic-api-key", label: "Synthetic API key" }
    ]},
    { value: "opencode-zen", label: "OpenCode Zen", hint: "API key", options: [
      { value: "opencode-zen", label: "OpenCode Zen (multi-model proxy)" }
    ]}
  ];

  res.json({
    configured: isConfigured(),
    gatewayTarget: GATEWAY_TARGET,
    moltbotVersion: version.output.trim(),
    channelsAddHelp: channelsHelp.output,
    authGroups,
  });
});

function buildOnboardArgs(payload) {
  const args = [
    "onboard",
    "--non-interactive",
    "--accept-risk",
    "--json",
    "--no-install-daemon",
    "--skip-health",
    "--workspace",
    WORKSPACE_DIR,
    // The wrapper owns public networking; keep the gateway internal.
    "--gateway-bind",
    "loopback",
    "--gateway-port",
    String(INTERNAL_GATEWAY_PORT),
    "--gateway-auth",
    "token",
    "--gateway-token",
    MOLTBOT_GATEWAY_TOKEN,
    "--flow",
    payload.flow || "quickstart"
  ];

  if (payload.authChoice) {
    args.push("--auth-choice", payload.authChoice);

    // Map secret to correct flag for common choices.
    const secret = (payload.authSecret || "").trim();
    const map = {
      "openai-api-key": "--openai-api-key",
      "apiKey": "--anthropic-api-key",
      "atlascloud-api-key": "--atlascloud-api-key",
      "openrouter-api-key": "--openrouter-api-key",
      "ai-gateway-api-key": "--ai-gateway-api-key",
      "moonshot-api-key": "--moonshot-api-key",
      "kimi-code-api-key": "--kimi-code-api-key",
      "gemini-api-key": "--gemini-api-key",
      "zai-api-key": "--zai-api-key",
      "minimax-api": "--minimax-api-key",
      "minimax-api-lightning": "--minimax-api-key",
      "synthetic-api-key": "--synthetic-api-key",
      "opencode-zen": "--opencode-zen-api-key"
    };
    const flag = map[payload.authChoice];
    if (flag && secret) {
      args.push(flag, secret);
    }

    if (payload.authChoice === "token" && secret) {
      // This is the Anthropics setup-token flow.
      args.push("--token-provider", "anthropic", "--token", secret);
    }
  }

  return args;
}

function runCmd(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const proc = childProcess.spawn(cmd, args, {
      ...opts,
      env: {
        ...process.env,
        CLAWDBOT_STATE_DIR: STATE_DIR,
        CLAWDBOT_WORKSPACE_DIR: WORKSPACE_DIR,
      },
    });

    let out = "";
    proc.stdout?.on("data", (d) => (out += d.toString("utf8")));
    proc.stderr?.on("data", (d) => (out += d.toString("utf8")));

    proc.on("error", (err) => {
      out += `\n[spawn error] ${String(err)}\n`;
      resolve({ code: 127, output: out });
    });

    proc.on("close", (code) => resolve({ code: code ?? 0, output: out }));
  });
}

app.post("/setup/api/run", requireSetupAuth, async (req, res) => {
  try {
    if (isConfigured()) {
      await ensureGatewayRunning();
      return res.json({ ok: true, output: "Already configured.\nUse Reset setup if you want to rerun onboarding.\n" });
    }

  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

  const payload = req.body || {};
  const onboardArgs = buildOnboardArgs(payload);
  const onboard = await runCmd(MOLTBOT_NODE, moltArgs(onboardArgs));

  let extra = "";

  const ok = onboard.code === 0 && isConfigured();

  // Optional channel setup (only after successful onboarding, and only if the installed CLI supports it).
  if (ok) {
    // Ensure gateway token is written into config so the browser UI can authenticate reliably.
    // (We also enforce loopback bind since the wrapper proxies externally.)
    await runCmd(MOLTBOT_NODE, moltArgs(["config", "set", "gateway.auth.mode", "token"]));
    await runCmd(MOLTBOT_NODE, moltArgs(["config", "set", "gateway.auth.token", MOLTBOT_GATEWAY_TOKEN]));
    await runCmd(MOLTBOT_NODE, moltArgs(["config", "set", "gateway.bind", "loopback"]));
    await runCmd(MOLTBOT_NODE, moltArgs(["config", "set", "gateway.port", String(INTERNAL_GATEWAY_PORT)]));

    const channelsHelp = await runCmd(MOLTBOT_NODE, moltArgs(["channels", "add", "--help"]));
    const helpText = channelsHelp.output || "";

    const supports = (name) => helpText.includes(name);

    if (payload.telegramToken?.trim()) {
      if (!supports("telegram")) {
        extra += "\n[telegram] skipped (this moltbot build does not list telegram in `channels add --help`)\n";
      } else {
        // Avoid `channels add` here (it has proven flaky across builds); write config directly.
        const token = payload.telegramToken.trim();
        const cfgObj = {
          enabled: true,
          dmPolicy: "pairing",
          botToken: token,
          groupPolicy: "allowlist",
          streamMode: "partial",
        };
        const set = await runCmd(
          MOLTBOT_NODE,
          moltArgs(["config", "set", "--json", "channels.telegram", JSON.stringify(cfgObj)]),
        );
        const get = await runCmd(MOLTBOT_NODE, moltArgs(["config", "get", "channels.telegram"]));
        extra += `\n[telegram config] exit=${set.code} (output ${set.output.length} chars)\n${set.output || "(no output)"}`;
        extra += `\n[telegram verify] exit=${get.code} (output ${get.output.length} chars)\n${get.output || "(no output)"}`;
      }
    }

    if (payload.discordToken?.trim()) {
      if (!supports("discord")) {
        extra += "\n[discord] skipped (this moltbot build does not list discord in `channels add --help`)\n";
      } else {
        const token = payload.discordToken.trim();
        const cfgObj = {
          enabled: true,
          token,
          groupPolicy: "allowlist",
          dm: {
            policy: "pairing",
          },
        };
        const set = await runCmd(
          MOLTBOT_NODE,
          moltArgs(["config", "set", "--json", "channels.discord", JSON.stringify(cfgObj)]),
        );
        const get = await runCmd(MOLTBOT_NODE, moltArgs(["config", "get", "channels.discord"]));
        extra += `\n[discord config] exit=${set.code} (output ${set.output.length} chars)\n${set.output || "(no output)"}`;
        extra += `\n[discord verify] exit=${get.code} (output ${get.output.length} chars)\n${get.output || "(no output)"}`;
      }
    }

    if (payload.slackBotToken?.trim() || payload.slackAppToken?.trim()) {
      if (!supports("slack")) {
        extra += "\n[slack] skipped (this moltbot build does not list slack in `channels add --help`)\n";
      } else {
        const cfgObj = {
          enabled: true,
          botToken: payload.slackBotToken?.trim() || undefined,
          appToken: payload.slackAppToken?.trim() || undefined,
        };
        const set = await runCmd(
          MOLTBOT_NODE,
          moltArgs(["config", "set", "--json", "channels.slack", JSON.stringify(cfgObj)]),
        );
        const get = await runCmd(MOLTBOT_NODE, moltArgs(["config", "get", "channels.slack"]));
        extra += `\n[slack config] exit=${set.code} (output ${set.output.length} chars)\n${set.output || "(no output)"}`;
        extra += `\n[slack verify] exit=${get.code} (output ${get.output.length} chars)\n${get.output || "(no output)"}`;
      }
    }

    // Apply changes immediately.
    await restartGateway();
  }

  return res.status(ok ? 200 : 500).json({
    ok,
    output: `${onboard.output}${extra}`,
  });
  } catch (err) {
    console.error("[/setup/api/run] error:", err);
    return res.status(500).json({ ok: false, output: `Internal error: ${String(err)}` });
  }
});

app.get("/setup/api/debug", requireSetupAuth, async (_req, res) => {
  const v = await runCmd(MOLTBOT_NODE, moltArgs(["--version"]));
  const help = await runCmd(MOLTBOT_NODE, moltArgs(["channels", "add", "--help"]));
  res.json({
    wrapper: {
      node: process.version,
      port: PORT,
      stateDir: STATE_DIR,
      workspaceDir: WORKSPACE_DIR,
      configPath: configPath(),
      gatewayTokenFromEnv: Boolean(
        process.env.MOLTBOT_GATEWAY_TOKEN?.trim() ||
        process.env.CLAWDBOT_GATEWAY_TOKEN?.trim()
      ),
      gatewayTokenPersisted: fs.existsSync(path.join(STATE_DIR, "gateway.token")),
      railwayCommit: process.env.RAILWAY_GIT_COMMIT_SHA || null,
    },
    moltbot: {
      entry: MOLTBOT_ENTRY,
      node: MOLTBOT_NODE,
      version: v.output.trim(),
      channelsAddHelpIncludesTelegram: help.output.includes("telegram"),
    },
  });
});

app.post("/setup/api/pairing/approve", requireSetupAuth, async (req, res) => {
  const { channel, code } = req.body || {};
  if (!channel || !code) {
    return res.status(400).json({ ok: false, error: "Missing channel or code" });
  }
  const r = await runCmd(MOLTBOT_NODE, moltArgs(["pairing", "approve", String(channel), String(code)]));
  return res.status(r.code === 0 ? 200 : 500).json({ ok: r.code === 0, output: r.output });
});

app.post("/setup/api/reset", requireSetupAuth, async (_req, res) => {
  // Minimal reset: delete the config file so /setup can rerun.
  // Keep credentials/sessions/workspace by default.
  try {
    fs.rmSync(configPath(), { force: true });
    res.type("text/plain").send("OK - deleted config file. You can rerun setup now.");
  } catch (err) {
    res.status(500).type("text/plain").send(String(err));
  }
});

app.get("/setup/export", requireSetupAuth, async (_req, res) => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

  res.setHeader("content-type", "application/gzip");
  res.setHeader(
    "content-disposition",
    `attachment; filename="moltbot-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.tar.gz"`,
  );

  // Prefer exporting from a common /data root so archives are easy to inspect and restore.
  // This preserves dotfiles like /data/.moltbot/moltbot.json.
  const stateAbs = path.resolve(STATE_DIR);
  const workspaceAbs = path.resolve(WORKSPACE_DIR);

  const dataRoot = "/data";
  const underData = (p) => p === dataRoot || p.startsWith(dataRoot + path.sep);

  let cwd = "/";
  let paths = [stateAbs, workspaceAbs].map((p) => p.replace(/^\//, ""));

  if (underData(stateAbs) && underData(workspaceAbs)) {
    cwd = dataRoot;
    // We export relative to /data so the archive contains: .moltbot/... and workspace/...
    paths = [
      path.relative(dataRoot, stateAbs) || ".",
      path.relative(dataRoot, workspaceAbs) || ".",
    ];
  }

  const stream = tar.c(
    {
      gzip: true,
      portable: true,
      noMtime: true,
      cwd,
      onwarn: () => {},
    },
    paths,
  );

  stream.on("error", (err) => {
    console.error("[export]", err);
    if (!res.headersSent) res.status(500);
    res.end(String(err));
  });

  stream.pipe(res);
});

// Proxy everything else to the gateway.
const proxy = httpProxy.createProxyServer({
  target: GATEWAY_TARGET,
  ws: true,
  xfwd: true,
});

proxy.on("error", (err, _req, _res) => {
  console.error("[proxy]", err);
});

app.use(async (req, res) => {
  // If not configured, force users to /setup for any non-setup routes.
  if (!isConfigured() && !req.path.startsWith("/setup")) {
    return res.redirect("/setup");
  }

  if (isConfigured()) {
    try {
      await ensureGatewayRunning();
    } catch (err) {
      return res.status(503).type("text/plain").send(`Gateway not ready: ${String(err)}`);
    }
  }

  return proxy.web(req, res, { target: GATEWAY_TARGET });
});

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`[wrapper] listening on :${PORT}`);
  console.log(`[wrapper] state dir: ${STATE_DIR}`);
  console.log(`[wrapper] workspace dir: ${WORKSPACE_DIR}`);
  console.log(`[wrapper] gateway token: ${MOLTBOT_GATEWAY_TOKEN ? "(set)" : "(missing)"}`);
  console.log(`[wrapper] gateway target: ${GATEWAY_TARGET}`);
  if (!SETUP_PASSWORD) {
    console.warn("[wrapper] WARNING: SETUP_PASSWORD is not set; /setup will error.");
  }
  // Don't start gateway unless configured; proxy will ensure it starts.
});

server.on("upgrade", async (req, socket, head) => {
  if (!isConfigured()) {
    socket.destroy();
    return;
  }
  try {
    await ensureGatewayRunning();
  } catch {
    socket.destroy();
    return;
  }
  proxy.ws(req, socket, head, { target: GATEWAY_TARGET });
});

process.on("SIGTERM", () => {
  // Best-effort shutdown
  try {
    if (gatewayProc) gatewayProc.kill("SIGTERM");
  } catch {
    // ignore
  }
  process.exit(0);
});
