# キャラ絵の黒い背景だけを透明にする（ふちからつながった暗い所だけを塗りつぶしで消す。キャラの中の黒は残す）
import sys, numpy as np
from PIL import Image
from collections import deque
for name in sys.argv[1:]:
    im = Image.open(f"public/img/{name}.jpg").convert("RGB")
    a = np.asarray(im).astype(int)
    h, w, _ = a.shape
    dark = a.max(axis=2) < 34  # ほぼ黒
    bg = np.zeros((h, w), bool)
    q = deque([(y, x) for y in range(h) for x in (0, w - 1)] + [(y, x) for x in range(w) for y in (0, h - 1)])
    while q:
        y, x = q.popleft()
        if bg[y, x] or not dark[y, x]:
            continue
        bg[y, x] = True
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not bg[ny, nx] and dark[ny, nx]:
                q.append((ny, nx))
    alpha = np.where(bg, 0, 255).astype(np.uint8)
    # ふちを少しぼかしてギザギザを消す
    from PIL import ImageFilter
    al = Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(1.2))
    out = im.copy()
    out.putalpha(al)
    out.save(f"public/img/{name}.png", optimize=True)
    print(name, f"{bg.mean():.0%} transparent")
