#!/bin/zsh

cd "$(dirname "$0")" || exit 1

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

if command -v node >/dev/null 2>&1; then
  NODE_EXE="$(command -v node)"
elif [ -x "/opt/homebrew/bin/node" ]; then
  NODE_EXE="/opt/homebrew/bin/node"
elif [ -x "/usr/local/bin/node" ]; then
  NODE_EXE="/usr/local/bin/node"
else
  echo "Cannot find Node.js."
  echo "Please install Node.js, or ask your AI assistant to configure a Node.js runtime."
  echo
  read "?Press Enter to close..."
  exit 1
fi

"$NODE_EXE" mac-sync-service.js
status=$?

if [ "$status" -ne 0 ]; then
  echo
  echo "Interrupt Capture helper stopped with an error."
  read "?Press Enter to close..."
fi

exit "$status"
