#!/usr/bin/env python3

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
DESKTOP_ICONS = ROOT / "apps" / "desktop" / "src-tauri" / "icons"
EXTENSION_ICONS = ROOT / "apps" / "extension" / "icons"

CANVAS = 1024
OUTPUT_SIZES = {
    "extension_16": 16,
    "extension_48": 48,
    "extension_128": 128,
    "icon_16x16": 16,
    "icon_16x16@2x": 32,
    "icon_32x32": 32,
    "icon_32x32@2x": 64,
    "icon_128x128": 128,
    "icon_128x128@2x": 256,
    "icon_256x256": 256,
    "icon_256x256@2x": 512,
    "icon_512x512": 512,
    "icon_512x512@2x": 1024,
}


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def mix_color(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return (
        round(lerp(a[0], b[0], t)),
        round(lerp(a[1], b[1], t)),
        round(lerp(a[2], b[2], t)),
    )


def gradient_color(stops: list[tuple[float, tuple[int, int, int]]], t: float) -> tuple[int, int, int]:
    if t <= stops[0][0]:
        return stops[0][1]
    if t >= stops[-1][0]:
        return stops[-1][1]

    for index in range(len(stops) - 1):
        start_t, start_color = stops[index]
        end_t, end_color = stops[index + 1]
        if start_t <= t <= end_t:
            local_t = (t - start_t) / (end_t - start_t)
            return mix_color(start_color, end_color, local_t)

    return stops[-1][1]


def diagonal_gradient(size: int) -> Image.Image:
    gradient = Image.new("RGBA", (size, size))
    pixels = gradient.load()
    stops = [
        (0.0, (6, 15, 30)),
        (0.45, (24, 74, 205)),
        (1.0, (85, 197, 255)),
    ]
    max_index = size - 1

    for y in range(size):
        for x in range(size):
            t = ((x / max_index) * 0.55) + ((y / max_index) * 0.45)
            pixels[x, y] = (*gradient_color(stops, min(1.0, t)), 255)

    return gradient


def rounded_mask(size: int, inset: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((inset, inset, size - inset, size - inset), radius=radius, fill=255)
    return mask


def blur_ellipse(size: int, bounds: tuple[int, int, int, int], fill: tuple[int, int, int, int], blur: int) -> Image.Image:
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    draw.ellipse(bounds, fill=fill)
    return layer.filter(ImageFilter.GaussianBlur(blur))


def build_background(size: int) -> Image.Image:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.rounded_rectangle((116, 136, size - 44, size - 24), radius=238, fill=(0, 0, 0, 118))
    shadow = shadow.filter(ImageFilter.GaussianBlur(54))
    image.alpha_composite(shadow)

    shell_mask = rounded_mask(size, 84, 224)
    shell = diagonal_gradient(size)
    image.paste(shell, (0, 0), shell_mask)

    image.alpha_composite(
        blur_ellipse(size, (86, 60, 516, 420), (255, 255, 255, 104), 72)
    )
    image.alpha_composite(
        blur_ellipse(size, (520, 520, 1024, 1040), (85, 228, 255, 68), 96)
    )
    image.alpha_composite(
        blur_ellipse(size, (220, 300, 860, 980), (5, 14, 30, 72), 118)
    )

    overlay = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    overlay_draw = ImageDraw.Draw(overlay)
    overlay_draw.rounded_rectangle(
        (84, 84, size - 84, size - 84),
        radius=224,
        outline=(255, 255, 255, 46),
        width=6,
    )
    overlay_draw.rounded_rectangle(
        (120, 120, size - 120, size - 120),
        radius=192,
        outline=(255, 255, 255, 22),
        width=2,
    )
    image.alpha_composite(overlay)

    return image


def build_glyph(size: int) -> Image.Image:
    glyph = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    page_shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    page_shadow_draw = ImageDraw.Draw(page_shadow)
    page_shadow_draw.rounded_rectangle((292, 252, 736, 806), radius=102, fill=(2, 10, 24, 60))
    page_shadow = page_shadow.filter(ImageFilter.GaussianBlur(32))
    glyph.alpha_composite(page_shadow)

    page = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    page_draw = ImageDraw.Draw(page)
    page_draw.rounded_rectangle((296, 244, 728, 792), radius=102, fill=(246, 250, 255, 248))
    page_draw.rounded_rectangle((388, 166, 636, 292), radius=56, fill=(246, 250, 255, 255))
    page_draw.rounded_rectangle((432, 206, 592, 248), radius=21, fill=(207, 221, 244, 210))
    page_draw.rounded_rectangle((296, 244, 728, 792), radius=102, outline=(255, 255, 255, 118), width=4)

    bars = [
        (374, 394, 438, 676, (15, 55, 170, 255)),
        (480, 394, 544, 676, (28, 95, 221, 255)),
        (586, 394, 650, 676, (47, 137, 255, 255)),
    ]
    for left, top, right, bottom, color in bars:
        page_draw.rounded_rectangle((left, top, right, bottom), radius=30, fill=color)
        page_draw.rounded_rectangle((left, top, right, top + 42), radius=30, fill=(255, 255, 255, 36))

    page_draw.rounded_rectangle((366, 714, 658, 742), radius=14, fill=(213, 224, 244, 172))
    glyph.alpha_composite(page)

    spark = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    spark_draw = ImageDraw.Draw(spark)
    spark_draw.ellipse((668, 222, 736, 290), fill=(108, 237, 255, 222))
    spark_draw.ellipse((720, 174, 756, 210), fill=(255, 255, 255, 164))
    spark = spark.filter(ImageFilter.GaussianBlur(4))
    glyph.alpha_composite(spark)

    return glyph


def build_master_icon(size: int = CANVAS) -> Image.Image:
    icon = build_background(size)
    icon.alpha_composite(build_glyph(size))
    return icon


def save_desktop_assets(master: Image.Image) -> None:
    DESKTOP_ICONS.mkdir(parents=True, exist_ok=True)
    desktop_png = DESKTOP_ICONS / "icon.png"
    desktop_ico = DESKTOP_ICONS / "icon.ico"
    desktop_icns = DESKTOP_ICONS / "icon.icns"

    master.save(desktop_png)
    master.save(
        desktop_ico,
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )

    with tempfile.TemporaryDirectory() as temp_dir_name:
        iconset_dir = Path(temp_dir_name) / "icon.iconset"
        iconset_dir.mkdir(parents=True, exist_ok=True)

        for name, size in OUTPUT_SIZES.items():
            if not name.startswith("icon_"):
                continue
            resized = master.resize((size, size), Image.Resampling.LANCZOS)
            resized.save(iconset_dir / f"{name}.png")

        subprocess.run(
            ["iconutil", "-c", "icns", str(iconset_dir), "-o", str(desktop_icns)],
            check=True,
        )


def save_extension_assets(master: Image.Image) -> None:
    EXTENSION_ICONS.mkdir(parents=True, exist_ok=True)
    for name, size in (("icon-16.png", 16), ("icon-48.png", 48), ("icon-128.png", 128)):
        resized = master.resize((size, size), Image.Resampling.LANCZOS)
        resized.save(EXTENSION_ICONS / name)


def main() -> None:
    master = build_master_icon()
    save_desktop_assets(master)
    save_extension_assets(master)
    print("Generated ClipForge desktop and extension icons.")


if __name__ == "__main__":
    main()
