# -*- coding: utf-8 -*-
"""把牛來的整段演出算成 GIF，給 README 當視覺說明用。

時間與座標【全部從 assets/<角色>/config.jsonc 讀出來】，不在這裡寫死。
早期版本是手算硬寫的，結果跟程式漂移，一度把總長標成 13 秒（實際 8.75 秒）。

座標公式抄自 src/renderer/show.js（m = 角色精靈，x/y 是左上角）：
    m.w    = 幀寬 * (sprite_height / 幀高)
    y      = target.y - sprite_height/2 + walk_y_offset
    endX   = target.x - m.w - target_gap        （從左側進場時）
    startX = -m.w
    爆炸    ex.x = target.x - ex.w/2
            ex.y = target.y - ex.h/2 - explosion_y_offset

串接順序同 show.js：
    走路(walk_duration_ms, out-quad) → 指點(point_frames) → 氣泡等使用者點擊
    → 踢踹(第 kick_frame 幀觸發爆炸＋刪除) → 登場 → 飛離(fly_duration_ms, in-quad)

注意：爆炸動畫播在自己的 canvas 上，與「登場」同時進行 —— kick.onEnd 是直接
接 leo 的，中間沒有空檔。早期版本在這裡多插了一段爆炸餘燼，是錯的。

用法：python3 tools/preview_show.py [角色資料夾] [輸出檔]
"""
import json
import os
import re
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHAR = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'assets', 'niulai')
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'docs', 'preview.gif')

# 畫布：README 裡看得清楚又不會太肥
W, H = 760, 470
TX, TY = 560, 190           # 目標檔案圖示中心
BAR = 34                    # 底部說明列高度
DIALOG_MS = 1000            # 氣泡在真實程式裡是無限等待使用者點擊，這裡取個代表值


def load_config(folder):
    """讀 config.jsonc：剝掉註解後當 JSON 解析（字串裡的 // 要保留）。"""
    path = None
    for name in ('config.jsonc', 'config.json'):
        p = os.path.join(folder, name)
        if os.path.exists(p):
            path = p
            break
    if not path:
        raise SystemExit(f'找不到 config：{folder}')
    text = open(path, encoding='utf-8').read()
    out, in_str, esc = [], False, False
    i = 0
    while i < len(text):
        ch = text[i]
        if in_str:
            out.append(ch)
            if esc:
                esc = False
            elif ch == '\\':
                esc = True
            elif ch == '"':
                in_str = False
            i += 1
            continue
        if ch == '"':
            in_str = True
            out.append(ch)
            i += 1
            continue
        if ch == '/' and i + 1 < len(text) and text[i + 1] == '/':
            while i < len(text) and text[i] != '\n':
                i += 1
            out.append('\n')
            continue
        if ch == '/' and i + 1 < len(text) and text[i + 1] == '*':
            i += 2
            while i + 1 < len(text) and not (text[i] == '*' and text[i + 1] == '/'):
                i += 1
            i += 2
            continue
        out.append(ch)
        i += 1
    return json.loads(''.join(out))


cfg = load_config(CHAR)
anim = cfg['animation']
FPS = anim['fps']
MS = round(1000 / FPS)
SPRITE_H = anim['sprite_height']
EXPL_H = anim['explosion_height']
WALK_MS = anim['walk_duration_ms']
FLY_MS = anim['fly_duration_ms']
GAP = anim['target_gap']
Y_OFF = anim['walk_y_offset']
EX_Y_OFF = anim['explosion_y_offset']
KICK_FRAME = anim['kick_frame']
POINT_FRAMES = cfg['sprites']['point_frames']
DIALOG = cfg['texts']['dialog']


def sheet(key, target_h, pick=None):
    """切 5x3 spritesheet，等比縮到指定高度。"""
    im = Image.open(os.path.join(CHAR, cfg['sprites'][key])).convert('RGBA')
    fw, fh = im.width // 5, im.height // 3
    frames = [im.crop((c * fw, r * fh, c * fw + fw, r * fh + fh))
              for r in range(3) for c in range(5)]
    if pick:
        frames = [frames[i] for i in pick]
    sc = target_h / fh
    return [f.resize((max(1, round(fw * sc)), target_h), Image.LANCZOS) for f in frames]


walk = sheet('walk', SPRITE_H)
point = sheet('point', SPRITE_H, POINT_FRAMES)
kick = sheet('kick', SPRITE_H)
leo = sheet('leo', SPRITE_H)
fly = sheet('fly', SPRITE_H)
boom = sheet('explosion', EXPL_H)

MW = walk[0].width
EW, EH = boom[0].width, EXPL_H
END_X = TX - MW - GAP                       # 角色落點（左上角 x）
TOP_Y = TY - SPRITE_H // 2 + Y_OFF
EX_X, EX_Y = TX - EW / 2, TY - EH / 2 - EX_Y_OFF

# 時間軸（毫秒）
T_WALK = WALK_MS
T_POINT = T_WALK + len(point) * MS
T_DIALOG = T_POINT + DIALOG_MS
T_BOOM = T_DIALOG + KICK_FRAME * MS         # 爆炸＋檔案進資源回收筒
T_KICK = T_DIALOG + len(kick) * MS
T_LEO = T_KICK + len(leo) * MS
T_FLY = T_LEO + FLY_MS
T_END = T_FLY + 900                         # 結尾留白
BOOM_END = T_BOOM + len(boom) * MS
REAL_TOTAL = WALK_MS + len(point) * MS + len(kick) * MS + len(leo) * MS + FLY_MS


