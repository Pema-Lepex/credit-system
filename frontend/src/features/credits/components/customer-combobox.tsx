"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Plus, Search, UserPlus, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import {
  Button,
  Dialog,
  FormField,
  Input,
  Spinner,
  toast,
} from "@/components/ui";
import { useMoney } from "@/features/credits/hooks/use-business-settings";
import { parseApiError } from "@/features/credits/lib/errors";
import {
  CREATE_CUSTOMER_MUTATION,
  CUSTOMER_SEARCH_QUERY,
  creditKeys,
  type CustomerOption,
  type CustomerSearchResult,
} from "@/features/credits/queries";
import { useClickOutside } from "@/hooks/use-click-outside";
import { useAuth } from "@/lib/auth/AuthProvider";
import { gqlRequest } from "@/lib/graphql/client";
import { cn } from "@/lib/utils";

/**
 * A searchable customer picker.
 *
 * A native <select> cannot do this: the list is server-side, it is searched as you
 * type, and each option is two lines (name + what they already owe). So this is a
 * real WAI-ARIA combobox — `role="combobox"` on the input, `role="listbox"` on the
 * panel, `aria-activedescendant` for the highlighted row — which means it is
 * driveable entirely from the keyboard, which is how a fast till operator works.
 *
 * "Create new customer" is INLINE, because the moment you have to leave this form
 * to add a customer, you lose the credit you were writing.
 */
export interface CustomerComboboxProps {
  value: CustomerOption | null;
  onChange: (customer: CustomerOption | null) => void;
  id?: string;
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  allowCreate?: boolean;
  allowClear?: boolean;
}

