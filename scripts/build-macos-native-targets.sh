#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "usage: $0 APPLICATION_BUNDLE [arm64|x86_64]" >&2
  exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export MACOSX_DEPLOYMENT_TARGET=14.0
export LZMA_API_STATIC=1
# The extensions consume the UniFFI zmanager-ffi crate from the sibling
# zmanager checkout (same source tree as the main application; the zmanager
# workspace [patch] entries make tzap resolve to the sibling tzap repo).
sibling_zmanager="${ZMANAGER_ZMANAGER_DIR:-$(cd "$repo_root/.." && pwd)/zmanager}"
uniffi_manifest="$sibling_zmanager/crates/zmanager-ffi/Cargo.toml"
app=$1
architecture=${2:-$(uname -m)}
case "$architecture" in
  arm64)
    rust_triple="aarch64-apple-darwin"
    swift_package_triple="arm64-apple-macosx14.0"
    swift_compile_target="arm64-apple-macos14.0"
    ;;
  x86_64)
    rust_triple="x86_64-apple-darwin"
    swift_package_triple="x86_64-apple-macosx14.0"
    swift_compile_target="x86_64-apple-macos14.0"
    ;;
  *)
    echo "unsupported macOS architecture: $architecture" >&2
    exit 2
    ;;
esac
package="$repo_root/native/macos"
finder_template="$repo_root/packaging/macos/FinderExtension"
plugins="$app/Contents/PlugIns"
appex="$plugins/ZManagerFinderExtension.appex"
preview_appex="$plugins/ZManagerQuickLookPreview.appex"
thumbnail_appex="$plugins/ZManagerQuickLookThumbnail.appex"
spotlight="$app/Contents/Library/Spotlight/ZManagerSpotlight.mdimporter"
uniffi_target="$repo_root/target/macos-uniffi/$architecture"
ffi_library="$uniffi_target/$rust_triple/release/libzmanager_ffi.a"

"$repo_root/scripts/sync-uniffi-swift-bindings.sh"
swift build --package-path "$package" -c release --triple "$swift_package_triple"
CARGO_TARGET_DIR="$uniffi_target" cargo build --release --features tzap-online --target "$rust_triple" \
  --manifest-path "$uniffi_manifest"
bin_dir=$(swift build --package-path "$package" -c release --triple "$swift_package_triple" --show-bin-path)
version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist")
build=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$app/Contents/Info.plist")

sync_bundle_identity() {
  local bundle=$1
  /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $version" "$bundle/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion $build" "$bundle/Contents/Info.plist"
}

ffi_link_args=(
  "$ffi_library"
  -lc++ -lpthread -framework CoreFoundation -framework Security -framework SystemConfiguration
  -lz -lbz2
  -liconv -lxml2 -lAppleArchive
)

