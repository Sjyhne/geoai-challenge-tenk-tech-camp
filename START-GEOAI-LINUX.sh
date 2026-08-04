#!/usr/bin/env bash
set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT=8765
URL="http://127.0.0.1:${PORT}/index.html"
PROFILE_DIR="${TMPDIR:-/tmp}/geoai-webgpu-profile"

cd "$DIR" || exit 1

PYTHON_BIN=""
if command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN="python3"
elif command -v python >/dev/null 2>&1; then
  PYTHON_BIN="python"
fi

BROWSER=""
for candidate in google-chrome-stable google-chrome chromium chromium-browser; do
  if command -v "$candidate" >/dev/null 2>&1; then
    BROWSER="$candidate"
    break
  fi
done

if [[ -z "$BROWSER" ]]; then
  echo "Fant ikke Chrome eller Chromium."
  echo "Installer Chrome/Chromium og start skriptet på nytt."
  echo "Firefox kan fremdeles mangle WebGPU-støtte på denne Linux-maskinen."
  read -r -p "Trykk Enter for å avslutte ..."
  exit 1
fi

if [[ -z "$PYTHON_BIN" ]]; then
  echo "Python 3 mangler. Installer Python eller åpne index.html manuelt."
  read -r -p "Trykk Enter for å avslutte ..."
  exit 1
fi

mkdir -p "$PROFILE_DIR"

open_browser() {
  # WebSAM requires a WebGPU adapter. These flags enable Linux WebGPU/Vulkan
  # and use a separate browser profile so an already running Chrome process
  # cannot silently ignore the launch flags.
  "$BROWSER" \
    --user-data-dir="$PROFILE_DIR" \
    --enable-unsafe-webgpu \
    --ignore-gpu-blocklist \
    --enable-features=Vulkan,VulkanFromANGLE \
    --use-angle=vulkan \
    --ozone-platform=x11 \
    "$URL" >/dev/null 2>&1 &
}

if (echo > /dev/tcp/127.0.0.1/$PORT) >/dev/null 2>&1; then
  echo "Det kjører allerede en lokal server på $URL."
  open_browser
  exit 0
fi

echo "GeoAI er startet i $BROWSER med WebGPU aktivert."
echo "Starter lokal webserver i dette terminalvinduet."
echo "La terminalen stå åpen. Trykk Ctrl+C her for å stoppe GeoAI-serveren."

(sleep 1; open_browser) &
exec "$PYTHON_BIN" -m http.server "$PORT" --bind 127.0.0.1
