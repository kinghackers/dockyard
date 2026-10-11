# -*- coding: utf-8 -*-
"""Fix icon corners: cut the opaque white corners outside the rounded card.

Measures the card inset & corner radius from the source image, then applies
an anti-aliased rounded-rect alpha mask (4x supersampled) and regenerates
build/icon.png (1024) + build/icon.ico (16..256 frames).
"""
from PIL import Image, ImageDraw
import struct

SRC = 'build/icon.png'
PNG_OUT = 'build/icon.png'
ICO_OUT = 'build/icon.ico'

img = Image.open(SRC)
print('source:', img.mode, img.size)
img = img.convert('RGBA')
W, H = img.size
px = img.load()

def first_non_white(scan):
    for i, (r, g, b, a) in enumerate(scan):
        if r < 245 or g < 245 or b < 245:
            return i
    return -1

row_mid = [px[x, H // 2] for x in range(W)]
col_mid = [px[W // 2, y] for y in range(H)]

left = first_non_white(row_mid)
right = W - 1 - first_non_white(row_mid[::-1])
top = first_non_white(col_mid)
bottom = H - 1 - first_non_white(col_mid[::-1])
print(f'card bounds: left={left} top={top} right={right} bottom={bottom}')

# corner radius: on row y=top, the arc starts at x = left + r
arc_x = first_non_white([px[x, top + 1] for x in range(W)])
r = arc_x - left
print(f'corner radius r={r} (arc_x={arc_x})')

# 4x supersampled AA mask
S = 4
mask = Image.new('L', (W * S, H * S), 0)
d = ImageDraw.Draw(mask)
d.rounded_rectangle(
    [left * S, top * S, (right + 1) * S - 1, (bottom + 1) * S - 1],
    radius=r * S, fill=255,
)
mask = mask.resize((W, H), Image.LANCZOS)

img.putalpha(mask)
img.save(PNG_OUT)
print('saved', PNG_OUT)

# multi-size .ico (Pillow resizes with LANCZOS internally)
img.save(ICO_OUT, sizes=[(16, 16), (24, 24), (32, 32), (48, 48),
                         (64, 64), (128, 128), (256, 256)])
print('saved', ICO_OUT)

# ---- verify ----
chk = Image.open(PNG_OUT).convert('RGBA')
c = chk.load()
print('verify png: corner(2,2) alpha =', c[2, 2][3],
      '| corner(w-3,2) alpha =', c[W - 3, 2][3],
      '| edge-in(left+6,mid) alpha =', c[left + 6, H // 2][3],
      '| center alpha =', c[W // 2, H // 2][3])

raw = open(ICO_OUT, 'rb').read()
res, typ, cnt = struct.unpack('<HHH', raw[:6])
print(f'verify ico: {cnt} frames')
ok = True
for i in range(cnt):
    w, h, cc, rr, planes, bc, size, off = struct.unpack('<BBBBHHII', raw[6 + i * 16:22 + i * 16])
    w = w or 256; h = h or 256
    print(f'  {w}x{h} bytes={size} png={raw[off:off+4] == bytes([0x89, 0x50, 0x4E, 0x47])}')

# decode 256 frame and check its corners too
ico_img = Image.open(ICO_OUT)
ico_img.load()
big = ico_img  # Pillow opens largest frame by default
bp = big.convert('RGBA').load()
bw, bh = big.size
corners = [bp[1, 1][3], bp[bw - 2, 1][3], bp[1, bh - 2][3], bp[bw - 2, bh - 2][3]]
print(f'verify ico largest frame {big.size}: corner alphas = {corners}')
print('DONE')
