# External Integrations

**Analysis Date:** 2026-01-29

## APIs & External Services

**AI Provider Groups:**
- **OpenAI** - Codex OAuth + API key
  - Options: Codex CLI, ChatGPT OAuth, API key
- **Anthropic** - Claude Code CLI + API key
  - Options: Claude Code token, setup-token, API key
- **Google** - Gemini API key + OAuth
  - Options: Gemini API key, Antigravity OAuth, Gemini CLI OAuth
- **OpenRouter** - API key
- **Vercel AI Gateway** - API key
- **Moonshot AI** - Kimi K2 + Kimi Code
  - Options: API key, Kimi Code API key
- **Z.AI (GLM 4.7)** - API key
- **MiniMax** - M2.1 (recommended)
  - Options: M2.1, M2.1 Lightning
- **Qwen** - OAuth
  - Options: Qwen OAuth
- **Copilot** - GitHub + local proxy
  - Options: GitHub Copilot (device login), Copilot Proxy
- **Synthetic** - Anthropic-compatible (multi-model)
- **OpenCode Zen** - API key

**Messaging Platforms:**
- **Telegram** - Bot tokens for channel integration
- **Discord** - Bot tokens with message content intent
- **Slack** - Bot tokens and app tokens

## Data Storage

**Databases:**
- None detected (clawdbot likely handles its own data)

**File Storage:**
- Local filesystem for state and workspace directories
- Export functionality creates .tar.gz archives

**Caching:**
- Not detected in codebase

## Authentication & Identity

**Auth Provider:**
- Custom token-based authentication for gateway
- Basic auth for setup endpoint
- Support for multiple AI provider authentication methods

**Implementation:**
- Gateway tokens persisted to filesystem
- Setup password protection via HTTP Basic Auth
- Environment variable configuration

## Monitoring & Observability

**Error Tracking:**
- Console logging for errors
- Custom error handling in proxy and gateway processes

**Logs:**
- Console output from wrapper and clawdbot processes
- Error logging for proxy and gateway issues
- Debug endpoints for troubleshooting

## CI/CD & Deployment

**Hosting:**
- Railway platform deployment
- Docker containerization

**CI Pipeline:**
- GitHub Actions for Docker builds
- Automated builds on PR and push to main

**Health Checks:**
- Railway healthcheck endpoint at /setup/healthz
- Gateway readiness monitoring

## Environment Configuration

**Required env vars:**
- `PORT` - HTTP server port (8080 default)
- `CLAWDBOT_PUBLIC_PORT` - Override port for Railway
- `SETUP_PASSWORD` - Password for setup endpoint
- `CLAWDBOT_GATEWAY_TOKEN` - Authentication token
- `CLAWDBOT_STATE_DIR` - State directory path
- `CLAWDBOT_WORKSPACE_DIR` - Workspace directory path
- `CLAWDBOT_ENTRY` - Path to clawdbot executable
- `CLAWDBOT_NODE` - Node.js executable path

**Secrets location:**
- Environment variables
- Token persistence in state directory (gateway.token)

## Webhooks & Callbacks

**Incoming:**
- `/setup` - Configuration wizard
- `/setup/api/*` - Setup API endpoints
- `/setup/healthz` - Health check

**Outgoing:**
- Proxy requests to internal gateway
- External AI provider API calls
- Messaging platform API calls

---

*Integration audit: 2026-01-29*
```