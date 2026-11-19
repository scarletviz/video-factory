// Top-of-frame graphics for two-speaker Shorts, built from the script text alone so every
// script gets them without extra fields:
//   headline  the episode title (first line), or a big hook number if the first line has one
//   stat      a big number from the line (years, counts, units) with the words that follow it
//   versus    a live scoreboard: "Round two", "Point OLED" from the title "OLED vs LCD"
//   claim     "Myth or fact: ..." on Fridays
//   verdict   MYTH / FACT / PARTLY TRUE stamp after "Verdict?"
// A card stays up until the next line produces a different one. A progress bar runs along the top.

const YEAR = /\b(1[0-9]{3}|20[0-9]{2})\b/;
const NUM = /\b(\d[\d,.]*\s?(?:%|percent|hours?|minutes?|seconds?|years?|days?|km|kilometers?|meters?|mph|Hz|K|GB|MB|TB|times|million|billion|thousand|feet|degrees)?)(?=[\s,.!?]|$)/i;
const ROUND = /\bround (one|two|three|four|1|2|3|4)\b/i;
const ROUND_N = { one: 1, two: 2, three: 3, four: 4 };
const POINT = /^point,?\s+(.+?)[.!]/i;
const VERDICT = /^(partly true|mostly myth|mostly fact|myth|fact)\b/i;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const r2 = (n) => Math.round(n * 100) / 100;

function statFrom(text) {
  const y = text.match(YEAR);
  const n = y || text.match(NUM);
  if (!n) return null;
  const num = n[1].trim();
  if (!y && /^\d$/.test(num)) return null; // a bare single digit ("1 thing") is not a stat
  const after = text.slice(n.index + n[0].length).replace(/^[\s,:]+/, "").split(/[.,!?;]/)[0].split(/\s+/).slice(0, 6).join(" ");
  return { num, label: after };
}

export function buildCards(script, lines, total) {
  const series = script.series || "";
  const [sideA, sideB] = (script.title || "").split(/\s+vs\.?\s+/i);
  const score = { a: 0, b: 0 };
  let round = 0;
  const raw = lines.map((l, i) => {
    const text = l.text.trim();
    if (series === "myth-or-fact") {
      if (i === 0) return { type: "claim", claim: text.replace(/^myth or fact:?\s*/i, "") };
      const prev = lines[i - 1]?.text || "";
      const v = text.match(VERDICT);
      if (/verdict/i.test(prev) && v) return { type: "verdict", verdict: v[1].toUpperCase() };
    }
    if (series === "versus" && sideB) {
      const r = text.match(ROUND);
      if (r) round = ROUND_N[r[1].toLowerCase()] || Number(r[1]);
      const p = text.match(POINT);
      if (p) {
        const who = p[1].toLowerCase();
        if (sideA.toLowerCase().includes(who) || who.includes(sideA.toLowerCase().split(" ")[0])) score.a++;
        else score.b++;
      }
      if (r || p || i === 0) return { type: "versus", a: sideA.replace(/:.*$/, ""), b: sideB.replace(/:.*$/, ""), sa: score.a, sb: score.b, round };
    }
    const stat = statFrom(text);
    if (i === 0) return stat ? { type: "stat", ...stat } : { type: "headline", title: script.title, chip: script.chip || "" };
    return stat ? { type: "stat", ...stat } : null;
  });
  // Carry the previous card forward, then merge runs of the same card.
  const segs = [];
  raw.forEach((card, i) => {
    const from = i === 0 ? 0 : lines[i].start;
    const c = card || segs[segs.length - 1]?.card;
    const key = JSON.stringify(c);
    if (segs.length && segs[segs.length - 1].key === key) return;
    if (segs.length) segs[segs.length - 1].to = from;
    segs.push({ from, to: total, card: c, key });
  });
  return segs.map(({ from, to, card }) => ({ from: r2(from), to: r2(to), card }));
}

function cardHtml(card, accent) {
  switch (card.type) {
    case "stat":
      return `<div class="card stat"><div class="num">${esc(card.num)}</div>${card.label ? `<div class="lbl">${esc(card.label)}</div>` : ""}</div>`;
    case "versus":
      return `<div class="card vs"><div class="side"><div class="nm">${esc(card.a)}</div><div class="sc">${card.sa}</div></div>
        <div class="mid">${card.round ? `ROUND ${card.round}` : "VS"}</div>
        <div class="side"><div class="nm">${esc(card.b)}</div><div class="sc">${card.sb}</div></div></div>`;
    case "claim":
      return `<div class="card claim"><div class="hl">${esc(card.claim)}</div></div>`;
    case "verdict":
      return `<div class="card verdict"><div class="stamp ${card.verdict.startsWith("MYTH") ? "no" : card.verdict === "FACT" ? "yes" : "mid"}">${esc(card.verdict)}</div></div>`;
    default:
      return `<div class="card headline"><div class="hl">${esc(card.title)}</div></div>`;
  }
}

