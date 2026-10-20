const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const base=__dirname,extension=path.resolve(base,'..');
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  let file;
  if(url.pathname==='/')file=path.join(base,'browser-fixture.html');
  else if(url.pathname.startsWith('/extension/'))file=path.join(extension,path.basename(url.pathname));
  else if(['/mock-runtime.js','/fixture-setup.js','/fixture-tests.js'].includes(url.pathname))file=path.join(base,path.basename(url.pathname));
  else{res.writeHead(404);res.end('Not found');return;}
  fs.readFile(file,(err,data)=>{
    if(err){res.writeHead(404);res.end('Not found');return;}
    res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');
    res.setHeader('Cache-Control','no-store');res.end(data);
  });
});
const port=Number(process.env.PORT||8765);
server.listen(port,'127.0.0.1',()=>console.log(`Fixture server: http://127.0.0.1:${port}`));
