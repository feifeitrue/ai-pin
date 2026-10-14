import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'..');
const dest=resolve(process.argv[2]||join(root,'docs/media/ai-ping'));
await mkdir(dest,{recursive:true});
const scene=process.argv.find(v=>v.startsWith('--scene='))?.split('=')[1];
const basename=scene?'ai-ping-'+scene:'ai-ping-demo';
const ffmpeg=process.env.FFMPEG_PATH||join(here,'node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe');
const browserPath=process.env.BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const server=createServer(async(req,res)=>{
 try{const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));
 if(!path.startsWith(root+sep)){res.writeHead(403).end();return}
 const data=await readFile(path);res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.png':'image/png','.js':'text/javascript; charset=utf-8'})[extname(path)]||'application/octet-stream');res.end(data);
 }catch{res.writeHead(404).end()}
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const browser=await chromium.launch({executablePath:browserPath,headless:true});
function run(args){return new Promise((resolve,reject)=>{const p=spawn(ffmpeg,args,{stdio:['ignore','ignore','pipe']});let err='';p.stderr.on('data',v=>err+=v);p.on('error',reject);p.on('close',code=>code===0?resolve():reject(Error(err)))})}
try{
 const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
 await page.goto(`http://127.0.0.1:${server.address().port}/promo/${scene?'signals':'hero'}.html?render${scene?'&scene='+encodeURIComponent(scene):''}`);await page.evaluate(()=>window.ready);
 const spec=await page.evaluate(()=>window.renderSpec||{seconds:20,stills:[0,2.45,5.9,8.1,9.25,12.9,14.5,17],sounds:[{file:'OnMyWay',at:2.3},{file:'MIA',at:8.8},{file:'OnMyWay',at:14.2}]});
 const stills=spec.stills;
 for(let i=0;i<stills.length;i++){await page.evaluate(t=>window.renderAt(t),stills[i]);await page.screenshot({path:join(dest,`frame-${i}.png`)});}
 if(process.argv.includes('--stills')){console.log('Stills:',dest)}else{
  const fps=30,frames=spec.seconds*fps;
  const encoder=spawn(ffmpeg,['-y','-loglevel','error','-f','image2pipe','-framerate',String(fps),'-i','pipe:0','-an','-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart',join(dest,basename+'-silent.mp4')],{stdio:['pipe','ignore','pipe']});
  let errors='';encoder.stderr.on('data',v=>errors+=v);const done=once(encoder,'close');
  for(let frame=0;frame<frames;frame++){
   const png=await page.evaluate(t=>{window.renderAt(t);return document.querySelector('canvas').toDataURL('image/png').split(',')[1]},frame/fps);
   if(!encoder.stdin.write(Buffer.from(png,'base64')))await once(encoder.stdin,'drain');
   if(frame%150===0)console.log(`Frames ${frame}/${frames}`);
  }
  encoder.stdin.end();if((await done)[0]!==0)throw Error(errors);
  await run(['-y','-loglevel','error','-i',join(dest,basename+'-silent.mp4'),'-filter_complex','fps=15,scale=1008:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle','-loop','0',join(dest,basename+'.gif')]);
  // Actual source signal sounds, aligned with the animated send/completion events.
  const audioInputs=spec.sounds.flatMap(v=>['-i',join(root,'assets/sounds',v.file+'.wav')]);
  const filters=spec.sounds.map((v,i)=>`[${i+1}:a]volume=0.5,adelay=${Math.round(v.at*1000)}|${Math.round(v.at*1000)},apad[a${i}]`);
  filters.push(spec.sounds.map((_,i)=>`[a${i}]`).join('')+`amix=inputs=${spec.sounds.length},volume=${spec.sounds.length}[audio]`);
  await run(['-y','-loglevel','error','-i',join(dest,basename+'-silent.mp4'),...audioInputs,'-filter_complex',filters.join(';'),'-map','0:v','-map','[audio]','-c:v','copy','-c:a','aac','-b:a','128k','-t',String(spec.seconds),'-movflags','+faststart',join(dest,basename+'.mp4')]);
  await writeFile(join(dest,'render-info.json'),JSON.stringify({...spec,mp4:{width:1440,height:900,fps:30},gif:{width:1008,height:630,fps:15},kind:'Scripted illustration, not a live screen recording',stills},null,2));
  console.log('Rendered:',dest);
 }
}finally{await browser.close();server.close()}
