# Coding Conventions

**Analysis Date:** 2024-01-29

## Naming Patterns

**Files:**
- kebab-case for server files: `src/server.js`
- kebab-case for utility scripts: `scripts/smoke.js`
- descriptive names reflecting purpose

**Functions:**
- camelCase for function names: `startGateway()`, `ensureGatewayRunning()`, `resolveGatewayToken()`
- predicate functions: `isConfigured()`
- async functions: `waitForGatewayReady()`, `buildOnboardArgs()`

**Variables:**
- UPPER_SNAKE_CASE for constants: `PORT`, `STATE_DIR`, `WORKSPACE_DIR`, `INTERNAL_GATEWAY_PORT`
- camelCase for regular variables: `gatewayProc`, `gatewayStarting`, `setupPayload`
- prefix with `_` for private variables (limited usage)

**Types:**
- Not applicable - no TypeScript in codebase

## Code Style

**Formatting:**
- Standard JavaScript formatting (no linter config found)
- 2-space indentation
- Line length varies (pragmatic approach for long configurations)
- Semicolons used consistently
- Mixed quotes (single and double)

**Linting:**
- Minimal linting: `node -c src/server.js` (basic syntax check only)
- No ESLint/Prettier configuration
- No automated code style enforcement

## Import Organization

**Order:**
1. Node.js core imports (first group)
2. Third-party imports (second group)
3. Relative imports (third group - not used)

**Path Aliases:**
- Not used
- Relative imports not needed due to flat structure

## Error Handling

**Patterns:**
- try/catch blocks with specific error handling
- Error propagation with meaningful messages
- Logging errors to console with prefixes: `[gateway]`, `[proxy]`, `[/setup/api/run]`
- Graceful degradation (ignore errors in non-critical paths)

```javascript
try {
  fs.writeFileSync(tokenPath, generated, { encoding: "utf8", mode: 0o600 });
} catch {
  // best-effort
}
```

## Logging

**Framework:** console.log

**Patterns:**
- Bracketed prefixes for log sources: `[wrapper]`, `[gateway]`, `[proxy]`
- Status messages during startup
- Error logging with context
- No structured logging framework

## Comments

**When to Comment:**
- Complex configuration logic (auth groups, channel setup)
- Gateway management explanations
- Proxy setup details
- Environment variable explanations

**JSDoc/TSDoc:**
- Not used
- Function documentation limited to inline comments

## Function Design

**Size:**
- Mix of small (helper functions) and large (server.js handlers) functions
- `server.js` contains many nested functions and complex handlers

**Parameters:**
- Consistent use of default parameters: `opts = {}`
- Optional chaining: `req.body?.{}`
- Nullish coalescing: `process.env.CLAWDBOT_PUBLIC_PORT ?? process.env.PORT ?? "8080"`

**Return Values:**
- Object returns for status: `{ ok: true }`, `{ ok: false, reason: "..." }`
- Promise-based async returns
- Direct returns for simple cases

## Module Design

**Exports:**
- No explicit exports (single application entry points)
- IIFE pattern for setup-app.js: `(function () { ... })();`

**Barrel Files:**
- Not used

---

*Convention analysis: 2024-01-29*
*Note: Limited formal conventions - pragmatic Node.js approach*