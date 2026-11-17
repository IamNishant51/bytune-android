/** Builds right-click / "more" menu items for tracks and playlists. */
import {
  ArrowUpDown,
  Disc3,
  Download,
  FolderOpen,
  Heart,
  Info,
  Link2,
  ListMusic,
  ListPlus,
  ListStart,
  Pencil,
  Play,
  Radio,
  RotateCcw,
  Share2,
  Check,
  Trash2,
  User,
} from "lucide-react";
import { startDownload } from "./downloads";
import { useLibrary, type Playlist } from "../stores/library";
import { usePlayer } from "../stores/player";
import { useUI, type MenuItem } from "../stores/ui";
import { isAndroid } from "./platform";
import { PLAYLIST_SORTS, type PlaylistSort } from "./playlistSort";
import { playSource } from "./recs/playback";
import { fmtTime } from "./format";
import { getCurrentRendition } from "./audio";
import type { Track } from "../types";

export function trackMenuItems(track: Track): MenuItem[] {
  const lib = useLibrary.getState();
  const ui = useUI.getState();
  const liked = lib.isLiked(track.id);
  const dl = lib.downloads[track.id];
  const done = dl?.status === "done";

  const playlistChildren: MenuItem[] = lib.playlists.slice(0, 10).map((p) => ({
    label: p.name,
    action: () => {
      const added = useLibrary.getState().addToPlaylist(p.id, track);
      useUI.getState().toast(added ? `Added to "${p.name}"` : "Already in this playlist");
    },
  }));
  playlistChildren.push({
    label: "New playlist…",
    icon: ListMusic,
    action: () => {
      const suggested = `Playlist ${useLibrary.getState().playlists.length + 1}`;
      useUI.getState().openDialog({
        title: "New playlist",
        body: `Add "${track.title}" to a new playlist.`,
        initialValue: suggested,
        placeholder: "Playlist name",
        confirmLabel: "Create",
        onConfirm: (value) => {
          const lib = useLibrary.getState();
          const playlist = lib.createPlaylist(value.trim() || suggested);
          lib.addToPlaylist(playlist.id, track);
          useUI.getState().navigate({ name: "playlist", param: playlist.id });
        },
      });
    },
  });

  const items: MenuItem[] = [
    {
      label: "Play now",
      icon: Play,
      action: () => usePlayer.getState().playTrack(track),
    },
    {
      label: "Play next",
      icon: ListStart,
      action: () => {
        usePlayer.getState().addToQueue(track, true);
        useUI.getState().toast("Playing next");
      },
    },
    {
      label: "Add to queue",
      icon: ListPlus,
      action: () => {
        usePlayer.getState().addToQueue(track);
        useUI.getState().toast("Added to queue");
      },
    },
    {
      label: "Create station",
      icon: Radio,
      action: () => {
        useUI.getState().toast(`Starting ${track.artist} radio…`);
        if (track.artistId) {
          void playSource({
            type: "artist-radio",
            artistId: track.artistId,
            name: `${track.artist} Radio`,
          });
        } else {
          void playSource({
            type: "artist-mix",
            artistId: track.id,
            name: `${track.title} Radio`,
          });
        }
      },
    },
    {
      label: "Add to playlist",
      icon: ListMusic,
      children: playlistChildren,
    },
    {
      separatorBefore: true,
      label: liked ? "Remove from Liked" : "Add to Liked",
      icon: Heart,
      action: () => useLibrary.getState().toggleLike(track),
    },
  ];

  items.push({
    separatorBefore: true,
    label: done ? (isAndroid ? "Remove download" : "Show in folder") : "Download",
    icon: done ? (isAndroid ? Check : FolderOpen) : Download,
    action: () => {
      if (done) {
        if (isAndroid) {
          useLibrary.getState().removeDownload(track.id);
          void window.bytune?.cancelDownload(track.id);
          useUI.getState().toast("Removed from downloads");
        } else if (dl?.path) {
          requireReveal(dl.path);
        }
      } else {
        void startDownload(track);
      }
    },
  });

  if (done && !isAndroid) {
    items.push({
      label: "Remove download",
      icon: Trash2,
      danger: true,
      action: () => {
        useLibrary.getState().removeDownload(track.id);
        void window.bytune?.cancelDownload(track.id);
        useUI.getState().toast("Removed from downloads");
      },
    });
  }

  if (track.artistId) {
    items.push({
      separatorBefore: true,
      label: "Go to artist",
      icon: User,
      action: () => useUI.getState().navigate({ name: "artist", param: track.artistId }),
    });
  }

  if (track.albumId) {
    items.push({
      separatorBefore: !track.artistId,
      label: "Go to album",
      icon: Disc3,
      action: () => useUI.getState().navigate({ name: "album", param: track.albumId }),
    });
  }

  items.push({
    label: "Share song",
    icon: Share2,
    action: () => {
      const shareUrl = `https://music.youtube.com/watch?v=${track.id}`;
      if (typeof navigator !== "undefined" && navigator.share) {
        navigator
          .share({
            title: track.title,
            text: `${track.title} • ${track.artist}`,
            url: shareUrl,
          })
          .catch(() => {
            /* cancelled or unsupported share target */
          });
      } else {
        void navigator.clipboard
          .writeText(shareUrl)
          .then(() => useUI.getState().toast("Link copied to clipboard"))
          .catch(() => useUI.getState().toast("Couldn't copy link", "error"));
      }
    },
  });

  items.push({
    label: "View credits",
    icon: Info,
    action: () => {
      // Only the track actually playing has a known rendition — for any
      // other track the codec line is omitted rather than guessed.
      const rendition = track.id === usePlayer.getState().current()?.id ? getCurrentRendition() : null;
      const label = rendition
        ? [rendition.codec ?? "", rendition.bitrateKbps ? `${rendition.bitrateKbps} kbps` : ""].join(" ").trim()
        : "";
      useUI.getState().openDialog({
        title: "Song Credits",
        body: `• Track: ${track.title}\n• Artist: ${track.artist}\n• Album: ${track.album || "Single"}\n• Duration: ${fmtTime(track.duration)}${label ? `\n• Audio: ${label}` : ""}`,
        confirmLabel: "Done",
        onConfirm: () => {},
      });
    },
  });

  return items;
}

