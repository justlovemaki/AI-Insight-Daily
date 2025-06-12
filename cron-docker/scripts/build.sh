#!/bin/sh

# set -e: Exit immediately if a command exits with a non-zero status.
# set -o pipefail: The return value of a pipeline is the status of the last command to exit with a non-zero status.
set -e
set -o pipefail

# --- Configuration ---
REPO_NAME=${REPO_NAME}
REPO_URL="https://github.com/${OWNER}/${REPO_NAME}"
# ---------------------


# 1. Validate Input Parameter
# Check if the working directory argument is provided.
if [ -z "$1" ]; then
  echo "Error: Working directory not provided."
  echo "Usage: $0 <path_to_working_directory>"
  exit 1
fi

WORK_DIR="$1"

# Check if the provided working directory exists.
if [ ! -d "$WORK_DIR" ]; then
  echo "Error: Directory '$WORK_DIR' does not exist."
  exit 1
fi

echo "--- Starting AI Today workflow in '$WORK_DIR' ---"

# 2. Change to the working directory. All subsequent operations will be relative to it.
cd "$WORK_DIR"

# 3. Cleanup: Remove the old repository directory to ensure a fresh start.
echo "--> Cleaning up old directory..."
rm -rf "$REPO_NAME"

# 4. Fetch: Clone the latest content from GitHub.
echo "--> Cloning repository from $REPO_URL..."
git clone -b book "$REPO_URL"

# Define the path to the cloned repository for easier access.
PROJECT_DIR="$WORK_DIR/$REPO_NAME"

# 5. Preprocessing: Prepare the cloned content.
echo "--> Preprocessing content..."
# Detach from Git history by removing the .git directory.
rm -rf "$PROJECT_DIR/.git"
# Remove any old generated content.
rm -rf "$PROJECT_DIR/today"
rm -rf "$PROJECT_DIR/src"
rm -rf "$PROJECT_DIR/prompt"
rm -rf "$PROJECT_DIR/podcast"

# Execute custom processing scripts.
# Note: Ensure 1.replace.sh and 2.gen.sh are in the $WORK_DIR or in your PATH.
echo "--> Running custom scripts..."
./replace.sh "$PROJECT_DIR/daily"
./gen.sh "$PROJECT_DIR/daily"
# mdbook build "$WORK_DIR"

# 6. Package & Upload
echo "--> Waiting for generation to complete..."
# This pause assumes the generation script might have background tasks.
# A more robust solution would be to wait for a specific file or process.
# sleep 10

echo "--> Packaging the 'book' directory..."
# Create a gzipped tar archive of the 'book' directory's contents.
# tar -cvf archive.tar.gz book/*

echo "--> Uploading the archive..."
# Upload the archive using a custom script.
# Note: Ensure github.sh is in the $WORK_DIR or in your PATH.
# ./github.sh upload "archive.tar.gz" "today/archive.tar.gz" "pushbook"

echo "--- Workflow completed successfully! ---"