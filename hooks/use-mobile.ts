import * as React from "react"

const MOBILE_BREAKPOINT = 768
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

export function useIsMobile() {
  const subscribe = React.useCallback((onStoreChange: () => void) => {
    const mql = window.matchMedia(MOBILE_QUERY)
    mql.addEventListener("change", onStoreChange)
    return () => mql.removeEventListener("change", onStoreChange)
  }, [])

  const getSnapshot = React.useCallback(
    // Read the same media query that emits the change. During device/viewport
    // transitions innerWidth can still reflect the preceding layout viewport.
    () => window.matchMedia(MOBILE_QUERY).matches,
    []
  )
  const getServerSnapshot = React.useCallback(() => false, [])

  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
