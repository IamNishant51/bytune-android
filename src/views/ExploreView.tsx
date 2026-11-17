import { useEffect, useState } from "react";
import { Compass, Search } from "lucide-react";
import { useUI } from "../stores/ui";
import { useIsMobile } from "../lib/useIsMobile";
import { useSession } from "../lib/session";
import { requireBridge } from "../lib/bridge";
import { FALLBACK_MOODS, type MoodEntry } from "../../electron/moods";

/**
 * Explore — the provider's own per-market "Moods & genres" catalog, rendered
 * as high-impact Apple Music / Spotify style cards with authentic genre artwork,
 * smooth liquid glass light sheens, and dark gradient contrast scrims.
 */

const MOODS_TTL_MS = 24 * 3_600_000;
let moodCache: { moods: MoodEntry[]; at: number } | null = null;

async function loadMoods(): Promise<MoodEntry[]> {
  if (moodCache && Date.now() - moodCache.at < MOODS_TTL_MS) return moodCache.moods;
  try {
    const moods = (await requireBridge().getMoods()) as MoodEntry[];
    const usable = moods.filter((m) => m.browseId.includes("moods_and_genres_category"));
    if (usable.length >= 6) {
      moodCache = { moods: usable, at: Date.now() };
      return usable;
    }
  } catch {
    /* offline / no bridge — neutral global fallback below */
  }
  return moodCache?.moods ?? FALLBACK_MOODS;
}

/** Darken a #RRGGBB color for the gradient's second stop. */
function shade(hex: string, factor: number): string {
  const n = hex.replace("#", "");
  const rgb = n.length === 6 ? [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16)) : [58, 12, 163];
  const dark = rgb.map((c) => Math.max(0, Math.round(c * factor)));
  return `#${dark.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** Relatable photographic artwork for genre cards (Apple Music / Spotify UX) */
const GENRE_PHOTOS: [RegExp, string][] = [
  [/today'?s hits/, "photo-1516450360452-9312f5e86fc7"],
  [/lo-?fi/, "photo-1534447677768-be436bb09401"],
  [/desi hip-hop|desi rap/, "photo-1546707012-0c9f63da0952"],
  [/hip-hop|hip hop|rap/, "photo-1509198397868-475647b2a1e5"],
  [/punk/, "photo-1526478806334-5fd488fcaabc"],
  [/rock/, "photo-1498038432885-c6f3f1b912ee"],
  [/indian pop/, "photo-1508700115892-45ecd05ae2ad"],
  [/k-pop/, "photo-1538481199705-c710c4e965fc"],
  [/j-pop/, "photo-1503899036084-c55cdd92da26"],
  [/pop hits/, "photo-1514525253161-7a46d19cd819"],
  [/pop/, "photo-1501386761578-eac5c94b800a"],
  [/dance|electronic|edm|club/, "photo-1470225620780-dba8ba36b745"],
  [/r&b|soul/, "photo-1511671782779-c97d3d27a1d4"],
  [/indian indie/, "photo-1464375117522-1311d6a5b81f"],
  [/indie|alt/, "photo-1539375665275-f9de415ef9ac"],
  [/chill/, "photo-1518495973542-4542c06a5843"],
  [/relax/, "photo-1506744038136-46273834b3fb"],
  [/workout|fitness/, "photo-1534438327276-14e5300c3a48"],
  [/energize|energy/, "photo-1476480862126-209bfaa8edc8"],
  [/feel good/, "photo-1470240731273-7821a6eeb6bd"],
  [/focus|study|work/, "photo-1434030216411-0b793f4b4173"],
  [/sleep|night|bedtime/, "photo-1506703719100-a0f3a48c0f86"],
  [/party/, "photo-1492684223066-81342ee5ff30"],
  [/carnatic classical/, "photo-1582719478250-c89cae4dc85b"],
  [/hindustani classical/, "photo-1514306191717-452ec28c7814"],
  [/classical/, "photo-1520523839898-50712743e9a7"],
  [/jazz/, "photo-1511192336575-5a79af67a629"],
  [/blues/, "photo-1525994886773-080587e161c2"],
  [/country|americana/, "photo-1510915361894-db8b60106cb1"],
  [/metal|heavy/, "photo-1470229722913-7c0e2dbbafd3"],
  [/reggaeton/, "photo-1516450360452-9312f5e86fc7"],
  [/latin/, "photo-1504609773096-104ff2c73ba4"],
  [/gaming|game/, "photo-1542751371-adc38448a05e"],
  [/folk|acoustic/, "photo-1465847899084-d164df4dedc6"],
  [/romance|love/, "photo-1518199266791-5375a83190b7"],
  [/commute|travel|drive/, "photo-1508873696983-2df5293cb395"],
  [/decades|80s|90s|2000s|retro/, "photo-1550745165-9bc0b252726f"],
  [/sad/, "photo-1515694346937-94d85e41e6f0"],
  [/african|afrobeats/, "photo-1516026672322-bc52d61a55d5"],
  [/arabic/, "photo-1512453979798-5ea266f8880c"],
  [/reggae|caribbean/, "photo-1507525428034-b723cf961d3e"],
  [/ghazal|sufi/, "photo-1603052875302-d376b7c0638a"],
  [/devotional/, "photo-1609840114035-3c981b782dfe"],
  [/family/, "photo-1490902931861-8de99b1b3293"],
  [/monsoon/, "photo-1534274988757-a28bf1a57c17"],
  [/diwali/, "photo-1574267432553-4b4628081c31"],
  [/punjabi/, "photo-1533174072545-7a4b6ad7a6c3"],
  [/hindi|bollywood|desi/, "photo-1489599849927-2ee91cede3ba"],
  [/tamil/, "photo-1582510003544-4d00b7f74220"],
  [/telugu/, "photo-1605649487212-47bdab064df7"],
  [/malayalam/, "photo-1602216056096-3b40cc0c9944"],
  [/kannada/, "photo-1590682680695-43b964a3ae17"],
  [/bengali/, "photo-1558431382-27e303142255"],
  [/marathi/, "photo-1570168007204-dfb528c6958f"],
  [/gujarati/, "photo-1603228254119-e6a4d095dc59"],
  [/bhojpuri/, "photo-1500382017468-9049fed747ef"],
  [/haryanvi/, "photo-1500651230702-0e2d8a49d4ad"],
];

const STUDIO_FALLBACKS = [
  "photo-1511379938547-c1f69419868d",
  "photo-1524368535928-5b5e00ddc76b",
  "photo-1487180144351-b8472da7d491",
  "photo-1501612780327-45045538702b",
  "photo-1468164016595-6108e4c60c8b",
  "photo-1514320291840-2e0a9bf2a9ae",
  "photo-1445985543468-7944e99500b5",
  "photo-1525362081669-2b476bb628c3",
  "photo-1507838153414-b4b713384a76",
  "photo-1497911270199-1c552ee64aa4",
];

function genreArtwork(title: string): string {
  const t = title.toLowerCase();
  for (const [pattern, id] of GENRE_PHOTOS) {
    if (pattern.test(t)) return `https://images.unsplash.com/${id}?w=400&q=80`;
  }
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = (hash << 5) - hash + title.charCodeAt(i);
    hash |= 0;
  }
  const fallbackId = STUDIO_FALLBACKS[Math.abs(hash) % STUDIO_FALLBACKS.length];
  return `https://images.unsplash.com/${fallbackId}?w=400&q=80`;
}

