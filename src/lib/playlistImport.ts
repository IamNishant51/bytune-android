/**
 * Spotify and YouTube Music playlist importer.
 *
 * Allows users to share / paste playlist links from Spotify or YouTube Music
 * directly into ByTune, turning them into playable local playlists.
 */
import { useLibrary } from "../stores/library";
import type { SearchRow, Track } from "../types";

export interface DetectedPlaylist {
  type: "spotify" | "youtube" | null;
  id: string | null;
}

export function detectPlaylist(input: string): DetectedPlaylist {
  if (!input) return { type: null, id: null };
  const text = input.trim();

  // Spotify URLs / URIs
  // https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=...
  // spotify:playlist:37i9dQZF1DXcBWIGoYBM5M
  const spotifyMatch = text.match(/open\.spotify\.com\/playlist\/([a-zA-Z0-9]+)/) || text.match(/spotify:playlist:([a-zA-Z0-9]+)/);
  if (spotifyMatch) {
    return { type: "spotify", id: spotifyMatch[1] };
  }

  // YouTube / YouTube Music playlist URLs
  // https://music.youtube.com/playlist?list=PL4fGSIvMGkUVD_3gG4o_F4n1_V2q-7xZf
  // https://www.youtube.com/playlist?list=PL...
  const ytMatch = text.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  if (ytMatch) {
    return { type: "youtube", id: ytMatch[1] };
  }

  // Raw YouTube playlist IDs (e.g. PL..., VLPL..., OLAK5uy..., etc.)
  if (/^(VL)?(PL|OLAK5uy|RD|LM)[a-zA-Z0-9_-]+$/i.test(text)) {
    return { type: "youtube", id: text };
  }

  return { type: null, id: null };
}

async function fetchHtml(url: string): Promise<string> {
  const cap = (globalThis as any).Capacitor;
  if (cap?.isNativePlatform?.()) {
    const { CapacitorHttp } = await import("@capacitor/core");
    const res = await CapacitorHttp.request({
      url,
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    return typeof res.data === "string" ? res.data : JSON.stringify(res.data);
  }
  const res = await fetch(url);
  return res.text();
}

interface SpotifyScraped {
  title: string;
  tracks: { title: string; artist: string; duration: number }[];
}

export async function scrapeSpotifyPlaylist(playlistId: string): Promise<SpotifyScraped> {
  const embedUrl = `https://open.spotify.com/embed/playlist/${playlistId}`;
  const html = await fetchHtml(embedUrl);

  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error("Could not parse Spotify playlist embed data.");
  }

  const json = JSON.parse(match[1]);
  const entity = json?.props?.pageProps?.state?.data?.entity;
  if (!entity) {
    throw new Error("Spotify playlist data not found or private.");
  }

  const title = entity.name || "Imported Spotify Playlist";
  const rawList = Array.isArray(entity.trackList) ? entity.trackList : [];

  const tracks = rawList.map((t: any) => ({
    title: t.title || "Unknown Title",
    artist: t.subtitle || "Unknown Artist",
    duration: Math.round((Number(t.duration) || 0) / 1000),
  }));

  return { title, tracks };
}

export interface ImportProgress {
  message: string;
  current: number;
  total: number;
}

export async function importPlaylistFromUrl(
  input: string,
  onProgress?: (progress: ImportProgress) => void
): Promise<{ playlistId: string; title: string; trackCount: number }> {
  const detected = detectPlaylist(input);
  if (!detected.type || !detected.id) {
    throw new Error("Please enter a valid Spotify or YouTube Music playlist link.");
  }

  const lib = useLibrary.getState();

  if (detected.type === "youtube") {
    onProgress?.({ message: "Loading YouTube Music playlist…", current: 1, total: 1 });
    const playlistBrowseId = detected.id.startsWith("VL") ? detected.id : `VL${detected.id}`;
    const page = await window.bytune?.getPlaylistPage(playlistBrowseId);
    if (!page || !page.tracks?.length) {
      throw new Error("Could not fetch YouTube Music playlist tracks or playlist is empty.");
    }

    const playlist = lib.createPlaylist(page.title || "YouTube Playlist");
    for (const track of page.tracks) {
      lib.addToPlaylist(playlist.id, track);
    }
    return { playlistId: playlist.id, title: playlist.name, trackCount: page.tracks.length };
  }

  if (detected.type === "spotify") {
    onProgress?.({ message: "Reading Spotify playlist…", current: 0, total: 100 });
    const scraped = await scrapeSpotifyPlaylist(detected.id);
    if (!scraped.tracks.length) {
      throw new Error("Spotify playlist appears to be empty.");
    }

    const playlist = lib.createPlaylist(scraped.title);
    const total = scraped.tracks.length;

    // Resolve Spotify tracks against YouTube Music search
    for (let i = 0; i < total; i++) {
      const item = scraped.tracks[i];
      onProgress?.({
        message: `Matching "${item.title}" (${i + 1}/${total})…`,
        current: i + 1,
        total,
      });

      try {
        const query = `${item.title} ${item.artist}`.trim();
        const searchRes = await window.bytune?.searchPage(query, "songs");
        const foundRow = searchRes?.rows?.find((r: SearchRow) => r.kind === "track" || r.kind === "top");
        if (foundRow && foundRow.kind !== "browse") {
          lib.addToPlaylist(playlist.id, foundRow.song);
        } else {
          // If search didn't match immediately, create track record so it's not lost
          const fallbackTrack: Track = {
            id: `sp:${detected.id}_${i}`,
            title: item.title,
            artist: item.artist,
            duration: item.duration,
            thumb: "",
          };
          lib.addToPlaylist(playlist.id, fallbackTrack);
        }
      } catch {
        // Fallback placeholder track on network hiccup
        const fallbackTrack: Track = {
          id: `sp:${detected.id}_${i}`,
          title: item.title,
          artist: item.artist,
          duration: item.duration,
          thumb: "",
        };
        lib.addToPlaylist(playlist.id, fallbackTrack);
      }
    }

    return { playlistId: playlist.id, title: playlist.name, trackCount: total };
  }

  throw new Error("Unsupported playlist type.");
}
