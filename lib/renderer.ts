import { activeVerse, getLineHeight, withEditableReference, type MediaAsset, type Project, type VisualLayer } from './model';
import { fontStack, getLayerFont } from './fonts';
import { backgroundMotionAt, horizontalTransitionAt, transitionAt } from './transitions';
import { animatedLines, lineRevealOpacity, lineWipeProgress, revealProgress } from './text-animation';

export type LayerBounds = { id: string; x: number; y: number; width: number; height: number };
export type RenderResources = { image?: HTMLImageElement; video?: HTMLVideoElement };
export { wrapText, layerText } from './text-layout';
import { layerText, fitProjectText, measureLayerText } from './text-layout';

const revealBuffers = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

function drawArabicWipe(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, text: string, left: number, y: number, width: number, maxWidth: number, fontSize: number, progress: number) {
  if (progress <= 0) return;
  let buffer = revealBuffers.get(canvas);
  if (!buffer) { buffer = document.createElement('canvas'); revealBuffers.set(canvas, buffer); }
  const metrics = ctx.measureText(text);
  const pad = Math.ceil(Math.max(14, fontSize * .25));
  const top = Math.ceil(Math.max(fontSize * 1.2, metrics.actualBoundingBoxAscent) + pad);
  const bottom = Math.ceil(Math.max(fontSize, metrics.actualBoundingBoxDescent) + pad);
  buffer.width = Math.ceil(width + pad * 2); buffer.height = top + bottom;
  const offscreen = buffer.getContext('2d')!;
  offscreen.font = ctx.font; offscreen.textBaseline = 'middle'; offscreen.textAlign = 'right'; offscreen.direction = 'rtl';
  offscreen.fillStyle = ctx.fillStyle;
  offscreen.shadowColor = ctx.shadowColor; offscreen.shadowBlur = ctx.shadowBlur; offscreen.shadowOffsetY = ctx.shadowOffsetY;
  offscreen.fillText(text, pad + width, top, maxWidth);
  const feather = Math.max(6, fontSize * .22);
  const edge = buffer.width - (buffer.width + feather) * progress;
  const mask = offscreen.createLinearGradient(edge, 0, edge + feather, 0);
  mask.addColorStop(0, 'transparent'); mask.addColorStop(1, '#ffffff');
  offscreen.globalCompositeOperation = 'destination-in'; offscreen.shadowColor = 'transparent'; offscreen.shadowBlur = 0; offscreen.shadowOffsetY = 0;
  offscreen.fillStyle = mask; offscreen.fillRect(0, 0, buffer.width, buffer.height);
  ctx.save(); ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  ctx.drawImage(buffer, left - pad, y - top); ctx.restore();
}


