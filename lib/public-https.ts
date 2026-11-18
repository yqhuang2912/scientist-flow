import { lookup } from "node:dns/promises"
import { BlockList, isIP } from "node:net"
import { request } from "node:https"
import { addAbortSignal, Readable } from "node:stream"

export class PublicTargetError extends Error {}

const blocked = new BlockList()
for (const [network, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
  ["168.63.129.16", 32],
] as const)
  blocked.addSubnet(network, bits, "ipv4")
const globalV6 = new BlockList()
globalV6.addSubnet("2000::", 3, "ipv6")
for (const [network, bits] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  blocked.addSubnet(network, bits, "ipv6")

export function publicAddress(ip: string) {
  if (isIP(ip) === 4) return !blocked.check(ip, "ipv4")
  return (
    isIP(ip) === 6 && globalV6.check(ip, "ipv6") && !blocked.check(ip, "ipv6")
  )
}

async function resolveAddresses(
  host: string,
  signal: AbortSignal
): Promise<string[]> {
  if (isIP(host)) return [host]
  if (
    !host.includes(".") ||
    /(?:^|\.)(?:localhost|local|internal|home|lan)\.?$/i.test(host)
  )
    return []
  if (process.env.SCIENTISTFLOW_TOOL_DNS !== "google")
    return (await lookup(host, { all: true })).map((r) => r.address)
  // Optional public DNS for desktop networks using synthetic IPs. Only the
  // fixed resolver receives the hostname; it never receives tool arguments or credentials.
  const answers = await Promise.all(
    ["A", "AAAA"].map(async (type) => {
      const url = new URL("https://dns.google/resolve")
      url.search = new URLSearchParams({ name: host, type }).toString()
      const res = await fetch(url, { signal, redirect: "error" })
      if (!res.ok) throw new Error("Public DNS unavailable.")
      const data = (await res.json()) as {
        Answer?: { type: number; data: string }[]
      }
      return (data.Answer ?? [])
        .filter((a) => a.type === (type === "A" ? 1 : 28))
        .map((a) => a.data)
    })
  )
  return answers.flat()
}

export type ToolRequest = {
  url: URL
  method: "GET" | "POST"
  headers: Record<string, string>
  body?: string
  signal: AbortSignal
}
export type ToolResponse = {
  status: number
  contentType: string
  body: Readable
}
export async function publicHttpsRequest({
  url,
  method,
  headers,
  body,
  signal,
}: ToolRequest): Promise<ToolResponse> {
  const host = url.hostname.replace(/^\[|\]$/g, "")
  signal.throwIfAborted()
  let onAbort: (() => void) | undefined
  const canceled = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason)
    signal.addEventListener("abort", onAbort, { once: true })
  })
  const addresses = await Promise.race([
    resolveAddresses(host, signal),
    canceled,
  ]).finally(() => {
    if (onAbort) signal.removeEventListener("abort", onAbort)
  })
  signal.throwIfAborted()
  if (!addresses.length || !addresses.every(publicAddress))
    throw new PublicTargetError(
      "The endpoint must resolve exclusively to public addresses."
    )
  const address = addresses.find((a) => isIP(a) === 4) ?? addresses[0]
  // Connect to the verified IP directly. Keep the configured hostname for TLS
  // identity and HTTP routing. No proxy, redirects, socket pooling or retries.
  return new Promise((resolve, reject) => {
    const req = request(
      {
        protocol: "https:",
        hostname: address,
        port: url.port || 443,
        path: url.pathname + url.search,
        servername: isIP(host) ? undefined : host,
        method,
        agent: false,
        signal,
        headers: { ...headers, host: url.host },
      },
      (res) => {
        resolve({
          status: res.statusCode ?? 0,
          contentType: res.headers["content-type"] ?? "",
          body: addAbortSignal(signal, res),
        })
      }
    )
    req.once("error", reject)
    req.end(body)
  })
}
