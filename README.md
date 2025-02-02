# chopd

A CLI tool to aid in the development of applications using the Chopin Framework. It provides a **reverse proxy** with **request queueing**, **callback mechanisms**, **identity simulation**, **websocket pass-through**, and more—helpful for local development and testing.

## Features

- **Queued Methods**: `POST`, `PUT`, `PATCH`, and `DELETE` requests are queued and executed in sequence, ensuring deterministic behavior under concurrent writes.
- **`x-callback-url` Header**: For queued requests, the proxy injects an `x-callback-url` header so the destination server can send interim data (“context”) back to the proxy while the request is still active. This data is stored in an **ordered list** and can be referenced later.
- **Chopin Identity Simulation**:  
  - `/_chopin/login[?as="0x..."]` sets a `dev-address` cookie.  
  - If present, the proxy adds an `x-address` header, mimicking Chopin Framework’s embedded wallet system.  
  - Simplifies local dev by simulating a “logged in” user’s address.
- **Logging**:  
  - A **log endpoint** `/_chopin/logs` returns a list of all queued requests with their context logs (currently under development).  
- **Websocket Passthrough**: Maintains compatibility with dev tools that require websockets (e.g., HMR).  
- **Executable via `npx chopd`**: No global install needed—just run the CLI.  
- **Extensive Test Suite**: Ensures reliability and consistent behavior under concurrency, partial context calls, identity simulation, etc.

## Prerequisites

- [Node.js](https://nodejs.org) (version 14+ recommended).
- npm or another Node package manager.

## Quick Start

When running a Next.js (or other) application on port 3000, you can start chopd on port 4000 by running:

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