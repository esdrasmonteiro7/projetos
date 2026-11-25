// Physically-based style bloom (13-tap downsample + tent upsample) — round, smooth halos
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;

export class SoftBloomPass extends Pass {
  constructor(w, h, { levels = 7, strength = 0.2, threshold = 0.8, knee = 0.4, radius = 1.0 } = {}) {
    super();
    Object.assign(this, { strength, threshold, knee, radius });
    this.downs = [];
    let cw = Math.round(w / 2), ch = Math.round(h / 2);
    for (let i = 0; i < levels; i++) {
      this.downs.push(new THREE.WebGLRenderTarget(cw, ch, { type: THREE.HalfFloatType, depthBuffer: false }));
      cw = Math.max(2, Math.round(cw / 2)); ch = Math.max(2, Math.round(ch / 2));
    }
    this.ups = this.downs.slice(0, levels - 1).map((rt) => new THREE.WebGLRenderTarget(rt.width, rt.height, { type: THREE.HalfFloatType, depthBuffer: false }));
    const common = { vertexShader: VS, depthTest: false, depthWrite: false };
    this.downMat = new THREE.ShaderMaterial({
      ...common,
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uPre: { value: 0 }, uThr: { value: threshold }, uKnee: { value: knee } },
      fragmentShader: `uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uPre, uThr, uKnee; varying vec2 vUv;
        vec3 s(vec2 o){ return texture2D(tSrc, vUv + o*uTexel).rgb; }
        vec3 pre(vec3 c){ float br = max(c.r, max(c.g, c.b));
          float rq = clamp(br - uThr + uKnee, 0., 2.*uKnee); rq = rq*rq/(4.*uKnee + 1e-4);
          float w = max(rq, br - uThr) / max(br, 1e-4); return c * w; }
        vec3 karis(vec3 c){ return c / (1.0 + max(c.r, max(c.g, c.b)) * 0.25); }
        void main(){
          vec3 a=s(vec2(-2.,2.)), b=s(vec2(0.,2.)), c=s(vec2(2.,2.));
          vec3 d=s(vec2(-2.,0.)), e=s(vec2(0.,0.)), f=s(vec2(2.,0.));
          vec3 g=s(vec2(-2.,-2.)), h=s(vec2(0.,-2.)), i=s(vec2(2.,-2.));
          vec3 j=s(vec2(-1.,1.)), k=s(vec2(1.,1.)), l=s(vec2(-1.,-1.)), m=s(vec2(1.,-1.));
          vec3 col = e*0.125 + (a+c+g+i)*0.03125 + (b+d+f+h)*0.0625 + (j+k+l+m)*0.125;
          if (uPre > 0.5) col = pre(col);
          gl_FragColor = vec4(col, 1.); }`,
    });
    this.upMat = new THREE.ShaderMaterial({
      ...common,
      uniforms: { tLow: { value: null }, tHigh: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: radius } },
      fragmentShader: `uniform sampler2D tLow, tHigh; uniform vec2 uTexel; uniform float uRadius; varying vec2 vUv;
        void main(){ vec2 t = uTexel*uRadius;
          vec3 c = texture2D(tLow, vUv+vec2(-t.x,t.y)).rgb + 2.*texture2D(tLow, vUv+vec2(0.,t.y)).rgb + texture2D(tLow, vUv+vec2(t.x,t.y)).rgb
            + 2.*texture2D(tLow, vUv+vec2(-t.x,0.)).rgb + 4.*texture2D(tLow, vUv).rgb + 2.*texture2D(tLow, vUv+vec2(t.x,0.)).rgb
            + texture2D(tLow, vUv+vec2(-t.x,-t.y)).rgb + 2.*texture2D(tLow, vUv+vec2(0.,-t.y)).rgb + texture2D(tLow, vUv+vec2(t.x,-t.y)).rgb;
          gl_FragColor = vec4(texture2D(tHigh, vUv).rgb + c/16., 1.); }`,
    });
    this.compMat = new THREE.ShaderMaterial({
      ...common,
      uniforms: { tBase: { value: null }, tBloom: { value: null }, uStrength: { value: strength } },
      fragmentShader: `uniform sampler2D tBase, tBloom; uniform float uStrength; varying vec2 vUv;
        void main(){ vec4 b = texture2D(tBase, vUv); gl_FragColor = vec4(b.rgb + texture2D(tBloom, vUv).rgb*uStrength, b.a); }`,
    });
    this.quad = new FullScreenQuad(null);
  }
  render(renderer, writeBuffer, readBuffer) {
    let src = readBuffer.texture, sw = readBuffer.width, sh = readBuffer.height;
    this.quad.material = this.downMat;
    this.downs.forEach((rt, i) => {
      const u = this.downMat.uniforms;
      u.tSrc.value = src; u.uTexel.value.set(1 / sw, 1 / sh); u.uPre.value = i === 0 ? 1 : 0;
      u.uThr.value = this.threshold; u.uKnee.value = this.knee;
      renderer.setRenderTarget(rt); this.quad.render(renderer);
      src = rt.texture; sw = rt.width; sh = rt.height;
    });
    this.quad.material = this.upMat;
    let low = this.downs[this.downs.length - 1];
    for (let i = this.downs.length - 2; i >= 0; i--) {
      const u = this.upMat.uniforms, out = this.ups[i];
      u.tLow.value = low.texture; u.tHigh.value = this.downs[i].texture;
      u.uTexel.value.set(1 / low.width, 1 / low.height); u.uRadius.value = this.radius;
      renderer.setRenderTarget(out); this.quad.render(renderer);
      low = out;
    }
    const c = this.compMat.uniforms;
    c.tBase.value = readBuffer.texture; c.tBloom.value = low.texture; c.uStrength.value = this.strength;
    this.quad.material = this.compMat;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
}
