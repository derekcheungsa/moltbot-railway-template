# Codebase Structure

**Analysis Date:** 2026-01-29

## Directory Layout

```
clawdbot-railway-template/
├── .github/              # CI/CD workflows
│   └── workflows/
│       └── docker-build.yml
├── src/                  # Application source
│   ├── server.js        # Main server and proxy logic
│   └── setup-app.js      # Setup wizard client
├── scripts/              # Utility scripts
│   └── smoke.js         # Basic sanity check
├── .planning/           # Analysis documents (auto-generated)
│   └── codebase/
├── Dockerfile            # Multi-stage container build
├── package.json          # Node.js dependencies
├── railway.toml         # Railway deployment config
└── README.md             # Project documentation
```

## Directory Purposes

**Root Directory:**
- Purpose: Project root containing configuration and deployment files
- Contains: Dockerfile, package.json, CI config, Railway config
- Key files: `package.json`, `Dockerfile`, `.github/workflows/docker-build.yml`

**`src/` Directory:**
- Purpose: Application source code
- Contains: Express server and setup client
- Key files: `src/server.js` (main server), `src/setup-app.js` (setup UI)

**`scripts/` Directory:**
- Purpose: Development and maintenance scripts
- Contains: Testing and verification utilities
- Key files: `scripts/smoke.js` (sanity check)

**`.github/workflows/` Directory:**
- Purpose: Continuous integration and deployment
- Contains: Docker build workflow
- Key files: `.github/workflows/docker-build.yml`

## Key File Locations

**Entry Points:**
- `src/server.js`: Main application entry point
- `src/setup-app.js`: Setup wizard client-side code
- `scripts/smoke.js`: Development/testing utility

**Configuration:**
- `package.json`: Node.js dependencies and scripts
- `Dockerfile`: Container build configuration
- `.github/workflows/docker-build.yml`: CI/CD pipeline

**Core Logic:**
- `src/server.js`: All server, proxy, and gateway management logic
- `src/setup-app.js`: Client-side setup wizard functionality

## Naming Conventions

**Files:**
- server.js: Main server application
- setup-app.js: Setup wizard client
- snake_case for configuration files (package.json, docker-build.yml)

**Variables:**
- PORT, STATE_DIR, WORKSPACE_DIR: Environment constants
- CLAWDBOT_*: Clawdbot-specific environment variables
- gatewayProc: Process management variables
- camelCase for function names and local variables

## Where to Add New Code

**New Feature:**
- Server endpoints: Add to `src/server.js`
- Setup UI additions: Modify `src/server.html` (inline) and `src/setup-app.js`

**New Channel Integration:**
- Setup API: Add to `/setup/api/run` endpoint in `src/server.js`
- Client updates: Modify `src/setup-app.js` form and payload

**New Configuration Option:**
- Environment variables: Add to `src/server.js` configuration section
- Client support: Update `src/setup-app.js` if UI needed

**Utilities and Helpers:**
- Server utilities: Add to `src/server.js` or separate module if complex
- Client utilities: Add to `src/setup-app.js` or separate module
- Build/deployment scripts: Add to `scripts/` directory

## Special Directories

**`.planning/codebase/`:**
- Purpose: Auto-generated analysis documents
- Generated: Yes
- Committed: Yes (for tracking)

**`src/`:**
- Purpose: Application source code
- Generated: No
- Committed: Yes

**`.github/workflows/`:**
- Purpose: CI/CD configuration
- Generated: No
- Committed: Yes

---

*Structure analysis: 2026-01-29*