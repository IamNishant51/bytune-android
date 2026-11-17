/**
 * Your Library — the full-page counterpart of the sidebar pill, Spotify-style.
 * Chips: Playlists / Liked / Downloaded. Playlists group into the same folders
 * as the sidebar, with Liked Songs, Downloads and Local Music as pinned
 * shortcut cards (unpin from the card menu or the sidebar row).
 * Listening history is deliberately absent — it lives in the queue panel's
 * "Recently played" tab, not in the library.
 */
import { useEffect, useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Folder,
  FolderOpen,
  Heart,
  Library,
  ListMusic,
  Music2,
  Pin,
  PinOff,
  Play,
  Search,
  Shuffle,
  Trash2,
} from "lucide-react";
import { TrackList } from "../components/TrackList";
import { Btn, EmptyState, Pills, PlayOverlay } from "../components/primitives";
import { CreateMenu } from "../components/CreateMenu";
import { useLibrary, type LibraryFolder, type Playlist } from "../stores/library";
import { usePlayer } from "../stores/player";
import { useUI } from "../stores/ui";
import { dragHasAlbum, dragHasPlaylist, readAlbum, readPlaylist, useDrag } from "../lib/dnd";
import { requireBridge } from "../lib/bridge";
import { playlistFolderItems, playlistHeaderItems } from "../lib/trackActions";
import { plural } from "../lib/format";
import { isMobileApp } from "../lib/platform";
import { upgradeArtwork } from "../lib/artwork";
import { useIsMobile } from "../lib/useIsMobile";
import { useSession } from "../lib/session";
import { importPlaylistFromUrl } from "../lib/playlistImport";
import type { Track } from "../types";

type LibTab = "playlists" | "liked" | "downloaded";

/** Empty-cover fill for a playlist with no artwork yet. */
const COVER_FALLBACK = "from-panel to-surface";

function tabFromParam(param: string | undefined): LibTab {
  if (param === "liked") return "liked";
  if (param === "downloaded") return "downloaded";
  return "playlists";
}

function LibraryPlaylistCard({ playlist }: { playlist: Playlist }) {
  const navigate = useUI((s) => s.navigate);
  const openContextMenu = useUI((s) => s.openContextMenu);
  const openDialog = useUI((s) => s.openDialog);
  const deletePlaylist = useLibrary((s) => s.deletePlaylist);
  const togglePin = useLibrary((s) => s.togglePinPlaylist);
  const toast = useUI((s) => s.toast);
  // Local playlists drag into sidebar folders to file them there.
  const drag = useDrag({
    playlist: {
      id: playlist.id,
      title: playlist.name,
      thumb: playlist.tracks[0]?.thumb || undefined,
    },
  });

  return (
    <div
      {...drag.props}
      title="Drag onto a sidebar folder to file it there"
      className={`group relative w-full text-left ${drag.dragging ? "opacity-40" : ""}`}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openContextMenu(e.clientX, e.clientY, [
          ...playlistHeaderItems(playlist),
          ...playlistFolderItems(playlist),
        ]);
      }}
    >
      <div className="rounded-2xl glass-card p-3 duration-200 active:scale-[0.97] transition-all">
        <button
          onClick={(e) => {
            e.stopPropagation();
            togglePin(playlist.id);
          }}
          title={playlist.pinned ? "Unpin" : "Pin to top"}
          aria-label={playlist.pinned ? "Unpin playlist" : "Pin playlist"}
          className={`absolute top-2 right-2 z-10 p-1.5 rounded-full transition-all ${
            playlist.pinned
              ? "text-accent opacity-100 bg-white/10"
              : "text-ink-hi/60 opacity-0 group-hover:opacity-100 hover:text-ink-hi hover:bg-white/10"
          }`}
        >
          <Pin className={`w-3.5 h-3.5 ${playlist.pinned ? "fill-current" : ""}`} />
        </button>
        <div
          role="button"
          tabIndex={0}
          onClick={() => navigate({ name: "playlist", param: playlist.id })}
          onKeyDown={(e) => {
            if (e.key === "Enter") navigate({ name: "playlist", param: playlist.id });
          }}
          title={playlist.name}
          className={`relative w-full aspect-square rounded-xl bg-gradient-to-br ${COVER_FALLBACK} overflow-hidden cursor-pointer shadow-md group-hover:shadow-xl transition-all`}
        >
          {playlist.tracks.length > 0 ? (
            playlist.tracks.length === 1 ? (
              <img
                src={upgradeArtwork(playlist.tracks[0].thumb, 240)}
                alt=""
                loading="lazy"
                decoding="async"
                onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
                className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
            ) : (
              <div className="grid grid-cols-2 gap-0.5 w-full h-full bg-black/20 overflow-hidden">
                {playlist.tracks.slice(0, 4).map((t) => (
                  <img
                    key={t.id}
                    src={upgradeArtwork(t.thumb, 120)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")}
                    className="w-full h-full object-cover"
                  />
                ))}
              </div>
            )
          ) : (
            <div className="absolute inset-0 grid place-items-center">
              <Music2 className="w-8 h-8 text-ink-hi/25" />
            </div>
          )}
          <span className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" aria-hidden />
          <PlayOverlay
            title="Play playlist"
            onClick={() => {
              if (!playlist.tracks.length) {
                navigate({ name: "playlist", param: playlist.id });
                return;
              }
              usePlayer.getState().playQueue(playlist.tracks, 0);
            }}
          />
        </div>

        <div
          onClick={() => navigate({ name: "playlist", param: playlist.id })}
          className="mt-3 flex items-start justify-between gap-1 cursor-pointer"
        >
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-ink truncate leading-snug">{playlist.name}</div>
            <div className="text-[12px] text-ink-dim mt-0.5">{plural(playlist.tracks.length, "track", "tracks")}</div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              openDialog({
                title: `Delete "${playlist.name}"?`,
                body: "This can't be undone. The tracks themselves aren't affected.",
                confirmLabel: "Delete",
                danger: true,
                onConfirm: () => {
                  deletePlaylist(playlist.id);
                  toast("Playlist deleted", "info");
                },
              });
            }}
            title="Delete playlist"
            aria-label={`Delete ${playlist.name}`}
            className="p-1.5 rounded-md text-ink-ghost hover:text-red-400 hover:bg-ink-hi/10 opacity-70 sm:opacity-0 sm:group-hover:opacity-100 transition-all shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Collapsible folder group holding its playlists, like the sidebar's rows. */
