import "server-only"
import { headers } from "next/headers"
import { ModelConnectionError } from "./model-credentials.server"

// This application has one local installation and no end-user login. Its
// credential-management and billed chat entry points are loopback-only.
export async function assertInstallationRequest() {
  const h = await headers()
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i
  const host = h.get("host") ?? ""
  const forwarded = h.get("x-forwarded-host")
  const origin = h.get("origin")
  if (
    !local.test(host) ||
    (forwarded && forwarded !== host) ||
    (origin && !["http://" + host, "https://" + host].includes(origin))
  ) {
    throw new ModelConnectionError(
      "Model settings are available only in the local installation."
    )
  }
}
