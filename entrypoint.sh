#!/bin/sh

# Fix ownership of mounted .claude directory (may have been created as root)
if [ -d "$HOME/.claude" ]; then
  if [ ! -w "$HOME/.claude" ]; then
    echo "Fixing permissions on $HOME/.claude"
    sudo chown -R "$(id -u):$(id -g)" "$HOME/.claude"
  fi
fi

# Sync skills from a public GitHub repo
# SKILLS_REPO supports: "user/repo" or "user/repo/subdirectory/path"
if [ -n "$SKILLS_REPO" ]; then
  SKILLS_DIR="/tmp/remote-skills"
  SKILLS_BRANCH="${SKILLS_BRANCH:-main}"

  # Split repo from subdirectory path (first two segments are user/repo)
  REPO_PART=$(echo "$SKILLS_REPO" | cut -d'/' -f1-2)
  SUB_PATH=$(echo "$SKILLS_REPO" | cut -d'/' -f3-)
  REPO_URL="https://github.com/${REPO_PART}.git"

  if [ -n "$SUB_PATH" ]; then
    SOURCE_DIR="$SKILLS_DIR/$SUB_PATH"
    echo "Syncing skills from ${REPO_PART}/${SUB_PATH} (branch: ${SKILLS_BRANCH})..."
  else
    SOURCE_DIR="$SKILLS_DIR"
    echo "Syncing skills from ${REPO_PART} (branch: ${SKILLS_BRANCH})..."
  fi

  if git clone --depth 1 --branch "$SKILLS_BRANCH" "$REPO_URL" "$SKILLS_DIR" 2>/dev/null; then
    COMMANDS_DIR="/app/.claude/commands"
    count=0
    for f in "$SOURCE_DIR"/*.md; do
      [ -f "$f" ] || continue
      cp "$f" "$COMMANDS_DIR/"
      count=$((count + 1))
    done
    echo "Loaded $count skill(s) from ${SKILLS_REPO}"
    rm -rf "$SKILLS_DIR"
  else
    echo "WARNING: Failed to clone skills repo ${REPO_PART}"
  fi
fi

exec "$@"
