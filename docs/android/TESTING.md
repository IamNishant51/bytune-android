# TESTING — how to prove something works

Rule: **a feature is not done until a device shows it working.** Typecheck and unit tests are
necessary, never sufficient — the renderer compiles fine while the phone shows a white screen.

Every claim you make must name a command and quote its output (`AGENTS.md` §3).

---

## 1. The gates

| Gate | Command | Pass condition |
|---|---|---|
| G0 | `npx tsc --noEmit` | exit 0, no output |
| G1 | `npm test` | `fail 0` (currently 279 pass) |
| G2 | `npm run build` | `✓ built in …` |
| G3 | `npx cap sync android` then `./gradlew.bat assembleDebug` | `BUILD SUCCESSFUL` |
| G4 | device run of the changed behaviour | observed result + `logcat`/CDP evidence |
| G5 | screenshot at the sizes in `RESPONSIVE.md` §7 | read back, checked |
| G6 | `docs/android/STATUS.md` updated | task moved, evidence line added |

G1 takes 13 s on a warm machine, up to 8 min cold. Run it in the background while doing other
work rather than blocking on it.

---

## 2. Environment

```bash
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-17.0.20.101-hotspot"
export ANDROID_HOME="/c/Users/nisha/AppData/Local/Android/Sdk"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
```

`JAVA_HOME`/`ANDROID_HOME` are **not** set globally. Every Gradle command needs them inline.

---

## 3. Emulator lifecycle

```bash
# start (headless). The shell sometimes reports exit 1 while the device stays up —
# check `adb devices` before assuming failure.
"$ANDROID_HOME/emulator/emulator.exe" -avd bytune -no-window -no-audio -no-boot-anim \
  -gpu swiftshader_indirect -no-snapshot &

# wait for boot
adb wait-for-device
until [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = "1" ]; do sleep 2; done

# stop
adb emu kill
```

AVD `bytune` = Pixel 6, 1080×2400, density 2.625 → **412 dp wide**, portrait.

### Orientation

```bash
adb shell settings put system accelerometer_rotation 0
adb shell settings put system user_rotation 1   # landscape
adb shell settings put system user_rotation 0   # portrait
```

A landscape phone reports `innerWidth 866` — see `RESPONSIVE.md` §1 for why that matters.

### System settings worth toggling in tests

```bash
adb shell settings put system font_scale 1.3     # A-407
adb shell settings put secure enabled_accessibility_services ...  # RTL via developer options
adb shell cmd connectivity airplane-mode enable  # A-502 / A-206
```

---

## 4. Install and launch

```bash
npm run build && npx cap sync android
cd android && ./gradlew.bat assembleDebug --console=plain
adb install -r app/build/outputs/apk/debug/app-debug.apk

# true fresh install (onboarding path)
adb uninstall com.bytune.music
adb install app/build/outputs/apk/debug/app-debug.apk

adb logcat -c
adb shell am start -n com.bytune.music/.MainActivity
```

Cold start takes ~15 s on this emulator before the WebView is interactive. Sleep, do not poll
in a tight loop.

---

## 5. Inspecting the WebView (CDP)

```bash
pid=$(adb shell pidof com.bytune.music | tr -d '\r')
adb forward tcp:9222 localabstract:webview_devtools_remote_$pid
curl -s http://127.0.0.1:9222/json
```

The forward dies when the app restarts — redo it after every `am force-stop`/reinstall.

### The three helper scripts

They lived in `.potest/` and were deleted after the last verification run. Recreate them when
needed; they are small and they are the only reliable way to drive this app.

**`cdp.mjs`** — evaluate an expression and print the result.

```js
// node cdp.mjs "({w: innerWidth, h: innerHeight})"
const expr = process.argv[2];
const list = await (await fetch("http://127.0.0.1:9222/json")).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
const id = 1;
ws.send(JSON.stringify({ id, method: "Runtime.evaluate",
  params: { expression: expr, returnByValue: true, awaitPromise: true } }));
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id !== id) return;
  console.log(JSON.stringify(msg.result?.result?.value ?? msg.result, null, 2));
  ws.close();
});
```

