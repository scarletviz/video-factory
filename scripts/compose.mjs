// Builds a HyperFrames project for one episode from the pipeline output.
//
// Reads:  episodes/<ep>/script.json, out/<ep>/{timeline,lipsync,transcript}.json, out/<ep>/dialogue.wav,
//         characters/svg/*.svg, characters/rig.js
// Writes: videos/<ep>/index.html, videos/<ep>/compositions/{stage,captions}.html, videos/<ep>/assets/dialogue.wav
//         (+ package.json / hyperframes.json if the project is new)
//
// Usage: node scripts/compose.mjs ep000-voice-test
// Then:  cd videos/ep000-voice-test && npm run dev   (preview)   /   npm run render

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HF_VERSION = "0.9.5";
const W = 1080, H = 1920;

const CAST = {
  kiko:   { name: "Kiko",   role: "AI co-host",            accent: "#6CF5C8" },
  alex:   { name: "Alex",   role: "Host · tech & hot takes", accent: "#7D8BFF" },
  selena: { name: "Selena", role: "Anime & pop culture",   accent: "#FF8FB8" },
  james:  { name: "James",  role: "Games & gadgets",       accent: "#3DD6A3" },
  john:   { name: "John",   role: "The skeptic",           accent: "#9FB4D8" },
  rachel: { name: "Rachel", role: "Trending & viral",      accent: "#FFC93C" },
};
const KIKO_LED = { classic: "#6CF5C8", sakura: "#FF8AD8", night: "#4DF3FF", onair: "#FFD23F" };

const ep = process.argv[2];
if (!ep) throw new Error("Usage: node scripts/compose.mjs <episode>");
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
const script = read(`episodes/${ep}/script.json`);
const timeline = read(`out/${ep}/timeline.json`);
const lipsync = read(`out/${ep}/lipsync.json`);
const words = read(`out/${ep}/transcript.json`);
const skin = script.kiko_skin || "classic";
CAST.kiko.accent = KIKO_LED[skin];

const lines = timeline.lines;
const total = Math.ceil((timeline.duration + 0.5) * 100) / 100;
const r2 = (n) => Math.round(n * 100) / 100;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Each line owns the screen from its start until the next line starts.
const slots = lines.map((l, i) => ({ ...l, from: i === 0 ? 0 : l.start, to: i + 1 < lines.length ? lines[i + 1].start : total }));
const speakers = [...new Set(lines.map((l) => l.speaker))];

/* ---------- Captions: script words, Whisper pacing, Kokoro line times ----------
   Whisper's absolute times drift by up to a second on synthetic speech, but its pacing inside a
   line is good. So: match script words to Whisper words by text (LCS), then stretch each line's
   matched times onto that line's exact start/end from timeline.json. */

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9']/g, "");
const said = lines.flatMap((l, li) => l.text.split(/\s+/).filter(Boolean).map((text) => ({ text, li })));
const heard = words.filter((w) => norm(w.text));

function lcsPairs(a, b) {
  const n = a.length, m = b.length, dp = Array.from({ length: n + 1 }, () => new Int16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs = new Map();
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i] === b[j]) { pairs.set(i, j); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}
const match = lcsPairs(said.map((w) => norm(w.text)), heard.map((w) => norm(w.text)));
said.forEach((w, i) => { if (match.has(i)) { const h = heard[match.get(i)]; w.start = h.start; w.end = h.end; } });

function timedWords(line, li) {
  const ws = said.filter((w) => w.li === li).map((w) => ({ ...w }));
  const known = ws.filter((w) => w.start !== undefined);
  // Unmatched words, or a line Whisper missed: spread by character count.
  if (known.length < 2) {
    const chars = ws.reduce((n, w) => n + w.text.length + 1, 0);
    let t = 0;
    for (const w of ws) { w.start = t; t += (w.text.length + 1) / chars; w.end = t; }
  } else {
    ws.forEach((w, i) => {
      if (w.start !== undefined) return;
      const prev = ws.slice(0, i).reverse().find((x) => x.start !== undefined);
      const next = ws.slice(i + 1).find((x) => x.start !== undefined);
      w.start = prev ? prev.end : next.start - 0.2;
      w.end = next ? Math.max(w.start + 0.05, next.start) : w.start + 0.25;
    });
  }
  const a = Math.min(...ws.map((w) => w.start)), b = Math.max(...ws.map((w) => w.end));
  const map = (t) => line.start + 0.02 + ((t - a) / Math.max(0.01, b - a)) * (line.end - line.start - 0.04);
  let last = line.start;
  return ws.map((w) => {
    const start = Math.max(last, map(w.start));
    last = start + 0.02;
    return { text: w.text, start, end: Math.max(start + 0.05, map(w.end)) };
  });
}

