#!/usr/bin/env python3
"""Generate docs/assets/social-preview.png — the 1280x640 card GitHub renders
when the repo link is shared anywhere (Settings → Social preview upload).

Static raster on purpose: og:image contexts don't run CSS. Same monochrome
taste as the banner (black bg, white lockup, emblem on its white tile —
no color, no gradients). Emblem crop logic mirrors gen-banner.py.
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFont

SRC = "synthetic-nature/public/android-chrome-512x512.png"
OUT = "docs/assets/social-preview.png"

W, H = 1280, 640
BG = (13, 17, 23, 255)          # #0d1117 — GitHub dark
WHITE = (230, 237, 240, 255)    # #e6edf0
DIM = (139, 148, 158, 255)      # #8b949e
FAINT = (90, 100, 110, 255)
TILE, RX = 132, 30
FONT_BOLD = "/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf"


def mark_img(size: int) -> Image.Image:
    im = Image.open(SRC).convert("RGBA")
    # crop the emblem out of the icon's light-gray plate (see gen-banner.py)
    a = np.array(im)
    alpha = a[:, :, 3] > 128
    lum = a[:, :, :3].mean(axis=2)
    colorful = (a[:, :, :3].max(axis=2).astype(int)
                - a[:, :, :3].min(axis=2).astype(int)) > 24
    mask = alpha & ((lum < 165) | colorful)
    ys, xs = np.where(mask)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    pad = 6
    box = (max(0, x0 - pad), max(0, y0 - pad),
           min(im.width, x1 + pad), min(im.height, y1 + pad))
    cropped = im.crop(box)
    return cropped.resize((size, size), Image.LANCZOS)


def build() -> None:
    im = Image.new("RGBA", (W, H), BG)
    d = ImageDraw.Draw(im)

    # white tile + emblem, centered, upper third
    tile_x, tile_y = (W - TILE) // 2, 74
    d.rounded_rectangle([tile_x, tile_y, tile_x + TILE, tile_y + TILE],
                        radius=RX, fill=(255, 255, 255, 255))
    mark = mark_img(TILE - 24)
    im.alpha_composite(mark, (tile_x + 12, tile_y + 12))

    def centered(text: str, font: ImageFont.FreeTypeFont, y: int, fill) -> None:
        bb = d.textbbox((0, 0), text, font=font)
        d.text(((W - (bb[2] - bb[0])) // 2 - bb[0], y), text, font=font, fill=fill)

    wordmark = ImageFont.truetype(FONT_BOLD, 168)
    tagline = ImageFont.truetype(FONT_BOLD, 44)
    subline = ImageFont.truetype(FONT_BOLD, 26)

    centered("ENZO", wordmark, tile_y + TILE + 34, WHITE)
    centered("The AI workspace with no middleman", tagline, tile_y + TILE + 34 + 186, WHITE)
    centered("300+ models  ·  bring your own keys  ·  self-hosted  ·  Apache-2.0",
             subline, tile_y + TILE + 34 + 186 + 66, DIM)

    im.convert("RGB").save(OUT, "PNG", optimize=True)
    print(f"{OUT} written ({W}x{H})")


if __name__ == "__main__":
    build()