function MoodTile({ mood }: { mood: MoodEntry }) {
  const setQuery = useUI((s) => s.setSearchQuery);
  const navigate = useUI((s) => s.navigate);
  const from = mood.color ?? "#3A0CA3";
  const to = shade(from, 0.45);
  const art = genreArtwork(mood.title);

  return (
    <button
      onClick={() => {
        setQuery(mood.title);
        navigate({ name: "search" });
      }}
      className="group relative aspect-[16/10] rounded-2xl overflow-hidden text-left transition-all duration-200 active:scale-[0.96] hover:scale-[1.02] shadow-md hover:shadow-xl"
      style={{
        background: `linear-gradient(135deg, ${from}, ${to})`,
        boxShadow: "inset 0 1px 1.2px 0 rgba(255, 255, 255, 0.30), 0 8px 24px -4px rgba(0, 0, 0, 0.40)",
      }}
    >
      <img
        src={art}
        alt=""
        loading="lazy"
        decoding="async"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
        className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-110"
      />
      {/* Dark gradient scrim so title is always high-contrast and legible */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0.2) 100%)",
        }}
      />
      {/* Liquid glass curvature light sheen */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(255, 255, 255, 0.18) 0%, transparent 70%)",
        }}
      />
      <span className="absolute left-3.5 bottom-3.5 right-3.5 font-display text-[16px] sm:text-[18px] font-extrabold tracking-[-0.02em] text-white leading-tight drop-shadow-md">
        {mood.title}
      </span>
    </button>
  );
}

export function ExploreView() {
  const [moods, setMoods] = useState<MoodEntry[]>(moodCache?.moods ?? FALLBACK_MOODS);
  const isMobile = useIsMobile();
  const navigate = useUI((s) => s.navigate);
  const mode = useSession((s) => s.mode);
  const username = useSession((s) => s.username);
  const letter = mode === "account" && username?.trim() ? username.trim().charAt(0).toUpperCase() : "G";

  useEffect(() => {
    if (moodCache && Date.now() - moodCache.at < MOODS_TTL_MS) return;
    let alive = true;
    void loadMoods().then((m) => {
      if (alive) setMoods(m);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="pt-2">
      <div className="flex items-center justify-between gap-3 pb-4">
        <h1 className="font-display text-[34px] font-extrabold tracking-[-0.03em] text-ink-hi flex items-center gap-3">
          <Compass className="w-7 h-7 text-ink-hi/90" />
          Explore
        </h1>
        {isMobile && (
          <button
            onClick={() => navigate({ name: "settings" })}
            className="w-10 h-10 rounded-full glass-btn grid place-items-center text-[15px] font-bold text-white shadow-lg shrink-0 active:scale-90 transition-transform"
            aria-label="Account and settings"
          >
            {letter}
          </button>
        )}
      </div>

      {/* Apple Music Liquid Glass Search Bar in Explore */}
      {isMobile && (
        <div className="mb-5 animate-slide-up">
          <button
            onClick={() => navigate({ name: "search" })}
            className="w-full flex items-center gap-3 px-4 h-11 rounded-2xl glass-card text-left text-ink-dim hover:text-ink-hi active:scale-[0.98] transition-all"
            aria-label="Search moods, genres, and songs"
          >
            <Search className="w-4 h-4 text-accent shrink-0" />
            <span className="text-[14px] font-medium text-ink-dim truncate">
              Search moods, genres, and songs…
            </span>
          </button>
        </div>
      )}

      <h2 className="section-title text-[21px] mb-4">Moods &amp; genres</h2>
      <p className="text-[13px] text-ink-dim -mt-3 mb-4">
        Picked for your region by YouTube Music
      </p>
      <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
        {moods.map((m) => (
          <MoodTile key={`${m.title}-${m.params ?? ""}`} mood={m} />
        ))}
      </div>
    </div>
  );
}
