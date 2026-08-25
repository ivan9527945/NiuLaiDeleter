# -*- coding: utf-8 -*-
"""牛來素材生成器：畫一隻《牛來》風格的小牛犢，輸出 6 張 5x3 spritesheet。

幀尺寸對齊原版素材：角色 225x400，爆炸 480x640（與原版 1440x1920 同比例）。
角度約定：0 = 正下方，正 = 向右，180 = 正上方（世界座標，四肢角度不受 lean 影響）。
"""
import math, os, sys, random
from PIL import Image, ImageDraw, ImageFilter

SS = 3                      # 超取樣倍數（抗鋸齒）
OUT = sys.argv[1] if len(sys.argv) > 1 else "out"
os.makedirs(OUT, exist_ok=True)

# ---------------- 配色（取自《牛來》劇照：琥珀黃毛、深棕角、粉白鼻） ----------------
FUR      = (212, 149,  58, 255)
FUR_LT   = (233, 181,  95, 255)
FUR_DK   = (168, 110,  34, 255)
FUR_EDGE = (138,  86,  24, 255)
MUZZLE   = (235, 193, 181, 255)
MUZZLE_D = (198, 145, 135, 255)
HORN     = ( 88,  52,  30, 255)
HORN_LT  = (124,  79,  47, 255)
HOOF     = (222, 168, 150, 255)
HOOF_DK  = (186, 133, 118, 255)
EYE      = ( 36,  25,  17, 255)
BROW     = ( 72,  45,  26, 255)
MOUTH    = (112,  60,  55, 255)

D2R = math.pi / 180.0


# ---------------- 基礎圖元 ----------------
def ell(cx, cy, rx, ry, rot=0.0, n=72, wob=0.0, seed=0.0):
    """橢圓多邊形；wob>0 時半徑帶一點「手搓」抖動。"""
    pts = []
    ca, sa = math.cos(rot * D2R), math.sin(rot * D2R)
    for i in range(n):
        t = 2 * math.pi * i / n
        k = 1.0 + wob * math.sin(3 * t + seed) + wob * 0.6 * math.sin(5 * t - seed * 1.7)
        x, y = rx * k * math.cos(t), ry * k * math.sin(t)
        pts.append((cx + x * ca - y * sa, cy + x * sa + y * ca))
    return pts


def blob(d, cx, cy, rx, ry, rot=0.0, fill=FUR, outline=None, w=0, wob=0.0, seed=0.0):
    p = ell(cx, cy, rx, ry, rot, wob=wob, seed=seed)
    d.polygon(p, fill=fill)
    if outline and w:
        d.line(p + [p[0]], fill=outline, width=max(1, int(w)), joint="curve")


def capsule(d, x1, y1, x2, y2, r, fill, edge=None, ew=0.0):
    if edge and ew:
        capsule(d, x1, y1, x2, y2, r + ew, edge)
    d.line([(x1, y1), (x2, y2)], fill=fill, width=max(1, int(r * 2)), joint="curve")
    for (x, y) in ((x1, y1), (x2, y2)):
        d.ellipse([x - r, y - r, x + r, y + r], fill=fill)


def pt(x, y, a, l):
    return (x + l * math.sin(a * D2R), y + l * math.cos(a * D2R))


def over(img, fn):
    """把半透明圖元畫到獨立圖層上再合成回去。

    PIL 的 draw 是直接覆寫像素、不做 alpha 合成：兩個半透明形狀疊在一起時
    後畫的會把先畫的整塊挖掉(背景圖的太陽曾因此在天空上戳出透明洞)。
    煙、火、光線這類需要真正疊加的東西一律走這裡。
    """
    lay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    fn(ImageDraw.Draw(lay))
    img.alpha_composite(lay)


