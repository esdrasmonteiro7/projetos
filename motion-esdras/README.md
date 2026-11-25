# Motion Esdras Soluções (9:16)

Vídeo vertical de 1080×1920, 60 fps e cerca de 33 segundos. Ele é feito como um mundo 3D em Three.js: a câmera voa entre as cenas num plano-sequência contínuo, sincronizada com a narração e com a trilha.

## Cenas e tempos

| Tempo | Narração | Cena |
|---|---|---|
| 0:00–4:00 | Todo grande projeto começa com um problema. | Ponto de luz, com anel de choque na batida da trilha (2,37s) |
| 4:00–7:00 | E todo problema... tem uma solução. | A luz vira um cometa e desenha o "E" |
| 7:00–8:40 | Esdras Soluções. | Logo 3D cromado com reflexo passando pelas letras |
| 8:40–10:50 | Sites que impressionam. | Celular e notebook com site rolando |
| 10:50–12:70 | Sistemas que trabalham por você. | Painéis de vidro com gráficos animados |
| 12:70–15:50 | Motion design que dá vida à sua marca. | Forma líquida iridescente e fitas de luz |
| 15:50–18:40 | Flyers... e design em cada detalhe. | Espiral de flyers e flyer principal |
| 18:40–22:40 | Mas, na verdade... eu estou aqui pra resolver o seu problema. | Anel de luz desenhado em volta da mensagem (trecho calmo da trilha) |
| 22:40–25:30 | Pensado. Criado. Resolvido. | Malha de arame, depois sólido cromado, depois ✓ |
| 25:30–33:00 | Vamos fazer um orçamento? Me chama no WhatsApp. | Logo, WhatsApp (92) 99509-9642 e botão. A volta forte da trilha (28,55s) entra junto com o botão |

A narração começa em 1,0s. Os tempos das frases estão em `js/overlay.js` e `js/main.js`.

## Como renderizar de novo

```bash
npm i three@0.170.0               # o Playwright/Chromium já precisa estar instalado
python3 -m http.server 8765 &     # serve esta pasta
mkdir -p segs stills
node still.mjs 3.2 9.6 28.7       # gera quadros soltos em stills/ para conferir
# render completo em 4 partes (1980 quadros)
for i in 0 1 2 3; do node render.mjs $((i*495)) $((i*495+495)) $i & done; wait
```

Depois, junte as partes e o áudio. Na mixagem, a voz é comprimida, a trilha abaixa sozinha quando há fala (sidechain) e o volume final fica em -14 LUFS:

```bash
printf "file 'segs/seg_%02d.mp4'\n" 0 1 2 3 > list.txt
ffmpeg -f concat -i list.txt -i mix.wav -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
  -c:a aac -b:a 256k -movflags +faststart -shortest esdras-solucoes-motion.mp4
```
