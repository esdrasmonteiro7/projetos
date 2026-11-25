// Apple-style kinetic typography, fully driven by t (deterministic)
import { clamp, smooth, easeOutCubic, easeInCubic, easeOutBack, spring, pulse } from './util.js';
import { HIT, DROP, END } from './timing.js';

function mkBlock(root, top, lines) {
  const el = document.createElement('div');
  el.className = 'blk'; el.style.top = top + 'px';
  const L = lines.map((ln) => {
    const d = document.createElement('div');
    d.className = 'line ' + ln.cls;
    if (ln.hidden) d.style.visibility = 'hidden';
    const spans = [];
    let acc = false;
    const units = ln.letters ? [...ln.text] : ln.text.split(' ').map((w, i, a) => (i < a.length - 1 ? w + ' ' : w));
    units.forEach((u) => {
      let txt = u;
      if (txt.startsWith('*')) { acc = true; txt = txt.slice(1); }
      let endAcc = false;
      if (txt.replace(/\s+$/, '').endsWith('*')) { endAcc = true; txt = txt.replace('*', ''); }
      const s = document.createElement('span');
      s.className = 'w' + (acc ? ' acc' : '');
      s.textContent = txt;
      d.appendChild(s); spans.push(s);
      if (endAcc) acc = false;
    });
    el.appendChild(d);
    return { ...ln, el: d, spans };
  });
  root.appendChild(el);
  return { el, lines: L };
}

function reveal(span, t, t0, o) {
  const dur = o.dur ?? 0.6;
  const p = clamp((t - t0) / dur), e = easeOutCubic(p);
  span.style.opacity = smooth(clamp((t - t0) / (dur * 0.6)));
  const dy = (o.dy ?? 38) * (1 - e), sc = 1 + (o.sc ?? 0) * (1 - e);
  span.style.transform = `translate3d(0,${dy.toFixed(2)}px,0) scale(${sc.toFixed(4)})`;
  const b = (o.blur ?? 14) * (1 - e);
  span.style.filter = b > 0.05 ? `blur(${b.toFixed(2)}px)` : 'none';
}
function blockOut(el, t, t0, dur = 0.3, o = {}) {
  const p = clamp((t - t0) / dur), e = easeInCubic(p);
  el.style.opacity = (1 - e).toFixed(4);
  const b = (o.blur ?? 12) * e;
  el.style.filter = b > 0.05 ? `blur(${b.toFixed(2)}px)` : 'none';
  el.style.transform = `translate3d(0,${((o.dy ?? -26) * e).toFixed(2)}px,0) scale(${(1 + (o.sc ?? 0) * e).toFixed(4)})`;
}

