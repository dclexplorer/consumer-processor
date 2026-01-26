#!/bin/bash

# Usage message
usage() {
  echo "Usage: $0 [--build] [--multiarch] [runner-type] [options]"
  echo ""
  echo "Options:"
  echo "  --build        Build the Docker image before running the container."
  echo "  --multiarch    Build for multiple architectures (amd64 and arm64)."
  echo "  runner-type    Specify the runner type ('godot-runner', 'crdt-runner', or 'godot-optimizer')."
  echo ""
  echo "Entrypoint options (passed to the Node.js app):"
  echo "  --entityId <hash|pointer>   Process a single entity by hash or pointer (e.g., '0,0')"
  echo "  --profile <address>         Process all wearables/emotes from an Ethereum address profile"
  echo ""
  echo "Examples:"
  echo "  $0 --build godot-runner"
  echo "  $0 --build --multiarch godot-runner"
  echo "  $0 godot-optimizer --entityId bafybei..."
  echo "  $0 godot-optimizer --entityId 0,0"
  echo "  $0 godot-optimizer --profile 0x481bed8645804714Efd1dE3f25467f78E7Ba07d6"
  exit 1
}

# Default values
BUILD_FLAG=false
MULTIARCH_FLAG=false
RUNNER_TYPE=""
EXTRA_ARGS=()

# Parse inputs
while [[ $# -gt 0 ]]; do
  case $1 in
    --build)
      BUILD_FLAG=true
      shift
      ;;
    --multiarch)
      MULTIARCH_FLAG=true
      shift
      ;;
    godot-runner|crdt-runner|godot-optimizer)
      RUNNER_TYPE=$1
      shift
      ;;
    --help)
      usage
      ;;
    --*)
      EXTRA_ARGS+=("$1")
      if [[ $# -ge 2 && ! $2 == --* ]]; then
        EXTRA_ARGS+=("$2")
        shift
      fi
      shift
      ;;
    *)
      echo "Invalid option: $1"
      usage
      ;;
  esac
done

# Determine Dockerfile and Image name based on the runner type
if [[ "$RUNNER_TYPE" == "godot-runner" ]]; then
  DOCKERFILE="dependencies/godot-runner/Dockerfile"
  ENVFILE=".env.godot-runner"
elif [[ "$RUNNER_TYPE" == "crdt-runner" ]]; then
  DOCKERFILE="dependencies/crdt-runner/Dockerfile"
  ENVFILE=".env.crdt-runner"
elif [[ "$RUNNER_TYPE" == "godot-optimizer" ]]; then
  DOCKERFILE="dependencies/godot-asset-optimizer-project/Dockerfile"
  ENVFILE=".env.godot-optimizer"
else
  echo "Invalid runner type specified."
  usage
fi

IMAGE_NAME="$RUNNER_TYPE"

# Build the Docker image if --build is set
if $BUILD_FLAG; then
  echo "Building the Docker image: $IMAGE_NAME"
  
  if $MULTIARCH_FLAG; then
    # Check if Docker buildx is available
    if ! docker buildx version &> /dev/null; then
      echo "Error: Docker buildx is not available. Please install Docker Desktop or enable buildx."
      exit 1
    fi
    
    # Create or use existing buildx builder
    BUILDER_NAME="multiarch-builder"
    if ! docker buildx ls | grep -q "$BUILDER_NAME"; then
      echo "Creating new buildx builder: $BUILDER_NAME"
      docker buildx create --name "$BUILDER_NAME" --use
      docker buildx inspect --bootstrap
    else
      echo "Using existing buildx builder: $BUILDER_NAME"
      docker buildx use "$BUILDER_NAME"
    fi
    
    echo "Building for multiple architectures (amd64 and arm64)..."
    docker buildx build \
      --platform linux/amd64,linux/arm64 \
      -f "$DOCKERFILE" \
      -t "$IMAGE_NAME" \
      --load \
      .
  else
    # Regular single-architecture build
    docker build -f "$DOCKERFILE" -t "$IMAGE_NAME" .
  fi

  # Check if the build succeeded
  if [ $? -ne 0 ]; then
    echo "Failed to build the Docker image."
    exit 1
  fi
else
  echo "Skipping build step. Use --build to build the image."
fi

# Run the Docker container interactively with automatic cleanup
echo "Running the Docker container interactively..."
echo "Entrypoint arguments: ${EXTRA_ARGS[@]}"

# godot-optimizer uses /service for node app (to preserve /app with godot-explorer files)
if [[ "$RUNNER_TYPE" == "godot-optimizer" ]]; then
  VOLUME_MOUNT="/service"
  PORT_MAPPING="-p 3000:3000 -p 8080:8080"
else
  VOLUME_MOUNT="/app"
  PORT_MAPPING="-p 8080:8080"
fi

docker run --rm -it \
  $PORT_MAPPING \
  -v $(pwd):${VOLUME_MOUNT}/ \
  --env-file "$ENVFILE" \
  "$IMAGE_NAME" \
  "${EXTRA_ARGS[@]}" || {
    echo "Error: Failed to run the Docker container. Check the provided arguments."
    exit 1
  }

# Exit message
if [ $? -eq 0 ]; then
  echo "Container exited successfully."
else
  echo "Container encountered an error."
fi
