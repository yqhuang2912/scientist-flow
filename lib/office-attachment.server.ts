import "server-only"
import path from "node:path"
import { SaxesParser } from "saxes"
import { fromBufferPromise, type Entry } from "yauzl"

type XmlEvents = {
  open?: (tag: string, attributes: Record<string, string>) => void
  close?: (tag: string) => void
  text?: (value: string) => void
}

function parseXml(source: string, events: XmlEvents) {
  const parser = new SaxesParser()
  const local = (tag: string) => tag.split(":").at(-1)!
  parser.on("doctype", () => {
    throw new Error("Unexpected document type")
  })
  parser.on("opentag", (tag) => events.open?.(local(tag.name), tag.attributes))
  parser.on("closetag", (tag) => events.close?.(local(tag.name)))
  if (events.text) {
    parser.on("text", events.text)
    parser.on("cdata", events.text)
  }
  parser.write(source).close()
}

function paragraphs(xml: string) {
  let capture = false
  const text: string[] = []
  parseXml(xml, {
    open(tag) {
      if (tag === "t") capture = true
      if (tag === "tab") text.push("\t")
      if (tag === "br") text.push("\n")
    },
    close(tag) {
      if (tag === "t") capture = false
      if (tag === "p") text.push("\n")
    },
    text(value) {
      if (capture) text.push(value)
    },
  })
  return text.join("").trim()
}

function spreadsheet(xml: string, shared: string[]) {
  let cell = "",
    type = "",
    address = "",
    capture = false
  const rows: string[] = []
  parseXml(xml, {
    open(tag, attrs) {
      if (tag === "c") {
        cell = ""
        type = attrs.t
        address = attrs.r
      }
      if (tag === "v" || tag === "t") capture = true
    },
    close(tag) {
      if (tag === "v" || tag === "t") capture = false
      if (tag === "c" && cell)
        rows.push(
          (address ? address + "=" : "") +
            (type === "s" ? (shared[Number(cell)] ?? "") : cell),
          "\t"
        )
      if (tag === "row") rows.push("\n")
    },
    text(value) {
      if (capture) cell += value
    },
  })
  return rows.join("").trim()
}

// Inspect only the package parts that hold text, in the order declared by
// the presentation or workbook. Large embedded media never gets inflated.
export async function officeAttachmentText(
  bytes: Buffer,
  ext: string,
  maxChars: number
) {
  const zip = await fromBufferPromise(bytes)
  const entries = new Map<string, Entry>()
  let xmlBudget = 16 * 1024 * 1024
  async function xml(part: string) {
    const entry = entries.get(part)
    if (
      !entry ||
      entry.isEncrypted() ||
      entry.uncompressedSize > Math.min(xmlBudget, 8 * 1024 * 1024)
    )
      throw new Error("Missing or oversized Office XML part")
    xmlBudget -= entry.uncompressedSize
    const chunks: Buffer[] = []
    const stream = await zip.openReadStreamPromise(entry)
    let size = 0
    for await (const chunk of stream) {
      size += chunk.length
      if (size > entry.uncompressedSize) throw new Error("Invalid part length")
      chunks.push(chunk)
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks)
    )
  }
  try {
    if (zip.entryCount > 16384) throw new Error("Too many archive entries")
    for await (const entry of zip.eachEntry()) {
      if (entry.fileName.endsWith(".xml") || entry.fileName.endsWith(".rels")) {
        if (entries.has(entry.fileName))
          throw new Error("Duplicate package part")
        entries.set(entry.fileName, entry)
      }
    }
    if (ext === ".docx") {
      const body = paragraphs(await xml("word/document.xml"))
      const comments = entries.has("word/comments.xml")
        ? paragraphs(await xml("word/comments.xml"))
        : ""
      return [body, comments && "Comments\n" + comments]
        .filter(Boolean)
        .join("\n\n")
    }
    const slides = ext === ".pptx"
    const dir = slides ? "ppt" : "xl"
    const manifest = slides ? "presentation.xml" : "workbook.xml"
    const relations = new Map<string, string>()
    parseXml(await xml(dir + "/_rels/" + manifest + ".rels"), {
      open(tag, a) {
        if (tag !== "Relationship" || a.TargetMode === "External" || !a.Target)
          return
        const target = a.Target.startsWith("/")
          ? a.Target.slice(1)
          : path.posix.join(dir, a.Target)
        if (
          slides
            ? /^ppt\/slides\/[^/]+\.xml$/.test(target)
            : /^xl\/worksheets\/[^/]+\.xml$/.test(target)
        )
          relations.set(a.Id, target)
      },
    })
    const sections: { part: string; title: string }[] = []
    parseXml(await xml(dir + "/" + manifest), {
      open(tag, a) {
        if (tag !== (slides ? "sldId" : "sheet")) return
        const part = relations.get(a["r:id"])
        if (part)
          sections.push({
            part,
            title: slides
              ? "Slide " + (sections.length + 1)
              : "Sheet: " + a.name,
          })
      },
    })
    const shared: string[] = []
    if (!slides && entries.has("xl/sharedStrings.xml")) {
      let value = "",
        capture = false
      parseXml(await xml("xl/sharedStrings.xml"), {
        open(tag) {
          if (tag === "t") capture = true
        },
        close(tag) {
          if (tag === "t") capture = false
          if (tag === "si") {
            shared.push(value)
            value = ""
          }
        },
        text(text) {
          if (capture) value += text
        },
      })
    }
    let text = ""
    for (const { part, title } of sections) {
      const source = await xml(part)
      const body = slides ? paragraphs(source) : spreadsheet(source, shared)
      if (body) text += title + "\n" + body + "\n\n"
      if (text.length > maxChars) break
    }
    return text.trim()
  } finally {
    zip.close()
  }
}
