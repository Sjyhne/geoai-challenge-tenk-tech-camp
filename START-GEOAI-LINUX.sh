#!/usr/bin/env bash
set -eu
cd "$(dirname "$0")"
if command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN=python3
else
  echo "Installer Python 3 for å starte kartoppgaven."
  exit 1
fi
echo "Girl Tech Fest – Lag ditt eget kart"
echo "Åpne http://127.0.0.1:8765/ i nettleseren."
echo "La vinduet stå åpent. Trykk Ctrl+C for å stoppe."
if command -v xdg-open >/dev/null 2>&1; then
  (sleep 1; xdg-open http://127.0.0.1:8765/ >/dev/null 2>&1) &
elif command -v open >/dev/null 2>&1; then
  (sleep 1; open http://127.0.0.1:8765/) &
fi
exec "$PYTHON_BIN" -m http.server 8765 --bind 127.0.0.1