export function buildOverlay(root) {
  const B = [];
  const add = (top, lines, tOut, outDur = 0.3, outOpt = {}) => { const b = mkBlock(root, top, lines); b.tOut = tOut; b.outDur = outDur; b.outOpt = outOpt; B.push(b); return b; };

  // top scrim for title scenes
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.style.cssText = 'top:0;height:820px;background:linear-gradient(180deg,rgba(2,4,12,.78) 0%,rgba(2,4,12,.45) 55%,rgba(2,4,12,0) 100%)';
  root.appendChild(scrim);

  const word = { dur: 0.6 };
  const letters = { dur: 0.7, dy: 70, blur: 18 };
  add(1250, [
    { cls: 'lt', text: 'Todo grande projeto', t0: 1.0, st: 0.17, o: word },
    { cls: 'hd', text: 'começa com um problema.', t0: 1.98, st: 0.14, o: word },
  ], 3.85, 0.32);
  add(1270, [
    { cls: 'lt', text: 'E todo problema...', t0: 4.11, st: 0.16, o: word },
    { cls: 'hd', text: 'tem uma *solução.*', t0: 5.72, st: 0.16, o: { dur: 0.7 } },
  ], 6.8, 0.38);
  // titles
  const title = (lab, big, subs, tIn, tOut, hideLab = false) => add(205, [
    { cls: 'lab', text: lab, t0: tIn - 0.12, st: 0, o: { dur: 0.5, dy: 14, blur: 6 }, hidden: hideLab },
    { cls: 'giant glow', text: big, t0: tIn, st: 0.04, letters: true, o: letters },
    ...subs.map(([s, t0]) => ({ cls: 'sub', text: s, t0, st: 0.09, o: { dur: 0.55, dy: 26, blur: 10 } })),
  ], tOut, 0.24, { dy: -40, blur: 16 });
  title('01', 'Sites', [['que impressionam.', 9.25]], 8.75, 10.1);
  title('02', 'Sistemas', [['que trabalham por você.', 11.05]], 10.56, 12.36);
  title('03', 'Motion', [['design que dá vida', 13.45], ['à sua marca.', 14.3]], 12.91, 15.1);
  title('04', 'Flyers', [], 15.62, 16.36);
  const dsg = title('04', 'Design', [['em cada detalhe.', 17.0]], 16.5, 18.08, true);
  dsg.lines[0].el.style.visibility = 'hidden';
  // label 04 persists across the Flyers -> Design swap
  const lab4 = B[B.length - 2].lines[0];
  // purpose
  const purpose = add(735, [
    { cls: 'lt', text: 'Mas, na verdade...', t0: 18.8, st: 0.15, o: { dur: 0.8 } },
    { cls: 'hd2', text: 'eu estou aqui', t0: 20.31, st: 0.11, o: word },
    { cls: 'hd2', text: 'pra resolver', t0: 20.78, st: 0.12, o: word },
    { cls: 'hd2 glow', text: '*o seu problema.*', t0: 21.63, st: 0.13, o: { dur: 0.7 } },
  ], 22.3, 0.3, { dy: -20, blur: 14, sc: 0.03 });
  purpose.lines[0].el.style.marginBottom = '34px';
  // signature
  const sig = (txt, t0, tOut, outDur) => add(1130, [{ cls: 'big', text: txt, t0, st: 0, o: { dur: 0.42, dy: 0, blur: 26, sc: 0.16 } }], tOut, outDur, { dy: 0, blur: 18, sc: -0.06 });
  sig('Pensado.', 22.6, 23.4, 0.14);
  sig('Criado.', 23.52, 24.2, 0.14);
  sig('*Resolvido.*', 24.32, 24.95, 0.3);
  // CTA heading
  add(612, [
    { cls: 'hd2', text: 'Vamos fazer', t0: 25.42, st: 0.12, o: { dur: 0.7 } },
    { cls: 'hd2', text: 'um *orçamento?*', t0: 25.8, st: 0.12, o: { dur: 0.7 } },
  ], 99, 0.3);

  // CTA widgets
  const pill = document.createElement('div'); pill.id = 'cta-pill';
  pill.innerHTML = `<svg class="ic" viewBox="0 0 92 92"><defs><linearGradient id="wg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5df58a"/><stop offset="1" stop-color="#1fb855"/></linearGradient></defs>
    <circle cx="46" cy="46" r="46" fill="url(#wg)"/>
    <path d="M46 21c-13.8 0-25 10.9-25 24.4 0 4.6 1.3 8.9 3.6 12.6L21.5 70l12.4-3.3c3.6 1.9 7.7 3 12.1 3 13.8 0 25-10.9 25-24.3S59.8 21 46 21z" fill="none" stroke="#fff" stroke-width="4" stroke-linejoin="round"/>
    <g transform="translate(32.5,31.5) scale(1.12)"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z" fill="#fff"/></g></svg>
    <div class="tx"><span class="k">WHATSAPP</span><span class="n">(92) 99509-9642</span></div>`;
  root.appendChild(pill);
  const btn = document.createElement('div'); btn.id = 'cta-btn';
  btn.innerHTML = 'Fazer orçamento &nbsp;→<div class="sh"></div>';
  root.appendChild(btn);
  const sh = btn.querySelector('.sh');
  const serv = document.createElement('div'); serv.id = 'cta-serv'; serv.textContent = 'SITES · SISTEMAS · MOTION · DESIGN';
  root.appendChild(serv);
  const uline = document.createElement('div'); uline.id = 'uline'; root.appendChild(uline);

  // measure underline target (accent line of purpose)
  const accSpans = purpose.lines[3].spans;
  const r0 = accSpans[0].getBoundingClientRect(), r1 = accSpans[accSpans.length - 1].getBoundingClientRect();
  uline.style.left = r0.left + 'px'; uline.style.width = (r1.right - r0.left) + 'px'; uline.style.top = (r1.bottom + 6) + 'px';
  uline.style.transformOrigin = 'left center';

  function update(t) {
    for (const b of B) {
      const first = Math.min(...b.lines.map((l) => l.t0));
      if (t < first - 0.02 || t > b.tOut + b.outDur + 0.02) { b.el.style.display = 'none'; continue; }
      b.el.style.display = 'block';
      for (const ln of b.lines) ln.spans.forEach((s, i) => reveal(s, t, ln.t0 + i * ln.st, ln.o || {}));
      blockOut(b.el, t, b.tOut, b.outDur, b.outOpt);
    }
    // keep "04" visible through the swap
    if (t > 16.2 && t < 18.4) {
      const dsgB = B.find((b) => b === dsg);
      dsgB.lines[0].el.style.visibility = 'visible';
      dsgB.lines[0].spans.forEach((s) => { s.style.opacity = 1; s.style.filter = 'none'; s.style.transform = 'none'; });
      lab4.el.style.visibility = 'hidden';
    } else lab4.el.style.visibility = 'visible';

    scrim.style.opacity = (smooth(clamp((t - 8.55) / 0.4)) * (1 - smooth(clamp((t - 18.0) / 0.5)))).toFixed(3);
    // underline
    const up = easeOutCubic(clamp((t - 22.0) / 0.45));
    const uo = (t < 22.0 || t > 22.65) ? 0 : 1 - easeInCubic(clamp((t - 22.3) / 0.3));
    uline.style.opacity = uo; uline.style.transform = `scaleX(${up.toFixed(4)})`;
    // pill
    const pp = easeOutCubic(clamp((t - 26.82) / 0.8));
    const pk = 1 + 0.045 * spring(t, DROP, 1.8, 4) + 0.03 * pulse(t, DROP, 0.03, 0.5);
    pill.style.display = t > 26.8 ? 'flex' : 'none';
    pill.style.opacity = smooth(clamp((t - 26.82) / 0.5));
    pill.style.filter = pp < 1 ? `blur(${((1 - pp) * 16).toFixed(2)}px)` : 'none';
    pill.style.transform = `translateX(-50%) translateY(${((1 - pp) * 70).toFixed(2)}px) scale(${((0.94 + 0.06 * pp) * pk).toFixed(4)})`;
    pill.style.boxShadow = `0 30px 80px rgba(0,20,80,.55), inset 0 1px 0 rgba(255,255,255,.25), 0 0 ${(60 * pulse(t, DROP, 0.03, 0.9)).toFixed(1)}px rgba(80,160,255,${(0.8 * pulse(t, DROP, 0.03, 0.9)).toFixed(3)})`;
    // button pops on the drop
    const bp = clamp((t - (DROP - 0.04)) / 0.6);
    btn.style.display = t > DROP - 0.05 ? 'block' : 'none';
    btn.style.opacity = smooth(clamp((t - (DROP - 0.04)) / 0.25));
    btn.style.transform = `translateX(-50%) scale(${(0.6 + 0.4 * easeOutBack(bp, 2.2)).toFixed(4)})`;
    const shimmer = (t0) => clamp((t - t0) / 0.9);
    const s1 = shimmer(29.25), s2 = shimmer(31.05);
    const sx = s2 > 0 ? s2 : s1;
    sh.style.left = (-200 + 900 * easeOutCubic(sx)).toFixed(1) + 'px';
    // services
    const sp = easeOutCubic(clamp((t - 29.0) / 1.0));
    serv.style.opacity = smooth(clamp((t - 29.0) / 0.7));
    serv.style.letterSpacing = (0.62 - 0.3 * sp).toFixed(3) + 'em';
    serv.style.filter = sp < 1 ? `blur(${((1 - sp) * 8).toFixed(2)}px)` : 'none';
  }
  update(0);
  return { update };
}
