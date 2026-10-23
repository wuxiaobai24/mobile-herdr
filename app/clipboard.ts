import { setStringAsync } from 'expo-clipboard';
export async function copyText(value: string): Promise<void> { await setStringAsync(value); }