**`tap.mjs`** — tap the Nth match of a selector with a **trusted** gesture.

```js
// node tap.mjs ".mobile-tab" 2
const selector = process.argv[2];
const index = Number(process.argv[3] ?? 0);
const list = await (await fetch("http://127.0.0.1:9222/json")).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let nextId = 1;
const send = (method, params) => new Promise((resolve) => {
  const id = nextId++;
  const onMessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id !== id) return;
    ws.removeEventListener("message", onMessage);
    resolve(m);
  };
  ws.addEventListener("message", onMessage);
  ws.send(JSON.stringify({ id, method, params }));
});
const rect = await send("Runtime.evaluate", {
  expression: `(() => {
    const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40) };
  })()`,
  returnByValue: true,
});
const r = rect.result?.result?.value;
if (!r) { console.log("no match:", selector, index); process.exit(1); }
for (const type of ["mousePressed", "mouseReleased"]) {
  await send("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: "left", clickCount: 1 });
}
console.log(`tapped "${r.label}" at ${Math.round(r.x)} ${Math.round(r.y)}`);
ws.close();
```

**`type.mjs`** — focus, insert text, press Enter.

```js
// node type.mjs ".mobile-search input" "arijit singh"
const selector = process.argv[2];
const text = process.argv[3] ?? "";
const list = await (await fetch("http://127.0.0.1:9222/json")).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let nextId = 1;
const send = (method, params) => new Promise((resolve) => {
  const id = nextId++;
  const onMessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id !== id) return;
    ws.removeEventListener("message", onMessage);
    resolve(m);
  };
  ws.addEventListener("message", onMessage);
  ws.send(JSON.stringify({ id, method, params }));
});
const focused = await send("Runtime.evaluate", {
  expression: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.focus(); return document.activeElement === el; })()`,
  returnByValue: true,
});
if (!focused.result?.result?.value) { console.log("could not focus:", selector); process.exit(1); }
await send("Input.insertText", { text });
await send("Input.dispatchKeyEvent", {
  type: "keyDown", key: "Enter", code: "Enter",
  text: String.fromCharCode(13),          // required for implicit form submit
  unmodifiedText: String.fromCharCode(13),
  windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
});
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter",
  windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
