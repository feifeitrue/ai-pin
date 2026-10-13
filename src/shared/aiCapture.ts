export function shouldCapturePing(aiMode: boolean, enabled: boolean, id: string): boolean {
  return aiMode && enabled && ['missing', 'allin', 'needvision', 'enemyvision', 'assist'].includes(id);
}

export const aiIntentLabel = (id: string): string => (({ missing: '解释', allin: '观点', needvision: '记录', enemyvision: '记录', assist: '学习' } as Record<string, string>)[id] ?? '分析');

/** Convert display-local DIP coordinates to the actual captured bitmap pixels. */
export function captureRegion(x: number, y: number, displayWidth: number, displayHeight: number, width: number, height: number) {
  if (![x, y, displayWidth, displayHeight, width, height].every(Number.isFinite) || Math.min(displayWidth, displayHeight, width, height) <= 0) throw new Error('Invalid display geometry');
  const px = Math.min(width - 1, Math.max(0, Math.round(x / displayWidth * width)));
  const py = Math.min(height - 1, Math.max(0, Math.round(y / displayHeight * height)));
  const w = Math.min(640, width), h = Math.min(480, height);
  const left = Math.max(0, Math.min(width - w, Math.round(px - w / 2)));
  const top = Math.max(0, Math.min(height - h, Math.round(py - h / 2)));
  return { point: { x: px, y: py }, crop: { x: left, y: top, width: w, height: h }, cropPoint: { x: px - left, y: py - top } };
}