function groupsFor(line, li) {
  const ws = timedWords(line, li), groups = [];
  let cur = [];
  ws.forEach((w, i) => {
    cur.push(w);
    const next = ws[i + 1];
    const sentenceEnd = /[.!?]$/.test(w.text);
    const pause = next && next.start - w.end >= 0.15;
    if (!next || cur.length >= 4 || sentenceEnd || pause) { groups.push(cur); cur = []; }
  });
  return groups.map((g, i) => {
    const start = Math.max(line.start, g[0].start - 0.08);
    const nextStart = i + 1 < groups.length ? groups[i + 1][0].start - 0.08 : line.end + 0.15;
    const end = i + 1 < groups.length ? Math.max(start + 0.2, nextStart) : Math.max(nextStart, g[g.length - 1].end);
    return { words: g, start: r2(start), end: r2(end), speaker: line.speaker };
  });
}
const capGroups = lines.flatMap(groupsFor);

/* ---------- Character expressions ---------- */

const kikoLines = lines.filter((l) => l.speaker === "kiko");
const expressions = { kiko: { eyes: [], arms: [] } };
kikoLines.forEach((l, i) => {
  const src = script.lines[l.index - 1] || {};
  const eyes = src.eyes || [[0, "happy"], [0.8, "open"]];
  const arms = src.arms || (i === 0 ? "wave" : i === kikoLines.length - 1 ? "point" : "rest");
  eyes.forEach(([t, s]) => expressions.kiko.eyes.push([r2(l.start + t), s]));
  expressions.kiko.eyes.push([r2(l.end + 0.1), "open"]);
  expressions.kiko.arms.push([r2(l.start), arms], [r2(l.end + 0.1), "rest"]);
});

/* ---------- Files ---------- */

const svgFor = (who) => readFileSync(join(ROOT, "characters/svg", who === "kiko" ? `kiko-${skin}.svg` : `${who}.svg`), "utf8")
  .replace(/<svg id="[^"]+"/, `<svg id="svg-${who}" width="100%" height="100%"`);

