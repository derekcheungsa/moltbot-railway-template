# Architecture

**Analysis Date:** 2026-01-29

## Pattern Overview

**Overall:** Wrapper Architecture with Reverse Proxy

**Key Characteristics:**
- Node.js-based wrapper around the Clawdbot CLI
- Express.js web server with HTTP proxy functionality
- Separate internal gateway (port 18789) and public wrapper (port 8080)
- Configuration management through JSON files and environment variables
- Built-in setup wizard for initial onboarding

## Layers

**Wrapper Layer (Public Interface):**
- Purpose: Provides web interface and proxy to internal gateway
- Location: `[src/server.js]`
- Contains: Express app, HTTP proxy setup, configuration management
- Depends on: Node.js built-ins, express, http-proxy, tar
- Used by: End users via web browser, Railway deployment

**Gateway Layer (Internal Processing):**
- Purpose: Runs the actual Clawbot instance with CLI commands
- Location: Spawned child process at `[src/server.js]` lines 117-124
- Contains: Child process management, token authentication
- Depends on: Clawdbot CLI binary (built from source)
- Used by: Wrapper proxy via internal HTTP endpoint

**Configuration Layer:**
- Purpose: Manages application state and configuration persistence
- Location: `[src/server.js]` lines 16-44, 62-64, 66-72
- Contains: Path resolution, config file management, token persistence
- Depends on: Node.js file system operations
- Used by: All layers for configuration state

**Setup Layer (Onboarding):**
- Purpose: Web-based configuration wizard
- Location: `[src/setup-app.js]` and endpoints in `[src/server.js]` lines 200-548
- Contains: UI HTML, client-side JavaScript, setup API endpoints
- Depends on: Express web server, child process execution
- Used by: First-time users for initial setup

## Data Flow

**Setup Flow:**
1. User visits `/setup` → HTML form served
2. Form submits to `/setup/api/run` → executes `clawdbot onboard`
3. Configuration file written to state directory
4. Gateway started as child process on loopback:18789
5. User redirected to `/clawdbot` → proxied to gateway

**Runtime Flow:**
1. Request to any endpoint (except `/setup`) → check if configured
2. If not configured → redirect to `/setup`
3. If configured → ensure gateway running
4. Proxy request to internal gateway at `http://127.0.0.1:18789`

**Gateway Management:**
1. Gateway spawned with token authentication
2. Health check loop monitors gateway availability
3. On failure → restart gateway process
4. Token persisted for stable authentication

## Key Abstractions

**Gateway Abstraction:**
- Purpose: Isolate external access from internal Clawdbot execution
- Examples: `[src/server.js]` lines 49-52, 97-153
- Pattern: Process management with health monitoring

**Configuration Abstraction:**
- Purpose: Centralized state management with environment fallbacks
- Examples: `[src/server.js]` lines 24-46, 62-64
- Pattern: Resolver functions with file persistence

**Authentication Abstraction:**
- Purpose: Layered security with setup password and gateway token
- Examples: `[src/server.js]` lines 19-21, 169-191, 24-46
- Pattern: Basic auth for setup, token auth for gateway

## Entry Points

**Primary Entry:**
- Location: `[src/server.js]` line 193
- Triggers: Express server start on port 8080
- Responsibilities: Initialize app, setup proxy, handle graceful shutdown

**Setup Entry:**
- Location: `[src/server.js]` line 200
- Triggers: GET `/setup` requests
- Responsibilities: Serve setup wizard UI, handle configuration

**Health Check:**
- Location: `[src/server.js]` line 198
- Triggers: GET `/setup/healthz` requests
- Responsibilities: Respond with service health status

## Error Handling

**Strategy:** Graceful degradation with descriptive messages

**Patterns:**
- Gateway startup failures → return 503 with error message
- Configuration missing → redirect to setup
- Proxy errors → log and continue serving
- Process spawn errors → capture and return in output

## Cross-Cutting Concerns

**Logging:** Console logging with prefixes `[wrapper]`, `[gateway]`, `[proxy]`
**Validation:** Environment variable parsing, file system error handling
**Authentication:** Basic auth for setup endpoints, token auth for gateway
**State Management:** File-based persistence with environment overrides

---

*Architecture analysis: 2026-01-29*