export function drawProject(canvas: HTMLCanvasElement, project: Project, time: number, resources: RenderResources): LayerBounds[] {
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  const { width: w, height: h, background: bg } = project;
  ctx.save(); ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, w, h);
  const backgroundEffect = transitionAt(bg.transition, time, 0, project.duration);
  const motion = backgroundMotionAt(bg.motion, time, project.duration, bg.motionStrength, bg.motionDuration, bg.motionRepeat);
  ctx.save(); ctx.globalAlpha = backgroundEffect.opacity; ctx.translate(horizontalTransitionAt(bg.transition, time, 0, project.duration) * w, backgroundEffect.y * h);
  ctx.fillStyle = bg.type === 'color' ? bg.source : '#24322f'; ctx.fillRect(0, 0, w, h);
  const media = bg.type === 'video' ? resources.video : resources.image;
  if (bg.type !== 'color' && media) {
    const mw = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth;
    const mh = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight;
    if (mw && mh) {
      ctx.save();
      const scale = Math.max(w / mw, h / mh) * bg.scale * motion.scale * (1 + Math.abs(backgroundEffect.scale - 1));
      ctx.filter = bg.blur ? `blur(${bg.blur}px)` : 'none';
      const imageX = Math.min(0, Math.max(w - mw * scale, (w - mw * scale) * bg.positionX / 100 + motion.x * w));
      const imageY = Math.min(0, Math.max(h - mh * scale, (h - mh * scale) * bg.positionY / 100 + ('y' in motion ? motion.y ?? 0 : 0) * h));
      ctx.drawImage(media, imageX, imageY, mw * scale, mh * scale);
      ctx.restore();
    }
  }
  ctx.fillStyle = `rgba(0,0,0,${bg.dim})`; ctx.fillRect(0, 0, w, h);
  ctx.restore();
  const bounds: LayerBounds[] = [];
  const currentVerse = activeVerse(project, time);
  for (const layer of fitProjectText(ctx, withEditableReference(project), time).project.layers) {
    if (!layer.visible || (layer.kind === 'reference' && !project.showReference) || time < layer.start || time >= layer.end) continue;
    const text = layerText(project, layer, time);
    if (!text) continue;
    ctx.save();
    ctx.font = `${layer.fontSize}px ${fontStack(getLayerFont(layer))}`;
    ctx.textAlign = layer.align; ctx.textBaseline = 'middle';
    ctx.direction = layer.kind === 'arabic' || /[\u0600-\u06ff]/.test(text) ? 'rtl' : 'ltr';
    const segmentStart = layer.kind !== 'text' && currentVerse ? Math.max(layer.start, currentVerse.start) : layer.start;
    const segmentEnd = layer.kind !== 'text' && currentVerse ? Math.min(layer.end, currentVerse.end) : layer.end;
    const effect = transitionAt(layer.transition, time, segmentStart, segmentEnd);
    const shiftX = horizontalTransitionAt(layer.transition, time, segmentStart, segmentEnd) * w;
    ctx.fillStyle = layer.color; ctx.globalAlpha = layer.opacity * effect.opacity;
    ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
    const maxWidth = w * layer.width / 100;
    const measurement = measureLayerText(ctx, project, layer, text);
    const lines = measurement.lines;
    const visibleLines = animatedLines(lines, layer.animation, time, segmentStart, segmentEnd, ctx.direction === 'rtl');
    const progress = revealProgress(layer.animation, time, segmentStart, segmentEnd);
    const lineWidths = lines.map(line => Math.max(1, Math.min(maxWidth, ctx.measureText(line).width)));
    const lineHeight = layer.fontSize * getLineHeight(layer) / 100;
    const x = w * layer.x / 100;
    const y = h * layer.y / 100;
    ctx.translate(x + shiftX, y + effect.y * h); ctx.scale(effect.scale, effect.scale); ctx.translate(-x, -y);
    const textX = layer.align === 'left' ? x - maxWidth / 2 : layer.align === 'right' ? x + maxWidth / 2 : x;
    lines.forEach((line, i) => {
      const visible = visibleLines[i];
      if (!visible) return;
      const fullWidth = lineWidths[i];
      const left = layer.align === 'left' ? textX : layer.align === 'right' ? textX - fullWidth : textX - fullWidth / 2;
      const baseline = y + (i - (lines.length - 1) / 2) * lineHeight;
      if (layer.animation?.effect === 'typewriter' && ctx.direction === 'rtl') {
        const wipe = lineWipeProgress(lineWidths, i, progress);
        if (wipe < 1) { drawArabicWipe(ctx, canvas, line, left, baseline, fullWidth, maxWidth, layer.fontSize, wipe); return; }
      }
      ctx.save();
      if (layer.animation?.effect === 'line-reveal') ctx.globalAlpha *= lineRevealOpacity(progress, i, lines.length);
      ctx.textAlign = ctx.direction === 'rtl' ? 'right' : 'left';
      ctx.fillText(visible, ctx.direction === 'rtl' ? left + fullWidth : left, baseline, maxWidth);
      ctx.restore();
    });
    bounds.push({ id: layer.id, x: x + shiftX - maxWidth * effect.scale / 2, y: y + effect.y * h + measurement.top * effect.scale, width: maxWidth * effect.scale, height: measurement.height * effect.scale });
    ctx.restore();
  }
  ctx.restore();
  return bounds;
}

export async function loadBackground(project: Project, assets: MediaAsset[]): Promise<RenderResources> {
  const bg = project.background;
  if (bg.type === 'color') return {};
  const url = assets.find(a => a.id === bg.source)?.url ?? bg.source;
  if (bg.type === 'image') {
    const image = new Image(); image.crossOrigin = 'anonymous';
    image.src = url; await image.decode(); return { image };
  }
  const video = document.createElement('video');
  video.muted = true; video.preload = 'auto'; video.playsInline = true;
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve(); video.onerror = () => reject(new Error('This video could not be decoded. Try an MP4 with H.264 video.'));
    video.src = url; video.load();
  });
  return { video };
}

export async function seekVideo(video: HTMLVideoElement, time: number) {
  const target = Math.min(time % video.duration, Math.max(0, video.duration - .04));
  if (Math.abs(video.currentTime - target) < .001) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('Video seeking timed out. Try a different background video.')); }, 15000);
    const cleanup = () => { clearTimeout(timer); video.removeEventListener('seeked', done); };
    const done = () => { cleanup(); resolve(); };
    video.addEventListener('seeked', done, { once: true }); video.currentTime = target;
  });
}
