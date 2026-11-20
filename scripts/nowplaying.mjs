// Builds the Last.fm card as build/nowplaying.svg, then renders it to
// assets/nowplaying.png with headless Chrome. The PNG is what the README shows:
// GitHub serves repo SVGs with a policy that blocks the embedded cover and font.
// Layout follows the listening card on the personal site home page.
//
// Env: LASTFM_API_KEY (required), LASTFM_USER (default "unfgws"), CHROME (browser path).
// Offline testing: FIXTURE (saved API response), FIXTURE_COVER (local image file).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const user = process.env.LASTFM_USER || "unfgws";
const key = process.env.LASTFM_API_KEY;
const svgOut = fileURLToPath(new URL("../build/nowplaying.svg", import.meta.url));
const pngOut = fileURLToPath(new URL("../assets/nowplaying.png", import.meta.url));
const PLACEHOLDER = "2a96cbd8b46e442fc41c2b86b821562f"; // Last.fm's "no art" image

const widths = JSON.parse(await readFile(new URL("./inter-widths.json", import.meta.url), "utf8"));
const fontB64 = (await readFile(new URL("./fonts/inter-latin.woff2", import.meta.url))).toString("base64");

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Text width in px from Inter advance widths (small safety margin included).
function measure(s, size, kind) {
  let units = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    units += widths[kind][c] ?? (c >= 0x2e80 ? 1000 : 620);
  }
  return (units / 1000) * size * 1.02;
}

function fit(s, size, kind, max) {
  if (measure(s, size, kind) <= max) return s;
  let t = s;
  while (t.length > 1 && measure(t + "…", size, kind) > max) t = t.slice(0, -1);
  return t.trimEnd() + "…";
}

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

