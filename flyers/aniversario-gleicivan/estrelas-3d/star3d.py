"""Render a gold foil star balloon (3D look) to a transparent PNG using numpy only."""
import sys
import numpy as np
from PIL import Image


def seg_dist(px, py, ax, ay, bx, by):
    abx, aby = bx - ax, by - ay
    t = ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby)
    t = np.clip(t, 0, 1)
    dx, dy = px - (ax + t * abx), py - (ay + t * aby)
    return np.sqrt(dx * dx + dy * dy)


def inside(px, py, poly):
    c = np.zeros(px.shape, bool)
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        cond = ((y1 > py) != (y2 > py)) & (px < (x2 - x1) * (py - y1) / (y2 - y1 + 1e-12) + x1)
        c ^= cond
    return c


def blur(a, r):
    # separable box blur x3 ~ gaussian
    for _ in range(3):
        for ax in (0, 1):
            k = 2 * r + 1
            p = np.pad(a, [(r, r) if i == ax else (0, 0) for i in range(2)], mode="edge")
            c = np.cumsum(p, axis=ax)
            c = np.insert(c, 0, 0, axis=ax)
            if ax == 0:
                a = (c[k:, :] - c[:-k, :]) / k
            else:
                a = (c[:, k:] - c[:, :-k]) / k
    return a


def render(size=1100, inner=0.50, tip_round=0.10, puff=0.55, light_seed=0, out="star.png", soft=3, key=1.10, rot=0.0):
    S = size
    ys, xs = np.mgrid[0:S, 0:S].astype(np.float32)
    cx = cy = S / 2
    u = (xs - cx) / (S / 2)
    v = (ys - cy) / (S / 2) - 0.05
    R = 0.86 - tip_round
    poly = []
    for i in range(10):
        ang = -np.pi / 2 + rot + i * np.pi / 5
        rr = R if i % 2 == 0 else R * inner
        poly.append((rr * np.cos(ang), rr * np.sin(ang)))
    d = np.full(u.shape, 1e9, np.float32)
    for i in range(10):
        ax, ay = poly[i]
        bx, by = poly[(i + 1) % 10]
        d = np.minimum(d, seg_dist(u, v, ax, ay, bx, by))
    ins = inside(u, v, poly)
    sd = np.where(ins, -d, d)              # signed distance to sharp star
    dist = tip_round - sd                  # distance to rounded (dilated) outline, >0 inside
    pix = 2.0 / S
    alpha = np.clip(dist / pix + 0.5, 0, 1)

    D = dist.max()
    t = np.clip(dist / D, 0, 1)
    h = np.sqrt(1 - (1 - t) ** 2.0)        # pillow profile
    h = 0.75 * h + 0.25 * t
    # crimped seam ripple near the edge
    ang = np.arctan2(v, u)
    seam = np.exp(-(dist / (0.035)) ** 2)
    h = h - 0.035 * seam + 0.0025 * np.sin(ang * 140) * seam
    # soft foil wrinkles
    rng = np.random.default_rng(light_seed + 7)
    noise = blur(rng.standard_normal(u.shape).astype(np.float32), 9)
    noise /= np.abs(noise).max() + 1e-6
    h = h + 0.012 * noise * t
    h = blur(h.astype(np.float32), soft)
    h *= puff * D * (S / 2)

    hy, hx = np.gradient(h)
    nx, ny, nz = -hx, -hy, np.ones_like(h)
    nn = np.sqrt(nx * nx + ny * ny + nz * nz)
    nx, ny, nz = nx / nn, ny / nn, nz / nn
    # reflection of view vector (0,0,1); image y points down -> up = -y
    rx, ry, rz = 2 * nz * nx, 2 * nz * ny, 2 * nz * nz - 1
    up = -ry

    def lobe(lx, ly, lz, p):
        l = np.array([lx, -ly, lz], np.float32)
        l /= np.linalg.norm(l)
        return np.clip(rx * l[0] + ry * l[1] + rz * l[2], 0, 1) ** p

    env = 0.42 + 0.40 * up
    env -= 0.42 * np.exp(-((up + 0.05) / 0.20) ** 2)          # dark horizon band
    env += key * lobe(-0.55, 0.70, 0.55, 18)
    env += 0.9 * lobe(-0.30, 0.45, 0.85, 60)                 # key softbox top-left
    env += 0.55 * lobe(0.85, 0.25, 0.35, 26)                  # rim right
    env += 0.35 * lobe(-0.2, -0.85, 0.3, 10)                  # warm bounce from below
    env += 0.25 * nz ** 3                                     # front fill
    env -= 0.25 * seam
    env = np.clip(env, 0, 1.6)

    stops = np.array([0.0, 0.22, 0.45, 0.68, 0.88, 1.05, 1.6])
    cols = np.array([[34, 16, 3], [104, 58, 12], [178, 116, 34], [228, 170, 66],
                     [250, 214, 120], [255, 242, 196], [255, 252, 238]], np.float32)
    rgb = np.stack([np.interp(env, stops, cols[:, k]) for k in range(3)], -1)
    img = np.dstack([rgb, alpha[..., None] * 255]).clip(0, 255).astype(np.uint8)
    im = Image.fromarray(img, "RGBA")
    bb = im.getchannel("A").getbbox()
    im = im.crop(bb)
    im.save(out)
    return out


if __name__ == "__main__":
    render(out=sys.argv[1] if len(sys.argv) > 1 else "star.png")
