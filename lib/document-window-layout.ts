export type WindowRect = { x: number; y: number; width: number; height: number }
export type Viewport = { width: number; height: number }
export function initialDocumentRect(view: Viewport): WindowRect {
  const width = Math.min(1100, view.width - 32)
  const height = Math.round(view.height * 0.8)
  return constrainDocumentRect(
    {
      x: (view.width - width) / 2,
      y: (view.height - height) / 2,
      width,
      height,
    },
    view
  )
}
export function constrainDocumentRect(
  rect: WindowRect,
  view: Viewport
): WindowRect {
  if (view.width <= 640 || view.height <= 400) return { x: 0, y: 0, ...view }
  const width = Math.min(Math.max(420, rect.width), view.width - 16)
  const height = Math.min(Math.max(280, rect.height), view.height - 16)
  return {
    width,
    height,
    x: Math.min(Math.max(8, rect.x), view.width - width - 8),
    y: Math.min(Math.max(8, rect.y), view.height - height - 8),
  }
}
