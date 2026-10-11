# -*- coding: utf-8 -*-
"""Fix icon corners: remove the opaque white background around the rounded card.

Pipeline (conforms to the card's ACTUAL contour, handles grazing-angle AA):
1. Flood-fill the near-white background from the four canvas corners with a
   sentinel color (tight threshold) -> base alpha mask of the card.
2. Erode 1px (MinFilter 3) to drop the hard white fringe.
3. Decontaminate the boundary band: near the contour the source blends card
   color into white over many pixels (grazing-angle AA at corner/edge
   tangents). For band pixels brighter than the card color, recover the true
   coverage as alpha = (245 - lum) / (245 - lum_card); dark pixels stay opaque.
4. Slight blur of the alpha channel for a smooth edge.

Regenerates build/icon.png (1024) + build/icon.ico (16..256 frames).

Usage: python scripts/fix-icon-corners.py <source-png>
"""
import sys
from PIL import Image, ImageDraw, ImageFilter

SRC = sys.argv[1] if len(sys.argv) > 1 else 'build/.icon-orig.tmp.png'
PNG_OUT = 'build/icon.png'
ICO_OUT = 'build/icon.ico'
SENTINEL = (255, 0, 255, 255)
L_CARD, L_WHITE = 40, 245  # card luminance ~36-40, background ~250-255


def lum(p):
    return (p[0] * 299 + p[1] * 587 + p[2] * 114) // 1000


img = Image.open(SRC).convert('RGBA')
W, H = img.size
print('source:', img.mode, img.size)

# 1) flood-fill background from the 4 corners
for seed in [(0, 0), (W - 1, 0), (0, H - 1), (W - 1, H - 1)]:
    ImageDraw.floodfill(img, seed, SENTINEL, thresh=45)

mask = Image.new('L', (W, H), 255)
mp = mask.load()
ip = img.load()
filled = 0
for y in range(H):
    for x in range(W):
        if ip[x, y] == SENTINEL:
            mp[x, y] = 0
            filled += 1
print(f'background pixels flooded: {filled} ({100.0 * filled / (W * H):.1f}%)')

# 2) erode 1px to drop the hard white fringe
mask = mask.filter(ImageFilter.MinFilter(3))

# 3) decontaminate the boundary band (alpha from luminance)
out = Image.open(SRC).convert('RGBA')  # pristine RGB, no sentinel
op = out.load()
prox = mask.filter(ImageFilter.GaussianBlur(18))
qp = prox.load()
touched = 0
for y in range(H):
    for x in range(W):
        if mp[x, y] == 0:
            continue
        if qp[x, y] >= 250:  # far from the contour
            continue
        p = op[x, y]
        l = lum(p)
        if l > L_CARD + 20:  # brighter than the card -> white blend
            a = (L_WHITE - l) * 255 // (L_WHITE - L_CARD)
            a = max(0, min(255, a))
            op[x, y] = (p[0], p[1], p[2], a)
            touched += 1
print(f'decontaminated pixels: {touched}')

# 4) smooth the alpha channel: final = min(decontaminated alpha, soft mask)
from PIL import ImageChops
mask_soft = mask.filter(ImageFilter.GaussianBlur(1.0))
final_alpha = ImageChops.darker(out.getchannel('A'), mask_soft)
out.putalpha(final_alpha)
out.save(PNG_OUT)
out.save(ICO_OUT, sizes=[(16, 16), (24, 24), (32, 32), (48, 48),
                         (64, 64), (128, 128), (256, 256)])
print('saved', PNG_OUT, 'and', ICO_OUT)

# ---- verify: outermost 8px ring must contain no bright (semi-)opaque pixel ----
chk = Image.open(PNG_OUT).convert('RGBA')
cp = chk.load()
bad = []
belt = 8
for y in range(H):
    for x in range(W):
        if x < belt or x >= W - belt or y < belt or y >= H - belt:
            p = cp[x, y]
            if p[3] >= 200 and lum(p) > 110:
                bad.append((x, y, p))
print('rim check (outer 8px ring):', 'OK' if not bad else f'FAIL {bad[:5]}')
corners = [cp[2, 2][3], cp[W - 3, 2][3], cp[2, H - 3][3], cp[W - 3, H - 3][3]]
print('png corner alphas:', corners)
ico = Image.open(ICO_OUT)
ico.load()
ip2 = ico.convert('RGBA').load()
iw, ih = ico.size
print(f'ico largest frame {ico.size} corner alphas:',
      [ip2[1, 1][3], ip2[iw - 2, 1][3], ip2[1, ih - 2][3], ip2[iw - 2, ih - 2][3]])
print('DONE')
