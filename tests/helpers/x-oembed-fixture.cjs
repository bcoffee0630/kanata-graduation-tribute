const { createServer } = require('node:http');

async function startXEmbedFixture() {
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1:9394');
    const postUrl = url.searchParams.get('url') || '';
    const postId = postUrl.match(/\/status\/(\d+)/)?.[1] || '';
    const status = url.pathname !== '/oembed' || !postId || postId.endsWith('404')
      ? 404 : postId.endsWith('503') ? 503 : 200;
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(status === 200 ? {
      type: 'rich',
      html: `<blockquote class="twitter-tweet"><a href="${postUrl}">Fixture post</a></blockquote>`
    } : { error: 'Fixture unavailable' }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(9394, '127.0.0.1', resolve);
  });
  return () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

module.exports = { startXEmbedFixture };
