"use client";

import { FileText, Paperclip, Upload, X } from "lucide-react";
import Image from "next/image";
import { useCallback, useId, useRef, useState } from "react";

import { Button, Label, Spinner, toast } from "@/components/ui";
import { parseApiError } from "@/features/credits/lib/errors";
import { uploadFile, type UploadedFile } from "@/features/credits/lib/rest";
import { cn, formatBytes } from "@/lib/utils";
import type { FileKind } from "@/types";

export interface AttachmentUploaderProps {
  label: string;
  description?: string;
  kind: FileKind;
  value: UploadedFile[];
  onChange: (files: UploadedFile[]) => void;
  multiple?: boolean;
  accept?: string;
  disabled?: boolean;
  /** Hard cap. The backend enforces a quota too; this is just a kinder failure. */
  maxFiles?: number;
}

/**
 * Upload-then-attach.
 *
 * The file goes to POST /api/upload immediately and comes back with an id; the id
 * is what the GraphQL mutation carries. Deferring the upload until submit would
 * mean a 6 MB photo blocking the one request that actually books the credit — and
 * a failed upload losing the whole form.
 *
 * Removing a file here just drops the id from the form. The asset itself is
 * reference-counted server-side and swept when it is orphaned; deleting it from
 * under a credit that might still reference it is not ours to do.
 */
export function AttachmentUploader({
  label,
  description,
  kind,
  value,
  onChange,
  multiple = false,
  accept = "image/*,application/pdf",
  disabled,
  maxFiles = 6,
}: AttachmentUploaderProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;

      const incoming = Array.from(fileList).slice(0, Math.max(0, maxFiles - value.length));
      if (incoming.length === 0) {
        toast.error(`You can attach at most ${maxFiles} file${maxFiles === 1 ? "" : "s"}.`);
        return;
      }

      setIsUploading(true);
      try {
        const uploaded = await Promise.all(incoming.map((file) => uploadFile(file, kind)));
        onChange(multiple ? [...value, ...uploaded] : uploaded.slice(0, 1));

        const saved = uploaded.reduce((total, file) => total + (file.bytesSaved || 0), 0);
        if (saved > 0) {
          toast.success("Uploaded", { description: `Compressed — saved ${formatBytes(saved)}.` });
        }
      } catch (error) {
        toast.error("Upload failed", { description: parseApiError(error).message });
      } finally {
        setIsUploading(false);
        // Reset the input, or picking the SAME file twice fires no change event.
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [kind, maxFiles, multiple, onChange, value],
  );

  const remove = (id: string) => onChange(value.filter((file) => file.id !== id));

  return (
    <div className="space-y-2">
      <Label htmlFor={inputId}>{label}</Label>
      {description ? <p className="text-muted-foreground text-xs">{description}</p> : null}

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        className="sr-only"
        accept={accept}
        multiple={multiple}
        disabled={disabled || isUploading}
        onChange={(event) => void handleFiles(event.target.files)}
      />

      <div className="flex flex-wrap gap-3">
        {value.map((file) => {
          const isImage = file.contentType.startsWith("image/");
          const preview = file.thumbnailUrl ?? file.url;

          return (
            <div
              key={file.id}
              className="border-border bg-muted/40 group relative flex size-20 items-center justify-center overflow-hidden rounded-lg border"
            >
              {isImage && preview ? (
                <Image
                  src={preview}
                  alt={file.filename}
                  width={80}
                  height={80}
                  className="size-full object-cover"
                  unoptimized
                />
              ) : (
                <FileText aria-hidden="true" className="text-muted-foreground size-6" />
              )}

              <button
                type="button"
                onClick={() => remove(file.id)}
                aria-label={`Remove ${file.filename}`}
                className="bg-foreground/70 text-background focus-visible:ring-ring absolute top-1 right-1 flex size-5 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none"
              >
                <X className="size-3" />
              </button>
            </div>
          );
        })}

        {value.length < maxFiles ? (
          <Button
            type="button"
            variant="outline"
            disabled={disabled || isUploading}
            onClick={() => inputRef.current?.click()}
            className={cn("size-20 flex-col gap-1 border-dashed p-0 text-xs")}
          >
            {isUploading ? (
              <Spinner size="sm" label="Uploading" />
            ) : (
              <>
                {multiple ? <Upload aria-hidden="true" /> : <Paperclip aria-hidden="true" />}
                <span>{value.length > 0 && !multiple ? "Replace" : "Add"}</span>
              </>
            )}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
