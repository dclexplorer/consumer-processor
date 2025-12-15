# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a consumer-processor service for Decentraland that processes deployments using various runners including Godot-based asset optimization, minimap generation, CRDT generation, and imposter generation. The service consumes messages from AWS SQS queues and processes them through different pipelines.

## Essential Commands

```bash
npm install                # Install dependencies
npm run build              # Build TypeScript
npm run lint:check         # Run linter
npm run lint:fix           # Fix lint issues
npm test                   # Run all tests
npm test -- test/unit/ping-controller.spec.ts  # Run specific test
npm start                  # Start service (requires built dist/)
PROCESS_METHOD=godot_optimizer npm start       # Start with specific runner
```

### Docker Operations (run.sh)

```bash
./run.sh --build godot-optimizer               # Build and run
./run.sh --build --multiarch godot-optimizer   # Build for ARM64 + AMD64
./run.sh godot-optimizer                       # Run without building
```

### Environment Configuration

Create `.env` from `.env.default`. Key variables:
- `PROCESS_METHOD`: `log`, `godot_minimap`, `godot_optimizer`, `generate_crdt`, `generate_imposters`
- `TASK_QUEUE`: SQS URL (if unset, uses in-memory queue)
- `BUCKET`: S3 bucket (if unset, uses local `./storage`)
- `GODOT4_EDITOR`: Path to Godot (default: `/usr/local/bin/godot` in containers)

## Architecture

### Dependency Injection Pattern

Uses `@well-known-components` framework. Components defined in `src/components.ts` with interfaces in `src/types.ts`. All adapters implement standard interfaces allowing swap between AWS services and local mocks via environment variables.

### Core Structure

- **`src/service.ts`**: Main processing loop, routes messages to runners based on `PROCESS_METHOD`
- **`src/adapters/`**: External integrations (SQS, S3, SNS) with dual implementations (AWS + local/memory)
- **`src/runners/`**: Processing pipelines (godot-optimizer, minimap-generator, crdt-runner, imposter-runner)

### Processing Flow

1. Service polls SQS (or memory queue) for `DeploymentToSqs` messages
2. Routes to runner based on `PROCESS_METHOD`
3. Runner downloads assets from content server, processes them
4. Uploads results to S3/storage
5. Publishes completion to SNS, reports to monitoring service

### Docker Architecture

Multi-architecture builds (AMD64/ARM64) in `dependencies/`:
- `godot-asset-optimizer-project/`: Godot 4.5.1 (dclexplorer fork for AMD64, official for ARM64)
- `godot-runner/`: Godot 4.4.1 (Decentraland fork for AMD64, official for ARM64)
- `crdt-runner/`: Node.js only (no Godot)

Godot runs headless using Xvfb virtual display.

## Adding a New Runner

1. Create directory in `src/runners/`
2. Implement async function matching signature: `(components, job, message) => Promise<void>`
3. Add to `validProcessMethods` array in `src/service.ts`
4. Add case in main processing switch statement

## Entity ID Resolution

The service supports direct entity IDs and pointer resolution. If entity ID contains a comma, it's treated as a pointer and resolved via content server API.