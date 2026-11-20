// Writes assets/nowplaying.svg from the latest Last.fm scrobble.
// Env: LASTFM_API_KEY (required), LASTFM_USER (default "unfgws"),
//      FIXTURE (path to a saved API response, for offline testing).
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const user = process.env.LASTFM_USER || "unfgws";
const key = process.env.LASTFM_API_KEY;
const out = fileURLToPath(new URL("../assets/nowplaying.svg", import.meta.url));
const PLACEHOLDER = "2a96cbd8b46e442fc41c2b86b821562f"; // Last.fm's "no art" image

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

async function latest() {
  if (process.env.FIXTURE) return JSON.parse(await readFile(process.env.FIXTURE, "utf8"));
  if (!key) throw new Error("LASTFM_API_KEY is not set");
  const q = new URLSearchParams({
    method: "user.getrecenttracks",
    user,
    api_key: key,
    format: "json",
    limit: "1",
  });
  const res = await fetch(`https://ws.audioscrobbler.com/2.0/?${q}`);
  if (!res.ok) throw new Error(`Last.fm responded ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`Last.fm error ${data.error}: ${data.message}`);
  return data;
}

async function coverData(track) {
  const img = [...(track.image || [])]
    .reverse()
    .find((i) => i["#text"] && !i["#text"].includes(PLACEHOLDER));
  if (!img) return null;
  try {
    const res = await fetch(img["#text"]);
    if (!res.ok) return null;
    const type = res.headers.get("content-type") || "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 60_000) return null; // keep the SVG small
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

function card({ label, title, artist, cover, live }) {
  const art = cover
    ? `<image href="${cover}" x="16" y="16" width="64" height="64" preserveAspectRatio="xMidYMid slice" clip-path="url(#r)"/>`
    : `<rect x="16" y="16" width="64" height="64" rx="8" fill="#23262d"/>`;
  const bars = live
    ? `<g fill="#8b93a1" transform="translate(396 30)">
    <rect class="b b1" x="0" y="0" width="4" height="16" rx="2"/>
    <rect class="b b2" x="8" y="0" width="4" height="16" rx="2"/>
    <rect class="b b3" x="16" y="0" width="4" height="16" rx="2"/>
  </g>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="96" viewBox="0 0 440 96" role="img" aria-label="${esc(label)}: ${esc(title)} by ${esc(artist)}">
<style>
text{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
.b{transform-box:fill-box;transform-origin:bottom;animation:eq 1.1s ease-in-out infinite}
.b2{animation-delay:-.4s}.b3{animation-delay:-.8s}
@keyframes eq{0%,100%{transform:scaleY(.3)}50%{transform:scaleY(1)}}
@media (prefers-reduced-motion:reduce){.b{animation:none}}
</style>
<defs><clipPath id="r"><rect x="16" y="16" width="64" height="64" rx="8"/></clipPath></defs>
<rect width="440" height="96" rx="12" fill="#14161a"/>
${art}
<text x="96" y="34" font-size="11" letter-spacing="1.4" fill="#8b93a1">${esc(label.toUpperCase())}</text>
<text x="96" y="56" font-size="16" font-weight="600" fill="#f4f4f2">${esc(clip(title, 30))}</text>
<text x="96" y="76" font-size="13" fill="#8b93a1">${esc(clip(artist, 38))}</text>
${bars}
</svg>
`;
}

const data = await latest();
const raw = data?.recenttracks?.track;
const track = Array.isArray(raw) ? raw[0] : raw;

let svg;
if (!track) {
  svg = card({ label: "Last.fm", title: "Nothing played yet", artist: user, cover: null, live: false });
} else {
  const live = track["@attr"]?.nowplaying === "true";
  svg = card({
    label: live ? "Now playing" : "Last played",
    title: track.name || "Unknown track",
    artist: track.artist?.["#text"] || track.artist?.name || "Unknown artist",
    cover: await coverData(track),
    live,
  });
}

await writeFile(out, svg);
console.log("wrote", out);