rm -rf "$appex"
mkdir -p "$appex/Contents/MacOS" "$appex/Contents/Resources"
ditto "$finder_template/Info.plist" "$appex/Contents/Info.plist"
for localization in "$finder_template"/*.lproj; do
  ditto "$localization" "$appex/Contents/Resources/$(basename "$localization")"
done

sync_bundle_identity "$appex"

xcrun swiftc -o "$appex/Contents/MacOS/ZManagerFinderExtension" \
  -target "$swift_compile_target" \
  "$bin_dir"/ZManagerGenerated.build/*.swift.o \
  "$bin_dir"/ZManagerMacOSShared.build/*.swift.o \
  "$bin_dir"/ZManagerFinderExtensionSupport.build/*.swift.o \
  "$bin_dir"/ZManagerFinderExtension.build/*.swift.o \
  -framework AppKit -framework FinderSync -framework Security \
  -Xlinker -e -Xlinker _NSExtensionMain
chmod 0755 "$appex/Contents/MacOS/ZManagerFinderExtension"

rm -rf "$preview_appex"
mkdir -p "$preview_appex/Contents/MacOS" "$preview_appex/Contents/Resources"
ditto "$repo_root/packaging/macos/QuickLookPreview/Info.plist" "$preview_appex/Contents/Info.plist"
sync_bundle_identity "$preview_appex"
xcrun swiftc -o "$preview_appex/Contents/MacOS/ZManagerQuickLookPreview" \
  -target "$swift_compile_target" \
  "$bin_dir"/ZManagerUniFFI.build/*.swift.o \
  "$bin_dir"/ZManagerPreviewModel.build/*.swift.o \
  "$bin_dir"/ZManagerQuickLookPreview.build/*.swift.o \
  -framework AppKit -framework QuickLookUI -framework UniformTypeIdentifiers \
  "${ffi_link_args[@]}" \
  -Xlinker -e -Xlinker _NSExtensionMain
chmod 0755 "$preview_appex/Contents/MacOS/ZManagerQuickLookPreview"

rm -rf "$thumbnail_appex"
mkdir -p "$thumbnail_appex/Contents/MacOS" "$thumbnail_appex/Contents/Resources"
ditto "$repo_root/packaging/macos/QuickLookThumbnail/Info.plist" "$thumbnail_appex/Contents/Info.plist"
sync_bundle_identity "$thumbnail_appex"
xcrun swiftc -o "$thumbnail_appex/Contents/MacOS/ZManagerQuickLookThumbnail" \
  -target "$swift_compile_target" \
  "$bin_dir"/ZManagerQuickLookThumbnail.build/*.swift.o \
  -framework AppKit -framework QuickLookThumbnailing \
  -Xlinker -e -Xlinker _NSExtensionMain
chmod 0755 "$thumbnail_appex/Contents/MacOS/ZManagerQuickLookThumbnail"

rm -rf "$spotlight"
mkdir -p "$spotlight/Contents/MacOS" "$spotlight/Contents/Resources/en.lproj" \
  "$spotlight/Contents/Resources/zh-Hans.lproj"
ditto "$repo_root/packaging/macos/Spotlight/Info.plist" "$spotlight/Contents/Info.plist"
ditto "$repo_root/packaging/macos/Spotlight/schema.xml" "$spotlight/Contents/Resources/schema.xml"
ditto "$repo_root/packaging/macos/Spotlight/en.lproj/schema.strings" \
  "$spotlight/Contents/Resources/en.lproj/schema.strings"
ditto "$repo_root/packaging/macos/Spotlight/zh-Hans.lproj/schema.strings" \
  "$spotlight/Contents/Resources/zh-Hans.lproj/schema.strings"
sync_bundle_identity "$spotlight"
xcrun clang -arch "$architecture" -fobjc-arc -mmacosx-version-min=14.0 -bundle \
  -F "$(xcrun --sdk macosx --show-sdk-path)/System/Library/Frameworks/CoreServices.framework/Frameworks" \
  -I "$package/Sources/zmanagerFFI/include" \
  "$repo_root/native/macos/Spotlight/ZManagerSpotlightImporter.m" \
  -framework Foundation -framework CoreServices \
  "${ffi_link_args[@]}" \
  -o "$spotlight/Contents/MacOS/ZManagerSpotlight"
chmod 0755 "$spotlight/Contents/MacOS/ZManagerSpotlight"

expected_finder_id=$(/usr/bin/python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['finderExtensionBundleIdentifier'])" "$repo_root/packaging/macos/product-identity.json")
[[ $(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$appex/Contents/Info.plist") == \
  "$expected_finder_id" ]]
file "$appex/Contents/MacOS/ZManagerFinderExtension" | grep -q 'Mach-O 64-bit executable'
"$repo_root/scripts/check-macos-core-revision-and-symbols.sh" \
  "$uniffi_target/$rust_triple/release/libzmanager_ffi.dylib"
for executable in \
  "$preview_appex/Contents/MacOS/ZManagerQuickLookPreview" \
  "$thumbnail_appex/Contents/MacOS/ZManagerQuickLookThumbnail" \
  "$spotlight/Contents/MacOS/ZManagerSpotlight"; do
  file "$executable" | grep -q 'Mach-O 64-bit'
  if otool -L "$executable" | grep -Eq '^\s+/(opt/homebrew|usr/local)/'; then
    echo "Native target contains a build-machine library path: $executable" >&2
    exit 1
  fi
done
# Verify UniFFI symbols in targets that use them (preview and spotlight; thumbnail renders only the app icon)
for executable in \
  "$preview_appex/Contents/MacOS/ZManagerQuickLookPreview" \
  "$spotlight/Contents/MacOS/ZManagerSpotlight"; do
  for required_symbol in \
    _ffi_zmanager_ffi_rustbuffer_alloc \
    _ffi_zmanager_ffi_rustbuffer_free \
    _uniffi_zmanager_ffi_fn_func_tzappublicmetadatadisplaysummary; do
    nm -m "$executable" | awk -v symbol="$required_symbol" '$NF == symbol { found = 1 } END { exit !found }' || {
      echo "Native target is missing required UniFFI symbol $required_symbol: $executable" >&2
      exit 1
    }
  done
done
otool -ov "$preview_appex/Contents/MacOS/ZManagerQuickLookPreview" | \
  awk '/providePreviewForFileRequest:completionHandler:/ { found = 1 } END { exit !found }' || {
    echo "Quick Look preview provider method was stripped from the packaged executable" >&2
    exit 1
  }
# Re-sign appex bundles after replacing their binaries. The Swift build writes new
# Mach-O executables into an already-signed bundle, which invalidates the existing
# code signature. Ad-hoc re-signing with entitlements restores the app sandbox
# permissions required to run inside quicklookd and the Finder Sync host.
quicklook_entitlements="$repo_root/packaging/macos/QuickLook/ZManagerQuickLook.entitlements"
finder_entitlements="$repo_root/packaging/macos/FinderExtension/ZManagerFinderExtension.entitlements"
for bundle in "$preview_appex" "$thumbnail_appex"; do
  if [[ -f "$bundle/Contents/MacOS/$(basename "$bundle" .appex)" ]]; then
    codesign --force --sign - --entitlements "$quicklook_entitlements" "$bundle"
  fi
done
if [[ -f "$appex/Contents/MacOS/ZManagerFinderExtension" ]]; then
  codesign --force --sign - --entitlements "$finder_entitlements" "$appex"
fi
# Re-sign Spotlight importer (sandboxed, no special entitlements).
if [[ -f "$spotlight/Contents/MacOS/ZManagerSpotlight" ]]; then
  codesign --force --sign - "$spotlight"
fi
echo "Embedded Finder, Quick Look, thumbnail, and Spotlight targets in: $app"
