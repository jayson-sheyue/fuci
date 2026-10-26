#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="浮词"
EXEC_NAME="Fuci"
VERSION="$(node -p "require('${ROOT}/package.json').version")"
ELECTRON_APP="$ROOT/node_modules/electron/dist/Electron.app"
DIST_APP="$ROOT/dist/${APP_NAME}.app"
DESKTOP_APP="$HOME/Desktop/${APP_NAME}.app"
ENTITLEMENTS="$ROOT/build/entitlements.mac.plist"

if [[ ! -d "$ELECTRON_APP" ]]; then
  echo "还没有 Electron 运行时。请先在项目目录执行 npm install。" >&2
  exit 1
fi

echo "正在组装 ${APP_NAME}.app"
rm -rf "$DIST_APP"
mkdir -p "$ROOT/dist"
ditto "$ELECTRON_APP" "$DIST_APP"

mv "$DIST_APP/Contents/MacOS/Electron" "$DIST_APP/Contents/MacOS/$EXEC_NAME"

ICONSET="$(mktemp -d)/icon.iconset"
mkdir -p "$ICONSET"
SOURCE_ICON="$ROOT/assets/icon.png"
sips -z 16 16 "$SOURCE_ICON" --out "$ICONSET/icon_16x16.png" >/dev/null
sips -z 32 32 "$SOURCE_ICON" --out "$ICONSET/icon_16x16@2x.png" >/dev/null
sips -z 32 32 "$SOURCE_ICON" --out "$ICONSET/icon_32x32.png" >/dev/null
sips -z 64 64 "$SOURCE_ICON" --out "$ICONSET/icon_32x32@2x.png" >/dev/null
sips -z 128 128 "$SOURCE_ICON" --out "$ICONSET/icon_128x128.png" >/dev/null
sips -z 256 256 "$SOURCE_ICON" --out "$ICONSET/icon_128x128@2x.png" >/dev/null
sips -z 256 256 "$SOURCE_ICON" --out "$ICONSET/icon_256x256.png" >/dev/null
sips -z 512 512 "$SOURCE_ICON" --out "$ICONSET/icon_256x256@2x.png" >/dev/null
sips -z 512 512 "$SOURCE_ICON" --out "$ICONSET/icon_512x512.png" >/dev/null
sips -z 1024 1024 "$SOURCE_ICON" --out "$ICONSET/icon_512x512@2x.png" >/dev/null
iconutil -c icns "$ICONSET" -o "$DIST_APP/Contents/Resources/icon.icns"
rm -rf "$(dirname "$ICONSET")"

PLIST="$DIST_APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName ${APP_NAME}" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleName ${APP_NAME}" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleExecutable ${EXEC_NAME}" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.fuci.dictionary" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleIconFile icon" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString ${VERSION}" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${VERSION}" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :LSApplicationCategoryType public.app-category.utilities" "$PLIST"

APP_DIR="$DIST_APP/Contents/Resources/app"
mkdir -p "$APP_DIR"
cp -R "$ROOT/src" "$ROOT/assets" "$APP_DIR/"
node -e '
const fs = require("fs");
const pkg = require(process.argv[1]);
fs.writeFileSync(process.argv[2], JSON.stringify({
  name: pkg.name,
  productName: pkg.productName,
  version: pkg.version,
  private: true,
  description: pkg.description,
  main: pkg.main,
  dependencies: pkg.dependencies,
}, null, 2));
' "$ROOT/package.json" "$APP_DIR/package.json"

node -e '
const fs = require("fs");
const { execFileSync } = require("child_process");
let commit = "";
try {
  commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.argv[1], encoding: "utf8" }).trim();
} catch {}
if (/^[0-9a-f]{40}$/i.test(commit)) {
  fs.writeFileSync(process.argv[2], JSON.stringify({
    commit,
    repo: "jayson-sheyue/fuci",
    branch: "main",
  }, null, 2) + "\n");
}
' "$ROOT" "$APP_DIR/revision.json"

