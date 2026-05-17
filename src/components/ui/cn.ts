/**
 * Helper de class names — concat seguro, sem dependência externa.
 * Inspirado em `clsx`, mas pra evitar trazer outra dep pra design system.
 */
export type ClassValue = string | number | null | undefined | false | ClassValue[];

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  const walk = (v: ClassValue) => {
    if (!v && v !== 0) return;
    if (typeof v === 'string' || typeof v === 'number') {
      out.push(String(v));
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    }
  };
  inputs.forEach(walk);
  return out.join(' ');
}
