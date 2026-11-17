# BUILD — toolchain, build, sign, install

The deliverable is a **sideloaded APK**. No Play Store, no AAB, no store review. That removes
a lot of work and leaves exactly one hard requirement: **the signing key must be stable**, or
the next build will not install over the previous one.

---

## 1. Toolchain (verified on this machine)

| Component | Version | Location |
|---|---|---|
| Node | 24.x | `C:\Program Files\nodejs` |
| Capacitor | 6.2.2 (`@capacitor/core`, `@capacitor/android`) | `package.json` |
| AGP | 8.2.1 | `android/build.gradle` |
| Kotlin | 1.9.24 | `android/build.gradle` |
| Gradle | 8.2.1 | `android/gradle/wrapper/gradle-wrapper.properties` |
| JDK | 17 (Adoptium 17.0.20.101) | `C:\Program Files\Eclipse Adoptium\jdk-17.0.20.101-hotspot` |
| Android SDK | platform-tools, build-tools, platform 34, `system-images;android-34;google_apis;x86_64` | `C:\Users\nisha\AppData\Local\Android\Sdk` |
| compileSdk / targetSdk | 34 | `android/variables.gradle` |
| minSdk | 22 (Android 5.1) | `android/variables.gradle` |
| Java target | 17 | `android/app/build.gradle` |
| Electron (desktop) | ^44.3.0 | `package.json` |

Gradle **requires JDK 17**; JDK 21+ will fail on AGP 8.2.1. `JAVA_HOME` is not set globally —
export it per command.

The table above is the Windows workstation. The Muse VM has Node 24 only — no JDK, no
Android SDK — so no Gradle build can run there. Kotlin changes made outside the
workstation are verified by the CI workflow (see `docs/android/CI-RELEASE.md`).

```bash
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-17.0.20.101-hotspot"
export ANDROID_HOME="/c/Users/nisha/AppData/Local/Android/Sdk"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
```

---

## 2. The build, in order

The Android project does **not** read `src/` directly. Capacitor copies the Vite output into
`android/app/src/main/assets/public/`. Skipping a step ships stale JavaScript — the single most
common "my fix didn't apply" cause.

```bash
# 1. typecheck + build the renderer AND the electron main (npm run build does both)
npm run build

# 2. copy dist/ into the Android project
npx cap sync android

# 3. compile the APK
cd android
./gradlew.bat assembleDebug --console=plain
cd ..

# 4. install
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk` (~4.05 MB). The delivery artifact is
the release build (§3), `android/app/build/outputs/apk/release/app-release.apk` (~1.27 MB).

### The one generated asset outside the normal build

`android/app/src/main/assets/potoken.js` is a **bundled copy** of
`src/mobile/potoken-page.ts` — the PO-token minter that runs in the hidden WebView. It is
checked in because it ships as an asset, and `cap sync` does not regenerate it.

If you edit `src/mobile/potoken-page.ts`, regenerate it **before** building the APK:

```bash
npm run build:potoken   # esbuild --bundle --format=iife --minify
```

Verified: that exact command reproduces the shipped 7,145-byte file byte-for-byte
(`cmp` clean). Skipping it ships the old minter and your change silently does nothing.

### Quick verification that the APK has your code

```bash
unzip -l android/app/build/outputs/apk/debug/app-debug.apk | grep "assets/public/assets/index-.*js"
```
Compare the hash in the filename with the one `vite build` printed. Different hash = stale.

### Native-only changes

Kotlin/Java/manifest/resource edits need only step 3. But `assembleDebug` is fast and safe, so
when in doubt run all four.

---

## 3. Debug vs release

| | Debug | Release |
|---|---|---|
| Signing | debug keystore, auto-generated | `signingConfigs.release` from `android/keystore.properties` |
| Minify | off | on (`minifyEnabled true`, `shrinkResources true`, R8) |
| WebView debugging | on (`BuildConfig.DEBUG`) | off |
| Install over old build | only if the debug keystore is the same machine | any build signed with the same release key |
| Suitable for daily use | yes | **yes — this is the delivery artifact** |

**State at 2026-10-29 (historical):** release was signed, minified and verified on device —
launches, mints a PO token, relays audio `HTTP 206`, posts the media notification, and
survives an in-place upgrade (v1.0.0 → v1.0.1, data intact). Release APK then:
**1,273,075 bytes** (`1.0.0`); R8 shrank it from 4,047,672 bytes. `apksigner verify --verbose` →
`Verifies`, v1 + v2 true, `CN=ByTune`, RSA 4096.

