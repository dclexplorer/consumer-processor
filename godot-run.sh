#!/bin/bash

# Set variables
DOCKERFILE="godot.Dockerfile"
IMAGE_NAME="godot-runner"

# Check for --build flag
if [[ "$1" == "--build" ]]; then
  # Build the Docker image
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
