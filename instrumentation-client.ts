// React Flight's development profiler can finish an aborted or errored server
// render before the current document's time origin (react/react#37561).
if (process.env.NODE_ENV === "development") {
  const measure = performance.measure
  performance.measure = function (...args: Parameters<Performance["measure"]>) {
    const [name, options] = args
    if (
      typeof name === "string" &&
      name.startsWith("\u200b") &&
      options &&
      typeof options === "object" &&
      options.detail?.devtools?.trackGroup === "Server Components ⚛" &&
      typeof options.start === "number" &&
      typeof options.end === "number" &&
      options.end < 0
    ) {
      return measure.call(this, name, { ...options, end: options.start })
    }
    return measure.apply(this, args)
  }
}
