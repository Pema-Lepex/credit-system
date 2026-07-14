"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  CornerDownLeft,
  CreditCard,
  Loader2,
  Package,
  Receipt,
  Search,
  SearchX,
  User,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { NAV_ITEMS, type NavItem } from "@/components/layout/nav-config";
import { Badge } from "@/components/ui/badge";
import { useCurrency } from "@/features/common/use-currency";
import { KIND_LABELS, KIND_ORDER, hrefForHit, type SearchHit } from "@/features/search/api";
import { useSearch } from "@/features/search/use-search";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useMounted } from "@/hooks/use-mounted";
import { useScrollLock } from "@/hooks/use-scroll-lock";
import { dialogVariants, overlayVariants } from "@/lib/motion";
import { CREDIT_STATUS_STYLES, CUSTOMER_STATUS_STYLES, cn } from "@/lib/utils";
import type { CreditStatus, CustomerStatus } from "@/types";

export interface CommandItem {
  id: string;
  label: string;
  /** e.g. "CUST-0007 · +975 17 123 456" — the second line in the row. */
  hint?: string;
  group: string;
  icon?: React.ReactNode;
  /** Right-hand side: money, already formatted. */
  amount?: string;
  /** Right-hand side: a status chip. */
  status?: React.ReactNode;
  onSelect: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Extra results, merged above the live ones. The shell passes none. */
  results?: CommandItem[];
  isSearching?: boolean;
  onQueryChange?: (query: string) => void;
}

const KIND_ICONS: Record<string, LucideIcon> = {
  customer: User,
  credit: CreditCard,
  payment: Receipt,
  product: Package,
};

/** Quick actions — what makes ⌘K useful before you have typed anything. */
interface QuickAction {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  keywords: string;
  permission?: NavItem["permission"];
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: "new-credit",
    label: "New credit",
    href: "/credits/new",
    icon: CreditCard,
    keywords: "new credit sale create",
    permission: "credit:write",
  },
  {
    id: "new-customer",
    label: "New customer",
    href: "/customers/new",
    icon: UserPlus,
    keywords: "new customer add person",
    permission: "customer:write",
  },
  {
    id: "record-payment",
    label: "Record payment",
    href: "/payments/new",
    icon: Receipt,
    keywords: "record payment collect money",
    permission: "payment:write",
  },
  {
    id: "new-product",
    label: "New product",
    href: "/products/new",
    icon: Package,
    keywords: "new product item stock",
    permission: "catalog:write",
  },
];

/** A hit's status, tinted with the same tokens the tables use. */
function StatusChip({ hit }: { hit: SearchHit }) {
  if (!hit.status) return null;

  if (hit.kind === "customer" && hit.status in CUSTOMER_STATUS_STYLES) {
    const style = CUSTOMER_STATUS_STYLES[hit.status as CustomerStatus];
    return (
      <Badge size="sm" className={style.className}>
        {style.label}
      </Badge>
    );
  }
  if (hit.kind === "credit" && hit.status in CREDIT_STATUS_STYLES) {
    const style = CREDIT_STATUS_STYLES[hit.status as CreditStatus];
    return (
      <Badge size="sm" className={style.className}>
        {style.label}
      </Badge>
    );
  }
  return (
    <Badge size="sm" variant="neutral">
      {hit.status}
    </Badge>
  );
}

/**
 * ⌘K palette — the app's global search.
 *
 * The listbox pattern: the INPUT keeps focus at all times and
 * `aria-activedescendant` points at the highlighted option. Moving real DOM focus
 * onto the options instead would rip focus out of the text field, and the user
 * could no longer type — which is the single most common way this component is
 * built wrong.
 *
 * With an empty query it is a launcher (quick actions + navigation, zero
 * latency). From two characters it is a debounced global search over customers,
 * credits, payments and products, grouped by kind, each row deep-linking to the
 * record. Both live in ONE list, so ↑↓ crosses the boundary without the user
 * having to know there is one.
 */
