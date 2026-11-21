import { createHash } from "node:crypto"
import { z } from "zod"
import type { WorkflowDraft } from "./workflow-draft"

export const subsetPath = "data/subset.json"
export const workflowTurnId = (versionId: string) => "workflow_" + versionId
export const digest = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("hex")

export function orderedPair(graph: WorkflowDraft) {
  const [edge] = graph.edges
  const first = graph.nodes.find((node) => node.id === edge?.source)
  const second = graph.nodes.find((node) => node.id === edge?.target)
  if (
    graph.nodes.length !== 2 ||
    graph.edges.length !== 1 ||
    !first ||
    !second ||
    first.botId === second.botId ||
    !first.instructions.trim() ||
    !second.instructions.trim()
  )
    throw new Error(
      "This runner needs two distinct assigned bots connected by one directed edge."
    )
  return [first, second] as const
}

const label = z.string().trim().min(1).max(240)
const vector = z.array(z.number().min(-1e12).max(1e12)).min(1).max(16384)
const dataset = z.object({
  source: z.string().trim().min(1).max(1000),
  baseline: label,
  candidate: label,
  cases: z
    .array(
      z.object({
        sample: label,
        split: z.enum(["development", "holdout"]),
        stratum: label,
        reference: vector,
        baseline: vector,
        candidate: vector,
      })
    )
    .min(1)
    .max(512),
})

export function measureSubset(bytes: Buffer) {
  const { source, baseline, candidate, cases } = dataset.parse(
    JSON.parse(bytes.toString("utf8"))
  )
  const splits = new Map<string, string>()
  const pairs = new Set<string>()
  const exceptions: {
    sample: string
    split: string
    stratum: string
    baseline: number
    candidate: number
  }[] = []
  let worsened = 0
  const summaries = new Map<
    string,
    {
      split: string
      stratum: string
      count: number
      baseline: number
      candidate: number
    }
  >()
  const rows = cases.map((item) => {
    const { sample, split, stratum, reference } = item
    const pair = JSON.stringify([sample, stratum])
    if (pairs.has(pair) || (splits.has(sample) && splits.get(sample) !== split))
      throw new Error("Duplicate case or sample shared across splits.")
    pairs.add(pair)
    splits.set(sample, split)
    function rmse(predicted: number[]) {
      if (predicted.length !== reference.length)
        throw new Error(
          "Paired predictions must match the reference dimensions."
        )
      return Math.sqrt(
        predicted.reduce(
          (sum, value, i) => sum + (value - reference[i]) ** 2,
          0
        ) / reference.length
      )
    }
    const b = rmse(item.baseline),
      c = rmse(item.candidate)
    if (c >= b)
      exceptions.push({ sample, split, stratum, baseline: b, candidate: c })
    if (c > b) worsened++
    const key = JSON.stringify([split, stratum])
    const group = summaries.get(key) ?? {
      split,
      stratum,
      count: 0,
      baseline: 0,
      candidate: 0,
    }
    group.count++
    group.baseline += b
    group.candidate += c
    summaries.set(key, group)
    return [
      sample,
      split,
      stratum,
      reference.length,
      b.toFixed(6),
      c.toFixed(6),
    ]
  })
  const table = (rows: (string | number)[][]) =>
    rows
      .map(
        (row) =>
          "| " +
          row
            .map((cell) =>
              String(cell)
                .replaceAll("|", "／")
                .replace(/[\r\n]/g, " ")
            )
            .join(" | ") +
          " |"
      )
      .join("\n")
  const metrics = table(
    Array.from(summaries.values(), (g) => [
      g.split,
      g.stratum,
      g.count,
      (g.baseline / g.count).toFixed(6),
      (g.candidate / g.count).toFixed(6),
    ])
  )
  const summary = [
    source,
    "基线：" + baseline,
    "候选：" + candidate,
    "指标为逐样本 RMSE 的算术平均，越低越好。不同采样条件可复用同一体模，样本按 ID 分组划分。",
    "| 划分 | 分层 | 样本数 | 基线 RMSE | 候选 RMSE |",
    "| --- | --- | ---: | ---: | ---: |",
    metrics,
  ]
    .join("\n\n")
    .replace(/\|\n\n\|/g, "|\n|")
  const evidence = [
    summary,
    "### 配对样本",
    "| 样本 | 划分 | 分层 | 元素数 | 基线 RMSE | 候选 RMSE |\n| --- | --- | --- | ---: | ---: | ---: |\n" +
      table(rows),
    "输入文件：" + subsetPath,
    "输入 SHA-256：" + digest(bytes),
  ].join("\n\n")
  const review = {
    strata: summaries.size,
    improvedStrata: [...summaries.values()].filter(
      (g) => g.candidate < g.baseline
    ).length,
    pairs: pairs.size,
    improvedPairs: pairs.size - exceptions.length,
    worsenedPairs: worsened,
    tiedPairs: exceptions.length - worsened,
    exceptions,
  }
  return { summary, evidence, review }
}

