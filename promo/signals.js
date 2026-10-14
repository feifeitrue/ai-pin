// Each sequence explains an existing signal intent. Text and task IDs are demonstration data.
const scenes={
 question:{name:'问号',title:'看不懂的地方，问个明白。',icon:'enemy_missing',slot:6,sound:'MIA',rect:true,color:'#c6a244',
  file:'二分查找.md',heading:'二分查找，为什么这么快？',category:'学习笔记 / 算法与复杂度',
  content:['每次比较，都排除一半不可能的答案。','n → n / 2 → n / 4 → … → 1','查找次数：log₂(n)'],
  context:'背景：数据已排序；每次比较中间位置。',ask:'解释框内这段推导。',intro:['理解所指内容','解释原因与适用边界','全图也作为上下文参考'],
  reply:[['解释','每次比较都将候选范围减半。'],['例子','8 个元素 → 4 → 2 → 1。'],['结论','因此次数随 log₂(n) 增长。'],['边界','前提是数据有序，能排除一半。']],
  message:'框内是重点，全图补充上下文。',end:'解释清楚，再回到你正在看的内容。'},
 allin:{name:'全力进攻',title:'不止复述，给一个有理由的观点。',icon:'all_in',slot:3,sound:'SRP_4',color:'#cf9d2a',
  file:'架构讨论.md',heading:'所有项目都应该拆成微服务？',category:'团队讨论 / 架构选择',
  content:['“服务越多，扩展就越容易。”','团队只有 3 人，每周发布一次。','目前还没有明确的性能瓶颈。'],
  context:'讨论背景：小团队，需要尽快验证产品。',ask:'你怎么看这个架构建议？',intro:['明确表达自己的观点','给出理由与适用条件','补充关键反例，不只附和'],
  reply:[['观点','这个团队先采用模块化单体。'],['理由','减少部署和数据一致性的负担。'],['条件','业务边界仍在变化、团队较小。'],['反例','需独立扩缩容时，再考虑拆分。']],
  message:'观点、理由、条件、反例，一起给。',end:'把分歧讲具体，帮助你做判断。'},
 needvision:{name:'需要视野',title:'看到值得留存的内容，插个眼。',icon:'need_vision',slot:5,sound:'SRP_7',rect:true,note:true,color:'#5ba84b',
  file:'重试策略.md',heading:'重试不是“失败就再来一次”',category:'技术阅读 / 可靠性',
  content:['只对可重试错误重试。','退避等待，避免集中重试。','写操作需要考虑幂等。'],
  context:'阅读目标：整理一份以后能找到的笔记。',ask:'整理这段内容并保存笔记。',intro:['整理标题、要点和必要解释','保留截图与指向坐标','实际写入成功后提示已保存'],
  reply:[['标题','重试策略：范围、退避与幂等'],['原文','限制重试范围，并使用退避。'],['分析','重复执行不应产生额外副作用。'],['提醒','失败不一定意味着服务未执行。']],
  message:'正文、截图、坐标，归入同一任务。',end:'真正保存成功，才提示“已保存”。'},
 enemyvision:{name:'敌方视野',title:'把值得留意的细节，连同画面保存。',icon:'enemy_vision',slot:7,sound:'AreaIsWarded',note:true,color:'#d95566',
  file:'读写分离.md',heading:'写入成功，为什么暂时读不到？',category:'技术阅读 / 数据一致性',
  content:['读副本可能暂时落后于主库。','写后立即读，需要一致性策略。','不能直接把延迟当作数据丢失。'],
  context:'当前关注：读副本的延迟与写后读取。',ask:'分析这段内容并保存记录。',intro:['与“需要视野”同为笔记意图','区分原始内容和 AI 分析','截图和坐标保留在对应记录中'],
  reply:[['标题','读写分离中的写后读取问题'],['原文','副本可能落后，需考虑一致性。'],['分析','可按业务需求决定读取路径。'],['边界','要区分复制延迟与真正的丢失。']],
  message:'敌方视野同样用于分析并保存。',end:'保留原始画面，也保留分析依据。'},
 assist:{name:'请求协助',title:'陌生概念，让 AI 带你学会。',icon:'assist_me',slot:4,sound:'ComeHere',color:'#55a249',
  file:'接口设计.md',heading:'“幂等”到底是什么意思？',category:'学习笔记 / 接口设计',
  content:['多次执行，结果与执行一次相同。','例如：把开关“设为关闭”。','与“把开关状态翻转”有什么区别？'],
  context:'学习目标：先理解概念，再用于接口设计。',ask:'从入门角度讲解“幂等”。',intro:['先用通俗语言解释','给出具体例子与必要前提','指出一个常见误解'],
  reply:[['通俗解释','重复做，也不会多出一份效果。'],['例子','“设为关闭”可以重复执行。'],['对比','“翻转开关”每次都会改变状态。'],['常见误解','幂等不要求每次返回值相同。']],
  message:'讲解 → 举例 → 对比 → 常见误解。',end:'不只给定义，也让你知道怎么用。'}
};
const requestedScene=new URLSearchParams(location.search).get('scene')||'question';
const sceneId=requestedScene==='feedback'?'question':requestedScene;
const s=scenes[sceneId];if(!s)throw Error('Unknown scene');
canvas.setAttribute('aria-label','ai-ping '+s.name+'功能演示动画，预设内容，非实时录屏');
const R={x:110,y:356,w:658,h:199};
const origin=s.rect?{x:667,y:626}:{x:403,y:452};
const angle=(s.slot*45-90)*Math.PI/180;
const target={x:origin.x+Math.cos(angle)*140,y:origin.y+Math.sin(angle)*140};
const number=Object.keys(scenes).indexOf(sceneId)+1;
const task=`LP-DEMO-0${number}`;
function paper(){
 box(48,181,792,574,15,'#fff');box(48,181,792,43,15,'#e6edf4');box(48,207,792,17,0,'#e6edf4');
 text('阅读窗口',73,210,17,muted,500);text(s.file,190,210,17,ink,600);line(766,201,778,201,muted);box(793,196,10,10,0,null,muted);
 text(s.heading,91,281,30,ink,600);text(s.category,93,315,17,muted);line(92,336,796,336);
 text('当前阅读',131,389,19,blue,600);
 s.content.forEach((v,i)=>text(v,131,434+i*46,i===1&&sceneId==='question'?28:24,ink,i===1?500:400));
 text(s.context,94,606,20,muted);
 text(s.rect?'矩形框选：框内为主，全图辅助理解。':'自由指向：信号附近为主，其余区域作为参考。',94,716,18,muted);
}
function select(t){if(!s.rect||t<1.65||t>5.65)return;const k=phase(t,1.65,2.9);c.save();c.globalAlpha=1-phase(t,5.25,5.65);box(R.x,R.y,R.w*k,R.h*k,3,'#3486c51b');c.strokeStyle=blue;c.lineWidth=2;c.strokeRect(R.x,R.y,R.w*k,R.h*k);if(k===1){for(const [x,y] of [[R.x,R.y],[R.x+R.w,R.y],[R.x,R.y+R.h],[R.x+R.w,R.y+R.h]])box(x-4,y-4,8,8,1,'#fff',blue);box(R.x,R.y-31,168,26,5,blue);text('框内为本次分析重点',R.x+9,R.y-12,15,'#fff',500)}c.restore()}
function snapshot(x,y,w,h){box(x,y,w,h,7,'#edf4fa');text(s.rect?'矩形选区 + 全图上下文':'信号位置 + 全图上下文',x+12,y+24,14,blue,600);text(s.content[0],x+12,y+54,16,ink,500);text('示例任务 '+task,x+12,y+81,14,muted)}
function archive(t){const p=phase(t,11.8,12.05);if(!p)return;c.save();c.globalAlpha=p;box(864,355,528,335,0,'#fff');text('笔记已写入 · 记录内容示意',891,389,21,ink,600);text(task+' /',891,425,17,muted);
 const files=[['note.txt','标题与分析正文'],['screen.png','完整屏幕截图'],['detail.png','局部截图'],['result.json','任务信息与原始坐标']];
 files.forEach(([file,label],i)=>{const y=463+i*49;box(893,y-17,17,21,2,null,'#6c8ba1');line(896,y-11,906,y-11,'#6c8ba1');text(file,925,y+1,20,ink,500);text(label,1087,y+1,18,muted);line(891,y+15,1360,y+15,'#e7ecf2')});c.restore();
}
function chat(t){
 box(864,181,528,574,15,'#fff');text('Codex',891,216,23,ink,600);text('演示对话',989,215,15,muted);line(886,235,1370,235);
 const status=t<5.45?'已绑定接收聊天':t<6.7?'已收到截图':t<10.7?'正在分析':s.note&&t<11.8?'正在保存笔记…':s.note?'已保存':'本轮已完成';
 text(status,891,268,17,t>=11.8?'#247450':muted,500);
 if(t<5.45){art(s.icon,941,380,76);text(s.name,1002,389,28,ink,600);s.intro.forEach((v,i)=>text(v,907,455+i*41,21,muted));text('每项任务独立编号，图片与意图对应。',908,647,18,muted);return}
 box(890,290,476,53,10,'#eff3f7');art(s.icon,915,316,30);text(s.ask,944,324,21,ink,500);
 if(t>=6.05)snapshot(890,355,476,92);
 if(t>=6.7){let n=Math.floor((t-6.7)*39);s.reply.forEach(([label,body],i)=>{const y=484+i*53;const l=label.slice(0,Math.max(0,n));n-=label.length;const b=body.slice(0,Math.max(0,n));n-=body.length;text(l,891,y,16,blue,600);text(b,891,y+25,20,ink,400)})}
 if(s.note)archive(t);
 if(t>=11.8){box(890,698,s.note?366:220,31,6,'#e8f3ec');text(s.note?'已保存 · 正文、截图、坐标对应':'已完成 · 自动提醒',903,720,17,'#247450',600)}
}
function travel(t){if(t<5.45||t>6.08)return;const p=phase(t,5.45,6.08),x=lerp(R.x,890,p),y=lerp(R.y,355,p)-Math.sin(p*Math.PI)*54,w=lerp(R.w,476,p),h=lerp(R.h,92,p);box(x,y,w,h,8,'#edf4fa',blue);c.save();c.translate(x,y);c.scale(w/658,h/199);text(s.content[0],20,70,24,ink,500);text(s.content[1],20,120,24,ink,500);text(s.content[2],20,166,21,muted);c.restore()}
const path=s.rect?[[0,536,666],[1.4,R.x,R.y],[1.65,R.x,R.y],[2.9,R.x+R.w,R.y+R.h],[3.75,origin.x,origin.y],[4.35,origin.x,origin.y],[5.1,target.x,target.y],[5.75,target.x,target.y],[6.55,origin.x,origin.y],[15,origin.x,origin.y],[17,536,666]]:[[0,536,666],[2,origin.x,origin.y],[4.35,origin.x,origin.y],[5.1,target.x,target.y],[5.75,target.x,target.y],[6.55,origin.x,origin.y],[15,origin.x,origin.y],[17,536,666]];
function point(t){for(let i=1;i<path.length;i++){const [b,x,y]=path[i],[a,px,py]=path[i-1];if(t<=b){const k=phase(t,a,b);return [lerp(px,x,k),lerp(py,y,k)]}}return [536,666]}
function footer(t){const phaseId=t<3.8?0:t<5.5?1:t<10.7?2:t<11.8&&s.note?3:4;
 const title=phaseId===0?(s.rect?'双击 Alt，拖出要分析的内容。':'把鼠标放到你关注的内容附近。'):phaseId===1?`选择“${s.name}”，松手发送。`:phaseId===2?s.message:phaseId===3?'正在写入笔记，等待保存结果。':s.end;
 const sub=phaseId===0?(s.rect?'用左键拖出矩形；随后可在框外发送':'不用框选也可以使用；全图仍提供上下文'):phaseId===1?(s.rect?'信号在鼠标起点出现，不移到选区中心':'截图、坐标和意图随独立任务一起发送'):phaseId===3?'尚未写入成功，不提前显示“已保存”':phaseId===4?'正在路上：本轮真实结束时的自动提醒':'预设示例回答 · 演示已缩短等待时间';
 text(title,49,808,28,ink,600);text(sub,50,848,19,muted);
 if(phaseId<2){key('Alt',1212,785,t>=4&&t<5.25||(s.rect&&(t>1.05&&t<1.18||t>1.3&&t<1.43)));text(s.rect&&phaseId===0?'× 2':'拖动',1295,812,22,muted)}else art(phaseId===4?'omw':s.icon,1330,810,52);
 for(let i=0;i<4;i++)box(50+i*39,872,29,4,2,i===Math.min(3,phaseId)?blue:'#c6d1dd');text('ai-ping · github.com/feifeitrue/ai-ping',953,875,16,muted);
}
function paint(t){c.fillStyle='#edf0f4';c.fillRect(0,0,W,H);text('ai-ping',49,62,39,ink,700);art(s.icon,243,49,39);text(s.name,273,60,24,ink,600);text(s.title,49,128,42,ink,600);text('功能演示动画 · 非实时录屏',1120,58,17,muted);paper();chat(t);select(t);travel(t);wheel(origin.x,origin.y,t,4,5.25,s.slot);ping(s.icon,origin.x,origin.y,t,5.25,s.color);ping('omw',origin.x,origin.y,t,12.1,'#398ed0');const [x,y]=point(t);cursor(x,y,(s.rect&&t>=1.65&&t<2.9)||t>=4&&t<5.25);footer(t)}
const buffer=document.createElement('canvas');buffer.width=W;buffer.height=H;const bc=buffer.getContext('2d');
window.renderAt=time=>{const t=((time%18)+18)%18;paint(t);if(t>17.25){bc.clearRect(0,0,W,H);bc.drawImage(canvas,0,0);paint(0);c.save();c.globalAlpha=1-phase(t,17.25,18);c.drawImage(buffer,0,0);c.restore()}};
window.renderSpec={seconds:18,stills:[0,2.95,4.9,5.65,9.95,10.95,12.35,15.6],sounds:[{file:s.sound,at:5.25},{file:'OnMyWay',at:12.1}],scene:sceneId,title:s.name};
window.ready=Promise.all(icons.map(id=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{images[id]=img;resolve()};img.onerror=reject;img.src='../assets/textures/'+id+'.png'}))).then(()=>window.renderAt(0));
let playing=!matchMedia('(prefers-reduced-motion: reduce)').matches,start=performance.now(),held=0;const button=document.querySelector('button');button.textContent=playing?'暂停动画':'播放动画';
button.onclick=()=>{playing=!playing;if(playing)start=performance.now()-held*1000;button.textContent=playing?'暂停动画':'播放动画'};
if(!location.search.includes('render'))window.ready.then(()=>{function tick(now){if(playing&&!document.hidden){held=(now-start)/1000;window.renderAt(held)}requestAnimationFrame(tick)}requestAnimationFrame(tick)});else button.remove();