# ---------------- 角色部件 ----------------
def draw_leg(d, hx, hy, hip, knee, s, front=True, seed=0.0):
    col, hc = (FUR, HOOF) if front else (FUR_DK, HOOF_DK)
    kx, ky = pt(hx, hy, hip, 46 * s)
    fx, fy = pt(kx, ky, knee, 40 * s)
    capsule(d, hx, hy, kx, ky, 17 * s, col, FUR_EDGE, 1.7 * s)
    capsule(d, kx, ky, fx, fy, 14.5 * s, col, FUR_EDGE, 1.7 * s)
    blob(d, fx + 3 * s * math.sin(knee * D2R), fy + 4 * s, 17 * s, 10 * s,
         0, hc, FUR_EDGE, 1.7 * s, wob=0.05, seed=seed)


def draw_arm(d, sx, sy, sh, elb, s, front=True, seed=0.0):
    col, hc = (FUR, HOOF) if front else (FUR_DK, HOOF_DK)
    ex, ey = pt(sx, sy, sh, 32 * s)
    hx, hy = pt(ex, ey, elb, 28 * s)
    capsule(d, sx, sy, ex, ey, 13 * s, col, FUR_EDGE, 1.7 * s)
    capsule(d, ex, ey, hx, hy, 11 * s, col, FUR_EDGE, 1.7 * s)
    blob(d, hx, hy, 12 * s, 11.5 * s, 0, hc, FUR_EDGE, 1.7 * s, wob=0.06, seed=seed)
    return (hx, hy)


def draw_horn(d, bx, by, s, side, big=1.0):
    """從頭頂兩側長出的彎角：先外擴，再上翹內收，三段漸細。"""
    x, y, r = bx, by, 10.0 * s * big
    for ang, dl, col in ((118, 20, HORN), (152, 17, HORN), (186, 13, HORN_LT)):
        nx, ny = pt(x, y, ang * side, dl * s * big)
        capsule(d, x, y, nx, ny, r, col)
        x, y, r = nx, ny, r * 0.70
    blob(d, x, y, r, r, 0, HORN_LT)


def draw_head(d, cx, cy, s, face=0.0, tilt=0.0, mouth=0.0, brow=1.0,
              eye_k=1.0, seed=0.0, big=1.0):
    ca, sa = math.cos(tilt * D2R), math.sin(tilt * D2R)

    def T(dx, dy):
        return (cx + (dx * ca - dy * sa) * s, cy + (dx * sa + dy * ca) * s)

    hw, hh = 52 * big, 47 * big
    # 耳朵（先畫，藏在頭後往兩側支出）
    for side in (-1, 1):
        ex, ey = T(side * (hw - 3), 8)
        blob(d, ex, ey, 24 * s * big, 13 * s * big, tilt + side * -18,
             FUR_DK if side * face < 0 else FUR, wob=0.05, seed=seed + side)
        blob(d, ex, ey, 13 * s * big, 6.5 * s * big, tilt + side * -18, MUZZLE_D)
    # 犄角
    for side in (-1, 1):
        draw_horn(d, *T(side * 26, -hh + 10), s, side, big)
    # 頭
    blob(d, *T(0, 0), hw * s, hh * s, tilt, FUR, FUR_EDGE, 2.4 * s, wob=0.026, seed=seed)
    blob(d, *T(-8 + face * 8, -21 * big), 25 * s * big, 12 * s * big, tilt - 10, FUR_LT)
    # 鼻吻部
    blob(d, *T(face * 8, 23 * big), 36 * s * big, 27 * s * big, tilt, MUZZLE,
         MUZZLE_D, 2.2 * s, wob=0.03, seed=seed + 3)
    for side in (-1, 1):
        blob(d, *T(face * 8 + side * 12, 16 * big), 5.6 * s * big, 4.0 * s * big,
             tilt + side * 24, MUZZLE_D)
    # 嘴
    if mouth > 0.05:
        blob(d, *T(face * 8, 35 * big), 14 * s * big, (3 + 9 * mouth) * s * big, tilt, MOUTH)
    else:
        d.line([T(face * 8 - 15, 35 * big), T(face * 8 + 15, 35 * big)],
               fill=MUZZLE_D, width=max(1, int(2.6 * s)))
    # 眼睛
    for side in (-1, 1):
        ex, ey = T(face * 6 + side * 22, -9 * big)
        blob(d, ex, ey, 6.6 * s * big, 8.8 * s * big * eye_k, tilt, EYE)
        if eye_k > 0.4:
            blob(d, ex - 2.2 * s, ey - 3 * s, 2.3 * s, 2.7 * s, 0, (255, 255, 255, 225))
    # 招牌八字厚眉
    for side in (-1, 1):
        b0 = T(face * 6 + side * 33, -23 * big - 2 * brow)
        b1 = T(face * 6 + side * 11, -20 * big - 7 * brow)
        capsule(d, b0[0], b0[1], b1[0], b1[1], 4.2 * s * big, BROW)