type ReviewFacts = ReturnType<typeof measureSubset>["review"]
const reviewFinding = z
  .object({
    improvedStrata: z.int().nonnegative(),
    improvedPairs: z.int().nonnegative(),
    worsenedPairs: z.int().nonnegative(),
    tiedPairs: z.int().nonnegative(),
    witness: z
      .object({
        sample: z.string(),
        split: z.string(),
        stratum: z.string(),
        baseline: z.number(),
        candidate: z.number(),
      })
      .nullable(),
    decision: z.enum(["expand", "repeat", "insufficient"]),
  })
  .strict()

export const reviewInstructions = [
  "在回答前区分两种检查：按划分和分层统计平均 RMSE；按样本与分层统计配对胜负。依据本次复算，不采纳上游报告中未经复核的概括。",
  "仅返回一个 JSON 对象。improvedStrata、improvedPairs、worsenedPairs、tiedPairs 均为全子集计数。witness 必须选一个候选误差更大的配对；若只有持平则选一个持平配对；全部改善时填 null。",
  "witness 包含 sample、split、stratum（原文精确标签）及 baseline、candidate（数值，保留六位小数）。decision 由你根据科研要求及证据选择 expand（扩大验证）、repeat（复查子集）或 insufficient（暂缓判断）。",
].join("\n")

export function verifyReview(
  answer: string,
  facts: ReviewFacts,
  sourcePath: string
) {
  const invalid = () =>
    new Error(
      "Verification failed. The review must distinguish group means from individual pairs and cite a matching measured case."
    )
  const body = answer
    .replace(/^\s*```(?:json)?\s*\n/i, "")
    .replace(/\n\s*```\s*$/, "")
  let finding: z.infer<typeof reviewFinding>
  try {
    finding = reviewFinding.parse(JSON.parse(body))
  } catch {
    throw invalid()
  }
  for (const key of [
    "improvedStrata",
    "improvedPairs",
    "worsenedPairs",
    "tiedPairs",
  ] as const)
    if (finding[key] !== facts[key]) throw invalid()
  const w = finding.witness
  const row =
    w &&
    facts.exceptions.find(
      (r) =>
        r.sample === w.sample &&
        r.split === w.split &&
        r.stratum === w.stratum &&
        (facts.worsenedPairs === 0 || r.candidate > r.baseline) &&
        Number(r.baseline.toFixed(6)) === w.baseline &&
        Number(r.candidate.toFixed(6)) === w.candidate
    )
  if (facts.exceptions.length ? !row : w !== null) throw invalid()
  const comparison = [
    "**分层平均。** " +
      facts.strata +
      " 个「数据划分 × 采样条件」中，" +
      facts.improvedStrata +
      " 个分层的候选平均 RMSE 更低。",
    "**逐样本配对。** " +
      facts.pairs +
      " 个「样本 × 采样条件」中，" +
      facts.improvedPairs +
      " 个改善，" +
      facts.worsenedPairs +
      " 个变差，" +
      facts.tiedPairs +
      " 个持平。",
  ]
  if (row) {
    const digits =
      row.baseline.toFixed(6) === row.candidate.toFixed(6) &&
      row.baseline !== row.candidate
        ? 12
        : 6
    comparison.push(
      "**反例。** " +
        row.sample +
        "（" +
        row.split +
        "，" +
        row.stratum +
        "）的 RMSE 从 " +
        row.baseline.toFixed(digits) +
        " 到 " +
        row.candidate.toFixed(digits) +
        (row.candidate > row.baseline ? "，候选误差更高。" : "，两者持平。")
    )
  }
  const decisions = {
    expand: "支持扩大样本验证。",
    repeat: "建议先复查子集。",
    insufficient: "现有证据不足以决定是否扩大实验。",
  }
  comparison.push(
    "**评判。** " +
      decisions[finding.decision] +
      "上述比较是本子集的描述性结果，尚未检验统计显著性。",
    "依据：" + sourcePath + " 中的分层均值表及「配对样本」表。"
  )
  return { finding, text: comparison.join("\n\n") }
}
