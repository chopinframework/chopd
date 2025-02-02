# chopd

A CLI tool to aid in the development of applications using the Chopin Framework.

## Features
- A reverse proxy that queues `POST`, `PUT`, `PATCH`, and `DELETE` requests and executes them in order.
- For queued requests, a header `x-callback-url` is added to the request that the destination server can use to send data back to the reverse proxy to be associated with the active request while it is being executed. This is used to cache responses so that when they are replayed, the same value can be deterministically retrieved. The data is stored in an ordered list.
- Identity management endpoints such as `/_chopin/login[?as="0x..."]`, which sets a cookie `dev-address` that mimics Chopin Framework's embedded wallet system. This cookie contains the address of the currently logged in user. When this cookie is present, the reverse proxy will add the header `x-address` to the request with the value of the cookie.
- Log endpoint `/_chopin/log`, which returns a list of all queued requests and their context (currently under development).
- Passthrough for websockets to ensure compatibility with hot reloading dev tools
- Executable via `npx chopd`.
- Extensive test suite.

# Prerequisites

Node.js with a package manager like npm.

# Quick Start
When running a Next.js application (port 3000), you can use this command to start running the reverse proxy on port 4000.
```
npx chopd
```

To specify the ports, you can use the following command:
```
npx chopd [your-web-apps-port] [proxy-port]
```
