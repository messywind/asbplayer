// Best-effort parsing of an anime title + episode from a subtitle/video file name,
// used to organize the on-disk analysis cache as <anime>/<episode>.json.
//
// Fansub / release names are messy; this covers the common shapes and degrades
// gracefully (returns whatever title it can, empty episode) when unsure.

export interface AnimeEpisode {
    anime: string;
    episode: string;
}

const EXT_RE = /\.[a-z0-9]{1,5}$/i;
const BRACKETS_RE = /[[(（{【][^\][)）}】]*[\])）}】]/g;
const JUNK_TOKENS_RE =
    /\b(1080p|720p|480p|2160p|4k|bd|bdrip|bluray|web-?dl|webrip|hevc|x264|x265|h\.?264|h\.?265|10bit|8bit|aac|flac|opus|ma10p|hi10p|dual[\s._-]?audio|cht|chs|gb|big5|jpsc|jptc|v\d)\b/gi;

/** Turn a raw title fragment into a clean display title. */
function cleanTitle(raw: string): string {
    return raw
        .replace(BRACKETS_RE, ' ')
        .replace(JUNK_TOKENS_RE, ' ')
        .replace(/[._]+/g, ' ')
        .replace(/\s*-\s*$/, '')
        .replace(/\s+/g, ' ')
        .trim();
}

const pad2 = (n: string) => n.padStart(2, '0');

/** Extract { anime, episode } from a file name; either field may be empty. */
export function parseAnimeEpisode(fileName: string | undefined | null): AnimeEpisode {
    if (!fileName) {
        return { anime: '', episode: '' };
    }
    const base = String(fileName)
        .replace(/^.*[\\/]/, '') // basename
        .replace(EXT_RE, '');

    // Ordered episode markers. Each returns the display episode + the index in
    // `base` where the title ends (everything before the marker is the title).
    const matchers: { re: RegExp; ep: (m: RegExpMatchArray) => string }[] = [
        { re: /[sS](\d{1,2})[\s._-]?[eE](\d{1,3})/, ep: (m) => `S${pad2(m[1])}E${pad2(m[2])}` },
        { re: /第\s*(\d{1,4})\s*[話话集]/, ep: (m) => pad2(m[1]) },
        { re: /[\s._]-[\s._]*(\d{1,4})(?:v\d)?(?=$|[\s._[(（])/, ep: (m) => pad2(m[1]) },
        { re: /\b[eE][pP]?[\s._]?(\d{1,4})\b/, ep: (m) => pad2(m[1]) },
        { re: /[\s._#]#?(\d{1,4})(?:v\d)?(?=$|[\s._[(（])/, ep: (m) => pad2(m[1]) },
    ];

    for (const { re, ep } of matchers) {
        const m = base.match(re);
        if (m && m.index !== undefined) {
            const title = cleanTitle(base.slice(0, m.index));
            const episode = ep(m);
            return { anime: title || cleanTitle(base), episode };
        }
    }

    return { anime: cleanTitle(base), episode: '' };
}
