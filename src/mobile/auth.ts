/**
 * Supabase auth for ByTune Android / Web edition.
 *
 * Provides Google OAuth PKCE and session persistence over Capacitor/localStorage.
 */
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { OAUTH_REDIRECT, SUPABASE_ANON_KEY, SUPABASE_URL } from "../lib/config";
import { normalizeUsername, usernameProblem } from "../lib/account-validators";

const PROFILE_KEY = "bytune.mobile.profile";
const SESSION_KEY = "bytune.mobile.auth_session";

export interface MobileProfile {
  mode: "guest" | "account" | null;
  userId: string | null;
  username: string | null;
  freshInstall: boolean;
  needsUsername?: boolean;
}

let client: SupabaseClient | null = null;
let currentSession: Session | null = null;

function getSupabase(): SupabaseClient {
  if (client) return client;
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      flowType: "pkce",
      detectSessionInUrl: false,
      autoRefreshToken: true,
      persistSession: false,
    },
  });
  client.auth.onAuthStateChange((_event, session) => {
    currentSession = session;
    if (session) {
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      } catch {
        /* ignore */
      }
    } else {
      localStorage.removeItem(SESSION_KEY);
    }
  });
  return client;
}

export function readProfile(): MobileProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) return JSON.parse(raw) as MobileProfile;
  } catch {
    /* ignore */
  }
  return { mode: null, userId: null, username: null, freshInstall: true, needsUsername: false };
}

export function writeProfile(p: Partial<MobileProfile>): MobileProfile {
  const existing = readProfile();
  const next: MobileProfile = {
    ...existing,
    ...p,
  };
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

const authListeners = new Set<(info: MobileProfile) => void>();

export function announceAuth(): void {
  const p = readProfile();
  for (const fn of authListeners) {
    try {
      fn(p);
    } catch {
      /* ignore */
    }
  }
}

export function onAuthChanged(cb: (info: MobileProfile) => void): () => void {
  authListeners.add(cb);
  return () => authListeners.delete(cb);
}

/** Restore stored session at startup if any */
export async function initAuth(): Promise<void> {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const stored = JSON.parse(raw) as Session;
    if (!stored?.access_token || !stored?.refresh_token) return;
    const { data, error } = await getSupabase().auth.setSession({
      access_token: stored.access_token,
      refresh_token: stored.refresh_token,
    });
    if (error) {
      console.warn("[bytune mobile] session restore failed:", error.message);
      return;
    }
    currentSession = data.session;
    if (data.session?.user) {
      const p = readProfile();
      if (p.mode === "account") {
        writeProfile({ userId: data.session.user.id });
      }
    }
  } catch (err) {
    console.warn("[bytune mobile] session restore error:", err);
  }
}

let pendingOAuthResolve: ((info: MobileProfile) => void) | null = null;
let pendingOAuthReject: ((err: Error) => void) | null = null;
let pendingOAuthTimer: ReturnType<typeof setTimeout> | null = null;
const earlyOAuthCallbacks: string[] = [];

function clearPendingOAuth(): void {
  pendingOAuthResolve = null;
  pendingOAuthReject = null;
  if (pendingOAuthTimer) {
    clearTimeout(pendingOAuthTimer);
    pendingOAuthTimer = null;
  }
}

/** Open external browser on device using Capacitor plugin or window.open */
async function openExternal(url: string): Promise<void> {
  const cap = (globalThis as any).Capacitor;
  const shell = cap?.Plugins?.ByTuneShell;
  if (shell?.openExternalUrl) {
    await shell.openExternalUrl({ url });
    return;
  }
  window.open(url, "_system");
}

