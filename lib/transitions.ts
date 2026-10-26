export const TRANSITION_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'fade', label: 'Fade' },
  { value: 'slide-up', label: 'Slide up' },
  { value: 'slide-down', label: 'Slide down' },
  { value: 'slide-left', label: 'Slide left' },
  { value: 'slide-right', label: 'Slide right' },
  { value: 'zoom', label: 'Soft zoom' },
] as const;
export type TransitionEffect = typeof TRANSITION_OPTIONS[number]['value'];
export type TransitionSettings = { enter: TransitionEffect; exit: TransitionEffect; duration: number };
export const DEFAULT_TRANSITION: TransitionSettings = { enter: 'none', exit: 'none', duration: .5 };
export const BACKGROUND_MOTIONS = [
  { value: 'none', label: 'Still' }, { value: 'zoom-in', label: 'Slow zoom in' },
  { value: 'zoom-out', label: 'Slow zoom out' }, { value: 'pan-left', label: 'Pan left' }, { value: 'pan-right', label: 'Pan right' },
  { value: 'pan-up', label: 'Pan up' }, { value: 'pan-down', label: 'Pan down' },
  { value: 'zoom-drift', label: 'Zoom & drift' }, { value: 'breathe', label: 'Zoom in & out' },
] as const;
export type BackgroundMotion = typeof BACKGROUND_MOTIONS[number]['value'];
export function validTransition(value: unknown): value is TransitionSettings {
  if (!value || typeof value !== 'object') return false;
  const t = value as TransitionSettings;
  return TRANSITION_OPTIONS.some(o => o.value === t.enter) && TRANSITION_OPTIONS.some(o => o.value === t.exit)
    && typeof t.duration === 'number' && Number.isFinite(t.duration) && t.duration >= .1 && t.duration <= 3;
}
const clampUnit = (value: number) => Math.max(0, Math.min(1, value));
const easeOut = (value: number) => 1 - (1 - clampUnit(value)) ** 3;
export function transitionAt(settings: TransitionSettings | undefined, time: number, start: number, end: number) {
  const state = { opacity: 1, y: 0, scale: 1 };
  if (!settings || end <= start) return state;
  const duration = Math.min(settings.duration, (end - start) / 2);
  const incoming = easeOut((time - start) / duration);
  const outgoing = easeOut((end - time) / duration);
  if (settings.enter !== 'none') {
    state.opacity *= incoming;
    if (settings.enter === 'slide-up') state.y += (1 - incoming) * .035;
    if (settings.enter === 'slide-down') state.y -= (1 - incoming) * .035;
    if (settings.enter === 'zoom') state.scale *= .92 + .08 * incoming;
  }
  if (settings.exit !== 'none') {
    state.opacity *= outgoing;
    if (settings.exit === 'slide-up') state.y -= (1 - outgoing) * .035;
    if (settings.exit === 'slide-down') state.y += (1 - outgoing) * .035;
    if (settings.exit === 'zoom') state.scale *= 1 + .08 * (1 - outgoing);
  }
  return state;
}
export function horizontalTransitionAt(settings: TransitionSettings | undefined, time: number, start: number, end: number) {
  if (!settings || end <= start) return 0;
  const duration = Math.min(settings.duration, (end - start) / 2);
  const incoming = 1 - easeOut((time - start) / duration);
  const outgoing = 1 - easeOut((end - time) / duration);
  return (settings.enter === 'slide-left' ? incoming : settings.enter === 'slide-right' ? -incoming : 0) * .05
    + (settings.exit === 'slide-left' ? -outgoing : settings.exit === 'slide-right' ? outgoing : 0) * .05;
}
export function backgroundMotionAt(motion: BackgroundMotion | undefined, time: number, duration: number, strength = 12, motionDuration = duration, repeat = false) {
  const phase = Math.max(0, time) / Math.max(.1, motionDuration);
  const cycle = phase % 2;
  const travel = cycle <= 1 ? cycle : 2 - cycle;
  // Ease only near the turns; a whole-cycle sine barely moves at the start
  // of long recordings, making moderate strengths appear frozen.
  const turn = .04;
  const repeatedProgress = travel < turn ? travel ** 2 / (2 * turn * (1 - turn))
    : travel > 1 - turn ? 1 - (1 - travel) ** 2 / (2 * turn * (1 - turn))
    : (travel - turn / 2) / (1 - turn);
  const progress = repeat ? repeatedProgress : clampUnit(phase);
  const amount = Math.max(0, Math.min(40, strength)) / 100;
  const pan = amount * (5 / 12);
  switch (motion) {
    case 'zoom-in': return { scale: 1 + amount * progress, x: 0 };
    case 'zoom-out': return { scale: 1 + amount * (1 - progress), x: 0 };
    case 'pan-left': return { scale: 1 + amount, x: pan * (1 - 2 * progress) };
    case 'pan-right': return { scale: 1 + amount, x: pan * (2 * progress - 1) };
    case 'pan-up': return { scale: 1 + amount, x: 0, y: pan * (1 - 2 * progress) };
    case 'pan-down': return { scale: 1 + amount, x: 0, y: pan * (2 * progress - 1) };
    case 'zoom-drift': return { scale: 1 + amount * (.5 + .5 * progress), x: pan * (.5 - progress), y: pan * (.5 - progress) };
    case 'breathe': return { scale: 1 + amount * Math.sin(Math.PI * progress) ** 2, x: 0 };
    default: return { scale: 1, x: 0 };
  }
}
