# Technology Stack

**Analysis Date:** 2026-01-29

## Languages

**Primary:**
- JavaScript (ES Modules) - Node.js runtime
- TypeScript (not detected in codebase, but Dockerfile references Node.js)

**Secondary:**
- Dockerfile uses shell scripts
- HTML served for setup UI

## Runtime

**Environment:**
- Node.js >=22 (enforced in package.json)
- Railway deployment platform
- Docker containerized

**Package Manager:**
- npm (used for wrapper dependencies)
- pnpm (used for clawdbot build dependencies - not in this repo)

**Type System:**
- JavaScript with ES Modules
- No TypeScript compilation detected

## Frameworks

**Core:**
- Express.js ^5.1.0 - HTTP server and routing
- Native Node.js modules for core functionality

**Testing:**
- No testing framework detected
- Custom smoke test script

**Build/Dev:**
- Docker multi-stage build
- Railway.toml for deployment configuration
- GitHub Actions for CI/CD

## Key Dependencies

**Critical:**
- express ^5.1.0 - Web server framework
- http-proxy ^1.18.1 - HTTP proxying to clawdbot gateway
- tar ^7.5.4 - Archive creation for backups

**Infrastructure:**
- Node.js runtime >=22
- Docker for containerization

## Configuration

**Environment:**
- Railway deployment variables (PORT, CLAWDBOT_PUBLIC_PORT)
- Setup password protection (SETUP_PASSWORD)
- Gateway token management (CLAWDBOT_GATEWAY_TOKEN)
- State and workspace directories (CLAWDBOT_STATE_DIR, CLAWDBOT_WORKSPACE_DIR)

**Build:**
- Dockerfile for multi-stage build
- railway.toml for Railway deployment configuration
- package.json for dependency management

## Platform Requirements

**Development:**
- Node.js >=22
- npm package manager

**Production:**
- Railway platform deployment
- Docker container runtime
- HTTP proxy setup

---

*Stack analysis: 2026-01-29*
```