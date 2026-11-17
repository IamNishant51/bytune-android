/**
 * Home — a personalized feed, not a fixed page.
 *
 * This view holds no recommendation logic of its own: sections come from
 * lib/recs (profile → candidates → section builder → feed hook), and each
 * section self-describes its title, subtitle, layout and items. The view's
 * whole job is to render whatever the engine chose — new section types and
 * reorderings appear without touching this file.
 *
 * Visual language follows the reference layouts: quick-resume tiles, square
 * album/track cards, circular artist cards, mix cards with name bands, and
 * pastel radio tiles with contextual "reason" subtitles.
 */
import { Play } from "lucide-react";
import { AlbumCard, ArtistCard, HomeShelfView, TrackCard } from "../components/Cards";
import { EyebrowHeader, MixCard, RadioCard } from "../components/recCards";
import { Artwork, Shelf, ShelfScroller, ShelfSkeleton } from "../components/primitives";
import { useHomeFeed } from "../lib/recs/feed";
import { useDrag } from "../lib/dnd";
import type { HomeSection } from "../lib/recs/sections";
import { usePlayer } from "../stores/player";
import { useLibrary } from "../stores/library";
import { tintHoverHandlers, useUI } from "../stores/ui";
import { trackMenuItems } from "../lib/trackActions";
import { useIsMobile } from "../lib/useIsMobile";
import { useSession } from "../lib/session";
import { upgradeArtwork } from "../lib/artwork";
import type { Track } from "../types";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Up late?";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 22) return "Good evening";
  return "Good night";
}

/** Quick-resume tiles — the compact 2×3 grid straight from history. Hovering
    a tile borrows its artwork colour for the panel wash (TintWash in App),
    and every tile is a drag source for the library. */
function QuickTile({ track }: { track: Track }) {
  const playQueue = usePlayer((s) => s.playQueue);
  const drag = useDrag({ track });
  const open = (): void => playQueue([track], 0);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        useUI.getState().openContextMenu(e.clientX, e.clientY, trackMenuItems(track));
      }}
      {...tintHoverHandlers(track.thumb)}
      {...drag.props}
      className={`group flex items-center gap-3 h-16 pr-3 rounded-lg bg-ink-hi/[0.03] text-left hover:bg-ink-hi/[0.08] transition-all overflow-hidden cursor-pointer select-none ${
        drag.dragging ? "opacity-40" : ""
      }`}
    >
      <Artwork src={track.thumb} className="h-16 w-16 rounded-none shrink-0" iconClassName="w-5 h-5" alt="" />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-ink truncate group-hover:text-ink-hi transition-colors">
          {track.title}
        </div>
        <div className="text-xs text-ink-faint truncate mt-0.5">{track.artist}</div>
      </div>
      <span className="w-9 h-9 rounded-full bg-primary text-on-primary grid place-items-center shadow-elev opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <Play className="w-4 h-4 fill-current ml-0.5" />
      </span>
    </div>
  );
}

/** Cold-start browse chips — the honest fallback while taste is unknown. */
function MoodChips({ moods }: { moods: string[] }) {
  const setQuery = useUI((s) => s.setSearchQuery);
  const navigate = useUI((s) => s.navigate);
  return (
    <div className="flex flex-wrap gap-2">
      {moods.map((mood) => (
        <button
          key={mood}
          onClick={() => {
            setQuery(mood);
            navigate({ name: "search" });
          }}
          className="px-4 py-2 rounded-full bg-ink-hi/[0.05] text-[13px] font-medium text-ink hover:bg-ink-hi/[0.09] hover:text-ink-hi transition-colors duration-150"
        >
          {mood}
        </button>
      ))}
    </div>
  );
}

/**
 * Renders one section however it asks to be rendered. Adding a new section
 * type = a new entry in the builder + (only if genuinely new) a new case here.
 */
function SectionView({ section }: { section: HomeSection }) {
  const navigate = useUI((s) => s.navigate);

  const eyebrow = section.eyebrow;
  const openArtist = eyebrow ? () => navigate({ name: "artist", param: eyebrow.artistId }) : undefined;

  if (section.layout === "yt-shelf" && section.shelf) {
    return <HomeShelfView shelf={section.shelf} />;
  }

  const body = (() => {
    if (section.layout === "tiles") {
      const tileTracks = section.items.flatMap((it) => (it.style === "track" ? [it.track] : []));
      return (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5">
          {tileTracks.map((t) => (
            <QuickTile key={t.id} track={t} />
          ))}
        </div>
      );
    }
    if (section.layout === "moods") {
      return <MoodChips moods={section.moods ?? []} />;
    }
    return (
      <ShelfScroller>
        {section.items.map((item, i) => {
          const key = `${section.id}-${item.style}-${i}`;
          switch (item.style) {
            case "track":
              return <TrackCard key={key} track={item.track} />;
            case "album":
              return <AlbumCard key={key} album={item.album} />;
            case "artist":
              return <ArtistCard key={key} artist={item.artist} />;
            case "mix":
              return <MixCard key={key} item={item} />;
            case "radio":
              return <RadioCard key={key} item={item} />;
            default:
              return null;
          }
        })}
      </ShelfScroller>
    );
  })();

  return (
    <section className="animate-slide-up">
      {eyebrow ? (
        <>
          <EyebrowHeader eyebrow={eyebrow} onOpen={openArtist as () => void} />
          {body}
        </>
      ) : (
        <Shelf title={section.title} subtitle={section.subtitle}>
          {body}
        </Shelf>
      )}
    </section>
  );
}

