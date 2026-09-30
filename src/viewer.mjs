import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const PAGE = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PR QA run</title>
<style>body{font:16px system-ui;background:#0d1420;color:#e5edf7;max-width:1000px;margin:40px auto;padding:0 20px}h1{font-size:28px}.muted{color:#9aacc3}.card{background:#172338;border:1px solid #2d405e;border-radius:12px;padding:18px;margin:12px 0}.passed{color:#6cdbac}.failed{color:#ff8b8b}.running{color:#ffcf7a}img{width:100%;border-radius:10px;margin-top:16px;border:1px solid #344766}code{color:#b8d5ff}a{color:#8fc6ff}</style>
<h1>PR QA run</h1><p class="muted" id="status">Connecting…</p><div id="events"></div><img id="shot" hidden alt="Latest browser screenshot">
<script>const events=document.querySelector('#events'),status=document.querySelector('#status'),shot=document.querySelector('#shot');let n=0;const stream=new EventSource('/events');stream.onopen=()=>status.textContent='Watching execution';stream.onerror=()=>status.textContent='Connection closed — saved report remains available';stream.onmessage=e=>{const x=JSON.parse(e.data);const box=document.createElement('div');box.className='card';const title=document.createElement('strong');title.textContent=x.type==='step'?(x.status+' · '+x.step.action+' '+x.step.target):(x.type+' · '+(x.name||x.status||x.error||''));title.className=x.status||'';box.append(title);if(x.error){const p=document.createElement('p');p.textContent=x.error;box.append(p)}events.prepend(box);if(x.screenshot){shot.hidden=false;shot.src='/files/'+encodeURIComponent(x.screenshot)+'?v='+(++n)}if(x.type==='done'){status.textContent=x.passed?'All tests passed':'QA found a failure';const link=document.createElement('a');link.href='/files/report.json';link.textContent='Download report.json';events.prepend(link)}};</script></html>`;

export async function startViewer(outputDir, port = 4177) {
  const clients = new Set();
  const history = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PAGE); return; }
    if (url.pathname === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      clients.add(res); for (const event of history) res.write(`data: ${JSON.stringify(event)}\n\n`);
      req.on('close', () => clients.delete(res)); return;
    }
    if (url.pathname.startsWith('/files/')) {
      const filename = decodeURIComponent(url.pathname.slice(7));
      if (!/^[a-zA-Z0-9._-]+$/.test(filename)) { res.writeHead(400); res.end(); return; }
      try {
        const data = await readFile(path.join(outputDir, filename));
        const type = filename.endsWith('.png') ? 'image/png' : filename.endsWith('.webm') ? 'video/webm' : 'application/octet-stream';
        res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }); res.end(data);
      } catch { res.writeHead(404); res.end(); }
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${port}`,
    emit(event) { history.push(event); for (const client of clients) client.write(`data: ${JSON.stringify(event)}\n\n`); },
    close() { return new Promise(resolve => server.close(resolve)); }
  };
}
