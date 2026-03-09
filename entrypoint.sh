#!/bin/sh

# Fix ownership of mounted .claude directory (may have been created as root)
if [ -d "$HOME/.claude" ]; then
  if [ ! -w "$HOME/.claude" ]; then
    echo "Fixing permissions on $HOME/.claude"
    sudo chown -R "$(id -u):$(id -g)" "$HOME/.claude"
  fi
fi

exec "$@"