def draw_calf(d, x, y, s=1.0, *, lean=0.0, hipL=0, kneeL=0, hipR=8, kneeR=6,
              shL=-10, elbL=-8, shR=10, elbR=8, head_dy=0.0, face=0.0,
              tilt=0.0, mouth=0.0, brow=1.0, eye_k=1.0, squash=1.0, seed=0.0, big=1.0):
    """x,y = 胯部中心；四肢角度為世界角度（不隨 lean 旋轉，方便擺姿勢）。"""
    ca, sa = math.cos(lean * D2R), math.sin(lean * D2R)

    def B(dx, dy):
        dy *= squash
        return (x + (dx * ca - dy * sa) * s, y + (dx * sa + dy * ca) * s)

    draw_leg(d, *B(-14 * big, 0), hipL, kneeL, s * big, False, seed)
    draw_arm(d, *B(-47 * big, -60 * big), shL, elbL, s * big, False, seed)
    # 身體
    blob(d, *B(0, -46 * big), 53 * s * big, 66 * s * big * squash, lean,
         FUR, FUR_EDGE, 2.6 * s, wob=0.028, seed=seed + 1)
    blob(d, *B(3, -34 * big), 33 * s * big, 39 * s * big * squash, lean, FUR_LT,
         wob=0.04, seed=seed + 2)
    draw_leg(d, *B(16 * big, 0), hipR, kneeR, s * big, True, seed + 1)
    draw_head(d, *B(face * 5, (-120 + head_dy) * big), s,
              face=face, tilt=tilt + lean * 0.4, mouth=mouth, brow=brow,
              eye_k=eye_k, seed=seed, big=big)
    return draw_arm(d, *B(49 * big, -60 * big), shR, elbR, s * big, True, seed + 2)


