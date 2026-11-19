"use client"

import { useEffect, useState, type ReactElement } from "react"
import { ScanIcon, ScanLineIcon } from "lucide-react"
import { FileTypeIcon } from "@/components/file-type-icon"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"

type ImageSource = { name: string; url: string; workspace?: boolean }

function PreviewContent({ source }: { source: ImageSource }) {
  const [url, setUrl] = useState(source.workspace ? "" : source.url)
  const [error, setError] = useState("")
  const [actualSize, setActualSize] = useState(false)
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null
  )

  useEffect(() => {
    if (!source.workspace) return
    const controller = new AbortController()
    let localUrl: string | undefined
    async function load() {
      try {
        const response = await fetch(source.url, { signal: controller.signal })
        if (!response.ok) {
          const problem = await response.json().catch(() => ({}))
          throw new Error(problem.error || "Could not load this image.")
        }
        const bytes = await response.blob()
        if (controller.signal.aborted) return
        localUrl = URL.createObjectURL(bytes)
        setUrl(localUrl)
      } catch (reason) {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load this image."
          )
      }
    }
    void load()
    return () => {
      controller.abort()
      if (localUrl) URL.revokeObjectURL(localUrl)
    }
  }, [source.url, source.workspace])

  return (
    <>
      <header className="flex min-w-0 items-center gap-2 border-b px-4 py-2 pr-12">
        <FileTypeIcon filename={source.name} mediaType="image/*" className="size-4 shrink-0" />
        <DialogTitle
          title={source.name}
          className="min-w-0 flex-1 truncate text-sm"
        >
          {source.name}
        </DialogTitle>
        {size && (
          <span className="hidden shrink-0 text-xs text-muted-foreground tabular-nums sm:inline">
            {size.width} × {size.height}
          </span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="compact"
          disabled={!size}
          aria-pressed={actualSize}
          onClick={() => setActualSize(!actualSize)}
        >
          {actualSize ? <ScanIcon /> : <ScanLineIcon />}
          {actualSize ? "Fit to window" : "Actual size"}
        </Button>
      </header>
      <div
        className="relative min-h-0 overflow-auto bg-muted/40"
        aria-busy={!size && !error}
      >
        {error ? (
          <p
            role="alert"
            className="grid h-full place-items-center px-4 text-center text-sm text-muted-foreground"
          >
            {error}
          </p>
        ) : (
          <>
            {!size && (
              <div
                role="status"
                aria-label="Loading image"
                className="absolute inset-0 grid place-items-center"
              >
                <Spinner />
              </div>
            )}
            {url && (
              <div
                className={
                  actualSize
                    ? "grid h-max min-h-full w-max min-w-full place-items-center"
                    : "grid h-full w-full place-items-center p-2 sm:p-4"
                }
              >
                {/* Original raster bytes, including animated GIFs and local blobs. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={source.name}
                  referrerPolicy="no-referrer"
                  onLoad={({ currentTarget }) =>
                    setSize({
                      width: currentTarget.naturalWidth,
                      height: currentTarget.naturalHeight,
                    })
                  }
                  onError={() => setError("This image could not be displayed.")}
                  className={
                    actualSize
                      ? "block max-w-none"
                      : "block h-full min-h-0 w-full min-w-0 object-contain"
                  }
                />
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}

export function ImagePreview({
  source,
  trigger,
  onClose,
}: {
  source: ImageSource
  trigger?: ReactElement
  onClose?: () => void
}) {
  return (
    <Dialog
      open={trigger ? undefined : true}
      onOpenChange={(open) => {
        if (!open) onClose?.()
      }}
    >
      {trigger && <DialogTrigger render={trigger} />}
      <DialogContent
        className="h-[min(85dvh,56rem)] w-[calc(100%-1rem)] max-w-6xl grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:w-[calc(100%-3rem)] sm:max-w-6xl"
        aria-describedby={undefined}
      >
        <PreviewContent key={source.url} source={source} />
      </DialogContent>
    </Dialog>
  )
}
