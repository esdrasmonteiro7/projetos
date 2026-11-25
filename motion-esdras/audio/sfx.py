"""Premium sound design for the Esdras Soluções motion — fully synthesized (numpy only).
Timeline is in video seconds (narration starts at 1.0s). Output: sfx.wav (48 kHz stereo)."""
import numpy as np, wave, math

SR = 48000
DUR = 33.0
N = int(SR * DUR)
rng = np.random.default_rng(11)
dry = np.zeros((2, N))
send = np.zeros((2, N))

# ------------------------------------------------------------------ dsp helpers
def tt(d):
    return np.arange(int(d * SR)) / SR

def pink(n):
    w = rng.standard_normal(n)
    f = np.fft.rfft(w)
    fr = np.fft.rfftfreq(n, 1 / SR)
    fr[0] = 1
    f /= np.sqrt(fr)
    p = np.fft.irfft(f, n)
    return p / (np.abs(p).max() + 1e-9)

def white(n):
    return rng.uniform(-1, 1, n)

def svf(x, fc, q=0.7, mode='bp'):
    """TPT state-variable filter with (optionally) per-sample cutoff."""
    n = len(x)
    fc = np.broadcast_to(np.clip(fc, 20, SR * 0.45), (n,)).astype(float)
    g = np.tan(np.pi * fc / SR)
    k = 1.0 / q
    a1 = 1.0 / (1.0 + g * (g + k)); a2 = g * a1; a3 = g * a2
    xs = x.tolist(); A1 = a1.tolist(); A2 = a2.tolist(); A3 = a3.tolist()
    ic1 = ic2 = 0.0
    out = [0.0] * n
    if mode == 'lp':
        for i in range(n):
            v3 = xs[i] - ic2; v1 = A1[i] * ic1 + A2[i] * v3; v2 = ic2 + A2[i] * ic1 + A3[i] * v3
            ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2; out[i] = v2
    elif mode == 'hp':
        for i in range(n):
            v3 = xs[i] - ic2; v1 = A1[i] * ic1 + A2[i] * v3; v2 = ic2 + A2[i] * ic1 + A3[i] * v3
            ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2; out[i] = xs[i] - k * v1 - v2
    else:
        for i in range(n):
            v3 = xs[i] - ic2; v1 = A1[i] * ic1 + A2[i] * v3; v2 = ic2 + A2[i] * ic1 + A3[i] * v3
            ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2; out[i] = v1
    return np.array(out)

def pan_st(m, pan):
    """equal-power pan; pan scalar or array in [-1, 1]"""
    p = (np.clip(pan, -1, 1) + 1) * np.pi / 4
    return np.vstack([m * np.cos(p), m * np.sin(p)])

def place(sig, t0, gain=1.0, rev=0.0, pan=0.0):
    if sig.ndim == 1:
        sig = pan_st(sig, pan)
    i0 = int(round(t0 * SR))
    if i0 < 0:
        sig = sig[:, -i0:]; i0 = 0
    n = min(sig.shape[1], N - i0)
    if n <= 0:
        return
    dry[:, i0:i0 + n] += sig[:, :n] * gain
    send[:, i0:i0 + n] += sig[:, :n] * gain * rev

def env_ad(n, a, d):
    t = np.arange(n) / SR
    e = np.where(t < a, (t / max(a, 1e-6)) ** 1.5, np.exp(-(t - a) / d))
    return e

def fade(x, fi=0.005, fo=0.02):
    n = x.shape[-1]; e = np.ones(n)
    a = int(fi * SR); b = int(fo * SR)
    if a: e[:a] = np.linspace(0, 1, a)
    if b: e[-b:] *= np.linspace(1, 0, b)
    return x * e

# notes (C-based, sits with the track)
C4, D4, G4 = 261.63, 293.66, 392.0
NOTE = lambda base, octv: base * (2 ** octv)

# ------------------------------------------------------------------ instruments
def whoosh(d, peak=0.55, flo=180, fhi=3800, q=1.1, p0=-0.6, p1=0.6, body=0.6, air=0.35, swirl=0.0):
    n = int(d * SR); x = np.arange(n) / n
    e = np.where(x < peak, (x / peak) ** 2.4, np.exp(-((x - peak) / (1 - peak)) * 4.5))
    e = e * (1 - np.clip((x - 0.97) / 0.03, 0, 1))
    fc = flo * (fhi / flo) ** e
    src = pink(n)
    bp = svf(src, fc, q, 'bp')
    lp = svf(src, fc * 0.45, 0.6, 'lp')
    hi = svf(white(n), 5200 + 3000 * e, 0.7, 'hp')
    m = (bp * 1.0 + lp * body) * e + hi * air * e ** 1.6
    m /= np.abs(m).max() + 1e-9
    pan = p0 + (p1 - p0) * (0.5 - 0.5 * np.cos(np.pi * x))
    if swirl:
        pan = np.clip(pan + swirl * np.sin(x * np.pi * 4), -1, 1)
    st = pan_st(m, pan)
    # tiny Haas widening
    dl = int(0.006 * SR)
    st[1] = np.concatenate([np.zeros(dl), st[1][:-dl]]) * 0.8 + st[1] * 0.2
    return fade(st)

