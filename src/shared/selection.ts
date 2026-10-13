export interface Rect { x: number; y: number; width: number; height: number }
export interface Selection { sessionId: number; rect: Rect }
export interface XY { x: number; y: number }
export const contains = (r: Rect, p: XY): boolean => p.x >= r.x && p.y >= r.y && p.x <= r.x+r.width && p.y <= r.y+r.height;
export function validRect(r: unknown, width: number, height: number): r is Rect {
  if (!r || typeof r !== 'object') return false;
  const v=r as Rect;
  return [v.x,v.y,v.width,v.height].every(Number.isFinite) && v.x>=0 && v.y>=0 && v.width>=8 && v.height>=8 && v.x+v.width<=width && v.y+v.height<=height;
}
export function bitmapRect(r: Rect, dw: number, dh: number, width: number, height: number): Rect {
  if (!validRect(r,dw,dh) || ![dw,dh,width,height].every(n=>Number.isFinite(n)&&n>0)) throw Error('选区无效，请重新框选');
  const x=Math.max(0,Math.floor(r.x/dw*width)), y=Math.max(0,Math.floor(r.y/dh*height));
  const right=Math.min(width,Math.ceil((r.x+r.width)/dw*width)), bottom=Math.min(height,Math.ceil((r.y+r.height)/dh*height));
  return {x,y,width:right-x,height:bottom-y};
}

/** Rectangle creation, corner resizing and whole-selection moving, all in local DIP. */
export class SelectionDrag {
  private start: XY={x:0,y:0};
  private original: Rect | null=null;
  private anchor: XY | null=null;
  begin(p: XY, current: Rect | null): void {
    this.start=p;this.original=null;this.anchor=p;
    if (!current) return;
    for (const x of [current.x,current.x+current.width]) for(const y of [current.y,current.y+current.height]) {
      if(Math.abs(p.x-x)<=10&&Math.abs(p.y-y)<=10){this.anchor={x:x===current.x?current.x+current.width:current.x,y:y===current.y?current.y+current.height:current.y};return;}
    }
    if(contains(current,p)){this.original={...current};this.anchor=null;}
  }
  move(p: XY, width: number, height: number): Rect {
    if(this.original){const r=this.original;return {...r,x:Math.max(0,Math.min(width-r.width,r.x+p.x-this.start.x)),y:Math.max(0,Math.min(height-r.height,r.y+p.y-this.start.y))};}
    const a=this.anchor!;
    const x=Math.max(0,Math.min(width,p.x)),y=Math.max(0,Math.min(height,p.y));
    const ax=Math.max(0,Math.min(width,a.x)),ay=Math.max(0,Math.min(height,a.y));
    return {x:Math.min(ax,x),y:Math.min(ay,y),width:Math.abs(x-ax),height:Math.abs(y-ay)};
  }
}