export async function signInGoogle(): Promise<MobileProfile> {
  const { data, error } = await getSupabase().auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: OAUTH_REDIRECT,
      skipBrowserRedirect: true,
      queryParams: { prompt: "select_account" },
    },
  });
  if (error || !data?.url) throw new Error(error?.message ?? "Could not start Google sign-in.");

  return new Promise<MobileProfile>((resolve, reject) => {
    clearPendingOAuth();
    pendingOAuthResolve = resolve;
    pendingOAuthReject = reject;

    const early = earlyOAuthCallbacks.splice(0).pop();
    if (early) {
      void handleOAuthCallback(early).catch((err) => console.warn("[bytune mobile] oauth callback:", err.message));
      return;
    }

    void openExternal(data.url).catch((err) => {
      if (pendingOAuthResolve !== resolve) return;
      clearPendingOAuth();
      reject(err instanceof Error ? err : new Error("Could not open the sign-in browser."));
    });

    // 5 min timeout
    pendingOAuthTimer = setTimeout(() => {
      if (pendingOAuthResolve === resolve) clearPendingOAuth();
      reject(new Error("Google sign-in timed out. Please try again."));
    }, 5 * 60 * 1000);
  });
}

export async function handleOAuthCallback(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  const redirect = new URL(OAUTH_REDIRECT);
  if (
    parsed.protocol !== redirect.protocol ||
    parsed.hostname !== redirect.hostname ||
    parsed.pathname.replace(/\/+$/, "") !== redirect.pathname.replace(/\/+$/, "")
  ) {
    return;
  }

  const code = parsed.searchParams.get("code");
  if (!code) {
    const errorDesc = parsed.searchParams.get("error_description") ?? "Google sign-in didn't complete.";
    pendingOAuthReject?.(new Error(errorDesc));
    clearPendingOAuth();
    return;
  }

  if (!pendingOAuthResolve) {
    earlyOAuthCallbacks.push(url);
    return;
  }

  const resolve = pendingOAuthResolve;
  const reject = pendingOAuthReject;
  clearPendingOAuth();

  try {
    const { data, error } = await getSupabase().auth.exchangeCodeForSession(code);
    if (error || !data.session?.user) {
      throw new Error(error?.message ?? "Could not complete sign-in.");
    }
    currentSession = data.session;
    const user = data.session.user;

    // Check existing profile in Supabase profiles table
    let username: string | null = null;
    let needsUsername = false;

    const { data: profileRow } = await getSupabase()
      .from("profiles")
      .select("username")
      .eq("id", user.id)
      .maybeSingle();

    if (profileRow?.username) {
      username = profileRow.username;
    } else {
      // Auto-assign display name or email stem
      const fallback = (user.user_metadata?.full_name || user.email?.split("@")[0] || "user").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 20);
      username = fallback || `user_${user.id.slice(0, 6)}`;
      needsUsername = true;
    }

    const updated = writeProfile({
      mode: "account",
      userId: user.id,
      username,
      freshInstall: false,
      needsUsername,
    });
    announceAuth();
    resolve(updated);
  } catch (err) {
    reject?.(err instanceof Error ? err : new Error("Google sign-in didn't complete."));
  }
}

export async function authSetUsername(newUsername: string): Promise<{ ok: boolean }> {
  const clean = normalizeUsername(newUsername);
  const problem = usernameProblem(clean);
  if (problem) throw new Error(problem);

  const profile = readProfile();
  if (profile.mode !== "account" || !profile.userId) {
    throw new Error("Sign in with Google first.");
  }

  const { error } = await getSupabase()
    .from("profiles")
    .upsert({ id: profile.userId, username: clean });

  if (error) throw new Error(error.message);

  writeProfile({ username: clean, needsUsername: false });
  announceAuth();
  return { ok: true };
}

export async function authUsernameAvailable(username: string): Promise<boolean> {
  const clean = normalizeUsername(username);
  const { data, error } = await getSupabase()
    .from("profiles")
    .select("username")
    .eq("username", clean)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data == null;
}

export async function authSignOut(): Promise<void> {
  try {
    await getSupabase().auth.signOut();
  } catch {
    /* ignore */
  }
  currentSession = null;
  localStorage.removeItem(SESSION_KEY);
  writeProfile({ mode: null, userId: null, username: null, freshInstall: false, needsUsername: false });
  announceAuth();
}
