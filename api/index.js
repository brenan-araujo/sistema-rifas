// Ponto de entrada das funções Serverless no Vercel
const app = require('../server.js');

module.exports = (req, res) => {
  // Normalização de rota para compatibilidade com Vercel Serverless
  const matchedPath = 
    req.headers['x-matched-path'] || 
    req.headers['x-vercel-matched-path'] || 
    req.headers['x-now-route-matches'] || 
    req.headers['x-forwarded-uri'] ||
    req.originalUrl;

  let targetPath = null;
  if (matchedPath && matchedPath.startsWith('/api')) {
    targetPath = matchedPath;
  } else if (req.originalUrl && req.originalUrl.startsWith('/api')) {
    targetPath = req.originalUrl;
  } else if (req.url && !req.url.startsWith('/api')) {
    targetPath = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
  }

  if (targetPath) {
    const queryIdx = req.url.indexOf('?');
    if (queryIdx !== -1 && !targetPath.includes('?')) {
      targetPath += req.url.slice(queryIdx);
    }
    req.url = targetPath;
  }

  return app(req, res);
};