def impact(size=1.0, f0=120, f1=38):
    d = 3.2; t = tt(d); n = len(t)
    f = f1 + (f0 - f1) * np.exp(-t / 0.075)
    ph = 2 * np.pi * np.cumsum(f) / SR
    sub = np.sin(ph) * env_ad(n, 0.003, 0.4 * size)
    sub = np.tanh(sub * 1.8) / np.tanh(1.8)
    click = svf(white(n), 2200, 0.7, 'lp') * env_ad(n, 0.0008, 0.018)
    body = svf(white(n), 320, 0.8, 'lp') * env_ad(n, 0.002, 0.25 * size)
    body /= np.abs(body).max() + 1e-9
    crack = svf(white(n), 3500, 1.2, 'bp') * env_ad(n, 0.0005, 0.04)
    crack /= np.abs(crack).max() + 1e-9
    m = sub * 1.0 + click * 1.8 + body * 0.55 + crack * 0.25
    m = svf(m, 32, 0.7, 'hp')
    return fade(m / np.abs(m).max(), 0.0005, 0.2)

def thud(size=1.0):
    d = 1.4; t = tt(d); n = len(t)
    f = 46 + 60 * np.exp(-t / 0.05)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * env_ad(n, 0.002, 0.2 * size)
    sub = np.tanh(sub * 2.2) / np.tanh(2.2)
    click = svf(white(n), 4000, 0.7, 'hp') * env_ad(n, 0.0004, 0.006)
    knock = svf(white(n), 900, 1.4, 'bp') * env_ad(n, 0.001, 0.05)
    knock /= np.abs(knock).max() + 1e-9
    m = sub + click * 0.8 + knock * 0.45
    return fade(m / np.abs(m).max(), 0.0004, 0.1)

def riser(d, f_start=C4 / 2, f_end=G4, fl0=300, fl1=7000, curve=2.6):
    n = int(d * SR); x = np.arange(n) / n
    amp = x ** curve
    nz = svf(pink(n), fl0 * (fl1 / fl0) ** (x ** 1.3), 1.6, 'bp')
    nz /= np.abs(nz).max() + 1e-9
    f = f_start * (f_end / f_start) ** (x ** 1.6)
    ph = 2 * np.pi * np.cumsum(f) / SR
    tone = sum(np.sin(ph * h + h) / h for h in range(1, 7))
    tone = svf(tone, 300 + 5000 * x ** 2, 0.9, 'lp')
    tone /= np.abs(tone).max() + 1e-9
    trem = 1 - 0.35 * x * (0.5 + 0.5 * np.sin(2 * np.pi * np.cumsum(4 + 14 * x ** 2) / SR))
    m = (nz * 0.8 + tone * 0.5) * amp * trem
    st = pan_st(m, 0.25 * np.sin(x * 9))
    return fade(st / np.abs(st).max(), 0.05, 0.004)

def bell(freq, d=2.2, bright=1.0):
    t = tt(d); n = len(t)
    parts = [(1, 1.0, 1.0), (2.0, 0.42, 0.65), (2.76, 0.35 * bright, 0.45), (5.4, 0.16 * bright, 0.25), (8.93, 0.07 * bright, 0.12)]
    m = np.zeros(n)
    for r, a, dc in parts:
        det = 1 + rng.uniform(-0.0015, 0.0015)
        m += a * np.sin(2 * np.pi * freq * r * det * t) * env_ad(n, 0.0015, dc)
    return fade(m / np.abs(m).max(), 0.0005, 0.05)

def glint(freq=NOTE(C4, 3), d=1.6):
    t = tt(d); n = len(t)
    m = (np.sin(2 * np.pi * freq * t) * env_ad(n, 0.001, 0.55)
         + 0.5 * np.sin(2 * np.pi * freq * 2.005 * t) * env_ad(n, 0.001, 0.3)
         + 0.25 * np.sin(2 * np.pi * freq * 3.01 * t) * env_ad(n, 0.001, 0.15))
    m += svf(white(n), 7000, 0.7, 'hp') * env_ad(n, 0.0005, 0.01) * 0.6
    return fade(m / np.abs(m).max(), 0.0003, 0.05)

