import { useEffect, useState } from 'react';
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    function update(): void {
      const editing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName ?? '');
      setVisible(editing && window.innerHeight - (viewport?.height ?? window.innerHeight) > 130);
    }
    viewport?.addEventListener('resize', update); document.addEventListener('focusin', update); document.addEventListener('focusout', update);
    return () => { viewport?.removeEventListener('resize', update); document.removeEventListener('focusin', update); document.removeEventListener('focusout', update); };
  }, []);
  return visible;
}