# ---------------- 拼圖 ----------------
def sheet(name, w, h, fn):
    out = Image.new("RGBA", (w * 5, h * 3), (0, 0, 0, 0))
    for i in range(15):
        img = Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0))
        fn(img, i)
        out.paste(img.resize((w, h), Image.LANCZOS), ((i % 5) * w, (i // 5) * h))
    out.save(os.path.join(OUT, name))
    print("  ->", name, out.size, "bbox", out.crop((0, 0, w, h)).getbbox())


W, H = 225, 400
GX, GY = W / 2 * SS, 283 * SS      # 胯部基準（腳落在 y≈373，與原素材同高）
S = SS * 1.06


# ---------------- 1. 走路 ----------------
def walk(img, i):
    d = ImageDraw.Draw(img)
    p = 2 * math.pi * i / 15
    sw = 28 * math.sin(p)
    bob = -4 * abs(math.cos(p)) - 2
    draw_calf(d, GX, GY + bob * SS, S,
              lean=5 + 2 * math.sin(p),
              hipL=-sw, kneeL=-sw * 0.5 + max(0, 34 * math.sin(p + 0.7)),
              hipR=sw, kneeR=sw * 0.5 + max(0, 34 * math.sin(p + math.pi + 0.7)),
              shL=-8 - sw * 0.85, elbL=-6 - sw * 0.75,
              shR=10 + sw * 0.85, elbR=8 + sw * 0.75,
              head_dy=1.5 * math.sin(2 * p), face=0.45,
              tilt=2 * math.sin(p), seed=i * 1.3)


# ---------------- 2. 指著檔案（預設只用 11~14 幀） ----------------
def point(img, i):
    d = ImageDraw.Draw(img)
    k = min(1.0, i / 10.0)
    talk, jit = 0.0, 0.0
    if i >= 11:
        talk = (0.9, 0.25, 0.85, 0.35)[i - 11]
        jit = (0.0, 2.0, -1.5, 1.2)[i - 11]
    sh = 10 + 78 * k                       # 前手從垂下抬到水平前指
    draw_calf(d, GX, GY - 2 * SS, S,
              lean=3,
              hipL=-7, kneeL=-3, hipR=9, kneeR=5,
              shL=-9, elbL=-7,
              shR=sh + jit, elbR=sh + 6 + jit,
              head_dy=-1 + jit * 0.4, face=0.55, tilt=-3 + jit * 0.6,
              mouth=talk, brow=1.0 + 0.5 * talk, seed=i * 2.1)


# ---------------- 3. 踹檔案（第 5 幀觸發爆炸） ----------------
KICK = [(-8, -26, -14), (-13, -36, -20), (-16, -42, -24), (-12, -30, -16),
        (10, 52, 30), (16, 84, 62), (12, 70, 48), (7, 46, 26),
        (3, 26, 12), (1, 12, 6), (0, 8, 6), (1, 10, 6),
        (2, 9, 6), (1, 8, 6), (0, 8, 6)]


def kick(img, i):
    d = ImageDraw.Draw(img)
    lean, hip, knee = KICK[i]
    boom = i in (4, 5, 6)
    draw_calf(d, GX, GY - 2 * SS, S,
              lean=lean,
              hipL=-lean * 0.5 - 6, kneeL=-lean * 0.3,
              hipR=hip, kneeR=knee,
              shL=-8 - lean * 1.1, elbL=-6 - lean * 0.9,
              shR=14 + lean * 1.6, elbR=12 + lean * 1.3,
              head_dy=-abs(lean) * 0.12, face=0.55, tilt=-lean * 0.45,
              mouth=0.9 if boom else 0.15, eye_k=0.45 if boom else 1.0,
              brow=1.6 if boom else 1.0, seed=i * 3.7)


# ---------------- 4. 爆炸 ----------------
EW, EH = 480, 640


def explosion(img, i):
    rnd = random.Random(20260805)
    cx, cy = EW / 2 * SS, EH * 0.55 * SS
    t = i / 14.0
    grow = 1 - (1 - t) ** 2.2
    R = (26 + 200 * grow) * SS
    fade = 1.0 if t < 0.42 else max(0.0, 1 - (t - 0.42) / 0.58)
    for k in range(14):                                     # 煙團
        a = 2 * math.pi * k / 14 + rnd.random() * 0.6
        rr = R * (0.55 + 0.5 * rnd.random())
        px = cx + math.cos(a) * rr * 0.9
        py = cy + math.sin(a) * rr * 0.72 - R * 0.28 * t
        g = int(118 - 34 * t)
        over(img, lambda dd, px=px, py=py, g=g, k=k: blob(
            dd, px, py, R * 0.40, R * 0.38, 0,
            (g + 46, g + 14, g - 16, int(150 * fade)), wob=0.12, seed=k))
    for frac, col in ((1.00, (226, 88, 34)), (0.72, (247, 162, 46)), (0.42, (255, 238, 168))):
        over(img, lambda dd, frac=frac, col=col: blob(
            dd, cx, cy, R * frac, R * frac * 0.92, i * 9,
            col + (int(255 * fade),), wob=0.13, seed=i + frac * 3))

    def rays(dd):                                           # 衝擊射線
        for k in range(11):
            a = 2 * math.pi * k / 11 + 0.3
            l0, l1 = R * 0.92, R * (1.06 + 0.55 * grow)
            dd.line([(cx + math.cos(a) * l0, cy + math.sin(a) * l0),
                     (cx + math.cos(a) * l1, cy + math.sin(a) * l1)],
                    fill=(255, 214, 120, int(220 * fade)), width=max(1, int(7 * SS)))
    over(img, rays)


# ---------------- 5. 牛爸登場（對應原版「雷歐登場」） ----------------
def leo(img, i):
    d = ImageDraw.Draw(img)
    if i <= 6:                                              # 從天而降
        k = i / 6.0
        dy, sq, sc = -(1 - k) ** 2 * 300, 1.0, 0.88 + 0.12 * k
    else:                                                   # 落地彈一下，叉腰站定
        k = (i - 6) / 8.0
        dy, sq, sc = 0.0, 1 - 0.20 * math.exp(-5 * k), 1.0
    cx, cy = GX, GY - 118 * SS
    # 畫框只有 225 寬、卻有 400 高：讓每道光按自己的方向吃滿可用空間，
    # 豎直方向能拉得比水平長得多，既不會被框邊切平，也不至於全被角色擋住。
    def ray_len(a):
        lim = [108 / abs(math.cos(a)) if abs(math.cos(a)) > 1e-3 else 1e9]
        if math.sin(a) < -1e-3:   lim.append(152 / -math.sin(a))    # 向上
        elif math.sin(a) > 1e-3:  lim.append(222 / math.sin(a))     # 向下
        return min(lim) * 0.92

    def light(dd):                                          # 放射光：錐形，尖端收到 0
        for k2 in range(14):
            a = 2 * math.pi * k2 / 14 + i * 0.09
            L = ray_len(a) * (0.80 + 0.20 * math.sin(i * 0.5 + k2)) * SS
            wdt = 7.5 * SS
            dd.polygon([(cx + math.cos(a) * L, cy + math.sin(a) * L),
                        (cx - math.sin(a) * wdt, cy + math.cos(a) * wdt),
                        (cx + math.sin(a) * wdt, cy - math.cos(a) * wdt)],
                       fill=(255, 226, 132, 88))
    # 光暈：同心橢圓由外到內逐級加不透明度（後畫的覆寫先畫的，正好疊成階梯漸變），
    # 再用高斯模糊把臺階抹平——直接疊 12 層半透明會看到一圈圈硬邊色帶。
    # 顏色偏暖：低透明度的冷白光混到深色桌面上會褪成灰，(255,214,120) 才留得住金色。
    glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for k2 in range(12):
        rx, ry = (104 - k2 * 8) * SS, (150 - k2 * 11) * SS
        blob(gd, cx, cy, rx, ry, 0, (255, 214, 120, 8 + k2 * 7), wob=0.05, seed=i + k2)
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(10 * SS)))

    lay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    light(ImageDraw.Draw(lay))
    img.alpha_composite(lay.filter(ImageFilter.GaussianBlur(2.5 * SS)))
    draw_calf(d, GX, GY + dy * SS, S * sc,
              hipL=-16, kneeL=-8, hipR=16, kneeR=8,
              shL=-52, elbL=28, shR=52, elbR=-28,           # 雙手叉腰
              head_dy=-3, face=0.0, tilt=0, mouth=0.55,
              brow=1.7, eye_k=0.85, squash=sq, seed=i * 1.7, big=1.12)


# ---------------- 6. 飛離退場 ----------------
def fly(img, i):
    d = ImageDraw.Draw(img)
    p = 2 * math.pi * i / 15
    for k in range(6):                                      # 速度線
        yy = GY - (30 + k * 36) * SS + 8 * SS * math.sin(p + k)
        x0 = GX - (120 + 46 * ((i + k * 2) % 5)) * SS
        d.line([(x0, yy), (x0 + 58 * SS, yy)], fill=(255, 255, 255, 120),
               width=max(1, int(4 * SS)))
    draw_calf(d, GX - 18 * SS, GY - 53 * SS + 9 * SS * math.sin(p), S * 0.72,
              lean=48 + 4 * math.sin(p),
              hipL=-104 + 6 * math.sin(p), kneeL=-58,
              hipR=-92 - 6 * math.sin(p), kneeR=-46,          # 後腿收起
              shL=104, elbL=112, shR=96, elbR=104,            # 雙手前伸
              head_dy=0, face=0.45, tilt=8, mouth=0.5, brow=1.3,
              eye_k=0.8, seed=i * 2.9)


# ---------------- 瞄準背景圖 ----------------
def targeting_bg(path, w=1375, h=768):
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    top, bot = (96, 62, 138), (255, 176, 96)
    for y in range(h):
        k = (y / h) ** 0.8
        d.line([(0, y), (w, y)],
               fill=tuple(int(top[c] + (bot[c] - top[c]) * k) for c in range(3)) + (255,))
    # 太陽與雲：PIL 的 ellipse 會直接覆寫像素(不做 alpha 合成),
    # 半透明的形狀必須畫在獨立圖層上再 alpha_composite,否則會在天空上戳出透明洞。
    over = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    od = ImageDraw.Draw(over)
    sx, sy = w * 0.62, h * 0.50
    for r, a in ((280, 26), (200, 42), (135, 68), (82, 130)):
        lay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        ImageDraw.Draw(lay).ellipse([sx - r, sy - r, sx + r, sy + r], fill=(255, 236, 190, a))
        over.alpha_composite(lay)
    for (cx, cy, cw, ch, al) in ((0.18, 0.16, 260, 46, 120), (0.55, 0.10, 320, 40, 100),
                                 (0.80, 0.24, 220, 38, 110), (0.34, 0.30, 300, 34, 90)):
        lay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        ld = ImageDraw.Draw(lay)
        for k in range(6):
            ox, rr = (k - 2.5) * cw / 6, ch * (1.2 - abs(k - 2.5) * 0.22)
            ld.ellipse([cx * w + ox - rr * 1.6, cy * h - rr,
                        cx * w + ox + rr * 1.6, cy * h + rr], fill=(255, 216, 228, al))
        over.alpha_composite(lay)
    img.alpha_composite(over)
    for (base, col) in ((0.70, (104, 70, 132)), (0.76, (130, 86, 150))):
        pts = [(0, h)]
        for x in range(0, w + 30, 30):
            k = x / w
            pts.append((x, h * base - 70 * math.sin(k * 7.3) - 46 * math.sin(k * 3.1 + 1.2)))
        pts.append((w, h))
        d.polygon(pts, fill=col + (255,))
    d.polygon([(0, h * 0.80), (w, h * 0.76), (w, h), (0, h)], fill=(226, 196, 156, 255))
    rnd = random.Random(7)
    for _ in range(18):
        x, y = rnd.randint(20, w - 20), rnd.randint(int(h * 0.62), int(h * 0.94))
        sc = 0.5 + (y - h * 0.62) / (h * 0.32) * 1.1
        d.line([(x, y), (x, y - 40 * sc)], fill=(96, 66, 44, 255), width=max(2, int(6 * sc)))
        for k in range(3):
            rr, yy = (26 - k * 6) * sc, y - (34 + k * 22) * sc
            d.ellipse([x - rr, yy - rr * 0.7, x + rr, yy + rr * 0.7],
                      fill=(74 + k * 12, 132 + k * 14, 70 + k * 10, 255))
    img.filter(ImageFilter.SMOOTH).save(path)
    print("  ->", os.path.basename(path), img.size)


# ---------------- 應用圖示 ----------------
def logo(path, n=1024):
    big = Image.new("RGBA", (n * 2, n * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(big)
    d.ellipse([40, 40, n * 2 - 40, n * 2 - 40], fill=(255, 231, 190, 255))
    draw_head(d, n, n * 1.14, n * 2 / 225.0 * 1.42, face=0.0, tilt=0,
              mouth=0.35, brow=1.2, seed=3)
    big.resize((n, n), Image.LANCZOS).save(path)
    print("  ->", os.path.basename(path), (n, n))


if __name__ == "__main__":
    print("generating 牛來 assets ->", OUT)
    sheet("走路动效_spritesheet_transparent.png", W, H, walk)
    sheet("指着文件_spritesheet_transparent.png", W, H, point)
    sheet("踹文件动效_spritesheet_transparent.png", W, H, kick)
    sheet("爆炸_spritesheet_transparent.png", EW, EH, explosion)
    sheet("雷欧登场_spritesheet_transparent.png", W, H, leo)
    sheet("出场飞行动效_spritesheet_transparent.png", W, H, fly)
    targeting_bg(os.path.join(OUT, "targeting_bg.png"))
    logo(os.path.join(OUT, "logo.png"))
