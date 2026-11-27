// Ponto de entrada das funções Serverless no Vercel
const app = require('../server.js');

function getNormalizedUrl(rawUrl, headers = {}) {
  try {
    const parsed = new URL(rawUrl, 'http://localhost');
    const pathParam = parsed.searchParams.get('__path');

    if (pathParam !== null && pathParam !== undefined) {
      parsed.searchParams.delete('__path');
      const remainingSearch = parsed.searchParams.toString();
      const cleanPath = pathParam.startsWith('/') ? pathParam : '/' + pathParam;
      return '/api' + (cleanPath === '/' ? '' : cleanPath) + (remainingSearch ? '?' + remainingSearch : '');
    }

    const matched = headers['x-matched-path'] || headers['x-vercel-matched-path'];
    if (matched && matched.startsWith('/api') && matched !== '/api') {
      return matched;
    }

    return rawUrl;
  } catch {
    return rawUrl;
  }
}

module.exports = (req, res) => {
  req.url = getNormalizedUrl(req.url, req.headers);
  return app(req, res);
};


