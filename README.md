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
   const res = await fetch('http://localhost:4000/_chopin/login');
   const { token } = await res.json();
   
   // 2. Use the token in subsequent requests
   await fetch('http://localhost:4000/api/endpoint', {
     headers: {
       'Authorization': `Bearer ${token}`
     }
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

You can create a `chopin.config.json` file in your project root to configure the proxy and automatically start your development server. The configuration file supports the following options:

```json
{
  "command": "npm run dev",        // Required. Command to start your dev server
  "proxyPort": 4000,              // Optional. Port for the proxy (default: 4000)
  "targetPort": 3000,             // Optional. Port for your dev server (default: 3000)
  "env": {                        // Optional. Environment variables for your dev server
    "NODE_ENV": "development",
    "PORT": "3000"
  }
}
```

### Configuration Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `command` | string | Yes | Command to start your development server. Must not be empty. |
| `proxyPort` | number | No | Port for the proxy server. Must be between 1-65535. Defaults to 4000. |
| `targetPort` | number | No | Port for your development server. Must be between 1-65535. Defaults to 3000. |
| `env` | object | No | Environment variables to pass to your development server. All values must be strings. |

When you run `chopd`, it will:
1. Read and validate the config file if it exists
2. Start your development server using the specified command
3. Start the proxy server
4. Handle graceful shutdown of both processes when you exit

The proxy will use the ports specified in the config unless overridden by command line arguments.