// Same pick as the site: the largest image Last.fm offers. No size cap.
async function coverData(track) {
  if (process.env.FIXTURE_COVER) {
    const buf = await readFile(process.env.FIXTURE_COVER);
    return `data:image/png;base64,${buf.toString("base64")}`;
  }
  const img = [...(track.image || [])]
    .reverse()
    .find((i) => i["#text"] && !i["#text"].includes(PLACEHOLDER));
  if (!img) {
    console.log("cover: Last.fm has no artwork for this track");
    return null;
  }
  try {
    const res = await fetch(img["#text"]);
    if (!res.ok) {
      console.log(`cover: download failed (${res.status}) ${img["#text"]}`);
      return null;
    }
    const type = res.headers.get("content-type") || "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());
    console.log(`cover: ${type}, ${buf.length} bytes`);
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch (err) {
    console.log(`cover: ${err.message}`);
    return null;
  }
}

function card({ status, title, artist, album, cover, live }) {
  // Geometry, in px, taken from the site's 26rem card.
  const W = 416;
  const trackX = 17;
  const trackW = W - 34;
  const trackY = 17 + 44.8;
  const artSize = 192;
  const edge = trackX + trackW - 1 - 12.8; // right edge of track content
  const artX = edge - artSize;
  const artY = trackY + 1 + 16;
  const maxText = 352;
  const padX = 6.08;
  const padY = 1.28;

  const chips = [
    { text: title, size: 23.2, weight: 600, kind: "semi", lh: 1.2, cls: "t" },
    { text: artist, size: 16, weight: 650, kind: "semi", lh: 1.35, cls: "a" },
    album && { text: album, size: 13.44, weight: 450, kind: "album", lh: 1.35, cls: "b" },
  ].filter(Boolean);

  let y = artY + artSize + 16;
  const chipSvg = chips
    .map((c) => {
      const text = fit(c.text, c.size, c.kind, maxText - padX * 2);
      const w = measure(text, c.size, c.kind) + padX * 2;
      const h = c.size * c.lh + padY * 2;
      const svg = `<rect x="${(edge - w).toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="4.8" fill="rgba(255,255,255,.46)"/>
<text class="${c.cls}" x="${(edge - padX).toFixed(1)}" y="${(y + h / 2).toFixed(1)}" text-anchor="end" dominant-baseline="central">${esc(text)}</text>`;
      y += h + 5.6;
      return svg;
    })
    .join("\n");
  const stackBottom = y - 5.6;
  const trackH = stackBottom + 16 + 1 - trackY;
  const H = Math.round((trackY + trackH + 16 + 1) * 10) / 10;
  const cx = trackX + trackW / 2;
  const cy = trackY + trackH / 2;

  // Glow: the artwork, scaled to cover 1.24x the track box, blurred.
  const glowScale = (Math.max(trackW * 1.24, trackH * 1.24) / 300) * 1.12;
  const glowSize = 300 * glowScale;

  const bars = [6.4, 12.48, 16, 12.48, 6.4]
    .map(
      (h, i) =>
        `<rect class="${live ? "eq e" + (i % 3) : ""}" x="${25 + i * 4}" y="${(39.4 - h / 2).toFixed(2)}" width="2" height="${h}" rx="1" fill="#656a6e"/>`,
    )
    .join("");

  const artBlock = cover
    ? `<g clip-path="url(#artclip)"><use href="#art" transform="translate(${artX + 1} ${artY + 1}) scale(${(artSize - 2) / 300})"/></g>`
    : `<path d="M${artX + 86} ${artY + 118}V${artY + 76}l30 -6v42" fill="none" stroke="#858b91" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><ellipse cx="${artX + 80}" cy="${artY + 118}" rx="8" ry="6" fill="#858b91"/><ellipse cx="${artX + 110}" cy="${artY + 112}" rx="8" ry="6" fill="#858b91"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(status)}: ${esc(title)} by ${esc(artist)}">
<style>
@font-face{font-family:"Inter";font-weight:100 900;src:url(data:font/woff2;base64,${fontB64}) format("woff2")}
text{font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif}
.s{font-size:12.8px;font-weight:650;letter-spacing:.576px;fill:#656a6e}
.l{font-size:11.84px;font-weight:500;fill:#656a6e}
.t{font-size:23.2px;font-weight:600;fill:${cover ? "#fff" : "#202122"}}
.a{font-size:16px;font-weight:650;fill:${cover ? "#fff" : "#202122"}}
.b{font-size:13.44px;font-weight:450;fill:${cover ? "#fff" : "#54595d"}}
.eq{transform-box:fill-box;transform-origin:center;animation:eq 1.2s ease-in-out infinite}
.e1{animation-delay:-.4s}.e2{animation-delay:-.8s}
@keyframes eq{0%,100%{transform:scaleY(.45)}50%{transform:scaleY(1)}}
@media (prefers-reduced-motion:reduce){.eq{animation:none}}
</style>
<defs>
${cover ? `<image id="art" width="300" height="300" href="${cover}"/>` : ""}
<clipPath id="box"><rect x="${trackX}" y="${trackY}" width="${trackW}" height="${trackH.toFixed(1)}" rx="16"/></clipPath>
<clipPath id="artclip"><rect x="${artX + 1}" y="${artY + 1}" width="${artSize - 2}" height="${artSize - 2}" rx="11"/></clipPath>
<filter id="blur" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="18"/><feColorMatrix type="saturate" values="1.35"/></filter>
<filter id="s1" x="-50%" y="-40%" width="200%" height="190%"><feDropShadow dx="0" dy="14.4" stdDeviation="15" flood-color="#000" flood-opacity=".58"/></filter>
<filter id="s2" x="-50%" y="-40%" width="200%" height="190%"><feDropShadow dx="0" dy="3.8" stdDeviation="4.4" flood-color="#000" flood-opacity=".38"/></filter>
</defs>
<rect width="${W}" height="${H}" rx="22.4" fill="#aeb3b8"/>
<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="21.4" fill="#242629"/>
<rect x="5" y="5" width="${W - 10}" height="${H - 10}" rx="17.4" fill="#555a5f"/>
<rect x="6" y="6" width="${W - 12}" height="${H - 12}" rx="16.4" fill="#e4e6e8"/>
${bars}
<text class="s" x="54.2" y="39.4" dominant-baseline="central">${esc(status)}</text>
<text class="l" x="${W - 25}" y="39.4" text-anchor="end" dominant-baseline="central">Last.fm</text>
<g clip-path="url(#box)">
${cover ? `<use href="#art" opacity=".85" filter="url(#blur)" transform="translate(${(cx - glowSize / 2).toFixed(1)} ${(cy - glowSize / 2).toFixed(1)}) scale(${glowScale.toFixed(3)})"/>` : ""}
<rect x="${artX}" y="${artY}" width="${artSize}" height="${artSize}" rx="12" fill="#eaecf0" filter="url(#s1)"/>
<rect x="${artX}" y="${artY}" width="${artSize}" height="${artSize}" rx="12" fill="#eaecf0" filter="url(#s2)"/>
<rect x="${artX + .5}" y="${artY + .5}" width="${artSize - 1}" height="${artSize - 1}" rx="11.5" fill="#eaecf0" stroke="#d8dadd"/>
${artBlock}
${chipSvg}
</g>
<rect x="${trackX + .5}" y="${trackY + .5}" width="${trackW - 1}" height="${(trackH - 1).toFixed(1)}" rx="15.5" fill="none" stroke="rgba(30,34,38,.14)"/>
</svg>
`;
}

const data = await latest();
const raw = data?.recenttracks?.track;
const track = Array.isArray(raw) ? raw[0] : raw;

let svg;
if (!track) {
  svg = card({ status: "LAST.FM", title: "Nothing played yet", artist: user, album: "", cover: null, live: false });
} else {
  const live = track["@attr"]?.nowplaying === "true";
  svg = card({
    status: live ? "CURRENTLY LISTENING" : "LAST PLAYED",
    title: track.name || "Unknown track",
    artist: track.artist?.["#text"] || track.artist?.name || "Unknown artist",
    album: track.album?.["#text"] || "",
    cover: await coverData(track),
    live,
  });
}

await mkdir(new URL("../build/", import.meta.url), { recursive: true });
await writeFile(svgOut, svg);

const height = Math.ceil(Number(svg.match(/viewBox="0 0 416 ([\d.]+)"/)[1]));
const chrome = process.env.CHROME || "google-chrome";
execFileSync(
  chrome,
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--hide-scrollbars",
    "--default-background-color=00000000",
    "--force-device-scale-factor=2",
    "--virtual-time-budget=3000",
    `--window-size=416,${height}`,
    `--screenshot=${pngOut}`,
    `file://${svgOut}`,
  ],
  { stdio: "ignore" },
);
console.log("wrote", pngOut);