**Since:** the shipped 1.0.3 release APK measures 2,422,219 bytes (see `STATUS.md` header).
1.1.0 / versionCode 5 is set in code but no APK has been built — the signed APK comes from
CI (`docs/android/CI-RELEASE.md`) or a local `npm run apk`.

**Consequence of minify:** WebView debugging is compiled out, so `chrome://inspect` / CDP is
unavailable on a release build. Device verification uses `adb` (`dumpsys`, `cmd media_session`,
`logcat`, `screencap`) instead. Build debug when you need the CDP harness.

---

## 4. Release signing (A-601)

### 4.1 Create the keystore — once, ever

```bash
mkdir -p ~/.bytune-keys
keytool -genkeypair -v \
  -keystore ~/.bytune-keys/bytune-release.jks \
  -alias bytune \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=ByTune, OU=ByTune, O=ByTune, L=Local, ST=Local, C=IN"
```

Rules:

- **Back it up.** Lose the keystore and every future build is a different app — the user must
  uninstall (losing all local data) to install the new one.
- **Never commit it.** Keep it outside the repo. `~/keystores/` is fine; a password manager
  attachment is better.
- `-validity 10000` days ≈ 27 years. Do not use a short validity; an expired key cannot sign.

### 4.2 Wire it up without secrets in the tree

Create `android/keystore.properties` (already present on this machine; it is git-ignored):

```properties
storeFile=C:/Users/nisha/.bytune-keys/bytune-release.jks
storePassword=…
keyAlias=bytune
keyPassword=…
```

`android/.gitignore` already ignores `*.jks`, `*.keystore` and `keystore.properties`
(verified with `git check-ignore -v android/keystore.properties`). Keep the keystore itself
**outside** the repo entirely — the ignore rules are a backstop, not permission to store it here.

In `android/app/build.gradle`, before `android { }`:

```gradle
def keystorePropsFile = rootProject.file("keystore.properties")
def keystoreProps = new Properties()
if (keystorePropsFile.exists()) {
    keystoreProps.load(new FileInputStream(keystorePropsFile))
}
```

Inside `android { }`:

```gradle
signingConfigs {
    release {
        if (keystorePropsFile.exists()) {
            storeFile file(keystoreProps['storeFile'])
            storePassword keystoreProps['storePassword']
            keyAlias keystoreProps['keyAlias']
            keyPassword keystoreProps['keyPassword']
        }
    }
}
buildTypes {
    release {
        signingConfig keystorePropsFile.exists() ? signingConfigs.release : signingConfigs.debug
        minifyEnabled false
        proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
    }
}
```

The `exists()` fallback keeps the build working on a machine without the keystore (CI, another
dev) instead of failing with a cryptic error.

Note (2026-11-17): the snippet above is a wiring template, not the shipped file. The real
`android/app/build.gradle` has **no** debug-signing fallback — without `keystore.properties`
the release build has no `signingConfig` and the APK is unsigned — and `minifyEnabled` is
`true` (D16), not `false` as the snippet shows. Read the file, not the snippet.

### 4.3 Build and verify

```bash
cd android && ./gradlew.bat assembleRelease --console=plain && cd ..
"$ANDROID_HOME/build-tools/34.0.0/apksigner.bat" verify --print-certs \
  android/app/build/outputs/apk/release/app-release.apk
```

`apksigner verify` printing the certificate DN is the proof. A silent success is not enough —
check the DN matches the key you created.

Or build via CI: add the four secrets and run the workflow manually — see
`docs/android/CI-RELEASE.md`. The same DN check applies to the CI artifact.

---

## 5. Versioning (A-602)

Both numbers live in `android/app/build.gradle`:

```gradle
versionCode 1        // integer, must strictly increase for every installed build
versionName "1.0"    // human string, shown in Settings/About
```

Rules:

- Bump `versionCode` on **every** build the owner will install. Android refuses to downgrade.
- `versionName` is free-form: `1.0`, `1.1`, `1.1-hotfix`.
- Keep every version site in sync: `android/app/build.gradle` (`versionCode`/`versionName`),
  `package.json` (`version`), and the fallback strings in `src/mobile/bridge.ts`,
  `electron/preload.ts` and `src/views/SettingsView.tsx`. The 1.0.1/1.0.3 mismatch (fixed
  in 1.1.0) happened because `package.json` drifted alone.
- Record the bump in `STATUS.md`'s Done log with the date.
- Do not derive either number from git tags — they are set by hand in the files above.

Current: `versionCode 5` / `versionName "1.1.0"` (set 2026-11-17; APK unbuilt).

---

