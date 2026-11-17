/**
 * PO-token minter, browser edition.
 *
 * Bundled to `android/app/src/main/assets/potoken.js` and run inside a hidden
 * WebView whose document URL is https://www.youtube.com/ (see
 * ByTuneShellPlugin). Same recipe as `electron/po-token.ts`, minus JSDOM:
 *
 *   1. read the BotGuard challenge the YouTube homepage embeds (falling back
 *      to /att/get),
 *   2. run the interpreter, snapshot the VM,
 *   3. hand the snapshot to the native side for GenerateIT — that call is
 *      cross-origin from a WebView and would need CORS; OkHttp does not,
 *   4. mint the WebPO token bound to the visitor data and post it back.
 *
 * A snapshot taken from a non-YouTube origin is scored invalid and GenerateIT
 * answers with no integrity token, which is why the document URL matters.
 */
import { BotGuardClient } from "bgutils-js/botguard";
import { WebPoMinter } from "bgutils-js/webpo";
import { parseLooseJSON } from "bgutils-js/utils";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Challenge {
  program: string;
  globalName: string;
  interpreterJS: string;
  ytcfg: Record<string, any> | null;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function bridge(): any {
  return (globalThis as any).__bytuneIT ?? null;
}

function done(payload: { token?: string; error?: string }): void {
  const out = (globalThis as any).__bytunePoDone;
  if (typeof out === "function") out(JSON.stringify(payload));
}

function interpreterOf(bg: any): { interpreterJS: string; program: string; globalName: string } | null {
  if (!bg?.program || !bg?.globalName) return null;
  const inline = bg?.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue;
  return { interpreterJS: inline ?? "", program: bg.program, globalName: bg.globalName };
}

async function fetchInterpreter(bg: any): Promise<string | null> {
  const wrapped = bg?.interpreterUrl?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue;
  if (!wrapped) return null;
  const res = await fetch(`https:${wrapped}`, { headers: { "user-agent": UA } });
  return res.ok ? res.text() : null;
}

async function fromHomepage(): Promise<Challenge | null> {
  const res = await fetch("https://www.youtube.com", { headers: { "user-agent": UA } });
  const html = await res.text();
  let ytcfg: Record<string, any> | null = null;
  const cfg = html.match(/ytcfg\.set\(({.+?})\);/s);
  if (cfg) {
    try {
      ytcfg = JSON.parse(cfg[1]);
    } catch {
      ytcfg = null;
    }
  }
  const att = html.match(/window\.ytAtN\(\s*({[\s\S]*?})\s*\)/);
  if (!att) return null;
  const bg = (parseLooseJSON as any)(att[1])?.R?.bgChallenge;
  const base = interpreterOf(bg);
  if (!base) return null;
  const interpreterJS = base.interpreterJS || (await fetchInterpreter(bg)) || "";
  if (!interpreterJS) return null;
  return { ...base, interpreterJS, ytcfg };
}

async function fromAttGet(): Promise<Challenge | null> {
  const native = bridge();
  if (!native?.attGet) return null;
  const parsed = JSON.parse(String(native.attGet() ?? "{}"));
  if (!parsed?.program || !parsed?.globalName || !parsed?.interpreterJS) {
    throw new Error(parsed?.error ?? "att/get: no challenge");
  }
  return { program: parsed.program, globalName: parsed.globalName, interpreterJS: parsed.interpreterJS, ytcfg: null };
}

async function mint(visitorData: string): Promise<string> {
  let stage = "start";
  try {
    let challenge: Challenge | null = null;
    stage = "homepage";
    try {
      challenge = await fromHomepage();
    } catch (err) {
      stage = `homepage(${err instanceof Error ? err.message : String(err)})`;
    }
    if (!challenge) {
      stage = "attget";
      challenge = await fromAttGet();
    }
    if (!challenge) throw new Error("no BotGuard challenge");

    if (challenge.ytcfg) (globalThis as any).yt = { config_: challenge.ytcfg };
    const g = globalThis as any;
    stage = "interpreter";
    if (!g[challenge.globalName]) new Function(challenge.interpreterJS)();
    if (!g[challenge.globalName]) throw new Error("interpreter did not load");

    stage = "snapshot";
    const botguard = await BotGuardClient.create({
      globalObject: g,
      globalName: challenge.globalName,
      program: challenge.program,
    });
    const webPoSignalOutput: any[] = [];
    const snapshot = await botguard.snapshot({ webPoSignalOutput } as any, 20000);
    if (!snapshot) throw new Error("empty BotGuard snapshot");

    // GenerateIT is cross-origin from here; the native side owns that POST
    // (it adds the request key and returns the integrity token).
    stage = "generateit";
    const native = bridge();
    if (!native?.generateIT) throw new Error("native bridge missing");
    const raw = native.generateIT(String(snapshot));
    const parsed = JSON.parse(String(raw ?? "{}"));
    if (!parsed?.integrityToken) throw new Error(parsed?.error ?? "no integrity token");

    stage = "mint";
    const minter = await WebPoMinter.create(
      {
        integrityToken: parsed.integrityToken,
        estimatedTtlSecs: parsed.ttl ?? undefined,
        mintRefreshThreshold: null,
        websafeFallbackToken: parsed.integrityToken,
      } as any,
      webPoSignalOutput
    );
    const token = await minter.mintAsWebsafeString(visitorData);
    if (!token) throw new Error("minting returned no token");
    return token;
  } catch (err) {
    throw new Error(`${stage}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

(globalThis as any).__bytuneMintPoToken = async (visitorData: string): Promise<void> => {
  try {
    done({ token: await mint(visitorData) });
  } catch (err) {
    const where = typeof location !== "undefined" ? ` @ ${location.origin}${location.pathname}` : "";
    done({ error: `${err instanceof Error ? err.message : String(err)}${where}` });
  }
};

(globalThis as any).__bytunePoReady = true;