const stage = `<template>
  <style>
    #root { position: absolute; inset: 0; overflow: hidden; }
    #bg { position: absolute; inset: 0; background: linear-gradient(180deg, #11142B 0%, #1E2350 55%, #151832 100%); }
    #bg-grid { position: absolute; inset: 0; opacity: .18;
      background-image: linear-gradient(rgba(255,255,255,.08) 2px, transparent 2px), linear-gradient(90deg, rgba(255,255,255,.08) 2px, transparent 2px);
      background-size: 90px 90px; }
    #bg-glow { --accent: ${CAST[lines[0].speaker].accent}; position: absolute; left: 0; top: 260px; width: ${W}px; height: 1100px; opacity: .5;
      background: radial-gradient(closest-side, var(--accent), transparent); }
    #floor { position: absolute; left: 190px; top: 1120px; width: 700px; height: 90px; border-radius: 50%; background: rgba(0,0,0,.28); }
    #chip { position: absolute; left: 0; top: 196px; width: ${W}px; text-align: center; }
    #chip-inner { display: inline-block; font: 900 34px "Inter", sans-serif; letter-spacing: 6px; color: #11142B;
      background: #F4F1EE; padding: 14px 30px; border-radius: 40px; }
    .plate { position: absolute; left: 0; top: 300px; width: ${W}px; text-align: center; }
    .plate-name { font: 900 120px "Inter", sans-serif; color: #fff; line-height: 1; }
    .plate-role { font: 400 42px "Inter", sans-serif; color: rgba(255,255,255,.72); margin-top: 18px; }
    .char { position: absolute; left: 240px; top: 450px; width: 600px; height: 720px; opacity: 0; }
  </style>
  <div id="root" data-composition-id="stage" data-width="${W}" data-height="${H}">
    <div id="bg" class="clip" data-start="0" data-duration="${total}" data-track-index="1">
      <div id="bg-grid"></div>
      <div id="bg-glow"></div>
      <div id="floor"></div>
    </div>
    <div id="chip" class="clip" data-start="0" data-duration="${total}" data-track-index="2"><span id="chip-inner">${esc(script.chip || "MEET THE CREW")}</span></div>
${slots.map((s, i) => `    <div id="plate-${i + 1}" class="plate clip" data-start="${r2(s.from)}" data-duration="${r2(s.to - s.from)}" data-track-index="3">
      <div class="plate-inner"><div class="plate-name" style="color:${CAST[s.speaker].accent}">${esc(CAST[s.speaker].name)}</div><div class="plate-role">${esc(CAST[s.speaker].role)}</div></div>
    </div>`).join("\n")}
${speakers.map((who) => `    <div id="slot-${who}" class="clip" data-start="0" data-duration="${total}" data-track-index="4" data-layout-allow-overlap>
      <div id="char-${who}" class="char">${svgFor(who)}</div>
    </div>`).join("\n")}
  </div>
  <script>
${readFileSync(join(ROOT, "characters/rig.js"), "utf8").replace(/<\/script/gi, "<\\/script")}
    (function () {
      const root = document.querySelector('[data-composition-id="stage"]');
      const SLOTS = ${JSON.stringify(slots.map((s) => ({ speaker: s.speaker, from: r2(s.from), to: r2(s.to) })))};
      const ACCENT = ${JSON.stringify(Object.fromEntries(speakers.map((w) => [w, CAST[w].accent])))};
      const LIPS = ${JSON.stringify(lipsync.speakers)};
      const EXPR = ${JSON.stringify(expressions)};
      const TOTAL = ${total};
      const tl = gsap.timeline({ paused: true });

      SLOTS.forEach((s, i) => {
        const el = root.querySelector("#char-" + s.speaker);
        const plate = root.querySelector("#plate-" + (i + 1) + " .plate-inner");
        tl.to(root.querySelector("#bg-glow"), { "--accent": ACCENT[s.speaker], duration: i ? 0.4 : 0.01, ease: "sine.inOut" }, s.from);
        if (i === 0) {
          tl.set(el, { opacity: 1, scale: 1, y: 0 }, 0);
          tl.set(plate, { opacity: 1, y: 0 }, 0);
        } else {
          tl.set(el, { opacity: 0, scale: 0.84, y: 50, transformOrigin: "50% 100%" }, s.from);
          tl.to(el, { opacity: 1, scale: 1, y: 0, duration: 0.38, ease: "back.out(1.7)" }, s.from);
          tl.set(plate, { opacity: 0, y: 30 }, s.from);
          tl.to(plate, { opacity: 1, y: 0, duration: 0.3, ease: "power3.out" }, s.from + 0.08);
        }
        if (i < SLOTS.length - 1) {
          tl.to(el, { opacity: 0, scale: 0.92, duration: 0.14, ease: "power2.in" }, s.to - 0.14);
          tl.to(plate, { opacity: 0, duration: 0.12, ease: "power2.in" }, s.to - 0.12);
        }
      });

      Object.entries(LIPS).forEach(([who, cues]) => Rig.lipSync(tl, root, who, cues));
      Rig.track(tl, root, "kiko", "eyes", EXPR.kiko.eyes);
      Rig.track(tl, root, "kiko", "arms", EXPR.kiko.arms);
      const kikoBusy = (t) => EXPR.kiko.eyes.some(([s, st], i, a) => st !== "open" && t >= s && t < (a[i + 1] ? a[i + 1][0] : TOTAL));
      Object.keys(ACCENT).forEach((who, n) => {
        Rig.blinks(tl, root, who, 0, TOTAL, n + 7, who === "kiko" ? kikoBusy : () => false);
        Rig.idle(tl, root, who, 0, TOTAL);
      });

      window.__timelines["stage"] = tl;
    })();
  </script>
</template>
`;

