import { expect, test } from 'bun:test';
import { themes } from '../shared/themes';
function luminance(hex: string): number {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
  return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
}
function contrast(a: string, b: string): number {
  const light = Math.max(luminance(a), luminance(b)), dark = Math.min(luminance(a), luminance(b));
  return (light + .05) / (dark + .05);
}
test('every theme keeps reading, secondary text and primary actions legible', () => {
  for (const { id, colors: c } of themes) {
    for (const bg of [c.bg, c.sidebar, c.surface, c.hover]) {
      expect(contrast(c.text, bg), `${id}: text on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(c.muted, c.bg), `${id}: secondary text`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.muted, c.surface), `${id}: input placeholder`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.accentInk, c.accent), `${id}: primary button`).toBeGreaterThanOrEqual(4.5);
  }
});