def sparkle(d, density, fmin=2400, fmax=7500, seed=0):
    """granular glitter; density = grains/sec (scalar or callable of x in 0..1)"""
    r = np.random.default_rng(seed)
    st = np.zeros((2, int(d * SR) + SR))
    scale = [NOTE(C4, o) * k for o in (2, 3, 4) for k in (1, 9 / 8, 3 / 2)]  # C D G
    scale = [f for f in scale if fmin <= f <= fmax] or [fmin]
    tcur = 0.0
    while tcur < d:
        dens = density(tcur / d) if callable(density) else density
        tcur += r.exponential(1 / max(dens, 0.1))
        if tcur >= d: break
        f = r.choice(scale) * (1 + r.uniform(-0.003, 0.003))
        gd = r.uniform(0.04, 0.18)
        gt = tt(gd); gn = len(gt)
        g = np.sin(2 * np.pi * f * gt) * env_ad(gn, 0.002, gd / 3) * r.uniform(0.3, 1.0)
        i0 = int(tcur * SR)
        st[:, i0:i0 + gn] += pan_st(g, r.uniform(-0.9, 0.9))
    return fade(st[:, :int(d * SR)])

def reverse_swell(d, notes=(NOTE(C4, 1), NOTE(G4, 1), NOTE(D4, 2)), ir=None):
    """reverb-tail of a soft chord, reversed: classic swell into a hit"""
    t = tt(d); n = len(t)
    m = np.zeros(n)
    for f in notes:
        m += np.sin(2 * np.pi * f * t) * env_ad(n, 0.002, 0.5)
    m += svf(pink(n), 2500, 0.8, 'bp') * env_ad(n, 0.001, 0.25) * 0.6
    wet = np.fft.irfft(np.fft.rfft(m, 2 * n) * np.fft.rfft(ir[0][:n], 2 * n))[:n]
    wetR = np.fft.irfft(np.fft.rfft(m, 2 * n) * np.fft.rfft(ir[1][:n], 2 * n))[:n]
    st = np.vstack([wet, wetR])[:, ::-1]
    st *= np.linspace(0, 1, n) ** 1.2
    return fade(st / np.abs(st).max(), 0.05, 0.003)

def glass_glide(d, f0, f1):
    n = int(d * SR); x = np.arange(n) / n
    k = 0.5 - 0.5 * np.cos(np.pi * x)
    f = f0 * (f1 / f0) ** k * (1 + 0.004 * np.sin(2 * np.pi * 5.5 * x * d))
    ph = 2 * np.pi * np.cumsum(f) / SR
    m = np.sin(ph) + 0.35 * np.sin(2 * ph) + 0.12 * np.sin(3 * ph)
    e = np.sin(np.pi * np.clip(x * 1.05, 0, 1)) ** 1.5
    return fade(m * e / 1.5, 0.02, 0.05)

def pop(f0=480, f1=1150, d=0.18):
    t = tt(d); n = len(t)
    f = f0 + (f1 - f0) * (1 - np.exp(-t / 0.02))
    ph = 2 * np.pi * np.cumsum(f) / SR
    m = (np.sin(ph) + 0.3 * np.sin(2 * ph)) * env_ad(n, 0.002, 0.045)
    return fade(m / np.abs(m).max(), 0.0005, 0.02)

def tick(freq=2400, d=0.06):
    t = tt(d); n = len(t)
    m = np.sin(2 * np.pi * freq * t) * env_ad(n, 0.0008, 0.012)
    m += svf(white(n), 6000, 0.7, 'hp') * env_ad(n, 0.0003, 0.003) * 0.5
    return fade(m / np.abs(m).max(), 0.0002, 0.01)

def drone(d, f=C4 / 2):
    n = int(d * SR); x = np.arange(n) / n; t = np.arange(n) / SR
    m = (np.sin(2 * np.pi * f * t) + 0.5 * np.sin(2 * np.pi * f * 2.003 * t) + 0.25 * np.sin(2 * np.pi * f * 3 * t + 1)
         + 0.2 * np.sin(2 * np.pi * f * 1.5 * t))
    air = svf(pink(n), 1800 + 600 * np.sin(2 * np.pi * 0.3 * t), 0.7, 'bp')
    air /= np.abs(air).max() + 1e-9
    e = np.sin(np.pi * x) ** 0.8
    st = pan_st(m * 0.6, 0) + pan_st(air * 0.25, 0.4 * np.sin(2 * np.pi * 0.15 * t))
    st = np.vstack([svf(st[0], 90, 0.7, 'hp'), svf(st[1], 90, 0.7, 'hp')])
    return fade(st * e, 0.3, 0.5)

