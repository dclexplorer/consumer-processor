#!/bin/bash

# Usage message
usage() {
  echo "Usage: $0 [--build] [runner-type]"
  echo ""
  echo "Options:"
  echo "  --build        Build the Docker image before running the container."
  echo "  runner-type    Specify the runner type ('godot-runner' or 'crdt-runner')."
  echo ""
  echo "Examples:"
  echo "  $0 --build godot-runner"
  echo "  $0 crdt-runner --build"
  echo "  $0 godot-runner"
  exit 1
}

# Default values
BUILD_FLAG=false
RUNNER_TYPE=""

# Parse inputs
for arg in "$@"; do
  case $arg in
    --build)
      BUILD_FLAG=true
      ;;
    godot-runner|crdt-runner|godot-optimizer)
      RUNNER_TYPE=$arg
      ;;
    --help)
      usage
      ;;
    *)
      echo "Invalid option: $arg"
      usage
      ;;
  esac
done

# Determine Dockerfile and Image name based on the runner type
if [[ "$RUNNER_TYPE" == "godot-runner" ]]; then
  DOCKERFILE="dependencies/godot-runner/Dockerfile"
elif [[ "$RUNNER_TYPE" == "crdt-runner" ]]; then
  DOCKERFILE="dependencies/crdt-runner/Dockerfile"
elif [[ "$RUNNER_TYPE" == "godot-optimizer" ]]; then
  DOCKERFILE="dependencies/godot-asset-optimizer-project/Dockerfile"
else
  echo "Invalid runner type specified."
  usage
fi

IMAGE_NAME="$RUNNER_TYPE"

# Build the Docker image if --build is set
if $BUILD_FLAG; then
  echo "Building the Docker image: $IMAGE_NAME"
  docker build -f "$DOCKERFILE" -t "$IMAGE_NAME" .

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
docker run --rm -it \
  -e AWS_SDK_LOAD_CONFIG=1 \
  -e AWS_DEFAULT_REGION=us-east-1 \
  -v ~/.aws:/root/.aws:ro \
  --network localenv_app-network \
  $IMAGE_NAME

# Exit message
if [ $? -eq 0 ]; then
  echo "Container exited successfully."
else
  echo "Container encountered an error."
fi
