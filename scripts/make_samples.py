"""Genera imágenes de ejemplo (SVG + PNG) para probar los efectos.

- sunflowers: dibujo lineal de girasoles (trazos finos, centros rellenos,
  hojas, tallos y raíces) — caso de prueba principal del Dotwork.
- sphere: ilustración tonal con degradés (prueba del motor Tono / halftone).
"""
import math, random, sys
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1] if len(sys.argv) > 1 else 'public/samples'
W, H = 1200, 1500
random.seed(4)

def bezier(p0, p1, p2, p3, n=60):
    pts = []
    for i in range(n + 1):
        t = i / n
        a = (1 - t) ** 3; b = 3 * (1 - t) ** 2 * t; c = 3 * (1 - t) * t * t; d = t ** 3
        pts.append((a*p0[0]+b*p1[0]+c*p2[0]+d*p3[0], a*p0[1]+b*p1[1]+c*p2[1]+d*p3[1]))
    return pts

strokes = []   # (points, width, closed)
fills = []     # (points)

def flower(cx, cy, R, tilt, petals=18):
    # Pétalos: forma de gota alrededor del centro, con nervadura.
    for k in range(petals):
        a = tilt + k * 2 * math.pi / petals + random.uniform(-0.06, 0.06)
        L = R * random.uniform(0.95, 1.12)
        wdt = R * 0.2
        base = 0.42 * R
        pts = []
        for i in range(41):
            t = i / 40 * math.pi
            r = base + (L - base) * (1 - math.cos(t)) / 2 if i <= 20 else base + (L - base) * (1 - math.cos(t)) / 2
            u = i / 40
            along = base + (L - base) * u
            side = math.sin(u * math.pi) ** 0.8 * wdt
            pts.append((along, side))
        poly = pts + [(x, -y) for (x, y) in reversed(pts[1:-1])]
        ca, sa = math.cos(a), math.sin(a)
        poly = [(cx + x * ca - y * sa, cy + x * sa + y * ca) for x, y in poly]
        strokes.append((poly, 2.2, True))
        vein = [(cx + (base + (L - base) * u * 0.8) * ca, cy + (base + (L - base) * u * 0.8) * sa) for u in [0.15 + i * 0.05 for i in range(13)]]
        strokes.append((vein, 1.2, False))
    # Centro: disco relleno + anillo.
    disc = [(cx + 0.33 * R * math.cos(t / 50 * 2 * math.pi), cy + 0.33 * R * math.sin(t / 50 * 2 * math.pi)) for t in range(50)]
    fills.append(disc)
    ring = [(cx + 0.42 * R * math.cos(t / 60 * 2 * math.pi), cy + 0.42 * R * math.sin(t / 60 * 2 * math.pi)) for t in range(60)]
    strokes.append((ring, 2.5, True))

def leaf(x, y, ang, L, wdt):
    ca, sa = math.cos(ang), math.sin(ang)
    top = [(u * L, math.sin(u * math.pi) * wdt) for u in [i / 30 for i in range(31)]]
    poly = top + [(xx, -yy) for (xx, yy) in reversed(top[1:-1])]
    poly = [(x + px * ca - py * sa, y + px * sa + py * ca) for px, py in poly]
    strokes.append((poly, 2.2, True))
    mid = [(x + u * L * 0.9 * ca, y + u * L * 0.9 * sa) for u in [i / 20 for i in range(21)]]
    strokes.append((mid, 1.4, False))
    for j in range(1, 6):
        u = j / 6.5
        bx, by = x + u * L * ca, y + u * L * sa
        for s in (1, -1):
            ex = bx + (0.18 * L) * ca - s * (0.6 * wdt) * sa
            ey = by + (0.18 * L) * sa + s * (0.6 * wdt) * ca
            strokes.append(([(bx, by), (ex, ey)], 1.0, False))

