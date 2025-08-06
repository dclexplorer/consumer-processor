# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a consumer-processor service for Decentraland that processes deployments using various runners including Godot-based asset optimization, minimap generation, CRDT generation, and imposter generation. The service consumes messages from AWS SQS queues and processes them through different pipelines.

## Essential Commands

### Development
```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run linter
npm run lint:check
npm run lint:fix

# Run tests
npm test

# Run a specific test
npm test -- test/unit/ping-controller.spec.ts
```

### Running Services

Using the run.sh script:
```bash
# Build and run a specific runner
./run.sh --build godot-optimizer
./run.sh --build godot-runner
./run.sh --build crdt-runner

# Build for multiple architectures (ARM64 + AMD64)
./run.sh --build --multiarch godot-optimizer

# Run without building
./run.sh godot-optimizer

# Pass additional options
./run.sh godot-optimizer --option key value
```

Direct execution:
```bash
# Start the service (requires built dist/)
npm start

# With specific process method
PROCESS_METHOD=godot_optimizer npm start
```

### Environment Configuration

Create a `.env` file based on `.env.default`. Key environment variables:
- `PROCESS_METHOD`: One of `log`, `godot_minimap`, `godot_optimizer`, `generate_crdt`, `generate_imposters`
- `AWS_REGION`: AWS region for SQS/S3
- `TASK_QUEUE`: SQS queue URL
- `BUCKET`: S3 bucket name for storage
- `GODOT4_EDITOR`: Path to Godot editor (defaults to /usr/local/bin/godot in containers)

## Architecture

### Core Components

1. **Service Layer** (`src/service.ts`): Main entry point that wires components and starts the processing loop based on `PROCESS_METHOD`

2. **Runners** (`src/runners/`): Different processing pipelines
   - `godot-optimizer/`: Asset optimization using Godot engine
   - `minimap-generator/`: Scene minimap generation
   - `crdt-runner/`: CRDT file generation from deployments
   - `imposter-runner/`: Imposter mesh generation

3. **Adapters** (`src/adapters/`): External service integrations
   - `sqs.ts`: AWS SQS queue consumer/publisher
   - `storage.ts`: S3 or local file storage
   - `sns.ts`: AWS SNS notifications
   - `runner.ts`: Task runner management

4. **Components** (`src/components.ts`): Dependency injection setup using well-known-components pattern

### Processing Flow

1. Service polls SQS queue for deployment messages
2. Based on `PROCESS_METHOD`, routes to appropriate runner
3. Runner downloads assets from content server
4. Processes assets (optimize, generate minimap, etc.)
5. Uploads results to S3/storage
6. Publishes completion notification to SNS

### Docker Architecture

The project supports multi-architecture builds (AMD64 and ARM64):
- AMD64: Uses Decentraland's fork of Godot 4.4.1
- ARM64: Uses official Godot 4.4.1 release

Three main Docker configurations:
- `dependencies/godot-asset-optimizer-project/`: Asset optimization service
- `dependencies/godot-runner/`: Godot explorer runner
- `dependencies/crdt-runner/`: CRDT generation service

## Key Implementation Details

### Godot Integration
- Godot runs in headless mode using Xvfb virtual display
- Communicates via file system and exit codes
- Timeout handling for long-running operations

### Queue Processing
- Messages contain deployment entity IDs and content server URLs
- Supports both memory queue (for testing) and AWS SQS
- Automatic retry and error handling

### Storage Abstraction
- Supports both S3 and local file system storage
- Consistent interface via `IStorageComponent`

### Testing
- Unit tests in `test/unit/`
- Integration tests in `test/integration/`
- Component mocking via `test/components.ts`

## Common Development Tasks

### Adding a New Runner
1. Create new directory in `src/runners/`
2. Implement runner function matching signature in `src/service.ts`
3. Add to `validProcessMethods` array
4. Wire in main processing loop

### Debugging Docker Builds
```bash
# Check architecture-specific build
docker buildx build --platform linux/arm64 -f dependencies/godot-optimizer/Dockerfile .

# Run with entrypoint override for debugging
docker run --rm --entrypoint /bin/bash -it godot-optimizer:latest

# Check Godot installation
docker run --rm --entrypoint /usr/local/bin/godot godot-optimizer:latest --version
```

### Working with Entity IDs
The service supports both direct entity IDs and pointer resolution. If an entity ID contains a comma, it's treated as a pointer and resolved via the content server API.