export function CommandPalette({
  open,
  onOpenChange,
  results = [],
  isSearching = false,
  onQueryChange,
}: CommandPaletteProps) {
  const router = useRouter();
  const mounted = useMounted();
  const { hasPermission } = useAuth();
  const currency = useCurrency();

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useScrollLock(open);
  useFocusTrap(panelRef, open, { initialFocusRef: inputRef });

  const search = useSearch(open ? query : "", 20);

  // ------------------------------------------------------------ remote hits
  const hitItems = useMemo<CommandItem[]>(() => {
    const hits = search.data?.hits ?? [];
    return [...hits]
      .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
      .map((hit) => {
        const Icon = KIND_ICONS[hit.kind] ?? Search;
        return {
          id: `${hit.kind}:${hit.id}`,
          label: hit.title,
          hint: hit.subtitle,
          group: KIND_LABELS[hit.kind] ?? "Results",
          icon: <Icon className="size-4" />,
          // Money is a string from the server; format it, never add it up.
          amount: hit.amount ? currency.format(hit.amount) : undefined,
          status: <StatusChip hit={hit} />,
          onSelect: () => router.push(hrefForHit(hit)),
        };
      });
  }, [currency, router, search.data]);

  // ------------------------------------------------- local (zero-latency) items
  const q = query.trim().toLowerCase();

  const actionItems = useMemo<CommandItem[]>(
    () =>
      QUICK_ACTIONS.filter(
        (action) =>
          (!action.permission || hasPermission(action.permission)) &&
          (!q || action.keywords.includes(q) || action.label.toLowerCase().includes(q)),
      ).map((action) => {
        const Icon = action.icon;
        return {
          id: `action:${action.id}`,
          label: action.label,
          group: "Actions",
          icon: <Icon className="size-4" />,
          onSelect: () => router.push(action.href),
        };
      }),
    [hasPermission, q, router],
  );

  const navItems = useMemo<CommandItem[]>(
    () =>
      NAV_ITEMS.filter(
        (item) =>
          (!item.permission || hasPermission(item.permission)) &&
          (!q || item.label.toLowerCase().includes(q)),
      ).map((item) => {
        const Icon = item.icon;
        return {
          id: `nav:${item.href}`,
          label: `Go to ${item.label}`,
          hint: item.href,
          group: "Navigation",
          icon: <Icon className="size-4" />,
          onSelect: () => router.push(item.href),
        };
      }),
    [hasPermission, q, router],
  );

  // Search hits first once they exist — when you type "Dorji" you want Dorji, not
  // "Go to Dashboard" sitting above him.
  const items = useMemo(
    () => [...results, ...hitItems, ...actionItems, ...navItems],
    [results, hitItems, actionItems, navItems],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    for (const item of items) {
      const list = map.get(item.group) ?? [];
      list.push(item);
      map.set(item.group, list);
    }
    return [...map.entries()];
  }, [items]);

  // Reset on every open — a palette that remembers last night's query is a bug.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      onQueryChange?.("");
    }
  }, [open, onQueryChange]);

  // Results arriving must not leave the highlight pointing past the end of the list.
  useEffect(() => setActiveIndex(0), [query, items.length]);

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!mounted) return null;

  const select = (index: number) => {
    const item = items[index];
    if (!item) return;
    onOpenChange(false);
    item.onSelect();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((i) => (items.length === 0 ? 0 : (i + 1) % items.length));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((i) => (items.length === 0 ? 0 : (i - 1 + items.length) % items.length));
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(Math.max(0, items.length - 1));
        break;
      case "Enter":
        event.preventDefault();
        select(activeIndex);
        break;
      case "Escape":
        event.preventDefault();
        onOpenChange(false);
        break;
      default:
        break;
    }
  };

  const busy = isSearching || search.isPending;
  const hasQuery = query.trim().length > 0;
  const noResults = !busy && items.length === 0;

  let flatIndex = -1;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
          <motion.div
            variants={overlayVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            aria-hidden="true"
            onClick={() => onOpenChange(false)}
            className="bg-foreground/25 absolute inset-0 backdrop-blur-[2px]"
          />

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            variants={dialogVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onKeyDown={onKeyDown}
            className="glass relative z-10 flex w-full max-w-xl flex-col overflow-hidden rounded-xl shadow-xl"
          >
            <div className="border-border flex items-center gap-3 border-b px-4">
              {busy ? (
                <Loader2
                  className="text-muted-foreground size-4 shrink-0 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <Search className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
              )}
              <input
                ref={inputRef}
                type="text"
                role="combobox"
                aria-expanded="true"
                aria-controls="command-list"
                aria-activedescendant={
                  items.length > 0 ? `command-item-${activeIndex}` : undefined
                }
                aria-autocomplete="list"
                aria-label="Search customers, credits, payments, products and pages"
                placeholder="Search customers, credits, payments, products…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  onQueryChange?.(e.target.value);
                }}
                className="text-foreground placeholder:text-muted-foreground h-12 w-full bg-transparent text-sm outline-none"
              />
              <kbd className="border-border bg-muted text-muted-foreground hidden shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium sm:block">
                ESC
              </kbd>
            </div>

            <ul
              ref={listRef}
              id="command-list"
              role="listbox"
              aria-label="Results"
              aria-busy={busy || undefined}
              className="max-h-[min(26rem,55dvh)] overflow-y-auto p-2"
            >
              {/* Live region: a screen-reader user gets told the count changed. */}
              <li role="presentation" aria-live="polite" className="sr-only">
                {busy
                  ? "Searching"
                  : `${items.length} result${items.length === 1 ? "" : "s"}`}
              </li>

              {busy && items.length === 0 ? (
                <li className="space-y-2 px-1 py-2" role="presentation">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-3 px-1.5 py-1.5">
                      <span className="bg-muted size-4 shrink-0 animate-pulse rounded" />
                      <span className="bg-muted h-3 flex-1 animate-pulse rounded" />
                      <span className="bg-muted h-3 w-16 shrink-0 animate-pulse rounded" />
                    </div>
                  ))}
                </li>
              ) : null}

              {noResults ? (
                <li
                  className="text-muted-foreground flex flex-col items-center gap-2 px-3 py-10 text-center text-sm"
                  role="presentation"
                >
                  <SearchX className="size-5" aria-hidden="true" />
                  {hasQuery ? (
                    <span>
                      No results for <span className="text-foreground">“{query}”</span>
                    </span>
                  ) : (
                    <span>Nothing to show.</span>
                  )}
                </li>
              ) : null}

              {grouped.map(([group, groupItems]) => (
                <li key={group} role="presentation">
                  <p className="text-muted-foreground px-2 py-1.5 text-[11px] font-semibold tracking-wider uppercase">
                    {group}
                  </p>
                  <ul role="group" aria-label={group}>
                    {groupItems.map((item) => {
                      flatIndex += 1;
                      const index = flatIndex;
                      const active = index === activeIndex;
                      return (
                        <li
                          key={item.id}
                          id={`command-item-${index}`}
                          role="option"
                          aria-selected={active}
                          data-active={active}
                          onClick={() => select(index)}
                          onMouseMove={() => setActiveIndex(index)}
                          className={cn(
                            "flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-sm",
                            active ? "bg-muted text-foreground" : "text-muted-foreground",
                          )}
                        >
                          {item.icon ? (
                            <span aria-hidden="true" className="shrink-0 opacity-80">
                              {item.icon}
                            </span>
                          ) : null}

                          <span className="min-w-0 flex-1">
                            <span className="text-foreground block truncate">{item.label}</span>
                            {item.hint ? (
                              <span className="text-muted-foreground block truncate text-xs">
                                {item.hint}
                              </span>
                            ) : null}
                          </span>

                          {item.status ? (
                            <span className="hidden shrink-0 sm:block">{item.status}</span>
                          ) : null}

                          {item.amount ? (
                            <span className="tabular text-foreground shrink-0 text-xs font-medium">
                              {item.amount}
                            </span>
                          ) : null}

                          {active ? (
                            <CornerDownLeft
                              className="text-muted-foreground size-3.5 shrink-0"
                              aria-hidden="true"
                            />
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>

            <div className="border-border text-muted-foreground hidden items-center gap-4 border-t px-4 py-2 text-[11px] sm:flex">
              <Shortcut keys="↑ ↓">Navigate</Shortcut>
              <Shortcut keys="↵">Open</Shortcut>
              <Shortcut keys="esc">Close</Shortcut>
              {search.data ? (
                <span className="ml-auto tabular-nums">
                  {search.data.total} match{search.data.total === 1 ? "" : "es"}
                </span>
              ) : null}
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

function Shortcut({ keys, children }: { keys: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1">
      <kbd className="border-border bg-muted rounded border px-1 py-0.5 font-medium">{keys}</kbd>
      {children}
    </span>
  );
}
