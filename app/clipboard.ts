import { getStringAsync, setStringAsync } from 'expo-clipboard';
export async function readText(): Promise<string> { return getStringAsync(); }
export async function copyText(value: string): Promise<void> { await setStringAsync(value); }
