import {beforeEach,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({writes:new Map<string,string|Buffer>(),getSources:vi.fn(),displays:[] as any[]}));
vi.mock('electron',()=>({app:{getPath:()=>'/capture'},desktopCapturer:{getSources:h.getSources},screen:{getAllDisplays:()=>h.displays}}));
vi.mock('node:fs/promises',()=>({mkdir:vi.fn(),writeFile:async(p:string,data:string|Buffer)=>{h.writes.set(p,data)}}));
import {capturePing} from '../../src/main/aiCapture';
beforeEach(()=>{h.writes.clear();h.getSources.mockReset();h.displays=[];});
it('uses the retained frame after desktop/display changes and saves exact rectangle metadata',async()=>{
 const crop=vi.fn(()=>({toPNG:()=>Buffer.from('selected-frame-A')}));
 const image={getSize:()=>({width:1920,height:1080}),toPNG:()=>Buffer.from('frame-A'),crop};
 const frame={image,display:{id:9,bounds:{x:-1280,y:0,width:1280,height:720},scaleFactor:1.5},capturedAt:'2026-10-13T00:00:00Z'} as any;
 const result=await capturePing({id:'needvision',displayId:9,x:250,y:160,focus:{sessionId:7,frame,rect:{x:100,y:80,width:300,height:160}}});
 expect(h.getSources).not.toHaveBeenCalled();expect(crop).toHaveBeenCalledWith({x:150,y:120,width:450,height:240});
 expect(h.writes.get(result.path)).toEqual(Buffer.from('frame-A'));
 const metadata=JSON.parse([...h.writes.entries()].find(([p])=>p.endsWith('.json'))![1] as string);
 expect(metadata).toMatchObject({capturedAt:frame.capturedAt,focus:{sessionId:7,mode:'rectangle',rect:{x:150,y:120,width:450,height:240}},point:{x:375,y:240}});
 expect(result.instruction).toContain('整个框内都是分析主体');expect(result.instruction).toContain('原图仅用于补充必要上下文');
});
it('free pointing keeps the complete screenshot and treats the nearby crop as a reference, not a boundary',async()=>{
 h.displays=[{id:2,bounds:{x:0,y:0,width:640,height:480},scaleFactor:2}];
 const image={isEmpty:()=>false,getSize:()=>({width:1280,height:960}),toPNG:()=>Buffer.from('whole-screen'),crop:()=>({toPNG:()=>Buffer.from('nearby-detail')})};
 h.getSources.mockResolvedValue([{display_id:'2',thumbnail:image}]);
 const result=await capturePing({id:'assist',displayId:2,x:100,y:120});
 expect(h.getSources).toHaveBeenCalledOnce();expect(h.writes.get(result.path)).toEqual(Buffer.from('whole-screen'));
 expect(result.instruction).toContain('当前没有选区');expect(result.instruction).toContain('将其他区域作为上下文和参考点');expect(result.instruction).toContain('不是分析范围的硬边界');
 const meta=JSON.parse(h.writes.get(result.path.replace('.png','.json')) as string);
 expect(meta.focus).toBeUndefined();expect(meta.signal).toEqual({displayId:2,point:{x:100,y:120}});
});
