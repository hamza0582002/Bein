#!/usr/bin/env python3
"""Generate the app icons (three books on a warm background).

Run with:  python3 tools/make-icons.py
Writes PNGs into public/ and, when present, the Android res folders.
"""

import os
from PIL import Image, ImageDraw

OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'public')

BG_TOP = (72, 44, 26)
BG_BOTTOM = (26, 16, 10)
BOOKS = [
    ((226, 168, 112), (194, 112, 58)),
    ((253, 246, 236), (214, 198, 176)),
    ((201, 126, 74), (150, 84, 44)),
]


def rounded_mask(size, radius):
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius, fill=255)
    return mask


def make(size, padding_ratio=0.0):
    image = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    # Vertical gradient background.
    for y in range(size):
        ratio = y / max(1, size - 1)
        colour = tuple(
            int(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * ratio) for i in range(3)
        )
        draw.line([(0, y), (size, y)], fill=colour + (255,))

    inset = int(size * padding_ratio)
    area = size - inset * 2
    book_width = area * 0.17
    gap = area * 0.075
    total = book_width * 3 + gap * 2
    left = inset + (area - total) / 2
    top = inset + area * 0.2
    bottom = inset + area * 0.82

    for index, (light, dark) in enumerate(BOOKS):
        x0 = left + index * (book_width + gap)
        # Slightly different heights, like books on a real shelf.
        offset = [0, -area * 0.05, area * 0.03][index]
        draw.rounded_rectangle(
            [x0, top + offset, x0 + book_width, bottom],
            radius=max(2, int(book_width * 0.16)),
            fill=light,
        )
        draw.rounded_rectangle(
            [x0, bottom - area * 0.06, x0 + book_width, bottom],
            radius=max(2, int(book_width * 0.16)),
            fill=dark,
        )

    # Shelf plank.
    draw.rounded_rectangle(
        [inset + area * 0.08, bottom, inset + area * 0.92, bottom + area * 0.07],
        radius=max(2, int(area * 0.02)),
        fill=(122, 80, 48),
    )

    image.putalpha(rounded_mask(size, int(size * 0.22)))
    return image


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in (192, 512):
        make(size).save(os.path.join(OUT_DIR, f'icon-{size}.png'))
    # Square (non-rounded) variant used as the Android adaptive foreground.
    full = make(1024, padding_ratio=0.14)
    full.save(os.path.join(OUT_DIR, 'icon-1024.png'))
    print('icons written to', os.path.normpath(OUT_DIR))


if __name__ == '__main__':
    main()
