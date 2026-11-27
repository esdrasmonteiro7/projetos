from PIL import Image, ImageDraw, ImageFilter
import numpy as np
im=Image.open('src.jpg').convert('RGB')
P=[(293,345),(295,500),(296,700),(298,860),(300,940),(282,946),(250,962),(228,985),(205,1020),(188,1050),(176,1080),
   (915,1080),(912,1040),(895,982),(860,940),(830,912),(780,880),(730,858),(700,845),(678,830),(670,805),(672,784),(686,768),
   (700,757),(714,744),(726,728),(734,708),(734,682),(722,664),(708,652),(708,600),(704,545),(690,506),(660,485),(628,469),(572,461),(515,472),
   (480,496),(455,537),(440,590),(436,628),(420,645),(403,661),(401,672),(425,686),(448,702),(446,750),(448,800),(455,850),
   (450,880),(425,905),(395,922),(386,880),(381,700),(376,500),(370,345)]
m=Image.new('L',im.size,0); ImageDraw.Draw(m).polygon(P,fill=255)
m=m.filter(ImageFilter.GaussianBlur(1.6))
a=np.asarray(m,np.float32)
y=np.arange(im.height)[:,None]
a*=np.clip((y-345)/70,0,1)          # fade top of guitar neck
a*=np.clip((1075-y)/40,0,1)         # fade bottom (old title area)
out=im.convert('RGBA'); out.putalpha(Image.fromarray(a.astype(np.uint8)))
out.save('dhavi_cut.png')
bg=Image.new('RGBA',im.size,(40,160,80,255)); bg.alpha_composite(out)
bg.crop((130,330,950,1100)).convert('RGB').save('cut_check.png')
