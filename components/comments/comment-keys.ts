/**
 * What a key press does in a comment textarea (the inline edit box and the reply
 * composer): Enter saves, Shift+Enter is a newline (null), Escape cancels.
 */
export function editKeyAction(key: string, shiftKey: boolean): 'save' | 'cancel' | null {
  if (key === 'Enter' && !shiftKey) return 'save'
  if (key === 'Escape') return 'cancel'
  return null
}