const captions = `<template>
  <style>
    #root { position: absolute; inset: 0; }
    .cap { position: absolute; left: 0; top: 1236px; width: ${W}px; text-align: center; overflow: visible; }
    .cap-inner { display: inline-block; font: 900 76px "Inter", sans-serif; text-transform: uppercase; color: #fff;
      line-height: 1.05; text-shadow: 0 6px 0 rgba(0,0,0,.45), 0 0 24px rgba(0,0,0,.35); }
    .w { display: inline-block; margin: 0 .12em; }
  </style>
  <div id="root" data-composition-id="captions" data-width="${W}" data-height="${H}">
${capGroups.map((g, i) => `    <div id="cap-${i + 1}" class="cap clip" data-start="${g.start}" data-duration="${r2(g.end - g.start)}" data-track-index="1" data-speaker="${g.speaker}">
      <span class="cap-inner">${g.words.map((w, j) => `<span class="w" id="cap-${i + 1}-w${j + 1}" data-t="${r2(w.start)}">${esc(w.text)}</span>`).join("")}</span>
    </div>`).join("\n")}
  </div>
  <script>
    (function () {
      const root = document.querySelector('[data-composition-id="captions"]');
      const ACCENT = ${JSON.stringify(Object.fromEntries(speakers.map((w) => [w, CAST[w].accent])))};
      const tl = gsap.timeline({ paused: true });
      root.querySelectorAll(".cap").forEach((cap) => {
        const inner = cap.querySelector(".cap-inner");
        const start = parseFloat(cap.dataset.start), end = start + parseFloat(cap.dataset.duration);
        const fit = window.__hyperframes && window.__hyperframes.fitTextFontSize
          ? window.__hyperframes.fitTextFontSize(inner.textContent.toUpperCase(), { fontFamily: "Inter", fontWeight: 900, maxWidth: 900 })
          : null;
        if (fit && fit.fontSize < 76) inner.style.fontSize = fit.fontSize + "px";
        tl.set(inner, { opacity: 0, scale: 0.9, visibility: "visible" }, start);
        tl.to(inner, { opacity: 1, scale: 1, duration: 0.14, ease: "back.out(2)" }, start);
        cap.querySelectorAll(".w").forEach((w) => {
          tl.set(w, { color: ACCENT[cap.dataset.speaker] }, parseFloat(w.dataset.t));
          tl.set(w, { color: "#ffffff" }, Math.min(end - 0.01, parseFloat(w.dataset.t) + 0.45));
        });
        tl.to(inner, { opacity: 0, duration: 0.1, ease: "power2.in" }, end - 0.1);
        tl.set(inner, { opacity: 0, visibility: "hidden" }, end);
      });
      window.__timelines["captions"] = tl;
    })();
  </script>
</template>
`;

const index = `<!doctype html>
<html lang="en" data-resolution="portrait">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: #11142B; }
      body { font-family: "Inter", sans-serif; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${total}" data-width="${W}" data-height="${H}">
      <div id="stage" data-composition-id="stage" data-composition-src="compositions/stage.html"
        data-start="0" data-duration="${total}" data-track-index="1" data-track-kind="graphics" data-width="${W}" data-height="${H}"></div>
      <div id="captions" data-composition-id="captions" data-composition-src="compositions/captions.html"
        data-start="0" data-duration="${total}" data-track-index="2" data-track-kind="captions" data-width="${W}" data-height="${H}" style="z-index: 2"></div>
      <audio id="voice" src="assets/dialogue.wav" data-start="0" data-duration="${r2(timeline.duration)}" data-track-index="3" data-volume="1"></audio>
    </div>
    <script>
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`;

const dir = join(ROOT, "videos", ep);
mkdirSync(join(dir, "compositions"), { recursive: true });
mkdirSync(join(dir, "assets"), { recursive: true });
writeFileSync(join(dir, "index.html"), index);
writeFileSync(join(dir, "compositions/stage.html"), stage);
writeFileSync(join(dir, "compositions/captions.html"), captions);
copyFileSync(join(ROOT, `out/${ep}/dialogue.wav`), join(dir, "assets/dialogue.wav"));
if (!existsSync(join(dir, "package.json"))) {
  const run = (cmd) => `npx --yes hyperframes@${HF_VERSION} ${cmd}`;
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: ep, private: true, type: "module",
    scripts: { dev: run("preview"), check: run("check"), render: run("render") } }, null, 2) + "\n");
}
if (!existsSync(join(dir, "hyperframes.json"))) {
  writeFileSync(join(dir, "hyperframes.json"), JSON.stringify({ $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
    paths: { blocks: "compositions", components: "compositions/components", assets: "assets" } }, null, 2) + "\n");
}
console.log(`videos/${ep}: ${total}s, ${slots.length} lines, ${capGroups.length} caption groups, cast: ${speakers.join(", ")}`);
