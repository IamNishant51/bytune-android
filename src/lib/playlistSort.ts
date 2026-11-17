/**
 * Playlist ordering — the sorts both playlist pages show under their "⋯" menu.
 *
 * The stored track order IS the playlist's custom order; the sorts below are a
 * view over it, not a rewrite (Spotify's model). Sorting therefore never
 * destroys an arrangement the user made by hand, and "Custom order" always
 * returns to it. Shared by `PlaylistView` and `RemotePlaylistView`.
 */
import type { Track } from "../types";

export type PlaylistSort = "custom" | "title" | "artist" | "album" | "duration";

/** Sortable keys, in menu order. `custom` is offered separately (it is the reset). */
export const PLAYLIST_SORTS: ReadonlyArray<{ key: Exclude<PlaylistSort, "custom">; label: string }> = [
  { key: "title", label: "Title" },
  { key: "artist", label: "Artist" },
  { key: "album", label: "Album" },
  { key: "duration", label: "Duration" },
];

/**
 * Sort a playlist's tracks. `custom` returns the stored order untouched.
 * Ties break on title so an artist sort still reads album-by-album, and the
 * comparator is case-insensitive because track titles arrive in mixed case
 * from YouTube.
 */
export function sortTracks(tracks: Track[], sort: PlaylistSort, desc = false): Track[] {
  if (sort === "custom") return tracks;
  const key: (t: Track) => string | number =
    sort === "title"
      ? (t) => t.title
      : sort === "artist"
        ? (t) => t.artist
        : sort === "album"
          ? (t) => t.album ?? ""
          : (t) => t.duration;
  const dir = desc ? -1 : 1;
  return [...tracks].sort((a, b) => {
    const va = key(a);
    const vb = key(b);
    const primary =
      typeof va === "number" && typeof vb === "number"
        ? va - vb
        : String(va).localeCompare(String(vb), undefined, { sensitivity: "base" });
    return (
      (primary || a.title.localeCompare(b.title, undefined, { sensitivity: "base" })) * dir
    );
  });
}