def font(sz):
    for p in ('/System/Library/Fonts/PingFang.ttc',
              '/System/Library/Fonts/STHeiti Medium.ttc'):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, sz)
            except OSError:
                pass
    return ImageFont.load_default()


F_UI, F_SM = font(15), font(13)

# 桌布
desk = Image.new('RGBA', (W, H), (0, 0, 0, 0))
d = ImageDraw.Draw(desk)
for y in range(H - BAR):
    k = y / (H - BAR)
    d.line([(0, y), (W, y)], fill=(int(36 + 26 * k), int(44 + 32 * k), int(60 + 40 * k), 255))
d.rectangle([0, H - BAR, W, H], fill=(24, 24, 30, 255))
d.line([(0, H - BAR), (W, H - BAR)], fill=(90, 90, 100, 255))


def file_icon(img):
    """目標檔案圖示；爆炸那一刻起就不再畫（＝已進資源回收筒）。"""
    g = ImageDraw.Draw(img)
    g.rectangle([TX - 22, TY - 28, TX + 22, TY + 26], fill=(246, 247, 250, 255),
                outline=(196, 202, 212, 255), width=2)
    g.polygon([(TX + 8, TY - 28), (TX + 22, TY - 14), (TX + 8, TY - 14)],
              fill=(212, 218, 228, 255))
    for k in range(4):
        g.line([(TX - 13, TY - 6 + k * 8), (TX + 13, TY - 6 + k * 8)],
               fill=(184, 190, 200, 255), width=2)
    g.text((TX, TY + 34), '報告.docx', font=F_SM, fill=(228, 232, 240, 255), anchor='ma')


def ease(t, kind):
    return 1 - (1 - t) ** 2 if kind == 'out' else t * t


frames, durations = [], []
t = 0
while t < T_END:
    img = desk.copy()

    if t < T_BOOM:                                  # 檔案還在
        file_icon(img)

    if t < T_WALK:                                  # 走進來（out-quad）
        sp = walk[(t // MS) % len(walk)]
        x = -MW + (END_X + MW) * ease(t / T_WALK, 'out')
        label = '走進來'
    elif t < T_POINT:                               # 指點
        sp = point[min(len(point) - 1, (t - T_WALK) // MS)]
        x, label = END_X, '指著檔案'
    elif t < T_DIALOG:                              # 等使用者按確認
        sp = point[-1]
        x, label = END_X, '等你按「就是它」'
    elif t < T_KICK:                                # 踢踹
        sp = kick[min(len(kick) - 1, (t - T_DIALOG) // MS)]
        x = END_X
        label = '踹 — 檔案已進資源回收筒' if t >= T_BOOM else '踹'
    elif t < T_LEO:                                 # 登場（爆炸同時還在播）
        sp = leo[min(len(leo) - 1, (t - T_KICK) // MS)]
        x, label = END_X, '登場'
    else:                                           # 飛離（in-quad）
        p = min(1.0, (t - T_LEO) / FLY_MS)
        sp = fly[((t - T_LEO) // MS) % len(fly)]
        x = END_X + (W + 200 - END_X) * ease(p, 'in')
        label = '飛走'

    img.alpha_composite(sp, (round(x), TOP_Y))

    if T_POINT <= t < T_DIALOG:                     # 對話氣泡
        g = ImageDraw.Draw(img)
        bx, by = END_X + MW / 2 - 88, TOP_Y - 54
        g.rounded_rectangle([bx, by, bx + 186, by + 40], 8, fill=(255, 255, 255, 242))
        g.polygon([(bx + 78, by + 40), (bx + 96, by + 40), (bx + 86, by + 52)],
                  fill=(255, 255, 255, 242))
        g.text((bx + 93, by + 20), DIALOG, font=F_UI, fill=(24, 24, 30, 255), anchor='mm')

    if T_BOOM <= t < BOOM_END:                      # 爆炸（獨立圖層，與登場並行）
        img.alpha_composite(boom[min(len(boom) - 1, (t - T_BOOM) // MS)],
                            (round(EX_X), round(EX_Y)))

    g = ImageDraw.Draw(img)
    g.text((14, H - BAR + 8), f'{t / 1000:5.2f}s   {label}', font=F_SM,
           fill=(120, 230, 140, 255))
    g.text((W - 14, H - BAR + 8),
           f'演出全長 {REAL_TOTAL / 1000:.2f}s（不含等你按確認）',
           font=F_SM, fill=(150, 150, 165, 255), anchor='ra')

    frames.append(img.convert('RGB').convert('P', palette=Image.ADAPTIVE, colors=96))
    durations.append(MS)
    t += MS

os.makedirs(os.path.dirname(OUT), exist_ok=True)
frames[0].save(OUT, save_all=True, append_images=frames[1:],
               duration=durations, loop=0, disposal=2, optimize=True)

print(f'{OUT}')
print(f'  {W}x{H}  來源 {len(frames)} 幀 @ {MS}ms  '
      f'{os.path.getsize(OUT) / 1024 / 1024:.2f}MB')
print(f'  演出全長 {REAL_TOTAL}ms（不含等待）；檔案於 '
      f'{T_BOOM - DIALOG_MS}ms + 等待時間 消失')
