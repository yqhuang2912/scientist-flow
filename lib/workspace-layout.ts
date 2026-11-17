export const WORKSPACE_DEFAULT_WIDTH = 400
export const WORKSPACE_MIN_WIDTH = 280
export const CHAT_MIN_WIDTH = 320
export const CHAT_COMFORT_WIDTH = 384

// The cap is relative to the whole page, including the navigation sidebar.
export function workspaceLayoutBounds(pageWidth: number, contentWidth: number) {
  const available = Math.max(0, contentWidth - 1) // separator
  // A manually expanded sidebar takes priority. Temporarily allow a narrower
  // chat at the smallest desktop widths instead of immediately closing it again.
  const chatMin = Math.min(
    CHAT_MIN_WIDTH,
    Math.max(0, available - WORKSPACE_MIN_WIDTH)
  )
  const max = Math.max(
    0,
    Math.min(Math.floor((pageWidth * 2) / 3), available - chatMin)
  )
  return { chatMin, min: Math.min(WORKSPACE_MIN_WIDTH, max), max }
}

export function clampWorkspaceWidth(
  width: number,
  pageWidth: number,
  contentWidth: number
) {
  const { min, max } = workspaceLayoutBounds(pageWidth, contentWidth)
  return Math.min(max, Math.max(min, width))
}

export function shouldCollapseNavigation(
  contentWidth: number,
  workspaceWidth: number
) {
  return contentWidth - workspaceWidth - 1 <= CHAT_COMFORT_WIDTH
}
