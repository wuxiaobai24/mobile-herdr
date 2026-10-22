export async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(value); return; }
  const field = document.createElement('textarea'); field.value = value; field.style.position = 'fixed'; field.style.opacity = '0';
  document.body.appendChild(field); field.select();
  try { if (!document.execCommand('copy')) throw new Error('复制不可用，请选择文字手动复制。'); }
  finally { field.remove(); }
}
