#!/usr/bin/env bash
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=8765
URL="http://127.0.0.1:${PORT}/index.html"

cd "$DIR" || exit 1

PYTHON_BIN=""
if command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN="python3"
elif command -v python >/dev/null 2>&1; then
  PYTHON_BIN="python"
fi

if [[ -z "$PYTHON_BIN" ]]; then
  echo "Python 3 mangler. Installer Python 3 eller åpne index.html manuelt."
  read -r -p "Trykk Enter for å avslutte ..."
  exit 1
fi

open_browser() {
  if [[ -d "/Applications/Google Chrome.app" ]]; then
    open -a "Google Chrome" "$URL"
  elif [[ -d "$HOME/Applications/Google Chrome.app" ]]; then
    open -a "Google Chrome" "$URL"
  else
    open "$URL"
  fi
}

if nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1; then
  echo "Det kjører allerede en lokal server på $URL."
  open_browser
  exit 0
fi

echo "GeoAI starter lokal webserver i dette terminalvinduet."
echo "La terminalen stå åpen. Trykk Ctrl+C her for å stoppe GeoAI-serveren."
echo "Chrome anbefales for WebSAM/WebGPU på Mac."

(sleep 1; open_browser) &
exec "$PYTHON_BIN" -m http.server "$PORT" --bind 127.0.0.1
