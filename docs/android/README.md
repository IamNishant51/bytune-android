# ByTune Android — documentation index

This folder is the operating manual for turning the Android port into a daily-driver APK.
It is written for an AI agent (and for a human) working on the repo, and it is designed so
that **nothing here needs to be guessed**: every claim points at a file, a command, or a
recorded observation.

Start with the root `AGENTS.md` — it holds the rules. Then read `STATUS.md`.

| Doc | Use it when |
|---|---|
| `STATUS.md` | **Always first.** What is done, in progress, next, blocked, unverified. The only status board. |
| `ROADMAP.md` | You need the task list, task IDs (`A-###`), phases and exit criteria. |
| `ARCHITECTURE.md` | You need to know how the phone build actually works before changing it. |
| `FEATURES.md` | You need the desktop→Android parity state of a specific feature, and its acceptance test. |
| `RESPONSIVE.md` | You are touching layout, breakpoints, insets, navigation or screen-size behaviour. |
| `TESTING.md` | You are about to claim something works, or you need the emulator/CDP recipes. |
| `BUILD.md` | You are building, signing, versioning or installing the APK. |
| `DECISIONS.md` | You are about to make an architectural choice, or you wonder why one was made. |

## Status vocabulary

Used identically in every doc. Do not invent new words.

| Word | Meaning |
|---|---|
| `WORKS` | Implemented **and** observed working on the emulator/device, with an evidence line. |
| `PARTIAL` | Some of the behaviour is real, some is missing. The missing part is named. |
| `STUB` | Present in the bridge so the UI does not throw, but does nothing. Must be hidden or implemented. |
| `HIDDEN` | The UI surface is deliberately not rendered on Android, with a recorded reason. |
| `MISSING` | The desktop feature does not exist on Android at all. |
| `BROKEN` | Implemented but fails when exercised. Include the error. |
| `UNVERIFIED` | Code exists, nobody has exercised it on a device yet. Include the command that would settle it. |
| `BLOCKED` | Cannot proceed: needs a decision, a dependency, or the owner. |

## Maintenance protocol

1. A change is not finished until `STATUS.md` says so, with evidence.
2. `FEATURES.md` rows carry the truth per feature; `STATUS.md` carries the work queue.
3. If code and docs disagree, **the code wins** — fix the doc in the same change.
4. Never delete a done item; move it to the Done log with its date and evidence.
5. Task IDs are minted in `ROADMAP.md` only.
