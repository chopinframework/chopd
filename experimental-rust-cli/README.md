# chopd-rs

A Rust port of the chopd proxy server with a TUI interface. This version maintains all the functionality of the original Node.js implementation while adding a terminal user interface for better monitoring and control. This is under active development and is not ready to be used.

## Features

- **All Original chopd Features**:
  - Queued Methods (POST, PUT, PATCH, DELETE)
  - x-callback-url Support
  - Chopin Identity Simulation
  - Request Logging
  - Websocket Passthrough
  - Config File Support

- **New TUI Features**:
  - Real-time Request Monitoring
  - Live Log Viewing
  - Status Dashboard
  - Keyboard Controls

## Prerequisites

- Rust 1.75+ (2021 edition)
- Cargo

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd chopd-rs

# Build the project
cargo build --release

# Run the binary
./target/release/chopd-rs
```

## Usage

The command-line interface is compatible with the original chopd:

```bash
# Initialize a new project
chopd-rs init

# Start with default settings (proxy:4000 -> target:3000)
chopd-rs

# Start with custom ports
chopd-rs 4000 3000
```

### TUI Controls

- `q` - Quit the application
- `c` - Clear logs
- Arrow keys - Navigate logs

### Configuration

Create a `chopin.config.json` file in your project root:

```json
{
  "command": "npm run dev",
  "proxyPort": 4000,
  "targetPort": 3000,
  "env": {
    "NODE_ENV": "development"
  }
}
```

## Development

```bash
# Run tests
cargo test

# Run with logging
RUST_LOG=debug cargo run

# Format code
cargo fmt

# Run linter
cargo clippy
```

## License

ISC License - Same as the original chopd



