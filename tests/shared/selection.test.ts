import {expect,it} from 'vitest';
import {bitmapRect,contains,SelectionDrag,validRect} from '../../src/shared/selection';
it('maps the entire selected rectangle using actual bitmap dimensions at mixed DPI',()=>{
 expect(bitmapRect({x:100,y:80,width:300,height:160},1280,720,1920,1080)).toEqual({x:150,y:120,width:450,height:240});
 expect(bitmapRect({x:1270,y:710,width:10,height:10},1280,720,1920,1080)).toEqual({x:1905,y:1065,width:15,height:15});
 for(const rect of [null,{}, {x:-1,y:0,width:20,height:20},{x:0,y:0,width:Infinity,height:20},{x:0,y:0,width:2,height:20},{x:95,y:0,width:10,height:20}])expect(validRect(rect,100,100)).toBe(false);
});
it('supports reversed drawing, corner resizing, moving and display-edge clamping',()=>{
 const drag=new SelectionDrag();drag.begin({x:400,y:300},null);
 const first=drag.move({x:100,y:80},800,600);expect(first).toEqual({x:100,y:80,width:300,height:220});
 drag.begin({x:400,y:300},first);expect(drag.move({x:900,y:700},800,600)).toEqual({x:100,y:80,width:700,height:520});
 drag.begin({x:200,y:150},first);expect(drag.move({x:-200,y:-300},800,600)).toEqual({x:0,y:0,width:300,height:220});
 expect(contains(first,{x:200,y:150})).toBe(true);expect(contains(first,{x:99,y:150})).toBe(false);
});