console.log("typed", JSON.stringify(text), "into", selector);
ws.close();
```

### Traps that cost time

| Trap | Reality |
|---|---|
| `element.click()` in `Runtime.evaluate` | Not a trusted gesture. React handlers may fire; media, focus and scroll behaviour will not match a finger. Use `Input.dispatchMouseEvent`. |
| Synthetic `MouseEvent` / `dispatchEvent` | Same problem. |
| Enter on an input | Needs `text: "\r"` (or `String.fromCharCode(13)`) in `Input.dispatchKeyEvent`, otherwise no implicit form submit. |
| `element.scrollIntoView()` | Scrolls the `overflow:hidden` shell root and makes the bottom nav appear mid-screen. The screenshot then looks broken when the app is fine. Always reset: `document.querySelector('#root > div').scrollTop = 0`. |
| Reading state before the network settles | Home/search take 5–9 s on the emulator. Sleep, then read. |

---

## 6. Reading the logs

```bash
adb logcat -s ByTunePoToken:* ByTuneStream:* Capacitor/Console:* Chrome:* | tail -40
```

| Line | Meaning |
|---|---|
| `challenge ok: … program bytes, … interpreter bytes` | BotGuard challenge parsed |
| `minted token: 180 chars` | PO token OK |
| `relay HTTP 206 range=bytes=0- len=…` | Stream proxy served audio |
| `Broken pipe` warnings | Normal on seek/abort; only a problem if playback stops |
| `TypeError: X is not a function` | A bridge method's promise-ness is wrong |
| `Failed to fetch` | CORS — a request bypassed `CapacitorHttp` |

---

## 7. Per-feature manual scripts

Each one is written to be runnable as-is. All start from a launched app with CDP forwarded.

### 7.1 App boots to onboarding on a fresh install
```bash
adb uninstall com.bytune.music && adb install android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.bytune.music/.MainActivity && sleep 16
node cdp.mjs "document.body.innerText.replace(/\n/g,' | ').slice(0,120)"
```
Expect `Your music lives here. … Continue as guest`.

### 7.2 Home feed loads
Tap "Continue as guest", sleep 12, read text. Expect a greeting, mood chips, shelves.

### 7.3 Playback
```bash
node tap.mjs ".mobile-tab" 0            # Home
node tap.mjs "button" 0                 # first mood chip — check the label first
sleep 8
node cdp.mjs "document.querySelector('.mobile-player')?.innerText"
node cdp.mjs "document.querySelector('.mobile-player-progress span')?.style.width"
sleep 6
node cdp.mjs "document.querySelector('.mobile-player-progress span')?.style.width"
```
Second read must be larger than the first.

### 7.4 Pause / resume
```bash
node tap.mjs ".mobile-player-controls button" 1
node cdp.mjs "[...document.querySelectorAll('.mobile-player-controls button')].map(b=>b.getAttribute('aria-label'))"
sleep 5
node cdp.mjs "document.querySelector('.mobile-player-progress span')?.style.width"   # unchanged
node tap.mjs ".mobile-player-controls button" 1
sleep 4
node cdp.mjs "document.querySelector('.mobile-player-progress span')?.style.width"   # advanced
```

### 7.5 Background audio
```bash
adb shell input keyevent KEYCODE_HOME && sleep 12
node cdp.mjs "({p: document.querySelector('.mobile-player-progress span')?.style.width, vis: document.visibilityState})"
```
Expect `vis: "hidden"` and an advanced position.

### 7.6 Search
```bash
node tap.mjs ".mobile-tab" 2
node type.mjs ".mobile-search input" "kabhi kabhi aditi"
sleep 8
node cdp.mjs "document.body.innerText.replace(/\n/g,' | ').slice(0,200)"
```

### 7.7 PO token and stream (log-level)
```bash
adb logcat -c; # then play something
adb logcat -d -s ByTunePoToken:* ByTuneStream:* | grep -E "minted token|relay HTTP"
```

### 7.8 Layout at a size
```bash
adb shell wm size 700x900 && adb shell wm density 160   # medium-class check
sleep 2
node cdp.mjs "({w: innerWidth, cls: document.querySelector('.mobile-nav') ? 'compact-shell' : 'wide-shell'})"
adb exec-out screencap -p > docs/android/screenshots/medium-700.png
adb shell wm size reset && adb shell wm density reset
```
`wm size`/`wm density` is the cheap way to hit the matrix without creating AVDs. Reset after.

### 7.9 Screenshot review
```bash
adb exec-out screencap -p > shot.png
```
Then **open the PNG and look at it**. A screenshot you did not read is not evidence.

---

## 8. What "verified" means in a report

Bad:
> The queue should work now.

Good:
> `node tap.mjs ".mobile-player-meta"` → overlay opened. `node cdp.mjs "document.querySelectorAll('.queue-row').length"` → `12`. `logcat` showed no errors. Screenshot `docs/android/screenshots/nowplaying-412.png` reviewed: transport row fully visible.

Include: the command, the output, the screenshot path, and the files changed.

---

## 9. Regression checklist before calling a phase done

- [ ] G0–G6 all green and quoted
- [ ] Desktop path still builds (`npm run build` builds both targets)
- [ ] Fresh install → onboarding → play, on a clean `adb uninstall`
- [ ] Background playback for at least 10 minutes
- [ ] Rotation at every phase (once A-409 lands)
- [ ] `git status` clean of build output (`dist/`, `android/app/build/`, `.potest/`)
- [ ] `STATUS.md` and `FEATURES.md` updated