const MOOD_PILLS = [
  { label: "Chill", query: "Chill" },
  { label: "Workout", query: "Workout" },
  { label: "Focus", query: "Focus" },
  { label: "Party", query: "Party" },
  { label: "Sleep", query: "Sleep" },
  { label: "Energize", query: "Energy Boost" },
  { label: "Romance", query: "Romantic" },
];

function QuickMoodRow() {
  const setQuery = useUI((s) => s.setSearchQuery);
  const navigate = useUI((s) => s.navigate);

  return (
    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0 py-0.5">
      {MOOD_PILLS.map((m) => (
        <button
          key={m.label}
          onClick={() => {
            setQuery(m.query);
            navigate({ name: "search" });
          }}
          className="shrink-0 h-8 px-4 rounded-full bg-white/[0.07] hover:bg-white/[0.14] text-[13px] font-semibold text-ink-hi transition-all active:scale-95 shadow-sm whitespace-nowrap"
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

function AppleHeroCarousel({ sections }: { sections: HomeSection[] }) {
  const playQueue = usePlayer((s) => s.playQueue);
  const navigate = useUI((s) => s.navigate);

  const candidates: Array<{
    id: string;
    badge: string;
    title: string;
    subtitle: string;
    thumb: string;
    onPlay: () => void;
    onOpen: () => void;
  }> = [];

  for (const s of sections) {
    if (s.items?.length) {
      for (const item of s.items) {
        if (candidates.length >= 6) break;
        if (item.style === "track" && item.track?.thumb) {
          const t = item.track;
          candidates.push({
            id: `hero-${t.id}`,
            badge: "TOP PICK",
            title: t.title,
            subtitle: t.artist,
            thumb: t.thumb,
            onPlay: () => playQueue([t], 0),
            onOpen: () => playQueue([t], 0),
          });
        } else if (item.style === "album" && item.album?.thumb) {
          const a = item.album;
          candidates.push({
            id: `hero-${a.id}`,
            badge: "FEATURED ALBUM",
            title: a.title,
            subtitle: a.artist,
            thumb: a.thumb,
            onPlay: () => navigate({ name: "album", param: a.id }),
            onOpen: () => navigate({ name: "album", param: a.id }),
          });
        }
      }
    }
    if (s.shelf?.items) {
      for (const item of s.shelf.items) {
        if (candidates.length >= 6) break;
        if (item.kind === "track" && item.track?.thumb) {
          const t = item.track;
          candidates.push({
            id: `hero-${t.id}`,
            badge: "TOP PICK",
            title: t.title,
            subtitle: t.artist,
            thumb: t.thumb,
            onPlay: () => playQueue([t], 0),
            onOpen: () => playQueue([t], 0),
          });
        } else if (item.kind === "album" && item.album?.thumb) {
          const a = item.album;
          candidates.push({
            id: `hero-${a.id}`,
            badge: "FEATURED ALBUM",
            title: a.title,
            subtitle: a.artist,
            thumb: a.thumb,
            onPlay: () => navigate({ name: "album", param: a.id }),
            onOpen: () => navigate({ name: "album", param: a.id }),
          });
        } else if (item.kind === "playlist" && item.playlist?.thumb) {
          const p = item.playlist;
          candidates.push({
            id: `hero-${p.id}`,
            badge: "FEATURED PLAYLIST",
            title: p.title,
            subtitle: p.subtitle || "Curated playlist",
            thumb: p.thumb,
            onPlay: () => navigate({ name: "ytplaylist", param: p.id }),
            onOpen: () => navigate({ name: "ytplaylist", param: p.id }),
          });
        }
      }
    }
    if (candidates.length >= 6) break;
  }

  if (candidates.length === 0) return null;

  return (
    <div className="relative pt-1 animate-slide-up">
      <div className="flex gap-4 overflow-x-auto no-scrollbar snap-x snap-mandatory -mx-4 px-4 sm:mx-0 sm:px-0 pb-1">
        {candidates.map((c) => (
          <div
            key={c.id}
            onClick={c.onOpen}
            className="group relative shrink-0 w-[84vw] sm:w-[380px] aspect-[16/9] rounded-2xl overflow-hidden snap-start cursor-pointer select-none active:scale-[0.98] transition-transform duration-200 shadow-xl"
          >
            <img
              src={upgradeArtwork(c.thumb, 800)}
              alt=""
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
            <div
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.40) 45%, rgba(0,0,0,0.1) 80%, transparent 100%)",
              }}
            />
            <div className="absolute top-3.5 left-4">
              <span className="px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase bg-white/20 text-white backdrop-blur-md shadow-sm">
                {c.badge}
              </span>
            </div>
            <div className="absolute bottom-3.5 inset-x-4 flex items-end justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="font-display text-[18px] sm:text-[20px] font-extrabold text-white leading-tight tracking-tight truncate drop-shadow-md">
                  {c.title}
                </h3>
                <p className="text-[13px] font-medium text-white/80 truncate mt-0.5 drop-shadow">
                  {c.subtitle}
                </p>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  c.onPlay();
                }}
                className="w-11 h-11 rounded-full glass-btn grid place-items-center text-white shrink-0 shadow-lg active:scale-90 transition-transform hover:brightness-125"
                title="Play"
                aria-label={`Play ${c.title}`}
              >
                <Play className="w-5 h-5 fill-current ml-0.5 text-white" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function JumpBackInShelf() {
  const history = useLibrary((s) => s.history);
  const playQueue = usePlayer((s) => s.playQueue);
  const currentId = usePlayer((s) => s.queue[s.index]?.id ?? null);
  const playing = usePlayer((s) => s.playing);
  const isMobile = useIsMobile();

  if (!history || !history.length) return null;

  const items = history.slice(0, 8);

  return (
    <section className="animate-slide-up space-y-3 pt-1">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-[22px] font-bold tracking-tight text-white">
          Jump Back In
        </h2>
        <span className="text-[12px] font-medium text-white/50">Recent plays</span>
      </div>

      <div className="flex gap-3.5 overflow-x-auto no-scrollbar pb-2 -mx-4 px-4 sm:mx-0 sm:px-0">
        {items.map((track) => {
          const isCurrent = track.id === currentId;
          return (
            <div
              key={track.id}
              onClick={() => playQueue(history, history.findIndex((t) => t.id === track.id))}
              className="group shrink-0 w-[138px] sm:w-[152px] cursor-pointer select-none"
            >
              <div className="relative aspect-square rounded-2xl overflow-hidden bg-white/[0.04] mb-2 shadow-md group-hover:shadow-xl transition-all">
                <img
                  src={upgradeArtwork(track.thumb, 300)}
                  alt={track.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                {/* 1-tap circular play button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isCurrent) {
                      usePlayer.getState().toggle();
                    } else {
                      playQueue([track], 0);
                    }
                  }}
                  className={`absolute right-2.5 bottom-2.5 w-10 h-10 rounded-full bg-white text-black shadow-lg flex items-center justify-center transition-all active:scale-90 ${
                    isMobile || isCurrent ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  }`}
                  aria-label={isCurrent && playing ? "Pause" : `Play ${track.title}`}
                >
                  {isCurrent && playing ? (
                    <span className="w-3.5 h-3.5 flex items-center justify-between px-0.5">
                      <span className="w-1 h-3.5 bg-black rounded-sm" />
                      <span className="w-1 h-3.5 bg-black rounded-sm" />
                    </span>
                  ) : (
                    <Play className="w-4 h-4 fill-current ml-0.5 text-black" />
                  )}
                </button>
              </div>

              <div className="text-[13.5px] font-semibold text-white truncate" title={track.title}>
                {track.title}
              </div>
              <div className="text-[12px] text-white/50 truncate" title={track.artist}>
                {track.artist}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function HomeView() {
  const { sections, profile } = useHomeFeed();
  const isMobile = useIsMobile();
  const mode = useSession((s) => s.mode);
  const username = useSession((s) => s.username);
  const letter = mode === "account" && username?.trim() ? username.trim().charAt(0).toUpperCase() : "G";

  return (
    <div className="relative">
      <div className="relative space-y-9">
        <div className="animate-slide-up pt-2 flex items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-[34px] font-extrabold tracking-[-0.03em] text-ink-hi leading-tight">
              {greeting()}
            </h1>
            <p className="text-[14px] text-ink-dim mt-1">What do you feel like listening to?</p>
          </div>
          {isMobile && (
            <button
              onClick={() => useUI.getState().navigate({ name: "settings" })}
              className="w-10 h-10 rounded-full glass-btn grid place-items-center text-[15px] font-bold text-white shadow-lg shrink-0 active:scale-90 transition-transform"
              aria-label="Settings"
            >
              {letter}
            </button>
          )}
        </div>

        <QuickMoodRow />

        <JumpBackInShelf />

        <AppleHeroCarousel sections={sections} />

        {sections.map((section) => (
          <SectionView key={section.id} section={section} />
        ))}

        {/* Stats still loading on a cold app launch — hold the layout. */}
        {!profile && (
          <div className="space-y-10">
            <ShelfSkeleton />
            <ShelfSkeleton />
          </div>
        )}
      </div>
    </div>
  );
}
