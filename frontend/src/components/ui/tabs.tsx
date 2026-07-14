"use client";

import { motion } from "framer-motion";
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

interface TabsContextValue {
  value: string;
  setValue: (value: string) => void;
  baseId: string;
  register: (value: string, el: HTMLButtonElement | null) => void;
  order: React.RefObject<string[]>;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabs(): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("Tabs components must be used inside <Tabs>");
  return ctx;
}

export interface TabsProps {
  /** Controlled value. Omit for uncontrolled + defaultValue. */
  value?: string;
  defaultValue: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
  className?: string;
}

export function Tabs({ value, defaultValue, onValueChange, children, className }: TabsProps) {
  const [internal, setInternal] = useState(defaultValue);
  const baseId = useId();
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const order = useRef<string[]>([]);

  const current = value ?? internal;

  const setValue = useCallback(
    (next: string) => {
      if (value === undefined) setInternal(next);
      onValueChange?.(next);
      // Automatic activation (WAI-ARIA "tabs with automatic activation"): arrow
      // keys both move focus AND select. Correct when panels are cheap to render;
      // switch to manual activation if a panel ever fires a network request.
      refs.current.get(next)?.focus();
    },
    [value, onValueChange],
  );

  const register = useCallback((tabValue: string, el: HTMLButtonElement | null) => {
    if (el) {
      refs.current.set(tabValue, el);
      if (!order.current.includes(tabValue)) order.current.push(tabValue);
    } else {
      refs.current.delete(tabValue);
      order.current = order.current.filter((v) => v !== tabValue);
    }
  }, []);

  const ctx = useMemo<TabsContextValue>(
    () => ({ value: current, setValue, baseId, register, order }),
    [current, setValue, baseId, register],
  );

  return (
    <TabsContext.Provider value={ctx}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({ children, className }: { children: ReactNode; className?: string }) {
  const { value, setValue, order } = useTabs();

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const values = order.current;
    const index = values.indexOf(value);
    if (index === -1) return;

    let next: number | null = null;
    if (event.key === "ArrowRight") next = (index + 1) % values.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + values.length) % values.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = values.length - 1;

    if (next !== null) {
      event.preventDefault();
      const target = values[next];
      if (target) setValue(target);
    }
  };

  return (
    <div
      role="tablist"
      onKeyDown={onKeyDown}
      className={cn(
        "border-border bg-muted/60 inline-flex items-center gap-1 rounded-lg border p-1",
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface TabsTriggerProps {
  value: string;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function TabsTrigger({ value, children, disabled, className }: TabsTriggerProps) {
  const { value: active, setValue, baseId, register } = useTabs();
  const selected = active === value;

  return (
    <button
      ref={(el) => register(value, el)}
      type="button"
      role="tab"
      id={`${baseId}-tab-${value}`}
      aria-selected={selected}
      aria-controls={`${baseId}-panel-${value}`}
      // Roving tabindex: the tablist is ONE tab stop, arrows move within it.
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      onClick={() => setValue(value)}
      className={cn(
        "relative rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        "focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-50",
        selected ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {selected ? (
        // layoutId gives the pill a shared-element slide between tabs; Framer's
        // MotionConfig reducedMotion="user" collapses it to an instant swap.
        <motion.span
          layoutId={`${baseId}-tab-indicator`}
          className="bg-card absolute inset-0 rounded-md shadow-xs"
          transition={{ type: "spring", stiffness: 400, damping: 34 }}
        />
      ) : null}
      <span className="relative z-10">{children}</span>
    </button>
  );
}

export function TabsContent({
  value,
  children,
  className,
}: {
  value: string;
  children: ReactNode;
  className?: string;
}) {
  const { value: active, baseId } = useTabs();
  if (active !== value) return null;

  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${value}`}
      aria-labelledby={`${baseId}-tab-${value}`}
      tabIndex={0}
      className={cn("mt-4 focus-visible:outline-none", className)}
    >
      {children}
    </div>
  );
}
