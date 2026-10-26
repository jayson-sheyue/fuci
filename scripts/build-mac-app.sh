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

# Keep the languages the window actually uses. The rest are Electron's own translations.
RES="$DIST_APP/Contents/Frameworks/Electron Framework.framework/Versions/A/Resources"
if [[ -d "$RES" ]]; then
  for dir in "$RES"/*.lproj; do
    name="$(basename "$dir" .lproj)"
    case "$name" in
      en|en_GB|zh_CN|zh_TW|zh_Hans|zh_Hant|ja|Base) ;;
      *) rm -rf "$dir" ;;
    esac
  done
fi

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
