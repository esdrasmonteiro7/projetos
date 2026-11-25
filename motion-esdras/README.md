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

## Fluidez: motion blur real

Cada quadro (60 fps) é a média de 1 a 10 subquadros, distribuídos num obturador de 216°. O número de subquadros cresce com a velocidade da câmera. Um desfoque direcional residual preenche o espaço entre os subquadros. As transições usam uma curva com aceleração contínua (sem trancos). Veja `setState`, `subframes` e `renderFrame` em `js/main.js`.

## Efeitos sonoros (`audio/sfx.py`)

Todos os efeitos são sintetizados do zero com numpy:
- whooshes com filtro em movimento e pan estéreo;
- impactos graves;
- reverse swells;
- riser antes da volta forte da trilha;
- brilhos granulares;
- glints e sinos afinados no tom da trilha (Dó/Ré/Sol);
- tiques de interface e pops;
- reverberação por convolução.

Cada evento é posicionado no tempo exato da animação. Na mixagem, a trilha e os efeitos abaixam quando a voz fala (sidechain). O volume final fica em -14 LUFS, com pico abaixo de -0,8 dBTP.

```bash
python3 audio/sfx.py   # gera sfx.wav
```

## Como renderizar de novo

```bash
npm i three@0.170.0               # o Playwright/Chromium já precisa estar instalado
python3 -m http.server 8765 &     # serve esta pasta
mkdir -p segs stills
node still.mjs 3.2 9.6 28.7       # gera quadros soltos em stills/ para conferir
# render completo: 3 workers puxam 12 trechos de uma fila
mkdir -p segs2; for i in 0 1 2; do node render2.mjs $i & done; wait
```

Depois, junte as partes e o áudio. Na mixagem, a voz é comprimida, a trilha abaixa sozinha quando há fala (sidechain) e o volume final fica em -14 LUFS:

```bash
for k in $(seq -w 0 11); do echo "file 'segs2/seg_$k.mp4'"; done > list.txt
ffmpeg -f concat -i list.txt -i mix.wav -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
  -c:a aac -b:a 256k -movflags +faststart -shortest esdras-solucoes-motion.mp4
```