// A dedicated closing beat makes automatic AI-to-user feedback visible in the short edit.
if(requestedScene==='feedback'){
 window.renderAt=time=>{
  const t=Math.max(0,time);c.fillStyle='#edf0f4';c.fillRect(0,0,W,H);
  text('ai-ping',49,62,39,ink,700);text('AI → 你',247,59,24,blue,600);
  text('AI 干完活，会主动 ping 你。',49,128,46,ink,600);
  text('功能演示动画 · 非实时录屏',1120,58,17,muted);
  paper();chat(t<1.2?10.6:15);
  cursor(origin.x,origin.y);
  if(t>=1.2){
   const age=t-1.2;
   if(age<1.4)ping('omw',origin.x,origin.y,t,1.2,'#398ed0');
   if(age>=1.1)art('omw',origin.x,origin.y-18,83,phase(age,1.1,1.4));
   box(origin.x-132,origin.y-117,264,40,8,'#2675bd');
   text('AI 主动 ping 你 · 活干完了',origin.x-120,origin.y-89,19,'#fff',600);
  }
  text(t<1.2?'AI 正在干活，你可以先忙别的。':'你忙你的，完成了它会主动提醒。',49,808,29,ink,600);
  text('不用盯着聊天等 · 完成后主动发出图标和音效',50,848,20,muted);
  art('omw',1330,810,55);text('ai-ping · github.com/feifeitrue/ai-ping',953,875,16,muted);
 };
 window.renderSpec={seconds:5.5,stills:[0,1.4,2,4.8],sounds:[{file:'OnMyWay',at:1.2}],scene:'feedback',title:'AI 自动完成反馈'};
}