## 6. R8 / minify (A-603)

**On in release** (`minifyEnabled true`, `shrinkResources true`,
`proguard-android-optimize.txt` + `android/app/proguard-rules.pro`). It cut the 1.0.0 APK from
4,047,672 to 1,273,075 bytes.

The keep rules that made it work (`android/app/proguard-rules.pro`):

```
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * { @com.getcapacitor.PluginMethod public *; }
-keepclassmembers class * { @android.webkit.JavascriptInterface public *; }
-keep class com.bytune.music.** { *; }
-dontwarn org.json.**
```

Verification is behavioural, not build-level — a minified APK is fine only if it launches,
**mints a PO token**, and **plays audio**. Verified on device 2026-10-29: launch, onboarding,
home feed, search, `relay HTTP 206 range=bytes=0- len=3487954`, notification with the right
title, `cmd media_session dispatch pause/next`.

Anything reached by reflection must be added to the keep rules, or the symptom is a silent
no-op in the WebView (no crash, no log) — not a build error.

---

## 7. APK size and ABIs (A-604)

Current: **2,422,219 bytes** universal release APK (1.0.3, R8 + resource shrinking). The
1,273,075-byte figure was the 1.0.0 build. Debug is 4,047,672 bytes. There are no native
`.so` files beyond Capacitor's, so ABI splits buy little today. Keep one universal APK
unless it exceeds ~25 MB.

If splits become necessary:

```gradle
splits {
    abi {
        enable true
        universalApk true
        include 'arm64-v8a', 'armeabi-v7a'
    }
}
```

The owner's phone almost certainly needs `arm64-v8a` only. `x86_64` is emulator-only.

---

## 8. Install on the phone (the actual delivery step)

1. Copy `app-release.apk` to the phone (USB, Drive, Telegram-to-self, anything).
2. Tap the file. Android asks to allow "Install unknown apps" for the app doing the installing
   (Files, Chrome, …). Allow it for that app only.
3. Install. If a previous build is installed with a **different** key, Android refuses with
   `INSTALL_FAILED_UPDATE_INCOMPATIBLE` — the only fix is uninstall, which deletes local data.
4. Open ByTune → **Continue as guest**.

Over USB instead:

```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

`-r` reinstalls keeping data. Use it for every iteration.

---

## 9. Common build failures

| Symptom | Cause | Fix |
|---|---|---|
| `Unsupported class file major version` | Wrong JDK | Export `JAVA_HOME` to JDK 17 |
| `SDK location not found` | `ANDROID_HOME` unset | Export it, or create `android/local.properties` |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | Different signing key | Uninstall (data loss) or sign with the original key |
| Fix not visible after install | Forgot `npm run build` / `npx cap sync` | Rebuild; compare the bundle hash (§2) |
| `Duplicate class` on sync | Capacitor plugin conflict | `npx cap sync android` after `npm install`; check `capacitor.build.gradle` |
| Gradle daemon OOM | Large heap on a small machine | `./gradlew.bat --stop`, retry, or add `org.gradle.jvmargs=-Xmx2g` to `gradle.properties` |
| Emulator "exit 1" but device present | Known quirk of the headless launch | `adb devices` — if it is listed, continue |

---

## 10. Desktop build (for reference — must keep working)

```bash
npm run dev          # Vite + Electron with hot reload
npm run dist:win     # NSIS installer
npm run dist:mac     # DMG (see MAC_BUILD_AND_SIGNING.md)
```

`npm run build` compiles **both** the renderer and the Electron main process. A change that
breaks the Electron build is a regression even when the APK builds, because both share `src/`.

Note: this repo holds only the `electron/` modules the renderer compiles directly (types,
parsers); the desktop app itself lives upstream (`AGENTS.md`). The "Electron main process"
above does not exist here — what must keep working is the shared `src/` + `electron/`
compilation that `npm run build` performs.

---

## 11. Release checklist (A-605/A-606)

- [ ] `versionCode` bumped, all version sites in sync (§5)
- [ ] `npx tsc --noEmit` clean (no test suite exists — do not claim `npm test` results; see `TESTING.md` §1)
- [ ] `npm run build && npx cap sync android`
- [ ] `assembleRelease` succeeds (locally or via CI), `apksigner verify` shows the expected DN
- [ ] Install **over** the previous build — data intact (A-606)
- [ ] Clean-device install: onboarding → guest → play → background → notification → offline (A-605)
- [ ] APK copied somewhere the owner can reach it, path recorded in `STATUS.md`
- [ ] Release created as DRAFT until a verified installable APK exists; publish only with the APK attached