# ------------------------------------------------------------------ reverb IR
def make_ir(rt60=2.6, d=3.6):
    n = int(d * SR); t = np.arange(n) / SR
    ir = []
    for ch in range(2):
        nz = rng.standard_normal(n)
        dark = svf(nz, 9000 * np.exp(-t / 1.2) + 900, 0.6, 'lp')
        e = np.exp(-6.9 * t / rt60) * np.clip(t / 0.012, 0, 1)
        h = dark * e
        for k in range(10):  # early reflections
            i = int(rng.uniform(0.008, 0.07) * SR); h[i] += rng.uniform(-0.6, 0.6)
        pre = int(0.022 * SR)
        h = np.concatenate([np.zeros(pre), h])[:n]
        ir.append(h / np.sqrt((h ** 2).sum()))
    return ir
IR = make_ir()

# ------------------------------------------------------------------ timeline (video seconds)
HIT, DROP = 2.37, 28.55

# opening atmosphere + swell into the first music hit
place(drone(4.6), 0.0, 0.1, rev=0.3)
place(reverse_swell(1.35, ir=IR), HIT - 1.35, 0.315, rev=0.15)
place(impact(0.8, f0=110, f1=40), HIT, 0.496, rev=0.35)
place(glint(NOTE(C4, 3)), HIT + 0.01, 0.384, rev=0.6)
place(whoosh(1.3, peak=0.12, flo=900, fhi=6500, q=0.8, p0=-0.2, p1=0.2, body=0.2, air=0.7), HIT + 0.02, 0.484, rev=0.5)

# comet flight + light pen drawing the E
place(whoosh(1.0, peak=0.62, flo=400, fhi=5200, q=1.4, p0=0.1, p1=-0.55, body=0.3, air=0.5), 4.1, 0.693, rev=0.3)
place(sparkle(1.0, lambda x: 8 + 30 * x, 3000, 9000, seed=3), 4.25, 0.265, rev=0.7)
place(sparkle(1.45, 26, 2400, 8000, seed=4), 5.0, 0.227, rev=0.75)
place(glass_glide(1.5, NOTE(C4, 1), NOTE(G4, 1)), 4.98, 0.133, rev=0.6, pan=-0.3)
place(glint(NOTE(G4, 2)), 6.45, 0.408, rev=0.7, pan=-0.35)

# brand reveal: reverse swell -> impact -> metallic shimmer sweep
place(reverse_swell(1.1, ir=IR), 7.07 - 1.1, 0.378, rev=0.1)
place(impact(1.0, f0=120, f1=38), 7.07, 0.477, rev=0.4)
place(sparkle(1.7, lambda x: 10 + 70 * np.sin(np.pi * x), 3200, 9500, seed=5), 7.1, 0.169, rev=0.75)
place(glint(NOTE(C4, 3)), 7.45, 0.432, rev=0.8, pan=0.2)

# scene transitions (whoosh peaks at the fastest camera moment)
place(whoosh(0.95, peak=0.6, flo=160, fhi=4200, q=1.0, p0=-0.5, p1=0.7), 8.2, 1.322, rev=0.25)
place(whoosh(0.8, peak=0.55, flo=200, fhi=4600, q=1.2, p0=-0.9, p1=0.9), 9.95, 1.176, rev=0.25)
place(whoosh(0.85, peak=0.55, flo=170, fhi=4000, q=1.0, p0=0.6, p1=-0.6, swirl=0.5), 12.2, 1.110, rev=0.25)
place(whoosh(0.75, peak=0.5, flo=220, fhi=6000, q=0.9, p0=0.0, p1=0.0, air=0.8), 14.98, 1.17, rev=0.35)
place(reverse_swell(0.32, notes=(NOTE(C4, 2), NOTE(G4, 2)), ir=IR), 15.3 - 0.32, 0.352)
place(glint(NOTE(D4, 3)), 15.3, 0.288, rev=0.8)
place(whoosh(1.6, peak=0.45, flo=90, fhi=1800, q=0.9, p0=0.5, p1=-0.3, body=1.0, air=0.25), 17.9, 0.731, rev=0.55)
place(whoosh(0.85, peak=0.5, flo=180, fhi=5200, q=1.0, p0=0.0, p1=0.0, air=0.7), 24.85, 0.83, rev=0.3)

# UI / data details
for i in range(7):
    place(tick(1800 + i * 160), 10.75 + i * 0.07 + 0.05, 0.158, rev=0.4, pan=-0.4 + i * 0.1)