function FolderSection({
  folder,
  playlists,
  expanded,
  onToggle,
}: {
  folder: LibraryFolder;
  playlists: Playlist[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const openContextMenu = useUI((s) => s.openContextMenu);
  const openDialog = useUI((s) => s.openDialog);
  const [dropHover, setDropHover] = useState(false);

  const onFolderDragOver = (e: React.DragEvent): void => {
    if (!dragHasPlaylist(e) && !dragHasAlbum(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    setDropHover(true);
  };
  const onFolderDragLeave = (e: React.DragEvent): void => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropHover(false);
  };
  const onFolderDrop = (e: React.DragEvent): void => {
    if (!dragHasPlaylist(e) && !dragHasAlbum(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setDropHover(false);
    const lib = useLibrary.getState();
    const ui = useUI.getState();
    // Local playlists are filed; YouTube collections are imported.
    if (dragHasPlaylist(e)) {
      const pl = readPlaylist(e);
      if (!pl) return;
      if (lib.playlists.some((p) => p.id === pl.id)) {
        lib.setPlaylistFolder(pl.id, folder.id);
        ui.toast(`Moved “${pl.title}” into “${folder.name}”`, "success");
        return;
      }
      ui.toast(`Importing “${pl.title}”…`);
      void requireBridge()
        .getPlaylist(pl.id)
        .then((page) => {
          const name = (page.title || pl.title).trim() || "Imported playlist";
          const seen = new Set<string>();
          const tracks = (page.tracks ?? []).filter((t: Track) =>
            seen.has(t.id) ? false : (seen.add(t.id), true)
          );
          if (!tracks.length) throw new Error("no tracks");
          const created = lib.createPlaylist(name);
          useLibrary.setState((s) => ({
            playlists: s.playlists.map((p) =>
              p.id === created.id ? { ...p, tracks, folderId: folder.id } : p
            ),
          }));
          ui.toast(`“${name}” · ${tracks.length} songs added to “${folder.name}”`, "success");
        })
        .catch(() => ui.toast(`Couldn't import “${pl.title}”`, "error"));
      return;
    }
    const al = readAlbum(e);
    if (!al) return;
    ui.toast(`Importing “${al.title}”…`);
    void requireBridge()
      .getAlbum(al.id)
      .then((page) => {
        const name = (page.album?.title || al.title).trim() || "Imported album";
        const seen = new Set<string>();
        const tracks = (page.tracks ?? []).filter((t: Track) =>
          seen.has(t.id) ? false : (seen.add(t.id), true)
        );
        if (!tracks.length) throw new Error("no tracks");
        const created = lib.createPlaylist(name);
        useLibrary.setState((s) => ({
          playlists: s.playlists.map((p) =>
            p.id === created.id ? { ...p, tracks, folderId: folder.id } : p
          ),
        }));
        ui.toast(`“${name}” · ${tracks.length} songs added to “${folder.name}”`, "success");
      })
      .catch(() => ui.toast(`Couldn't import “${al.title}”`, "error"));
  };

  return (
    <section>
      <button
        onDragOver={onFolderDragOver}
        onDragLeave={onFolderDragLeave}
        onDrop={onFolderDrop}
        onClick={onToggle}
        onContextMenu={(e) => {
          e.preventDefault();
          openContextMenu(e.clientX, e.clientY, [
            {
              label: "Rename folder",
              action: () =>
                openDialog({
                  title: "Rename folder",
                  initialValue: folder.name,
                  placeholder: "Folder name",
                  confirmLabel: "Save",
                  onConfirm: (value) => useLibrary.getState().renameFolder(folder.id, value),
                }),
            },
            {
              label: "Delete folder",
              danger: true,
              action: () => useLibrary.getState().deleteFolder(folder.id),
            },
          ]);
        }}
        title="Right-click to rename or delete — or drop a playlist here to file it"
        className={`group flex items-center gap-3 py-1 pr-3 rounded-lg text-left hover:bg-ink-hi/[0.04] transition-colors w-full ${
          dropHover ? "ring-2 ring-inset ring-accent/60 bg-ink-hi/[0.08]" : ""
        }`}
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-ink-hi/45 shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-ink-hi/45 shrink-0" />
        )}
        <span className="w-10 h-10 rounded-md bg-ink-hi/[0.06] grid place-items-center shrink-0">
          <Folder className="w-5 h-5 text-ink-hi/55" />
        </span>
        <span className="min-w-0">
          <span className="block text-[15px] font-semibold text-ink-hi truncate">{folder.name}</span>
          <span className="block text-[12.5px] text-ink-hi/55">
            {plural(playlists.length, "playlist", "playlists")}
          </span>
        </span>
      </button>
      {expanded && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5 sm:gap-5 mt-3">
          {playlists.length ? (
            playlists.map((p) => <LibraryPlaylistCard key={p.id} playlist={p} />)
          ) : (
            <p className="text-[13px] text-ink-hi/45 py-2 col-span-full">
              Empty folder — right-click a playlist in the sidebar and move it here.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/** Pinned shortcut tile (Liked / Downloads / Local) with a pin toggle. */
function ShortcutTile({
  title,
  subtitle,
  pinned,
  onTogglePin,
  onOpen,
  artClassName,
  art,
}: {
  title: string;
  subtitle: string;
  pinned: boolean;
  onTogglePin: () => void;
  onOpen: () => void;
  artClassName: string;
  art: ReactNode;
}) {
  const openContextMenu = useUI((s) => s.openContextMenu);
  return (
    <div
      className="group relative w-full text-left"
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openContextMenu(e.clientX, e.clientY, [
          {
            label: pinned ? "Unpin" : "Pin to top",
            icon: pinned ? PinOff : Pin,
            action: onTogglePin,
          },
        ]);
      }}
    >
      <div className="rounded-2xl glass-card p-3 duration-200 active:scale-[0.97] transition-all">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin();
          }}
          title={pinned ? "Unpin" : "Pin to top"}
          aria-label={pinned ? `Unpin ${title}` : `Pin ${title}`}
          className={`absolute top-2 right-2 z-10 p-1.5 rounded-full transition-all ${
            pinned
              ? "text-accent opacity-100 bg-white/10"
              : "text-ink-hi/60 opacity-0 group-hover:opacity-100 hover:text-ink-hi hover:bg-white/10"
          }`}
        >
          <Pin className={`w-3.5 h-3.5 ${pinned ? "fill-current" : ""}`} />
        </button>
        <button onClick={onOpen} className="block w-full text-left">
          <div
            className={`relative w-full aspect-square rounded-xl bg-gradient-to-br grid place-items-center overflow-hidden shadow-md ${artClassName}`}
          >
            {art}
          </div>
          <div className="mt-3">
            <div className="text-[14px] font-semibold text-ink truncate leading-snug">{title}</div>
            <div className="text-[12px] text-ink-dim mt-0.5">{subtitle}</div>
          </div>
        </button>
      </div>
    </div>
  );
}

export function LibraryView() {
  const isMobile = useIsMobile();
  const view = useUI((s) => s.view);
  const navigate = useUI((s) => s.navigate);
  const liked = useLibrary((s) => s.liked);
  const playlists = useLibrary((s) => s.playlists);
  const folders = useLibrary((s) => s.folders);
  const downloads = useLibrary((s) => s.downloads);
  const pinnedSingles = useLibrary((s) => s.pinnedSingles);
  const togglePinSingle = useLibrary((s) => s.togglePinSingle);
  const playQueue = usePlayer((s) => s.playQueue);
  const mode = useSession((s) => s.mode);
  const username = useSession((s) => s.username);
  const letter = mode === "account" && username?.trim() ? username.trim().charAt(0).toUpperCase() : "G";

  const [tab, setTab] = useState<LibTab>(() => tabFromParam(useUI.getState().view.param));
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  // Dropping songs on the open Liked page is handled panel-wide in App.

  // The sidebar deep-links here (Liked Songs → ?liked); keep the chip in sync
  // when the view changes while this component stays mounted.
  useEffect(() => {
    setTab(tabFromParam(view.param));
  }, [view.name, view.param]);

  const downloadedTracks: Track[] = Object.values(downloads)
    .filter((d) => d.status === "done")
    .map((d) => d.track);

  const unfiled = playlists.filter((p) => !p.folderId);
  const pinnedFirst = [...unfiled.filter((p) => p.pinned), ...unfiled.filter((p) => !p.pinned)];

  const shufflePlay = (tracks: Track[]): void => {
    if (!tracks.length) return;
    usePlayer.setState({ shuffle: true });
    playQueue(tracks, Math.floor(Math.random() * tracks.length));
  };

  return (
    <div className="pb-12">
      {/* Header — counts + the shared create dropdown (Playlist / Folder) */}
      <div className={isMobile ? "px-0 pt-2" : "px-8 pt-8"}>
        <div className="flex items-end justify-between gap-4 animate-slide-up">
          <div>
            <div className="micro-label text-ink-faint mb-1.5">Collection</div>
            <h1 className="font-display text-[28px] font-bold tracking-tight text-ink-hi">Your Library</h1>
            <p className="text-sm text-ink-dim mt-1">
              {plural(playlists.length, "playlist", "playlists")} ·{" "}
              {!isMobileApp && <>{plural(folders.length, "folder", "folders")} ·{" "}</>}
              {plural(liked.length, "liked song", "liked songs")}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isMobile && (
              <>
                <button
                  onClick={() => {
                    useUI.getState().openDialog({
                      title: "Import playlist",
                      body: "Paste a Spotify or YouTube Music playlist link.",
                      initialValue: "",
                      placeholder: "https://open.spotify.com/playlist/... or https://music.youtube.com/playlist?list=...",
                      confirmLabel: "Import",
                      onConfirm: async (url) => {
                        const trimmed = url.trim();
                        if (!trimmed) return;
                        useUI.getState().toast("Importing playlist…", "info");
                        try {
                          const res = await importPlaylistFromUrl(trimmed);
                          useUI.getState().toast(`Imported “${res.title}” (${res.trackCount} tracks)`, "success");
                          navigate({ name: "playlist", param: res.playlistId });
                        } catch (err) {
                          useUI.getState().toast(err instanceof Error ? err.message : "Import failed", "error");
                        }
                      },
                    });
                  }}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-white/[0.08] text-[12.5px] font-semibold text-ink-hi hover:bg-white/[0.14] active:scale-95 transition-all whitespace-nowrap shadow-sm"
                >
                  <Download className="w-3.5 h-3.5 text-accent" />
                  <span>Import</span>
                </button>
                <button
                  onClick={() => navigate({ name: "settings" })}
                  className="w-9 h-9 rounded-full glass-btn grid place-items-center text-[14px] font-bold text-white shadow-md active:scale-90 transition-transform shrink-0"
                  aria-label="Account and settings"
                >
                  {letter}
                </button>
              </>
            )}
            <CreateMenu onFolderCreated={(f) => setExpandedFolders((prev) => new Set(prev).add(f.id))} />
          </div>
        </div>

        {/* Apple Music Liquid Glass Search Bar in Library */}
        {isMobile && (
          <div className="mt-4 mb-2 animate-slide-up">
            <button
              onClick={() => navigate({ name: "search" })}
              className="w-full flex items-center gap-3 px-4 h-11 rounded-2xl glass-card text-left text-ink-dim hover:text-ink-hi active:scale-[0.98] transition-all"
              aria-label="Search your library and music catalog"
            >
              <Search className="w-4 h-4 text-accent shrink-0" />
              <span className="text-[14px] font-medium text-ink-dim truncate">
                Find in Library, playlists, and songs…
              </span>
            </button>
          </div>
        )}

        <div className={`mt-4 flex items-center gap-2.5 ${isMobile ? "-mx-4 px-4 overflow-x-auto no-scrollbar pb-1" : "justify-between"}`}>
          <div className="shrink-0">
            <Pills
              options={[
                { key: "playlists" as const, label: "Playlists", count: playlists.length },
                { key: "liked" as const, label: "Liked", count: liked.length },
                { key: "downloaded" as const, label: "Downloaded", count: downloadedTracks.length },
              ]}
              value={tab}
              onChange={setTab}
            />
          </div>
        </div>
      </div>

      {tab === "playlists" && (
        <div className={isMobile ? "px-0 mt-5 space-y-6" : "px-8 mt-6 space-y-7"}>
          {/* Apple Music Navigation Category Rows on Mobile */}
          {isMobile && (
            <div className="rounded-2xl overflow-hidden glass-card divide-y divide-white/[0.06] mb-5">
              <button
                onClick={() => setTab("liked")}
                className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-white/[0.04] active:bg-white/[0.08] transition-colors"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-pink-500/20 text-pink-400 grid place-items-center shrink-0">
                    <Heart className="w-4 h-4 fill-current" />
                  </div>
                  <div className="text-left min-w-0">
                    <div className="text-[15px] font-semibold text-ink-hi">Liked Songs</div>
                    <div className="text-[12px] text-ink-dim">{plural(liked.length, "track", "tracks")}</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-ink-dim/60 shrink-0" />
              </button>
              <button
                onClick={() => setTab("downloaded")}
                className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-white/[0.04] active:bg-white/[0.08] transition-colors"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 grid place-items-center shrink-0">
                    <Download className="w-4 h-4" />
                  </div>
                  <div className="text-left min-w-0">
                    <div className="text-[15px] font-semibold text-ink-hi">Downloaded</div>
                    <div className="text-[12px] text-ink-dim">{plural(downloadedTracks.length, "track", "tracks")}</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-ink-dim/60 shrink-0" />
              </button>
              {!isMobileApp && (
                <button
                  onClick={() => navigate({ name: "local" })}
                  className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-white/[0.04] active:bg-white/[0.08] transition-colors"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-400 grid place-items-center shrink-0">
                      <FolderOpen className="w-4 h-4" />
                    </div>
                    <div className="text-left min-w-0">
                      <div className="text-[15px] font-semibold text-ink-hi">Local Music</div>
                      <div className="text-[12px] text-ink-dim">On this device</div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-ink-dim/60 shrink-0" />
                </button>
              )}
            </div>
          )}

          {/* Shortcut tiles (desktop or tablet) */}
          {!isMobile && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5 sm:gap-5">
              {(
                [
                  { key: "liked" as const, pinned: pinnedSingles?.liked ?? true },
                  { key: "downloads" as const, pinned: pinnedSingles?.downloads ?? true },
                  { key: "local" as const, pinned: pinnedSingles?.local ?? true },
                ]
                  .filter((t) => !isMobileApp || t.key === "liked" || t.key === "downloads")
                  .sort((a, b) => Number(b.pinned) - Number(a.pinned))
                  .map(({ key, pinned }) => {
                    if (key === "liked") {
                      return (
                        <ShortcutTile
                          key="liked"
                          title="Liked Songs"
                          subtitle={plural(liked.length, "track", "tracks")}
                          pinned={pinned}
                          onTogglePin={() => togglePinSingle("liked")}
                          onOpen={() => setTab("liked")}
                          artClassName="from-accent/30 to-accent/[0.06]"
                          art={
                            <Heart
                              className={`w-9 h-9 ${liked.length ? "fill-accent text-accent" : "text-accent"}`}
                            />
                          }
                        />
                      );
                    }
                    if (key === "downloads") {
                      return (
                        <ShortcutTile
                          key="downloads"
                          title="Downloads"
                          subtitle={plural(downloadedTracks.length, "track", "tracks")}
                          pinned={pinned}
                          onTogglePin={() => togglePinSingle("downloads")}
                          onOpen={() => navigate({ name: "downloads" })}
                          artClassName="from-emerald-400/25 to-emerald-400/[0.05]"
                          art={
                            <Download
                              className={`w-9 h-9 ${downloadedTracks.length ? "text-emerald-300" : "text-ink-hi/55"}`}
                            />
                          }
                        />
                      );
                    }
                    return (
                      <ShortcutTile
                        key="local"
                        title="Local Music"
                        subtitle="On this device"
                        pinned={pinned}
                        onTogglePin={() => togglePinSingle("local")}
                        onOpen={() => navigate({ name: "local" })}
                        artClassName="from-white/[0.07] to-white/[0.02]"
                        art={<FolderOpen className="w-9 h-9 text-ink-hi/55" />}
                      />
                    );
                  })
              )}
            </div>
          )}

          {folders.length === 0 && unfiled.length === 0 ? (
            <EmptyState
              icon={ListMusic}
              title="No playlists yet"
              body='Use the + button above to create a playlist or a folder — or right-click any track and choose "New playlist…" to start one from a song you like.'
            />
          ) : (
            <>
              {folders.map((f) => (
                <FolderSection
                  key={f.id}
                  folder={f}
                  playlists={playlists.filter((p) => p.folderId === f.id)}
                  expanded={expandedFolders.has(f.id)}
                  onToggle={() =>
                    setExpandedFolders((prev) => {
                      const next = new Set(prev);
                      if (next.has(f.id)) next.delete(f.id);
                      else next.add(f.id);
                      return next;
                    })
                  }
                />
              ))}
              {unfiled.length > 0 && (
                <section>
                  <h2 className="text-[17px] sm:text-[19px] font-bold text-ink-hi mb-3.5 tracking-tight flex items-center justify-between">
                    <span>Recently Added</span>
                    <span className="text-[12px] font-normal text-ink-dim">{plural(unfiled.length, "playlist", "playlists")}</span>
                  </h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5 sm:gap-5">
                    {pinnedFirst.map((p) => (
                      <LibraryPlaylistCard key={p.id} playlist={p} />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      )}

      {tab === "liked" && (
        <div className={isMobile ? "px-0 mt-5" : "px-8 mt-6"}>
          {liked.length ? (
            <>
              <div className="flex items-center gap-2">
                <Btn variant="white" size="md" icon={Play} onClick={() => playQueue(liked, 0)}>
                  Play all
                </Btn>
                <Btn variant="glass" size="md" icon={Shuffle} onClick={() => shufflePlay(liked)}>
                  Shuffle
                </Btn>
              </div>
              <div className="mt-5">
                <TrackList tracks={liked} showAlbum emptyTitle="No liked songs yet" />
              </div>
            </>
          ) : (
            <EmptyState
              icon={Heart}
              title="Songs you like will show up here"
              body="Click the heart on any track — in the player, a playlist, or search — and it lands in this list."
              action={
                <Btn variant="white" onClick={() => navigate({ name: "search" })}>
                  Find something to like
                </Btn>
              }
            />
          )}
        </div>
      )}

      {tab === "downloaded" && (
        <div className={isMobile ? "px-0 mt-5" : "px-8 mt-6"}>
          {downloadedTracks.length ? (
            <>
              <div className="flex items-center gap-2">
                <Btn variant="white" size="md" icon={Play} onClick={() => playQueue(downloadedTracks, 0)}>
                  Play all
                </Btn>
                <Btn variant="glass" size="md" icon={Shuffle} onClick={() => shufflePlay(downloadedTracks)}>
                  Shuffle
                </Btn>
              </div>
              <div className="mt-5">
                <TrackList tracks={downloadedTracks} showAlbum emptyTitle="Nothing downloaded yet" />
              </div>
            </>
          ) : (
            <EmptyState
              icon={Download}
              title="No downloads yet"
              body="Right-click any track and choose Download — it lands here for offline playback."
              action={
                <Btn variant="white" onClick={() => navigate({ name: "search" })}>
                  Find something to download
                </Btn>
              }
            />
          )}
        </div>
      )}
    </div>
  );
}
