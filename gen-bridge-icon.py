"""透明背景桥梁图标：上1/4、下1/8留白，左右贴边。"""
from PIL import Image, ImageDraw

SIZE = 1024
OUT = r"c:\work\web-agent-bridge-editor\bridge-icon.png"
COLOR = (44, 44, 44, 255)

TOP_RATIO = 1 / 4
BOT_RATIO = 1 / 8
CONTENT_RATIO = 1.0 - TOP_RATIO - BOT_RATIO

CANVAS = 1200
img = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

left, right = 0, CANVAS
bottom = CANVAS
tower_w = 320
# 加厚桥面
deck_h = 340
deck_y0 = 0
deck_y1 = deck_h

lx0, lx1 = left, left + tower_w
rx0, rx1 = right - tower_w, right

d.rectangle([lx0, deck_y1, lx1, bottom], fill=COLOR)
d.rectangle([rx0, deck_y1, rx1, bottom], fill=COLOR)
d.rectangle([0, deck_y0, CANVAS, deck_y1], fill=COLOR)

# 加厚桥拱：拱顶实心层 + 下方拱
arch_thickness = 120
arch_opening_h = int(CANVAS * 0.15)
arch_bot = deck_y1 + arch_thickness + arch_opening_h
d.rectangle([lx1, deck_y1, rx0, arch_bot], fill=COLOR)

ax0 = lx1 + 4
ax1 = rx0 - 4
ay0 = deck_y1 + arch_thickness
ay1 = arch_bot
cx = (ax0 + ax1) / 2.0
cy = float(ay1)
rx = (ax1 - ax0) / 2.0
ry = (ay1 - ay0) * 0.98

pixels = img.load()
for y in range(ay0, ay1 + 1):
    for x in range(ax0, ax1 + 1):
        nx = (x - cx) / rx
        ny = (y - cy) / ry
        if nx * nx + ny * ny <= 1.0:
            pixels[x, y] = (0, 0, 0, 0)

bbox = img.getbbox()
if not bbox:
    raise SystemExit("empty image")
cropped = img.crop(bbox)

# 左右铺满宽度；高度固定为全体的 5/8，置于上1/4与下1/8之间
content_h = int(SIZE * CONTENT_RATIO)
scaled = cropped.resize((SIZE, content_h), Image.Resampling.LANCZOS)
top = int(SIZE * TOP_RATIO)

out = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
out.paste(scaled, (0, top), scaled)
out.save(OUT, "PNG")

print(
    f"saved {OUT} top={top} content_h={content_h} bot={SIZE - top - content_h}"
)