export function CustomerCombobox({
  value,
  onChange,
  id,
  placeholder = "Search customers…",
  invalid,
  disabled,
  allowCreate = true,
  allowClear = false,
}: CustomerComboboxProps) {
  const money = useMoney();
  const { hasPermission } = useAuth();
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const listboxId = `${inputId}-listbox`;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useClickOutside([rootRef], () => setOpen(false), open);

  // Debounce: one request per pause, not one per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 220);
    return () => clearTimeout(timer);
  }, [query]);

  const { data, isFetching } = useQuery({
    queryKey: creditKeys.customerSearch(debounced),
    queryFn: () =>
      gqlRequest<CustomerSearchResult, Record<string, unknown>>(CUSTOMER_SEARCH_QUERY, {
        filter: { search: debounced || null },
        page: { page: 1, limit: 20 },
      }),
    enabled: open,
    select: (result) => result.customers.items,
  });

  const options = useMemo(() => data ?? [], [data]);
  const canCreate = allowCreate && hasPermission("customer:write");

  useEffect(() => {
    setActiveIndex(0);
  }, [debounced, open]);

  const select = useCallback(
    (customer: CustomerOption) => {
      onChange(customer);
      setOpen(false);
      setQuery("");
    },
    [onChange],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (event.key === "ArrowDown" || event.key === "Enter")) {
      setOpen(true);
      return;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((index) => Math.min(index + 1, options.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((index) => Math.max(index - 1, 0));
        break;
      case "Enter": {
        event.preventDefault();
        const option = options[activeIndex];
        if (option) select(option);
        break;
      }
      case "Escape":
        event.preventDefault();
        setOpen(false);
        break;
      default:
        break;
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <span
          aria-hidden="true"
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
        >
          {value ? <Check className="size-4" /> : <Search className="size-4" />}
        </span>

        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={
            open && options[activeIndex] ? `${listboxId}-option-${activeIndex}` : undefined
          }
          aria-invalid={invalid || undefined}
          disabled={disabled}
          autoComplete="off"
          placeholder={value ? value.name : placeholder}
          value={open ? query : (value?.name ?? "")}
          onChange={(event) => {
            setQuery(event.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={cn(
            "bg-background text-foreground h-9 w-full rounded-md border pr-9 pl-9 text-sm",
            "placeholder:text-muted-foreground/70",
            "focus-visible:ring-ring focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none",
            "disabled:bg-muted disabled:cursor-not-allowed disabled:opacity-60",
            invalid ? "border-destructive focus-visible:ring-destructive" : "border-input",
          )}
        />

        <span className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center">
          {allowClear && value ? (
            <button
              type="button"
              aria-label="Clear customer"
              onClick={() => {
                onChange(null);
                setQuery("");
                inputRef.current?.focus();
              }}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex size-6 items-center justify-center rounded focus-visible:ring-2 focus-visible:outline-none"
            >
              <X className="size-3.5" />
            </button>
          ) : (
            <ChevronsUpDown
              aria-hidden="true"
              className="text-muted-foreground mr-1.5 size-4"
            />
          )}
        </span>
      </div>

      {open ? (
        <div
          className={cn(
            "border-border bg-popover absolute z-50 mt-2 w-full overflow-hidden rounded-lg border shadow-lg",
          )}
        >
          <ul
            id={listboxId}
            role="listbox"
            aria-label="Customers"
            className="max-h-64 overflow-y-auto p-1"
          >
            {isFetching && options.length === 0 ? (
              <li className="text-muted-foreground flex items-center gap-2 px-3 py-6 text-sm">
                <Spinner size="sm" label="" />
                Searching…
              </li>
            ) : options.length === 0 ? (
              <li className="text-muted-foreground px-3 py-6 text-center text-sm">
                {debounced ? `No customer matches “${debounced}”` : "No customers yet"}
              </li>
            ) : (
              options.map((customer, index) => {
                const selected = value?.id === customer.id;
                return (
                  <li
                    key={customer.id}
                    id={`${listboxId}-option-${index}`}
                    role="option"
                    aria-selected={selected}
                    onMouseEnter={() => setActiveIndex(index)}
                    // onMouseDown, not onClick: the input's blur would close the
                    // panel before a click could land.
                    onMouseDown={(event) => {
                      event.preventDefault();
                      select(customer);
                    }}
                    className={cn(
                      "flex cursor-pointer items-center justify-between gap-3 rounded-md px-2.5 py-2 text-sm",
                      index === activeIndex ? "bg-muted" : "",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="text-foreground block truncate font-medium">
                        {customer.name}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs tabular">
                        {customer.code}
                        {customer.phone ? ` · ${customer.phone}` : ""}
                      </span>
                    </span>
                    <span className="text-muted-foreground shrink-0 text-xs tabular">
                      {money.format(customer.outstandingBalance)} owed
                    </span>
                  </li>
                );
              })
            )}
          </ul>

          {canCreate ? (
            <div className="border-border border-t p-1">
              <button
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  setOpen(false);
                  setCreateOpen(true);
                }}
                className="text-primary hover:bg-muted focus-visible:ring-ring flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
              >
                <Plus aria-hidden="true" className="size-4" />
                Create a new customer
                {query ? <span className="truncate opacity-70">“{query}”</span> : null}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {canCreate ? (
        <CreateCustomerDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          initialName={query}
          onCreated={(customer) => {
            select(customer);
            setCreateOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline creation
// ---------------------------------------------------------------------------
function CreateCustomerDialog({
  open,
  onOpenChange,
  initialName,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName: string;
  onCreated: (customer: CustomerOption) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setPhone("");
      setTouched(false);
    }
  }, [open, initialName]);

  const createCustomer = useMutation({
    mutationFn: (input: { name: string; phone: string | null }) =>
      gqlRequest<{ createCustomer: CustomerOption }, { input: typeof input }>(
        CREATE_CUSTOMER_MUTATION,
        { input },
      ).then((data) => data.createCustomer),
    onSuccess: (customer) => {
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      void queryClient.invalidateQueries({ queryKey: [...creditKeys.all, "customer-search"] });
      toast.success(`${customer.name} added`);
      onCreated(customer);
    },
    onError: (error) => {
      toast.error("Could not create the customer", {
        description: parseApiError(error).message,
      });
    },
  });

  const trimmed = name.trim();
  const error = touched && trimmed.length === 0 ? "A name is required." : undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title="New customer"
      description="Just enough to write the credit. You can fill in the rest later."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            isLoading={createCustomer.isPending}
            leftIcon={<UserPlus />}
            onClick={() => {
              setTouched(true);
              if (trimmed.length === 0) return;
              createCustomer.mutate({ name: trimmed, phone: phone.trim() || null });
            }}
          >
            Create and select
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormField label="Name" required error={error}>
          <Input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="Full name"
          />
        </FormField>

        <FormField label="Phone" description="How you will chase them. Optional.">
          <Input
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="Optional"
          />
        </FormField>
      </div>
    </Dialog>
  );
}
