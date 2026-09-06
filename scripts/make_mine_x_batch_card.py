#!/usr/bin/env python3
"""Render a 20-block batch card: list of heights + rewards for X."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BACKGROUND = Path(
    "/home/box/agent-data/agents/a1322314-4240-4e8c-9b16-4500c572c283/assets/"
    "f711226d6d1c69630b62f649dfdda36ec8d8ec3e6a7191721b03d86485d3b89b.png"
)
DEFAULT_LOGO = ROOT / "site/public/10mmLogo.png"
DEFAULT_OUTPUT = ROOT / "site/public/x-mine-card-latest.png"
FONT_DIR = Path("/usr/share/fonts/truetype/dejavu")


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    for candidate in (FONT_DIR / name, Path("/usr/share/fonts/truetype/liberation2") / name):
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def cover(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    scale = max(size[0] / image.width, size[1] / image.height)
    resized = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    left = (resized.width - size[0]) // 2
    top = (resized.height - size[1]) // 2
    return resized.crop((left, top, left + size[0], top + size[1])).convert("RGBA")


def short_addr(addr: str) -> str:
    a = addr or ""
    if len(a) < 12:
        return a or "—"
    return f"{a[:6]}…{a[-4:]}"


def short_digest(d: str) -> str:
    d = d or ""
    if len(d) < 12:
        return d or "—"
    return f"{d[:8]}…{d[-4:]}"


def make_batch_card(
    entries: list[dict],
    window_start: int,
    window_end: int,
    output_paths: Iterable[Path],
    background_path: Path = DEFAULT_BACKGROUND,
    logo_path: Path = DEFAULT_LOGO,
) -> None:
    W, H = 1600, 900
    image = cover(Image.open(background_path), (W, H))
    shade = Image.new("RGBA", (W, H), (2, 10, 22, 210))
    image.alpha_composite(shade)

    draw = ImageDraw.Draw(image)
    # panel
    panel = (48, 48, 1552, 852)
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.rounded_rectangle(panel, radius=28, fill=(6, 18, 36, 230), outline=(40, 180, 255, 160), width=2)
    image.alpha_composite(overlay)
    draw = ImageDraw.Draw(image)

    title_f = font("DejaVuSans-Bold.ttf", 42)
    sub_f = font("DejaVuSans.ttf", 22)
    row_f = font("DejaVuSans.ttf", 20)
    row_b = font("DejaVuSans-Bold.ttf", 20)
    tiny = font("DejaVuSans.ttf", 16)

    total = 0.0
    for e in entries:
        try:
            total += float(e.get("amount_10mm") or 0)
        except Exception:
            pass

    draw.text((80, 72), "10MinMine · 20-block batch", font=title_f, fill=(240, 248, 255, 255))
    draw.text(
        (80, 128),
        f"Heights {window_start}–{window_end}  ·  +{total:g} 10MM  ·  Sui mainnet",
        font=sub_f,
        fill=(140, 200, 230, 230),
    )

    if logo_path.exists():
        logo = Image.open(logo_path).convert("RGBA")
        logo.thumbnail((72, 72), Image.Resampling.LANCZOS)
        image.alpha_composite(logo, (1440, 70))

    # header row
    y0 = 180
    draw.text((80, y0), "Height", font=row_b, fill=(100, 190, 255, 255))
    draw.text((220, y0), "Reward", font=row_b, fill=(100, 190, 255, 255))
    draw.text((420, y0), "Rewarded", font=row_b, fill=(100, 190, 255, 255))
    draw.text((820, y0), "Tx", font=row_b, fill=(100, 190, 255, 255))
    draw.line((80, y0 + 32, 1520, y0 + 32), fill=(40, 120, 180, 120), width=1)

    # map by height for full window; show all known in range
    by_h = {int(e["height"]): e for e in entries if "height" in e}
    y = y0 + 44
    row_h = 28
    max_rows = 20
    for i, h in enumerate(range(window_start, window_end + 1)):
        if i >= max_rows:
            break
        e = by_h.get(h)
        if e:
            amt = str(e.get("amount_10mm") or "50")
            rewarded = e.get("rewarded") or []
            if rewarded and isinstance(rewarded, list) and rewarded:
                who = short_addr(str(rewarded[0].get("address", "")))
                ramt = rewarded[0].get("amount_10mm", amt)
                rew = f"{who} · {ramt} 10MM"
            else:
                rew = f"0x5818…4d0a · {amt} 10MM"
            dig = short_digest(str(e.get("digest") or ""))
            color = (230, 240, 250, 255)
        else:
            amt = "—"
            rew = "(no local log entry)"
            dig = "—"
            color = (120, 140, 160, 200)
        draw.text((80, y), str(h), font=row_b, fill=color)
        draw.text((220, y), f"{amt} 10MM" if amt != "—" else "—", font=row_f, fill=color)
        draw.text((420, y), rew, font=row_f, fill=color)
        draw.text((820, y), dig, font=row_f, fill=color)
        y += row_h

    draw.text(
        (80, 820),
        "https://2secsui.github.io/10MinMine/site/   ·   50 10MM / block",
        font=tiny,
        fill=(120, 170, 200, 200),
    )

    for output in output_paths:
        output = Path(output)
        output.parent.mkdir(parents=True, exist_ok=True)
        image.convert("RGB").save(output, format="PNG", optimize=True)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--log", type=Path, required=True, help="mine-log.json path")
    p.add_argument("--start", type=int, required=True)
    p.add_argument("--end", type=int, required=True)
    p.add_argument("--output", type=Path, nargs="+", default=[DEFAULT_OUTPUT])
    p.add_argument("--background", type=Path, default=DEFAULT_BACKGROUND)
    p.add_argument("--logo", type=Path, default=DEFAULT_LOGO)
    args = p.parse_args()
    log = json.loads(args.log.read_text()) if args.log.exists() else []
    entries = [e for e in log if args.start <= int(e.get("height", -1)) <= args.end]
    make_batch_card(entries, args.start, args.end, args.output, args.background, args.logo)
    print(f"batch card rows={len(entries)} heights={args.start}-{args.end}", flush=True)


if __name__ == "__main__":
    main()