ground = 1260
specs = [(330, 360, 150, 0.1), (760, 260, 175, 0.3), (560, 640, 120, -0.2)]
for (cx, cy, R, tilt) in specs:
    flower(cx, cy, R, tilt)
    # Tallo (doble línea).
    sx = cx + random.uniform(-30, 30)
    stem = bezier((cx, cy + 0.45 * R), (cx + 20, cy + 300), (sx - 40, ground - 300), (sx, ground))
    strokes.append((stem, 3.0, False))
    stem2 = [(x + 9, y) for x, y in stem]
    strokes.append((stem2, 1.6, False))
    t = random.uniform(0.35, 0.55)
    i = int(t * 60)
    lx, ly = stem[i]
    leaf(lx, ly, -0.6, 160, 45)
    lx, ly = stem[min(59, i + 14)]
    leaf(lx + 6, ly, math.pi + 0.5, 150, 42)
    # Raíces ramificadas.
    def root(x, y, ang, L, depth):
        if depth == 0 or L < 12:
            return
        ex = x + L * math.cos(ang); ey = y + L * math.sin(ang)
        mx = (x + ex) / 2 + random.uniform(-8, 8); my = (y + ey) / 2 + random.uniform(-4, 4)
        strokes.append((bezier((x, y), (mx, my), (mx, my), (ex, ey), 16), max(0.9, depth * 0.55), False))
        for _ in range(2):
            root(ex, ey, ang + random.uniform(-0.7, 0.7), L * 0.62, depth - 1)
    for a in (1.2, 1.57, 1.95):
        root(sx, ground, a + random.uniform(-0.15, 0.15), 70, 4)

# Línea de tierra y textura.
strokes.append(([(80, ground), (1120, ground)], 2.0, False))
for _ in range(40):
    x = random.uniform(100, 1100); y = ground + random.uniform(12, 40)
    strokes.append(([(x, y), (x + random.uniform(10, 30), y)], 1.0, False))

# --- SVG ---
def d_of(pts, closed):
    s = 'M' + ' L'.join(f'{x:.1f} {y:.1f}' for x, y in pts)
    return s + (' Z' if closed else '')
svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
       '<rect width="100%" height="100%" fill="#fff"/>',
       '<g fill="none" stroke="#111" stroke-linecap="round" stroke-linejoin="round">']
for pts, w, closed in strokes:
    svg.append(f'<path d="{d_of(pts, closed)}" stroke-width="{w}"/>')
svg.append('</g><g fill="#111">')
for pts in fills:
    svg.append(f'<path d="{d_of(pts, True)}"/>')
svg.append('</g></svg>')
open(f'{OUT}/girasoles.svg', 'w').write('\n'.join(svg))

# --- PNG (antialias por supermuestreo) ---
S = 4
img = Image.new('RGB', (W * S, H * S), 'white')
dr = ImageDraw.Draw(img)
for pts, w, closed in strokes:
    P = [(x * S, y * S) for x, y in pts] + ([(pts[0][0] * S, pts[0][1] * S)] if closed else [])
    dr.line(P, fill=(17, 17, 17), width=max(1, round(w * S)), joint='curve')
    r = w * S / 2
    for x, y in (P[0], P[-1]):
        dr.ellipse((x - r, y - r, x + r, y + r), fill=(17, 17, 17))
for pts in fills:
    dr.polygon([(x * S, y * S) for x, y in pts], fill=(17, 17, 17))
img.resize((W, H), Image.LANCZOS).save(f'{OUT}/girasoles.png')

# --- Esfera tonal sobre fondo degradé ---
W2, H2 = 1000, 800
im = Image.new('RGB', (W2, H2))
px = im.load()
for y in range(H2):
    for x in range(W2):
        bg = 0.85 - 0.35 * (y / H2)
        v = bg
        dx, dy = (x - 480) / 260, (y - 380) / 260
        rr = dx * dx + dy * dy
        if rr < 1:
            nz = math.sqrt(1 - rr)
            l = max(0, (-dx * 0.5 - dy * 0.6 + nz * 0.62))
            v = 0.08 + 0.85 * l ** 1.3
        else:
            sx, sy = (x - 560) / 300, (y - 650) / 70
            if sx * sx + sy * sy < 1:
                v *= 0.45 + 0.55 * (sx * sx + sy * sy)
        c = int(max(0, min(1, v)) * 255)
        px[x, y] = (c, int(c * 0.92), int(c * 0.8))
im.save(f'{OUT}/esfera.png')
print('ok')
