# CI RELEASE — signed APKs from GitHub Actions

The release keystore lives only on the owner's machine (see `BUILD.md` §4).
This workflow lets GitHub Actions build a signed release APK with that same
key, so a CI-built APK upgrades the installed app in place instead of
refusing with a signature mismatch.

The workflow is `.github/workflows/android-release.yml`. It runs on tag
pushes (`v*`) and on manual dispatch from the Actions tab. It needs four
repository secrets, set up once below. If any secret is missing, the
workflow fails immediately with a clear error — it never produces an APK
signed with the wrong key.

---

## 1. One-time setup: add the four secrets

In the `bytune-android` repo on GitHub: **Settings > Secrets and variables
> Actions > New repository secret**. Add each of these exactly (names are
case-sensitive):

| Secret name | Value |
|---|---|
| `KEYSTORE_BASE64` | The release keystore file, base64-encoded, on ONE line (see step 1a) |
| `KEYSTORE_PASSWORD` | The keystore (store) password from `android/keystore.properties` |
| `KEY_ALIAS` | The key alias from `android/keystore.properties` (e.g. `bytune`) |
| `KEY_PASSWORD` | The key password from `android/keystore.properties` |

### 1a. Encode the keystore to base64

Run this in bash on the machine that holds the keystore (the file stays
outside the repo; only its base64 form goes into the secret):

```bash
base64 -w 0 ~/.bytune-keys/bytune-release.jks > /tmp/bytune-release.b64
```

Then open `/tmp/bytune-release.b64`, copy its entire contents (one long
line, no line breaks), and paste it as the value of `KEYSTORE_BASE64`.

- If the keystore lives somewhere else, use that path instead of
  `~/.bytune-keys/bytune-release.jks` — the path in `storeFile` inside
  `android/keystore.properties` is the one that signed the installed app.
- Do NOT commit the `.b64` file or the keystore itself. Delete
  `/tmp/bytune-release.b64` when done.
- If the passwords in `android/keystore.properties` are ever changed, the
  matching secrets must be updated too (edit the secret; GitHub never shows
  the old value).

---

## 2. Trigger a build

### Option A — tag push (creates a draft release)

```bash
git tag v1.1.0
git push origin v1.1.0
```

The workflow builds the APK and creates a **draft** GitHub release for that
tag with the APK attached. Nothing is published until the draft is reviewed
and published by hand on the Releases page.

Use a new tag for every release (`v1.1.1`, `v1.2.0`, …). Re-pushing the
same tag does not create a second release.

### Option B — manual run (APK only, no release)

GitHub repo > **Actions** > **Android release** > **Run workflow** > **Run
workflow**. The APK is uploaded as a build artifact named
`bytune-release-apk`, downloadable from the workflow run page. No release
is created.

---

## 3. Download and install the APK

- **From a draft release:** Releases page > the draft release > Assets >
  `app-release.apk`. Download it, copy it to the phone, tap it to install.
- **From a manual run:** the workflow run page > Artifacts >
  `bytune-release-apk` (a zip containing `app-release.apk`).

Install over the previous build with `-r` to keep data, or just tap the
file on the phone:

```bash
adb install -r app-release.apk
```

A CI-built APK is signed with the same key as the local release build, so
it upgrades the installed app in place, data intact — same as `BUILD.md`
§8. Verify the signature before distributing, exactly as for a local
build:

```bash
apksigner verify --print-certs app-release.apk
```

The printed certificate DN must match the key created in `BUILD.md` §4.1.

---

## 4. Build locally instead

If CI is not set up (or the secrets are missing), build on the machine
that holds the keystore, exactly as `BUILD.md` §2–§4 describes:

```bash
npm run apk
```

That runs the typecheck + Vite build, `cap sync`, and the Gradle release
build, signing with `android/keystore.properties`. The APK lands at
`android/app/build/outputs/apk/release/app-release.apk`.

---

## 5. Signature-mismatch warning — read before installing

Android refuses to install an update signed with a **different** key than
the installed app (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`). The only fix is
to uninstall first, which **deletes all local data** (downloads, likes,
playlists, settings).

Concretely:

- A **debug-signed** APK (`assembleDebug`, or any build made on a machine
  without `keystore.properties`) will NOT upgrade the installed release
  build (1.0.3+) in place. Do not install a debug APK over the release app
  expecting an upgrade — it will fail, and uninstalling to fix it loses
  data.
- A CI-built APK upgrades in place **only** when the `KEYSTORE_BASE64`
  secret holds the same keystore that signed the installed app. If the
  secret holds a different/expired key, the build succeeds but the install
  fails the same way.
- If the original keystore is lost, every future build is a different app
  to Android: back the keystore up (see `BUILD.md` §4.1).

When in doubt, check the certificate with `apksigner verify
--print-certs` on both the installed APK's replacement and a known-good
release APK before installing.
