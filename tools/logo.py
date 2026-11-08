# Flat Hisaab logo: a round roti with one slice pulled out = "your share".
# Reads as food and as a pie chart (money split), and stays clear at small sizes.
from PIL import Image, ImageDraw
import math
GREEN = (30, 107, 88, 255)      # #1E6B58
ROTI = (247, 241, 230, 255)     # warm off-white
SHARE = (242, 190, 92, 255)     # saffron: the slice that is "yours"

def mark(d, cx, cy, r, color=ROTI, share=SHARE, pull=None, start=-80, sweep=100):
    pull = r * 0.16 if pull is None else pull
    # body: everything except the slice
    d.pieslice([cx - r, cy - r, cx + r, cy + r], start + sweep, start + 360, fill=color)
    # the pulled-out slice, moved outward along its middle angle
    mid = math.radians(start + sweep / 2)
    ox, oy = math.cos(mid) * pull, math.sin(mid) * pull
    d.pieslice([cx - r + ox, cy - r + oy, cx + r + ox, cy + r + oy], start, start + sweep, fill=share)

def icon(px, shape="square", r_frac=0.27, transparent=False):
    S = px * 4
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    if shape == "square": d.rounded_rectangle([0, 0, S - 1, S - 1], radius=S * 0.23, fill=GREEN)
    elif shape == "circle": d.ellipse([0, 0, S - 1, S - 1], fill=GREEN)
    elif shape == "full": d.rectangle([0, 0, S, S], fill=GREEN)
    cx, cy = S / 2 - S * 0.02, S / 2 + S * 0.02     # nudge so the whole mark looks centred
    if transparent:
        mark(d, cx, cy, S * r_frac, color=(255, 255, 255, 255), share=(255, 255, 255, 255))
    else:
        mark(d, cx, cy, S * r_frac)
    return im.resize((px, px), Image.LANCZOS)

if __name__ == "__main__":
    sheet = Image.new("RGB", (1180, 420), (245, 245, 242))
    big = icon(360); sheet.paste(big, (30, 30), big)
    for (img, pos) in [(icon(180, "circle"), (420, 30)), (icon(96), (420, 250)), (icon(48), (540, 274)), (icon(96, None, transparent=True), (610, 250))]:
        sheet.paste(img, pos, img)
    dark = Image.new("RGB", (480, 360), (28, 28, 30))
    for i, px in enumerate([144, 96, 64]):
        ic = icon(px); dark.paste(ic, (30 + i * 160, 100), ic)
    sheet.paste(dark, (670, 30)); sheet.save("preview-sheet.png"); print("ok")
