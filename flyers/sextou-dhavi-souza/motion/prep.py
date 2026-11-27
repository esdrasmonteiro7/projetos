import sys, json
sys.path.insert(0, '..')
import numpy as np
from PIL import Image, ImageFilter, ImageEnhance
from star3d import blur

# --- refaz a base melhorada SEM o rodapé (mesmo processo do enhance.py) ---
src = Image.open('../melhora/in.png').convert('RGB')
W = 1080; H = round(src.height * W / src.width)
im = src.resize((W, H), Image.LANCZOS).crop((0, 0, W, 1920))
a = np.asarray(im, np.float32)
x0, x1, y0, y1 = 110, 990, 1515, 1725
reg = a[y0:y1, x0:x1]; lum = reg.max(-1); bgl = blur(lum, 12)
mask = (lum > bgl + 18).astype(np.float32); mask = (blur(mask, 4) > 0.02).astype(np.float32)
yy, xx = np.mgrid[0:y1-y0, 0:x1-x0].astype(np.float32)
band = np.clip(np.minimum.reduce([xx/30, (x1-x0-xx)/30, yy/20, (y1-y0-yy)/20]), 0, 1)
w = 1 - mask
fill = np.stack([blur(reg[..., k]*w, 18)/np.maximum(blur(w, 18), 1e-3) for k in range(3)], -1)
fill += np.random.default_rng(3).normal(0, 2.2, fill.shape)
m = mask*band
a[y0:y1, x0:x1] = reg*(1-m[..., None]) + fill*m[..., None]
im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
im = im.filter(ImageFilter.UnsharpMask(radius=1.4, percent=85, threshold=2))
im = im.filter(ImageFilter.UnsharpMask(radius=22, percent=14, threshold=0))
im = ImageEnhance.Contrast(im).enhance(1.03); im = ImageEnhance.Color(im).enhance(1.05)
base = np.asarray(im, np.float32)

# --- rodapé padrão em duas linhas ---
f = Image.open('../sextou/footer.png'); s = 1.07
f = f.resize((round(f.width*s), round(f.height*s)), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=1, percent=60, threshold=1))
cut = 100
for name, box in [('L_ficons', (0, 0, f.width, cut)), ('L_finfo', (0, cut, f.width, f.height))]:
    L = Image.new('RGBA', (W, 1920), (0, 0, 0, 0)); L.alpha_composite(f.crop(box), (115, 1524 + box[1])); L.save(name + '.png')

# --- máscaras dos textos a partir da arte final ---
orig = np.asarray(Image.open('flyer.png').convert('RGB')).astype(np.int32)
R, G, B = orig[..., 0], orig[..., 1], orig[..., 2]
mx = orig.max(-1); mn = orig.min(-1); sat = (mx - mn)/(mx + 1e-6)
Y, X = np.mgrid[0:1920, 0:W]
warm = (R > 190) & ((R - B) > 140) & (sat > 0.6)
red = (R > 170) & (G < 90) & (B < 80)
white = mn > 200
def clean(m, open_=5, grow=13, feather=2.6):
    im = Image.fromarray((m*255).astype(np.uint8))
    im = im.filter(ImageFilter.MinFilter(open_)).filter(ImageFilter.MaxFilter(open_))
    im = im.filter(ImageFilter.MaxFilter(grow)).filter(ImageFilter.GaussianBlur(feather))
    return np.asarray(im, np.float32)/255
inb = lambda x0, x1, y0, y1: (X >= x0) & (X < x1) & (Y >= y0) & (Y < y1)
tagbox = inb(440, 676, 1262, 1300)
masks = {
  'sextou': clean((warm | red) & inb(225, 905, 1030, 1258)),
  'dhavi':  clean((red | warm) & inb(150, 556, 1240, 1352) & ~tagbox),
  'souza':  clean(white & inb(440, 990, 1205, 1330) & ~tagbox, open_=3),
}
# tag e pílula da data: retângulos suaves
def rect(x0, x1, y0, y1, r=4):
    m = inb(x0, x1, y0, y1).astype(np.uint8)*255
    return np.asarray(Image.fromarray(m).filter(ImageFilter.GaussianBlur(r)), np.float32)/255
masks['tag'] = rect(442, 674, 1263, 1300, 2)
masks['date'] = rect(392, 742, 1372, 1478, 6)
origf = orig.astype(np.float32)
boxes = {}
for k, mk in masks.items():
    L = np.dstack([origf, mk*255]).astype(np.uint8)
    Image.fromarray(L, 'RGBA').save(f'L_{k}.png')
    ys, xs = np.where(mk > 0.5); boxes[k] = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]
boxes['ficons'] = [115, 1524, 115 + f.width, 1524 + cut]; boxes['finfo'] = [115, 1524 + cut, 115 + f.width, 1524 + f.height]

# --- placa: base sem textos (inpainting nas áreas dos textos) ---
hole = np.zeros((1920, W), np.float32)
for k in ('sextou', 'dhavi', 'souza', 'tag', 'date'):
    hole = np.maximum(hole, masks[k])
hard = (hole > 0.02).astype(np.float32)
hard = np.asarray(Image.fromarray((hard*255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9)), np.float32)/255
plate = base.copy()
known = 1 - hard
for r in (6, 12, 24, 48, 96):
    num = np.stack([blur(plate[..., k]*known, r) for k in range(3)], -1)
    den = blur(known, r)
    newly = (known < 0.5) & (den > 0.08)
    plate[newly] = (num[newly] / den[newly][:, None])
    known = np.where(newly, 1.0, known)
plate += np.random.default_rng(9).normal(0, 1.8, plate.shape) * hard[..., None]
Image.fromarray(np.clip(plate, 0, 255).astype(np.uint8)).save('plate.png')

# máscara para o brilho (shine) dos textos e da logo
shine = np.maximum.reduce([masks['sextou'], masks['dhavi'], masks['souza']])
lumo = orig.max(-1).astype(np.float32)
logo = ((lumo > blur(lumo, 10) + 22) & inb(330, 750, 120, 390)).astype(np.float32)
shine = np.maximum(shine, logo)
_m=Image.fromarray((shine*255).astype(np.uint8)); _o=Image.new('RGBA',_m.size,(255,255,255,0)); _o.putalpha(_m); _o.save('M_shine.png')
json.dump(boxes, open('boxes.json', 'w'), indent=1)
print(boxes)
