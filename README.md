# chopd

A CLI tool to aid in the development of applications using the Chopin Framework. It provides a **reverse proxy** with **request queueing**, **callback mechanisms**, **identity simulation**, **websocket pass-through**, and more—helpful for local development and testing.

## Features

- **Queued Methods**: `POST`, `PUT`, `PATCH`, and `DELETE` requests are queued and executed in sequence, ensuring deterministic behavior under concurrent writes.
- **`x-callback-url` Header**: For queued requests, the proxy injects an `x-callback-url` header so the destination server can send interim data ("context") back to the proxy while the request is still active. This data is stored in an **ordered list** and can be referenced later.
- **Chopin Identity Simulation**:
  - `/_chopin/login[?as="0x..."]` sets a `dev-address` cookie and returns a JWT.
  - Identity can be provided via:
    - Browser: `dev-address` cookie (set automatically)
    - API/CLI: `Authorization: Bearer <jwt>` header
  - The proxy adds an `x-address` header, mimicking Chopin Framework's embedded wallet system.
  - Simplifies local dev by simulating a "logged in" user's address.
  - `/_chopin/me` endpoint returns current user's address or null.
- **Logging & Status**:
  - A **log endpoint** `/_chopin/logs` returns a list of all queued requests with their context logs.
  - A **status endpoint** `/_chopin/status` returns server health status.
- **Websocket Passthrough**: Maintains compatibility with dev tools that require websockets (e.g., HMR).
- **Executable via `npx chopd`**: No global install needed—just run the CLI.
- **Extensive Test Suite**: Ensures reliability and consistent behavior under concurrency, partial context calls, identity simulation, etc.
- **Config File Support**: Automatically starts your development server alongside the proxy using `chopin.config.json`.

## Prerequisites

- [Node.js](https://nodejs.org) (version 20+ recommended).
- npm or another Node package manager.

## Quick Start

Run the following command inside the root directory of you existing codebase:

```bash
npx chopd init
```

This will:

1. Create a `chopin.config.json` with default settings
2. Create a `.chopin` directory for internal use
3. Add `.chopin` to your `.gitignore`

Then start the proxy and your development server:

```bash
npx chopd
```

This sets up a reverse proxy on 4000 that forwards to 3000 (by default).

To specify custom ports, supply them as arguments:

```bash
npx chopd [proxy-port] [target-port]
```

For example:

```bash
npx chopd 4000 3000
```

…will proxy requests on port 4000 to your app on port 3000.

## Authentication

The proxy supports two methods of authentication for development:

1. **Browser-based Development** (Cookie)

   ```javascript
   // Cookie is set automatically when visiting /_chopin/login
   // No manual steps needed
   ```

2. **API/CLI Development** (JWT)

   ```javascript
   // 1. Get a JWT token
   const res = await fetch("http://localhost:4000/_chopin/login");
   const { token } = await res.json();

   // 2. Use the token in subsequent requests
   await fetch("http://localhost:4000/api/endpoint", {
     headers: {
       Authorization: `Bearer ${token}`,
     },
   });
   ```

Both methods will result in the proxy adding an `x-address` header to requests forwarded to your development server.

## API Endpoints

The proxy provides several built-in endpoints under the `/_chopin` namespace:

### Authentication Endpoints

- **GET** `/_chopin/login?as=0x...`

  - Authenticates a development user
  - Query params:
    - `as` (optional): Ethereum address to use. If not provided, generates a random address
  - Returns:
    - Sets `dev-address` cookie
    - Returns `{ success: true, address: string, token: string }`

- **GET** `/_chopin/logout`

  - Logs out the current user
  - Clears the `dev-address` cookie
  - Redirects to the root route (`/`)

- **GET** `/_chopin/me`
  - Returns current authenticated user's address
  - Authentication via cookie or JWT
  - Returns `{ address: string | null }`

### System Endpoints

- **GET** `/_chopin/status`

  - Simple health check endpoint
  - Returns `{ status: "ok" }`

- **GET** `/_chopin/logs`
  - Returns list of all queued requests with their context logs
  - Returns array of log entries with contexts

## Configuration

The `chopin.config.json` file supports the following options:

```json
{
  "version": "0.1.0", // Schema version (required)
  "command": "npm start", // Command to start your dev server (required)
  "proxyPort": 4000, // Port for the proxy server (default: 4000)
  "targetPort": 3000, // Port your dev server runs on (default: 3000)
  "env": {
    // Environment variables for your dev server
    "NODE_ENV": "development"
  }
}
```

### Version System

The `version` field in the configuration file helps ensure compatibility between your config and the version of chopd you're using:

- The current schema version is `0.1.0` (development version)
- When the project reaches stability, we'll release version `1.0.0`
- Schema versions are tied to specific chopd versions
- Future breaking changes to the schema will increment the major version number
- Minor additions will increment the minor version number
- Bug fixes will increment the patch version

#### Compatibility Table

| Schema Version | Compatible chopd Versions |
| -------------- | ------------------------- |
| 0.1.0          | 0.0.8+                   |

# Development

## Schema Version Bumping

When making changes to the schema structure, you can use the schema version bumping script to automate the versioning process:

```bash
# Bump patch version (for backward-compatible bug fixes)
npm run bump-schema -- patch

# Bump minor version (for backward-compatible new features)
npm run bump-schema -- minor

# Bump major version (for breaking changes)
npm run bump-schema -- major

# Specify a specific chopd version for the compatibility mapping
npm run bump-schema -- minor --chopd-version 0.0.7

# Test mode (doesn't modify files)
npm run bump-schema -- minor --test

# Or run all tests at once
npm run test-bump
```

The script will:

1. Create a new schema file with the bumped version number
2. Update the `versions.json` file with the new version information
3. Update the compatibility mapping
4. Update this README's compatibility table

Schema version information is maintained in `versions.json`, which includes:

- The current schema version
- Minimum compatible version
- Version compatibility mapping
- Version history with release dates

After bumping the version, you can modify the new schema file to include your changes.

## Chopd Version Bumping

When releasing a new version of the chopd application, you can use the chopd version bumping script to update the version and maintain compatibility with schema versions:

```bash
# Bump patch version (for backward-compatible bug fixes)
npm run bump-chopd -- patch

# Bump minor version (for backward-compatible new features)
npm run bump-chopd -- minor

# Bump major version (for breaking changes)
npm run bump-chopd -- major

# Specify specific schema versions to mark as compatible
npm run bump-chopd -- patch --schema-versions 0.1.0,0.1.1

# Test mode (doesn't modify files)
npm run bump-chopd -- minor --test

# Or run all tests at once
npm run test-chopd-bump
```

The script will:

1. Update the version in `package.json`
2. Update the compatibility mapping in `versions.json` for all affected schema versions
3. Update this README's compatibility table

This ensures that as the chopd application evolves, there is clear documentation of which schema versions are compatible with each chopd version.

If you're using an older configuration with a newer version of chopd, you'll receive appropriate warnings or instructions for updating your configuration.

When you run `chopd`, it will:

1. Read and validate the config file if it exists
2. Start your development server using the specified command
3. Start the proxy server
4. Handle graceful shutdown of both processes when you exit

The proxy will use the ports specified in the config unless overridden by command line arguments.

## Testing

To run the test suite:

```bash
npm test
```
