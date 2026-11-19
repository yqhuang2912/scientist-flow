import assert from "node:assert/strict"
import { test } from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { defaultRemarkPlugins, Streamdown } from "streamdown"
import { cjk } from "@streamdown/cjk"
import { math } from "@streamdown/math"
import { normalizeChatMath } from "../lib/chat-math"
import { remarkReasoningMath } from "../lib/remark-reasoning-math"

function render(source: string, streaming = false) {
  return renderToStaticMarkup(
    createElement(
      Streamdown,
      { plugins: { cjk, math }, isAnimating: streaming },
      normalizeChatMath(source)
    )
  )
}

const annotations = (html: string) =>
  Array.from(
    html.matchAll(
      /<annotation encoding="application\/x-tex">([\s\S]*?)<\/annotation>/g
    ),
    ([, tex]) => tex
  )

test("the patient split reply renders subscripts, intersection and the empty set inline", () => {
  const train = String.raw`P_{\text{train}}`
  const val = String.raw`P_{\text{val}}`
  const intersection = train + " \\cap " + val
  const condition = intersection + " = \\varnothing"
  const source = `1. 构建集合 \\(${train}\\) 与 \\(${val}\\)。\n2. 计算交集：\\(${intersection}\\)。\n3. 条件：\\(${condition}\\)。`
  const html = render(source)
  assert.deepEqual(annotations(html), [train, val, intersection, condition])
  assert.doesNotMatch(html, /katex-display|katex-error/)
})

test("square brackets produce display math on one or multiple lines inside Markdown containers", () => {
  for (const source of [
    "> 1. \\[x+y\\]",
    "> \\[\n> x+y\n> \\]",
    "前文 \\[x+y\\] 后文",
    "\\[\nx+y\n\\]",
  ]) {
    const html = render(source)
    assert.deepEqual(annotations(html), ["x+y"])
    assert.match(html, /class="katex-display"/)
  }
})

test("dollar math and adjacent equations render without interpreting prices as math", () => {
  const html = render(String.raw`$5 and $10; $x_1$; \(a\)\(b\)。`)
  assert.deepEqual(annotations(html), ["x_1", "a", "b"])
  assert.match(html, /\$5 and \$10/)
  for (const original of [
    "$$\n\\frac{1}{2}\n$$",
    String.raw`see $$\text{use \( here}$$`,
  ]) {
    assert.equal(normalizeChatMath(original), original)
  }
})

test("code, escaped delimiters, and link destinations keep their original text", () => {
  const source = [
    "Inline `\\(x\\) and $u$`, price $5 next to `$var`.",
    "~~~tex\n\\[x^2\\]\n~~~",
    "    \\(literal\\)",
    String.raw`\\(escaped\\) and [ref](https://example.org/a\(b\) "use \(x\)").`,
  ].join("\n\n")
  assert.equal(normalizeChatMath(source), source)
  assert.deepEqual(annotations(render(source)), [])
})

test("only closed formula pairs render as the reply streams in", () => {
  const tex = String.raw`P_{\text{train}} \cap P_{\text{val}}`
  const complete = `交集：\\(${tex}\\)`
  for (let size = 1; size < complete.length; size++) {
    const partial = complete.slice(0, size)
    assert.equal(normalizeChatMath(partial), partial)
    assert.deepEqual(annotations(render(partial, true)), [])
  }
  assert.deepEqual(annotations(render(complete, true)), [tex])
  assert.deepEqual(annotations(render(complete + "。")), [tex])
})

function reasoning(source: string, streaming = false) {
  return renderToStaticMarkup(
    createElement(
      Streamdown,
      {
        plugins: { cjk, math },
        remarkPlugins: [
          ...Object.values(defaultRemarkPlugins),
          remarkReasoningMath,
        ],
        parseMarkdownIntoBlocksFn: (value) => [value],
        isAnimating: streaming,
      },
      normalizeChatMath(source)
    )
  )
}

test("a thought typesets a set expression and the variables introduced earlier", () => {
  const intro = "Define sets P_train and P_val."
  assert.deepEqual(
    annotations(reasoning(intro + "\n\nIntersection: P_train ∩ ", true)),
    []
  )
  const source = intro + "\n\nIntersection: P_train ∩ P_val."
  const train = "P_{\\text{train}}"
  const val = "P_{\\text{val}}"
  for (const streaming of [true, false]) {
    const html = reasoning(source, streaming)
    assert.deepEqual(annotations(html), [train, val, train + " ∩ " + val])
    assert.doesNotMatch(html, /katex-error/)
  }
  assert.deepEqual(annotations(render(source)), [])
})

test("reasoning keeps explicit math, code, links and ordinary identifiers distinct", () => {
  const source = [
    "Compare x_i ≤ y_j. Explicitly: \\(x_i\\) and \\[y_j\\].",
    "Keep sample_id, x_i.csv, /docs/x_i and OTHER_ID.",
    "`x_i ≤ y_j` and [x_i](https://example.org/x_i).",
    "~~~text\nx_i ≤ y_j\n~~~",
  ].join("\n\n")
  const html = reasoning(source)
  assert.deepEqual(annotations(html), ["x_{i} ≤ y_{j}", "x_i", "y_j"])
  assert.match(html, /katex-display/)
  assert.match(html, /x_i\.csv/)
  assert.deepEqual(
    annotations(reasoning("Use x_i and P_val as column names.")),
    []
  )
})
