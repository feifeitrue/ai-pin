import { SelectionDrag, validRect, type Rect, type XY } from '../../shared/selection';

/** Draws the frozen surface; input stays in the existing native hook, so this never takes focus. */
export class SelectionView {
  private root=document.createElement('div');
  private image=document.createElement('img');
  private box=document.createElement('div');
  private hint=document.createElement('div');
  private drag=new SelectionDrag();
  private dragging=false;
  private sessionId:number|null=null;
  private rect:Rect|null=null;
  constructor() {
    this.root.id='selection';this.root.hidden=true;
    this.image.className='selection-image';this.image.alt='已固定的屏幕画面';
    this.box.className='selection-box';this.box.hidden=true;
    for(const corner of ['nw','ne','sw','se']){const handle=document.createElement('i');handle.className=corner;this.box.append(handle);}
    this.hint.className='selection-hint';this.hint.setAttribute('role','status');
    this.root.append(this.image,this.box,this.hint);document.body.prepend(this.root);
  }
  get active():boolean{return this.sessionId!==null;}
  loading():void {
    this.close();this.root.hidden=false;this.image.hidden=true;this.box.hidden=true;
    this.hint.textContent='正在固定当前画面，请稍候… · Esc 取消';
    document.body.classList.add('selection-loading');
  }
  open(sessionId:number,image:string):void {
    this.sessionId=sessionId;this.rect=null;this.dragging=false;
    this.image.src=image;this.image.hidden=false;this.root.hidden=false;this.box.hidden=true;
    document.body.classList.remove('selection-loading');
    document.body.classList.add('selecting');
    this.hint.textContent='拖动框选重点 · Esc / 右键取消';
  }
  close():void {this.sessionId=null;this.rect=null;this.dragging=false;this.root.hidden=true;this.image.removeAttribute('src');document.body.classList.remove('selecting','selection-loading');}
  pointer(p:XY & {phase:'down'|'move'|'up'}):void {
    if(!this.active)return;
    if(p.phase==='down'){this.drag.begin(p,this.rect);this.dragging=true;}
    if(!this.dragging)return;
    this.rect=this.drag.move(p,innerWidth,innerHeight);
    const r=this.rect;
    Object.assign(this.box.style,{left:`${r.x}px`,top:`${r.y}px`,width:`${r.width}px`,height:`${r.height}px`});
    this.box.hidden=false;
    if(p.phase==='up') {
      this.dragging=false;
      window.overlay.setSelection({sessionId:this.sessionId!,rect:{...r}});
    }
    this.hint.textContent=validRect(r,innerWidth,innerHeight)
      ? '在任意位置按住 Alt 拖动，松手发信号 · AI 重点分析选区 · 拖动选区或角点可调整 · Esc 取消'
      : '选区太小，请重新拖动框选 · Esc 取消';
  }
}
