import zlib
import struct
from pathlib import Path


def chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path: Path, size: int, rgb_at) -> None:
    rows = []
    for y in range(size):
        row = bytearray()
        row.append(0)
        for x in range(size):
            row.extend(rgb_at(x, y, size))
        rows.append(bytes(row))
    raw = b"".join(rows)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)


def lerp(a, b, t):
    return int(a + (b - a) * t)


def icon_color(x, y, size):
    ink = (19, 41, 61)
    paper = (246, 241, 228)
    saffron = (224, 164, 55)
    nx = x / (size - 1)
    ny = y / (size - 1)
    radius = ((nx - 0.5) ** 2 + (ny - 0.5) ** 2) ** 0.5
    if radius > 0.48:
        return (232, 238, 244)
    if radius > 0.42:
        return ink

    # open-book pages
    if 0.28 < ny < 0.72 and 0.22 < nx < 0.78:
        spine = abs(nx - 0.5)
        if spine < 0.03:
            return ink
        shade = lerp(255, 230, spine * 2.2)
        if 0.66 < ny < 0.70:
            return saffron
        return (shade, shade - 4, shade - 16)

    return ink


def main():
    out = Path(__file__).resolve().parents[1] / "icons"
    out.mkdir(exist_ok=True)
    for size in (16, 48, 128):
        write_png(out / f"icon{size}.png", size, icon_color)
    print("icons generated")


if __name__ == "__main__":
    main()
