import type { Machine } from '../shared/protocol';

export async function loadMachines(): Promise<Machine[]> {
  return JSON.parse(localStorage.getItem('mobile-herdr-machines') ?? '[]');
}
export async function saveMachines(machines: Machine[]): Promise<void> {
  localStorage.setItem('mobile-herdr-machines', JSON.stringify(machines));
}
export async function loadDraft(key: string): Promise<string> { return localStorage.getItem(`mobile-herdr-draft:${key}`) ?? ''; }
export async function saveDraft(key: string, value: string): Promise<void> {
  if (value) localStorage.setItem(`mobile-herdr-draft:${key}`, value); else localStorage.removeItem(`mobile-herdr-draft:${key}`);
}