place(sparkle(1.3, 14, 3000, 8000, seed=8), 10.7, 0.18, rev=0.6)
# liquid motion: soft fluid swell around the blob
place(whoosh(2.2, peak=0.35, flo=120, fhi=900, q=2.2, p0=-0.4, p1=0.4, body=0.8, air=0.1, swirl=0.4), 12.75, 0.56, rev=0.5)
# flyers sweeping past the camera
for k, (t0, pn) in enumerate([(15.75, -0.7), (16.35, 0.7), (16.95, -0.6), (17.5, 0.6)]):
    place(whoosh(0.45, peak=0.45, flo=900, fhi=5200, q=0.9, p0=pn, p1=-pn * 0.3, body=0.15, air=0.8), t0, 0.808, rev=0.3)

# purpose: the ring of light draws itself
place(glass_glide(1.35, NOTE(C4, 1), NOTE(C4, 2)), 20.72, 0.186, rev=0.75)
place(sparkle(1.3, lambda x: 4 + 30 * x, 2600, 8000, seed=13), 20.75, 0.253, rev=0.85)
place(glint(NOTE(C4, 3)), 22.0, 0.336, rev=0.85)

# signature: Pensado. Criado. Resolvido.
for i in range(14):
    place(tick(2600 + (i % 4) * 300, 0.04), 22.55 + i * 0.034, 0.150, rev=0.5, pan=np.sin(i) * 0.6)
place(thud(1.0), 22.6, 0.669, rev=0.3)
place(thud(1.0), 23.52, 0.750, rev=0.3)
place(bell(NOTE(G4, 1), 1.4, 0.6), 23.52, 0.12, rev=0.6)
place(thud(1.25), 24.32, 0.699, rev=0.35)
place(bell(NOTE(G4, 1), 2.4), 24.34, 0.32, rev=0.7)
place(bell(NOTE(C4, 2), 2.6), 24.43, 0.30, rev=0.7)
place(sparkle(0.9, lambda x: 60 * (1 - x), 3000, 9000, seed=21), 24.36, 0.261, rev=0.8)

# CTA: pill pop, build-up and the drop
place(pop(), 26.84, 0.437, rev=0.35)
place(whoosh(0.5, peak=0.4, flo=600, fhi=4000, q=0.8, p0=0, p1=0, body=0.2, air=0.6), 26.7, 0.396, rev=0.3)
rz = riser(1.9)
place(rz, DROP - 1.9 - 0.035, 0.42, rev=0.25)
place(impact(1.2, f0=130, f1=40), DROP, 0.51, rev=0.5)
place(glint(NOTE(C4, 3)), DROP + 0.01, 0.38, rev=0.8)
place(sparkle(1.6, lambda x: 90 * (1 - x) ** 2 + 5, 2600, 9500, seed=34), DROP, 0.34, rev=0.85)
place(whoosh(1.1, peak=0.08, flo=1200, fhi=7000, q=0.7, p0=-0.3, p1=0.3, body=0.1, air=0.9), DROP, 0.35, rev=0.6)
place(pop(700, 1500, 0.15), DROP + 0.02, 0.24, rev=0.3)
place(whoosh(0.9, peak=0.5, flo=500, fhi=6000, q=0.8, p0=-0.5, p1=0.5, body=0.2, air=0.9), 28.95, 0.22, rev=0.4)
for t0 in (29.25, 31.05):
    place(glint(NOTE(G4, 3), 1.0), t0 + 0.35, 0.24, rev=0.8, pan=0.3)
    place(sparkle(0.7, 25, 4000, 10000, seed=int(t0 * 10)), t0 + 0.1, 0.24, rev=0.8)

# ------------------------------------------------------------------ reverb + master
wet = np.zeros_like(send)
L = N + len(IR[0])
nfft = 1 << (L - 1).bit_length()
for ch in range(2):
    send[ch] = svf(send[ch], 220, 0.7, 'hp')
    wet[ch] = np.fft.irfft(np.fft.rfft(send[ch], nfft) * np.fft.rfft(IR[ch], nfft), nfft)[:N]
mix = dry + wet * 0.55
# gentle glue: soft clip
peak = np.abs(mix).max()
mix = np.tanh(mix * 1.6) / np.tanh(1.6) * 0.5  # fixed gain + soft-clip glue (no peak renormalisation)
# end fade
fo = int(0.8 * SR)
mix[:, -fo:] *= np.linspace(1, 0, fo) ** 2

pcm = (np.clip(mix, -1, 1) * 32767).astype('<i2').T.copy()
with wave.open('sfx.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print('sfx.wav written, peak', peak)
