import sys
sys.path.insert(0, '..')
import numpy as np
from PIL import Image, ImageFilter, ImageEnhance
from star3d import blur

src = Image.open('in.png').convert('RGB')
W = 1080
H = round(src.height * W / src.width)            # 1935
im = src.resize((W, H), Image.LANCZOS).crop((0, 0, W, 1920))

# 1) apagar o rodapé antigo (inpainting simples por convolução normalizada)
a = np.asarray(im, np.float32)
x0, x1, y0, y1 = 110, 990, 1515, 1725
reg = a[y0:y1, x0:x1]
lum = reg.max(-1)
bg = blur(lum, 12)
mask = (lum > bg + 18).astype(np.float32)
mask = (blur(mask, 4) > 0.02).astype(np.float32)        # dilata
# máscara geral da faixa do rodapé, com bordas suaves
yy, xx = np.mgrid[0:y1 - y0, 0:x1 - x0].astype(np.float32)
band = np.clip(np.minimum.reduce([xx / 30, (x1 - x0 - xx) / 30, yy / 20, (y1 - y0 - yy) / 20]), 0, 1)
w = 1 - mask
fill = np.stack([blur(reg[..., k] * w, 18) / np.maximum(blur(w, 18), 1e-3) for k in range(3)], -1)
rng = np.random.default_rng(3)
fill += rng.normal(0, 2.2, fill.shape)                 # grão para não ficar "liso"
m = np.maximum(mask, 0) * band
m = np.maximum(m, band * 0.0)
out = reg * (1 - m[..., None]) + fill * m[..., None]
a[y0:y1, x0:x1] = out
im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))

# 2) melhora de nitidez e definição
im = im.filter(ImageFilter.UnsharpMask(radius=1.4, percent=85, threshold=2))
im = im.filter(ImageFilter.UnsharpMask(radius=22, percent=14, threshold=0))   # "clarity"
im = ImageEnhance.Contrast(im).enhance(1.03)
im = ImageEnhance.Color(im).enhance(1.05)

# 3) rodapé padrão do Recanto
f = Image.open('../sextou/footer.png')
s = 1.07
f = f.resize((round(f.width * s), round(f.height * s)), Image.LANCZOS)
f = f.filter(ImageFilter.UnsharpMask(radius=1, percent=60, threshold=1))
canvas = im.convert('RGBA')
canvas.alpha_composite(f, (115, 1524))
canvas.convert('RGB').save('out.png')
canvas.convert('RGB').crop((0, 1450, 1080, 1800)).save('foot_out.png')
