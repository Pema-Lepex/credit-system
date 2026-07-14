"use client";

/**
 * Image upload, shared by the customer photo (single) and product images (many).
 *
 * The upload happens IMMEDIATELY on selection, not on form submit. That is
 * deliberate: the mutation takes a file *id*, so the file has to exist before the
 * form can be saved — and doing it eagerly means the user sees the preview (and
 * any "too big" error) while they are still filling in the name, not after they
 * press Save.
 *
 * The server reports how many bytes its compression saved. We show it. A user on
 * a metered quota deserves to know the 4 MB photo they picked became 380 KB.
 */

import { ImagePlus, Loader2, X } from "lucide-react";
import Image from "next/image";
import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui";
import { assetUrls } from "@/features/common/media";
import { uploadFile, validateImage, type UploadedFile } from "@/features/common/upload";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FileKind, ID } from "@/types";

export interface UploadedImage {
  id: ID;
  url: string;
  thumbnailUrl?: string | null;
  /** Present only for files uploaded in this session. */
  bytesSaved?: number;
}

export interface ImageUploaderProps {
  kind: FileKind;
  value: UploadedImage[];
  onChange: (next: UploadedImage[]) => void;
  multiple?: boolean;
  max?: number;
  /** Visible label; also names the file input for AT. */
  label: string;
  hint?: string;
  disabled?: boolean;
  /** Circular preview for a person, square for a product. */
  shape?: "circle" | "square";
  /**
   * URLs already stored on the record. Shown read-only, because the API returns
   * image *URLs* but takes file *ids* — there is no id to send back for a file we
   * did not just upload. Uploading replaces them; nothing here can un-set them.
   */
  existing?: string[];
  className?: string;
}

export function ImageUploader({
  kind,
  value,
  onChange,
  multiple = false,
  max = multiple ? 6 : 1,
  label,
  hint,
  disabled,
  shape = "square",
  existing = [],
  className,
}: ImageUploaderProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const savedBytes = value.reduce((total, image) => total + (image.bytesSaved ?? 0), 0);
  const isFull = value.length >= max;

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);

    const picked = Array.from(files).slice(0, Math.max(0, max - value.length));
    const invalid = picked.map(validateImage).find(Boolean);
    if (invalid) {
      setError(invalid);
      return;
    }

    setUploading(true);
    try {
      const uploaded: UploadedFile[] = [];
      // Sequential, not Promise.all: the API dedups by checksum, and two identical
      // files racing each other can both miss the cache and store twice.
      for (const file of picked) {
        uploaded.push(await uploadFile(file, kind));
      }
      const next: UploadedImage[] = uploaded.map((file) => ({
        id: file.id,
        url: file.url,
        thumbnailUrl: file.thumbnailUrl,
        bytesSaved: file.bytesSaved,
      }));
      onChange(multiple ? [...value, ...next] : next.slice(0, 1));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed.");
    } finally {
      setUploading(false);
      // Reset the input so re-picking the SAME file fires onChange again.
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = (id: ID) => {
    setError(null);
    onChange(value.filter((image) => image.id !== id));
  };

  const existingUrls = assetUrls(existing);
  const showExisting = existingUrls.length > 0 && value.length === 0;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-start gap-3">
        {showExisting
          ? existingUrls.map((url) => (
              <figure key={url} className="relative">
                <Image
                  src={url}
                  alt=""
                  width={80}
                  height={80}
                  unoptimized
                  className={cn(
                    "border-border bg-muted size-20 border object-cover opacity-90",
                    shape === "circle" ? "rounded-full" : "rounded-lg",
                  )}
                />
                <figcaption className="text-muted-foreground mt-1 text-center text-[10px]">
                  Current
                </figcaption>
              </figure>
            ))
          : null}

        {value.map((image) => (
          <figure key={image.id} className="group relative">
            <Image
              src={image.thumbnailUrl || image.url}
              alt=""
              width={80}
              height={80}
              unoptimized
              className={cn(
                "border-border bg-muted size-20 border object-cover",
                shape === "circle" ? "rounded-full" : "rounded-lg",
              )}
            />
            <Button
              type="button"
              variant="destructive"
              size="icon-sm"
              aria-label="Remove image"
              disabled={disabled}
              onClick={() => remove(image.id)}
              className="absolute -top-2 -right-2 size-6 rounded-full shadow-sm"
            >
              <X />
            </Button>
          </figure>
        ))}

        {!isFull ? (
          <>
            <label
              htmlFor={inputId}
              className={cn(
                "border-border text-muted-foreground flex size-20 cursor-pointer flex-col items-center justify-center gap-1 border border-dashed text-center",
                "hover:border-ring hover:text-foreground focus-within:ring-ring transition-colors focus-within:ring-2",
                shape === "circle" && value.length === 0 ? "rounded-full" : "rounded-lg",
                disabled && "pointer-events-none opacity-50",
              )}
            >
              {isUploading ? (
                <Loader2 className="size-5 animate-spin" aria-hidden="true" />
              ) : (
                <ImagePlus className="size-5" aria-hidden="true" />
              )}
              <span className="px-1 text-[10px] leading-tight font-medium">
                {isUploading
                  ? "Uploading…"
                  : showExisting
                    ? "Replace"
                    : multiple
                      ? "Add image"
                      : "Upload"}
              </span>
            </label>
            <input
              ref={inputRef}
              id={inputId}
              type="file"
              accept="image/*"
              multiple={multiple}
              disabled={disabled || isUploading}
              aria-label={label}
              onChange={(event) => void handleFiles(event.target.files)}
              className="sr-only"
            />
          </>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-destructive-soft-foreground text-xs font-medium">
          {error}
        </p>
      ) : null}

      {!error && savedBytes > 0 ? (
        <p className="text-success-soft-foreground text-xs font-medium" aria-live="polite">
          Compression saved {formatBytes(savedBytes)}.
        </p>
      ) : null}

      {!error && savedBytes === 0 && hint ? (
        <p className="text-muted-foreground text-xs">{hint}</p>
      ) : null}
    </div>
  );
}
