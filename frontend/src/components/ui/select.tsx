import { ChevronDown } from "lucide-react";
import { forwardRef } from "react";

import { fieldBaseVariants } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<
  React.SelectHTMLAttributes<HTMLSelectElement>,
  "size"
> {
  invalid?: boolean;
  selectSize?: "sm" | "md" | "lg";
  options?: readonly SelectOption[];
  placeholder?: string;
}

/**
 * A NATIVE <select>, deliberately.
 *
 * A custom listbox is ~200 lines of ARIA and still loses to the OS picker on
 * mobile, where the native control is a full-screen wheel that users already know
 * how to drive. We restyle the box and swap the chevron; the popup stays native.
 * Use a Dropdown/Combobox only when the options need rich content or search.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, invalid, selectSize = "md", options, placeholder, children, ...props },
  ref,
) {
  const isInvalid = Boolean(invalid) || props["aria-invalid"] === true;

  return (
    <div className="relative w-full">
      <select
        ref={ref}
        aria-invalid={isInvalid || undefined}
        className={cn(
          fieldBaseVariants({ invalid: isInvalid, inputSize: selectSize }),
          "cursor-pointer appearance-none pr-9",
          // No value chosen yet -> render the placeholder in muted ink.
          !props.value && !props.defaultValue && placeholder ? "text-muted-foreground" : "",
          className,
        )}
        {...props}
      >
        {placeholder ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options?.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
      />
    </div>
  );
});
