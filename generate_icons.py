"""Generate simple PNG icons for the TruthLens Chrome extension."""
import struct
import zlib
import os

def create_png(width, height, pixels):
    """Create a PNG file from raw RGBA pixel data."""
    def make_chunk(chunk_type, data):
        chunk = chunk_type + data
        crc = struct.pack('>I', zlib.crc32(chunk) & 0xFFFFFFFF)
        return struct.pack('>I', len(data)) + chunk + crc

    # PNG signature
    signature = b'\x89PNG\r\n\x1a\n'

    # IHDR chunk
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    ihdr = make_chunk(b'IHDR', ihdr_data)

    # IDAT chunk - raw pixel data with filter byte
    raw_data = b''
    for y in range(height):
        raw_data += b'\x00'  # filter: none
        for x in range(width):
            idx = (y * width + x) * 4
            raw_data += bytes(pixels[idx:idx + 4])

    compressed = zlib.compress(raw_data)
    idat = make_chunk(b'IDAT', compressed)

    # IEND chunk
    iend = make_chunk(b'IEND', b'')

    return signature + ihdr + idat + iend

def draw_icon(size):
    """Draw a magnifying glass icon on a transparent background."""
    pixels = [0, 0, 0, 0] * (size * size)
    cx, cy = size // 2, size // 2
    radius = int(size * 0.35)
    handle_length = int(size * 0.28)
    handle_width = max(2, int(size * 0.08))

    color = (79, 70, 229, 255)  # Indigo accent color
    darker = (67, 56, 202, 255)

    def set_pixel(x, y, r, g, b, a):
        if 0 <= x < size and 0 <= y < size:
            idx = (y * size + x) * 4
            pixels[idx] = r
            pixels[idx + 1] = g
            pixels[idx + 2] = b
            pixels[idx + 3] = a

    # Draw circle (magnifying glass lens)
    for y in range(size):
        for x in range(size):
            dx = x - (cx - int(size * 0.12))
            dy = y - (cy - int(size * 0.12))
            dist = (dx * dx + dy * dy) ** 0.5
            if dist <= radius:
                # Fill with color, make border slightly different
                if dist >= radius - max(1, size // 32):
                    set_pixel(x, y, *darker)
                else:
                    set_pixel(x, y, *color)

    # Draw handle line (diagonal from bottom-right of circle)
    handle_start_x = int(cx + radius * 0.7)
    handle_start_y = int(cy + radius * 0.7)
    angle = 0.785  # 45 degrees in radians
    dx = int(handle_length * 0.707)
    dy = int(handle_length * 0.707)

    for t in range(handle_length):
        hx = handle_start_x + int(t * 0.707)
        hy = handle_start_y + int(t * 0.707)
        for w in range(-handle_width // 2, handle_width // 2 + 1):
            set_pixel(hx + w, hy, *darker)

    return pixels

def main():
    icons_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'icons')
    os.makedirs(icons_dir, exist_ok=True)

    sizes = [16, 48, 128]
    for size in sizes:
        pixels = draw_icon(size)
        png_data = create_png(size, size, pixels)
        path = os.path.join(icons_dir, f'icon{size}.png')
        with open(path, 'wb') as f:
            f.write(png_data)
        print(f'Created {path} ({len(png_data)} bytes)')

    print('All icons generated successfully!')

if __name__ == '__main__':
    main()
