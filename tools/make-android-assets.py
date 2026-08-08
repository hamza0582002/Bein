#!/usr/bin/env python3
"""Generate the Android launcher icons and splash screens.

Run after `npx cap add android` (or whenever the artwork changes):
    python3 tools/make-android-assets.py
"""

import os
from PIL import Image, ImageDraw

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))
RES = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')

BG_TOP = (72, 44, 26)
BG_BOTTOM = (26, 16, 10)
PLANK = (122, 80, 48)
BOOKS = [
    ((226, 168, 112), (194, 112, 58)),
    ((253, 246, 236), (214, 198, 176)),
    ((201, 126, 74), (150, 84, 44)),
]

LAUNCHER_SIZES = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
# Adaptive foregrounds are 108dp; only the middle 72dp is guaranteed visible.
FOREGROUND_SIZES = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}
SPLASH_PORT = {'mdpi': (320, 480), 'hdpi': (480, 800), 'xhdpi': (720, 1280),
               'xxhdpi': (960, 1600), 'xxxhdpi': (1280, 1920)}
SPLASH_LAND = {name: (h, w) for name, (w, h) in SPLASH_PORT.items()}


def gradient(size, vertical=True):
    width, height = size
    image = Image.new('RGBA', size)
    draw = ImageDraw.Draw(image)
    span = height if vertical else width
    for i in range(span):
        ratio = i / max(1, span - 1)
        colour = tuple(int(BG_TOP[c] + (BG_BOTTOM[c] - BG_TOP[c]) * ratio) for c in range(3))
        if vertical:
            draw.line([(0, i), (width, i)], fill=colour + (255,))
        else:
            draw.line([(i, 0), (i, height)], fill=colour + (255,))
    return image


def draw_books(draw, cx, cy, scale):
    """Three books on a plank, centred on (cx, cy)."""
    book_width = 0.17 * scale
    gap = 0.075 * scale
    top = cy - 0.30 * scale
    bottom = cy + 0.30 * scale
    total = book_width * 3 + gap * 2
    left = cx - total / 2

    for index, (light, dark) in enumerate(BOOKS):
        x0 = left + index * (book_width + gap)
        offset = [0, -0.05 * scale, 0.03 * scale][index]
        radius = max(2, int(book_width * 0.16))
        draw.rounded_rectangle([x0, top + offset, x0 + book_width, bottom], radius=radius, fill=light)
        draw.rounded_rectangle([x0, bottom - 0.06 * scale, x0 + book_width, bottom], radius=radius, fill=dark)

    draw.rounded_rectangle(
        [cx - 0.42 * scale, bottom, cx + 0.42 * scale, bottom + 0.07 * scale],
        radius=max(2, int(0.02 * scale)),
        fill=PLANK,
    )


def rounded_mask(size, radius):
    mask = Image.new('L', size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius, fill=255)
    return mask


def circle_mask(size):
    mask = Image.new('L', size, 0)
    ImageDraw.Draw(mask).ellipse([0, 0, size[0] - 1, size[1] - 1], fill=255)
    return mask


def launcher(size, shape):
    image = gradient((size, size))
    draw_books(ImageDraw.Draw(image), size / 2, size / 2, size)
    if shape == 'round':
        image.putalpha(circle_mask((size, size)))
    else:
        image.putalpha(rounded_mask((size, size), int(size * 0.22)))
    return image


def foreground(size):
    """Transparent background, artwork inside the adaptive safe zone."""
    image = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw_books(ImageDraw.Draw(image), size / 2, size / 2, size * 0.62)
    return image


def splash(size):
    image = gradient(size, vertical=True)
    draw = ImageDraw.Draw(image)
    scale = min(size) * 0.42
    draw_books(draw, size[0] / 2, size[1] / 2, scale)
    return image


def write(image, *path):
    target = os.path.join(RES, *path)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    image.save(target)


def main():
    for density, size in LAUNCHER_SIZES.items():
        write(launcher(size, 'square'), f'mipmap-{density}', 'ic_launcher.png')
        write(launcher(size, 'round'), f'mipmap-{density}', 'ic_launcher_round.png')
    for density, size in FOREGROUND_SIZES.items():
        write(foreground(size), f'mipmap-{density}', 'ic_launcher_foreground.png')
    for density, size in SPLASH_PORT.items():
        write(splash(size), f'drawable-port-{density}', 'splash.png')
    for density, size in SPLASH_LAND.items():
        write(splash(size), f'drawable-land-{density}', 'splash.png')
    write(splash(SPLASH_PORT['xhdpi']), 'drawable', 'splash.png')

    # Background colour behind the adaptive icon.
    colours = os.path.join(RES, 'values', 'ic_launcher_background.xml')
    os.makedirs(os.path.dirname(colours), exist_ok=True)
    with open(colours, 'w', encoding='utf-8') as handle:
        handle.write(
            '<?xml version="1.0" encoding="utf-8"?>\n'
            '<resources>\n    <color name="ic_launcher_background">#2A1A0F</color>\n</resources>\n'
        )
    # Capacitor ships a drawable of the same name; two definitions clash.
    stale = os.path.join(RES, 'drawable', 'ic_launcher_background.xml')
    if os.path.exists(stale):
        os.remove(stale)

    print('android assets written to', RES)


if __name__ == '__main__':
    main()
