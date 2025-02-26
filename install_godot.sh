#!/bin/bash

# Set variables
GODOT_VERSION="4.3-stable"
GODOT_FILENAME="Godot_v${GODOT_VERSION}_linux.x86_64"
GODOT_URL="https://github.com/godotengine/godot/releases/download/${GODOT_VERSION}/${GODOT_FILENAME}.zip"
INSTALL_DIR="/usr/local/bin"

# Download Godot
echo "Downloading Godot ${GODOT_VERSION}..."
curl -fsSL "$GODOT_URL" -o godot.zip

if [ $? -ne 0 ]; then
    echo "Error: Failed to download Godot from ${GODOT_URL}"
    exit 1
fi

# Extract the zip file
echo "Extracting Godot to ${INSTALL_DIR}..."
unzip -o godot.zip -d "$INSTALL_DIR"

if [ $? -ne 0 ]; then
    echo "Error: Failed to extract Godot."
    rm -f godot.zip
    exit 1
fi

# Cleanup the zip file
rm -f godot.zip
echo "Cleanup completed."

# Set environment variable for Godot editor
export GODOT4_EDITOR="${INSTALL_DIR}/${GODOT_FILENAME}"

# Verify installation
if [ -f "${GODOT4_EDITOR}" ]; then
    echo "Godot installed successfully. Editor located at: ${GODOT4_EDITOR}"
else
    echo "Error: Godot installation failed."
    exit 1
fi

# Optionally, you can add this environment variable to the user's profile
echo "Adding GODOT4_EDITOR to ~/.bashrc for persistent environment setup..."
echo "export GODOT4_EDITOR=${GODOT4_EDITOR}" >> ~/.bashrc
echo "Done! Restart your terminal or source ~/.bashrc to use the GODOT4_EDITOR variable."
