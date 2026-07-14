"use client";

import { ImagePlus, Trash2, Upload } from "lucide-react";
import { useId, useRef, useState } from "react";

import { Button, toast } from "@/components/ui";
import { absoluteUrl, uploadFile } from "@/features/settings/lib/http";
import { cn, formatBytes } from "@/lib/utils";
import type { FileKind, ID } from "@/types";

export interface ImageUploadProps {
  label: string;
  description?: string;
  /** The URL currently stored on the server, if any. */
  currentUrl?: string | null;
  kind: FileKind;
  /** Called with the new FileAsset id — hand it to the mutation as `logoFileId` etc. */
  onUploaded: (fileId: ID, url: string | null) => void;
  onRemoved: () => void;
  shape?: "square" | "circle";
  maxBytes?: number;
}

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";
const DEFAULT_MAX = 5 * 1024 * 1024;

/**
 * Upload an image and hand back its FileAsset id.
 *
 * The upload happens IMMEDIATELY on selection rather than on form submit. The
 * mutation only takes a file *id*, so the bytes have to be on the server before
 * the form can be saved anyway — doing it up front means the user sees the
 * preview (and any "too large" error) while they are still looking at the field,
 * not after they press Save.
 *
 * The preview is the server's URL once uploaded; before that it is a local object
 * URL, which is revoked as soon as the real one arrives.
 */
export function ImageUpload({
  label,
  description,
  currentUrl,
  kind,
  onUploaded,
  onRemoved,
  shape = "square",
  maxBytes = DEFAULT_MAX,
}: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [preview, setPreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const shown = preview ?? absoluteUrl(currentUrl) ?? null;

  const handleFile = async (file: File): Promise<void> => {
    if (!file.type.startsWith("image/")) {
      toast.error("That file is not an image.");
      return;
    }
    if (file.size > maxBytes) {
      toast.error(`Images must be under ${formatBytes(maxBytes, 0)}.`);
      return;
    }

    const localUrl = URL.createObjectURL(file);
    setPreview(localUrl);
    setIsUploading(true);

    try {
      const uploaded = await uploadFile(file, kind);
      const remote = absoluteUrl(uploaded.url) ?? null;
      setPreview(remote);
      onUploaded(uploaded.id, remote);
      toast.success(
        uploaded.bytesSaved > 0
          ? `Uploaded. Compression saved ${formatBytes(uploaded.bytesSaved)}.`
          : "Uploaded.",
      );
    } catch (error) {
      setPreview(null);
      toast.error(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setIsUploading(false);
      URL.revokeObjectURL(localUrl);
      // Clear the input so re-picking the SAME file fires onChange again.
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <span id={`${inputId}-label`} className="text-foreground text-sm font-medium">
        {label}
      </span>

      <div className="flex flex-wrap items-center gap-4">
        <div
          className={cn(
            "border-border bg-muted flex size-20 shrink-0 items-center justify-center overflow-hidden border",
            shape === "circle" ? "rounded-full" : "rounded-lg",
          )}
        >
          {shown ? (
            /* A plain <img>, not next/image: while an upload is in flight the src is
               a local `blob:` object URL, which next/image refuses to load. The
               preview is a 80px thumbnail, so there is nothing to optimise anyway. */
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shown} alt="" className="size-full object-cover" />
          ) : (
            <ImagePlus className="text-muted-foreground size-6" aria-hidden="true" />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            isLoading={isUploading}
            loadingText="Uploading…"
            leftIcon={<Upload />}
            onClick={() => inputRef.current?.click()}
            aria-describedby={description ? `${inputId}-description` : undefined}
          >
            {shown ? "Replace" : "Upload"}
          </Button>

          {shown ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              leftIcon={<Trash2 />}
              disabled={isUploading}
              onClick={() => {
                setPreview(null);
                onRemoved();
              }}
            >
              Remove
            </Button>
          ) : null}
        </div>
      </div>

      {description ? (
        <p id={`${inputId}-description`} className="text-muted-foreground text-xs">
          {description}
        </p>
      ) : null}
    </div>
  );
}
