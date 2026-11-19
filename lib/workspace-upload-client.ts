"use client"

import { toast } from "@/components/ui/toast"
import {
  uploadWorkspaceFileSchema,
  type UploadedEntry,
} from "./workspace-validation"

type Destination =
  { chatId: string; parent: string } | { chatId: string; attachment: true }

function uploadFile(
  destination: Destination,
  file: File,
  progress: (percent: number) => void
) {
  const query = new URLSearchParams({
    name: file.name,
    size: String(file.size),
  })
  if ("parent" in destination) query.set("parent", destination.parent)
  else query.set("attachment", "1")
  return new Promise<UploadedEntry>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open(
      "POST",
      `/api/workspace/${encodeURIComponent(destination.chatId)}/upload?${query}`
    )
    request.setRequestHeader("Content-Type", "application/octet-stream")
    request.responseType = "json"
    request.upload.onprogress = (event) =>
      progress(Math.floor((100 * event.loaded) / file.size))
    request.onload = () => {
      if (request.status === 201 && request.response?.entry)
        resolve(request.response.entry)
      else
        reject(
          new Error(
            request.response?.error ||
              (request.status === 413
                ? "The server rejected the file size."
                : `The server returned HTTP ${request.status}. Please retry.`)
          )
        )
    }
    request.onerror = () =>
      reject(new Error("Connection lost. Check your connection and retry."))
    request.onabort = () => reject(new Error("Upload cancelled."))
    request.send(file)
  })
}

// The cache belongs to one chat draft. If a later file fails, retrying the
// draft can reuse the completed uploads without creating duplicate copies.
export async function uploadFiles(
  destination: Destination,
  files: File[],
  onSaved: (entry: UploadedEntry, file: File) => void,
  cache?: WeakMap<File, UploadedEntry>
) {
  if (!files.length) return
  const id = toast.add({
    type: "loading",
    title: "Uploading…",
    description: files[0].name,
    timeout: 0,
  })
  let completed = 0
  try {
    for (const file of files) {
      const input = uploadWorkspaceFileSchema.safeParse({
        name: file.name,
        size: file.size,
      })
      if (!input.success) throw new Error(input.error.issues[0].message)
      const report = (percent: number) =>
        toast.update(id, {
          title:
            percent < 100
              ? `Uploading ${completed + 1}/${files.length} · ${percent}%`
              : `Saving ${completed + 1}/${files.length}…`,
          description: file.name,
        })
      report(0)
      const entry =
        cache?.get(file) ?? (await uploadFile(destination, file, report))
      cache?.set(file, entry)
      onSaved(entry, file)
      completed++
    }
    toast.update(id, {
      type: "success",
      title: completed === 1 ? "File uploaded" : `${completed} files uploaded`,
      description: completed === 1 ? files[0].name : undefined,
      timeout: 3000,
    })
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.message
        : "Upload interrupted. Please retry."
    const message = `${files[completed].name}: ${reason}`
    toast.update(id, {
      type: "error",
      title: completed
        ? `${completed}/${files.length} uploaded`
        : "Upload failed",
      description: message,
      timeout: 7000,
    })
    throw new Error(message)
  }
}

export const CHAT_UPLOAD_EVENT = "scientistflow:chat-upload"
