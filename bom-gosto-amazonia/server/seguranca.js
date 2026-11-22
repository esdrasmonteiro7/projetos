// Cabeçalhos de segurança do painel (CSP, HSTS etc.). Usado pelo servidor e pelo build da Netlify (arquivo _headers),
// para que as páginas tenham exatamente as mesmas proteções nos dois modos.
import helmet from 'helmet';

export function opcoesHelmet(producao) {
  return {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: producao ? { maxAge: 15552000 } : false,
  };
}

export const middlewareSeguranca = (producao) => helmet(opcoesHelmet(producao));