function requireReveal(path: string): void {
  if (window.bytune) window.bytune.revealPath(path);
}

export function playlistMenuItems(playlist: Playlist, track: Track): MenuItem[] {
  return [
    {
      label: "Remove from this playlist",
      icon: Trash2,
      danger: true,
      action: () => {
        useLibrary.getState().removeFromPlaylist(playlist.id, track.id);
        useUI.getState().toast("Removed from playlist");
      },
    },
    ...trackMenuItems(track),
  ];
}

export function playlistHeaderItems(playlist: Playlist): MenuItem[] {
  return [
    {
      label: "Rename",
      icon: Pencil,
      action: () => {
        useUI.getState().openDialog({
          title: "Rename playlist",
          initialValue: playlist.name,
          placeholder: "Playlist name",
          confirmLabel: "Rename",
          onConfirm: (value) => {
            if (value.trim()) useLibrary.getState().renamePlaylist(playlist.id, value);
          },
        });
      },
    },
    {
      label: "Delete playlist",
      icon: Trash2,
      danger: true,
      action: () => {
        useUI.getState().openDialog({
          title: `Delete "${playlist.name}"?`,
          body: "This can't be undone. The tracks themselves aren't affected.",
          confirmLabel: "Delete",
          danger: true,
          onConfirm: () => {
            useLibrary.getState().deletePlaylist(playlist.id);
            useUI.getState().navigate({ name: "playlists" });
            useUI.getState().toast("Playlist deleted", "info");
          },
        });
      },
    },
  ];
}

/**
 * The "Sort" submenu both playlist pages hang off their "⋯" menu — the same
 * place Spotify and Apple Music put it. Tapping the ticked key flips the
 * direction, exactly like Spotify.
 */
export function playlistSortItems(
  active: PlaylistSort,
  desc: boolean,
  onPick: (sort: PlaylistSort, desc: boolean) => void
): MenuItem[] {
  const item = (key: Exclude<PlaylistSort, "custom">, label: string): MenuItem => ({
    label: active === key ? `✓ ${label} ${desc ? "↓" : "↑"}` : label,
    action: () => onPick(key, active === key ? !desc : false),
  });
  return [
    {
      label: active === "custom" ? "✓ Custom order" : "Custom order",
      action: () => onPick("custom", false),
    },
    ...PLAYLIST_SORTS.map((s) => item(s.key, s.label)),
  ];
}

/** "Sort" menu entry, with its own icon, ready to drop into a header menu. */
export function playlistSortMenuItem(
  active: PlaylistSort,
  desc: boolean,
  onPick: (sort: PlaylistSort, desc: boolean) => void
): MenuItem {
  return {
    label: "Sort",
    icon: ArrowUpDown,
    children: playlistSortItems(active, desc, onPick),
  };
}

/** File a playlist into a library folder (or back out to the top level). */
export function playlistFolderItems(playlist: Playlist): MenuItem[] {
  const folders = useLibrary.getState().folders;
  const items: MenuItem[] = folders.map((f, i) => ({
    label: f.id === playlist.folderId ? `✓ ${f.name}` : `Move to “${f.name}”`,
    icon: FolderOpen,
    separatorBefore: i === 0,
    action: () => useLibrary.getState().setPlaylistFolder(playlist.id, f.id),
  }));
  if (playlist.folderId) {
    items.push({
      label: "Remove from folder",
      icon: FolderOpen,
      separatorBefore: true,
      action: () => useLibrary.getState().setPlaylistFolder(playlist.id, null),
    });
  }
  return items;
}

export function historyMenuItems(track: Track): MenuItem[] {
  return [
    {
      label: "Remove from history",
      icon: Trash2,
      danger: true,
      action: () => {
        const lib = useLibrary.getState();
        lib.clearHistory();
        // Re-add everything except this track.
        lib.history
          .filter((t) => t.id !== track.id)
          .slice()
          .reverse()
          .forEach((t) => lib.pushHistory(t));
      },
    },
    ...trackMenuItems(track),
  ];
}

export function downloadMenuItems(track: Track, path: string | null): MenuItem[] {
  const items: MenuItem[] = [];
  if (!isAndroid) {
    items.push({
      label: "Show in folder",
      icon: FolderOpen,
      action: () => {
        if (path) requireReveal(path);
      },
    });
  }
  items.push({
    label: "Retry download",
    icon: RotateCcw,
    action: () => void startDownload(track),
  });
  return items;
}
