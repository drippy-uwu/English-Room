// Development-only static file server. Not a Node backend and never deployed.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root=resolve(import.meta.dirname,'..');
const allowed=new Set(['index.html','style.css','script.js','firebase-config.js','firebase.js','multiplayer.js','battle.js','battle-state.js']);
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};
const port=Number(process.env.PORT || 4173);
createServer(async(req,res)=>{
  try {
    const file=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,'')||'index.html';
    if(!allowed.has(file)){res.writeHead(404);res.end('Not found');return}
    const content=await readFile(resolve(root,file));
    res.writeHead(200,{'Content-Type':types[extname(file)],'Cache-Control':'no-store'});res.end(content);
  } catch {res.writeHead(500);res.end('Unable to read file')}
}).listen(port,'0.0.0.0',()=>console.log(`Static preview: http://localhost:${port} (same Wi-Fi: http://YOUR-LAPTOP-IP:${port})`));