export function graphicsHtml(segs, total, accent, W, H) {
  return `<template>
  <style>
    #root { position: absolute; inset: 0; }
    #progress { position: absolute; left: 90px; top: 278px; width: 900px; height: 8px; border-radius: 4px; background: rgba(255,255,255,.14); overflow: hidden; }
    #progress-fill { width: 100%; height: 100%; background: ${accent}; transform-origin: 0% 50%; }
    .slot { position: absolute; left: 0; top: 318px; width: ${W}px; height: 360px; display: flex; align-items: center; justify-content: center; }
    .card { width: 900px; max-width: 900px; min-height: 230px; padding: 34px 44px; border-radius: 34px; background: #F4F1EE; color: #1C1E2B;
      box-shadow: 0 18px 40px rgba(0,0,0,.35); display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 12px; }
    .eyebrow { font: 900 30px "Inter", sans-serif; letter-spacing: 5px; color: #1C1E2B; background: ${accent}; padding: 8px 18px; border-radius: 14px; }
    .hl { font: 900 58px "Inter", sans-serif; line-height: 1.08; text-wrap: balance; }
    .stat .num, .vs .sc { color: #1C1E2B; background: linear-gradient(transparent 58%, ${accent} 58%, ${accent} 92%, transparent 92%); padding: 0 12px; }
    .stat .num { font: 900 150px "Inter", sans-serif; line-height: .95; letter-spacing: -2px; }
    .stat .lbl { font: 700 40px "Inter", sans-serif; color: #4A4F66; }
    .vs { flex-direction: row; justify-content: space-between; gap: 20px; }
    .vs .side { width: 330px; display: flex; flex-direction: column; align-items: center; gap: 6px; }
    .vs .nm { font: 900 46px "Inter", sans-serif; line-height: 1.05; text-wrap: balance; }
    .vs .sc { font: 900 120px "Inter", sans-serif; line-height: 1; }
    .vs .mid { white-space: nowrap; font: 900 30px "Inter", sans-serif; letter-spacing: 4px; color: #fff; background: #1C1E2B; padding: 12px 18px; border-radius: 16px; }
    .claim .hl { font-size: 58px; }
    .verdict { background: transparent; box-shadow: none; }
    .stamp { font: 900 130px "Inter", sans-serif; letter-spacing: 6px; padding: 10px 40px; border: 12px solid; border-radius: 26px; background: #F4F1EE; }
    .stamp.no { color: #E2492F; border-color: #E2492F; }
    .stamp.yes { color: #12A383; border-color: #12A383; }
    .stamp.mid { color: #D98E04; border-color: #D98E04; font-size: 96px; }
  </style>
  <div id="root" data-composition-id="graphics" data-width="${W}" data-height="${H}">
    <div id="progress" class="clip" data-start="0" data-duration="${total}" data-track-index="1"><div id="progress-fill"></div></div>
${segs.map((s, i) => `    <div id="card-${i + 1}" class="slot clip" data-start="${s.from}" data-duration="${r2(s.to - s.from)}" data-track-index="2" data-layout-allow-overflow>
      <div class="card-wrap">${cardHtml(s.card, accent)}</div>
    </div>`).join("\n")}
  </div>
  <script>
    (function () {
      const root = document.querySelector('[data-composition-id="graphics"]');
      const tl = gsap.timeline({ paused: true });
      tl.fromTo(root.querySelector("#progress-fill"), { scaleX: 0 }, { scaleX: 1, duration: ${total}, ease: "none" }, 0);
      root.querySelectorAll(".slot").forEach((slot, i) => {
        const wrap = slot.querySelector(".card-wrap");
        const start = parseFloat(slot.dataset.start), end = start + parseFloat(slot.dataset.duration);
        const stamp = wrap.querySelector(".stamp");
        if (stamp) {
          tl.set(wrap, { opacity: 1 }, start);
          tl.fromTo(stamp, { scale: 2.2, opacity: 0, rotation: -14 }, { scale: 1, opacity: 1, rotation: -8, duration: 0.28, ease: "back.out(1.6)" }, start);
        } else {
          tl.fromTo(wrap, { opacity: 0, y: 24, scale: 0.94 }, { opacity: 1, y: 0, scale: 1, duration: i ? 0.3 : 0.01, ease: "back.out(1.5)" }, start);
        }
        tl.to(wrap, { opacity: 0, duration: 0.12, ease: "power2.in" }, Math.max(start, end - 0.12));
      });
      window.__timelines["graphics"] = tl;
    })();
  </script>
</template>
`;
}