mkdir -p "$APP_DIR/build"
cp "$ENTITLEMENTS" "$APP_DIR/build/entitlements.mac.plist"

SDK_VERSION="${GCLOUD_VERSION:-589.0.0}"
SDK_DIR="$ROOT/vendor/google-cloud-sdk"
if [[ ! -f "$SDK_DIR/.fuci-ready" ]]; then
  echo "正在下载 Google Cloud CLI ${SDK_VERSION}"
  mkdir -p "$ROOT/vendor"
  rm -rf "$SDK_DIR"
  ARCHIVE="$(mktemp)"
  curl -fL --retry 3 -o "$ARCHIVE" \
    "https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-${SDK_VERSION}-darwin-arm.tar.gz"
  tar -xzf "$ARCHIVE" -C "$ROOT/vendor"
  rm -f "$ARCHIVE"
  CLOUDSDK_CONFIG="$(mktemp -d)"
  CLOUDSDK_CORE_DISABLE_PROMPTS=1 \
    CLOUDSDK_CONFIG="$CLOUDSDK_CONFIG" \
    bash "$SDK_DIR/install.sh" --quiet --usage-reporting false --path-update false --command-completion false
  rm -rf "$CLOUDSDK_CONFIG"
  touch "$SDK_DIR/.fuci-ready"
fi

# gcloud on Apple silicon does not ship a Python. Its launcher then accepts
# /usr/bin/python3, which is 3.9 on many Macs, and gcloud refuses to start.
PYTHON_URL="https://github.com/astral-sh/python-build-standalone/releases/download/20261021/cpython-3.12.15+20261021-aarch64-apple-darwin-install_only_stripped.tar.gz"
PYTHON_DIR="$SDK_DIR/platform/fuci-python"
if [[ ! -x "$PYTHON_DIR/bin/python3" ]]; then
  echo "正在下载 gcloud 自用的 Python"
  mkdir -p "$SDK_DIR/platform"
  ARCHIVE="$(mktemp)"
  curl -fL --retry 3 -o "$ARCHIVE" "$PYTHON_URL"
  rm -rf "$SDK_DIR/platform/python" "$PYTHON_DIR"
  tar -xzf "$ARCHIVE" -C "$SDK_DIR/platform"
  mv "$SDK_DIR/platform/python" "$PYTHON_DIR"
  rm -f "$ARCHIVE"
fi
"$PYTHON_DIR/bin/python3" -c 'import sys; raise SystemExit(0 if sys.version_info[:2] >= (3, 10) else 1)'

rm -rf "$DIST_APP/Contents/Resources/google-cloud-sdk"
ditto "$SDK_DIR" "$DIST_APP/Contents/Resources/google-cloud-sdk"

rsync -a \
  --exclude electron \
  --exclude electron/ \
  --exclude @electron \
  --exclude @electron-internal \
  --exclude @types \
  "$ROOT/node_modules/" "$APP_DIR/node_modules/"
rm -f "$APP_DIR/node_modules/.bin/electron" "$APP_DIR/node_modules/.bin/install-electron"

echo "正在签名"
codesign --force --deep --sign - --entitlements "$ENTITLEMENTS" "$DIST_APP"

rm -rf "$DESKTOP_APP"
ditto "$DIST_APP" "$DESKTOP_APP"
codesign --force --deep --sign - --entitlements "$ENTITLEMENTS" "$DESKTOP_APP"
xattr -cr "$DESKTOP_APP" || true

DMG="$ROOT/dist/fuci-${VERSION}-arm64.dmg"
STAGE="$(mktemp -d)"
ditto "$DIST_APP" "$STAGE/${APP_NAME}.app"
ln -s /Applications "$STAGE/Applications"
rm -f "$DMG"
hdiutil create -volname "$APP_NAME" -srcfolder "$STAGE" -ov -format UDZO "$DMG"
rm -rf "$STAGE"

echo "已生成"
echo "  $DESKTOP_APP"
echo "  $DIST_APP"
echo "  $DMG"
