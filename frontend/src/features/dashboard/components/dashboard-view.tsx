"use client";

import { motion } from "framer-motion";
import { ArrowRight, Package, PlusCircle, RefreshCw, Sparkles, UserPlus } from "lucide-react";
import Link from "next/link";

import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  buttonVariants,
} from "@/components/ui";
import { CollectionsByMethodChart } from "@/features/dashboard/components/collections-by-method-chart";
import { DashboardSkeleton } from "@/features/dashboard/components/dashboard-skeleton";
import { LatestActivity } from "@/features/dashboard/components/latest-activity";
import { MonthlyChart } from "@/features/dashboard/components/monthly-chart";
import { OverdueTrendChart } from "@/features/dashboard/components/overdue-trend-chart";
import { StatCards } from "@/features/dashboard/components/stat-cards";
import { TopCustomers } from "@/features/dashboard/components/top-customers";
import { UpcomingDue } from "@/features/dashboard/components/upcoming-due";
import { useDashboard } from "@/features/dashboard/hooks/use-dashboard";
import { parseApiError } from "@/features/credits/lib/errors";
import { useAuth } from "@/lib/auth/AuthProvider";
import {
  MonthCards,
  TodayCards,
} from "@/features/dashboard/components/money-out-cards";
import {
  OverdueCustomers,
  RecentExpenses,
  TopExpenseCategoriesChart,
} from "@/features/dashboard/components/money-out-panels";
import {
  CashFlowTrendChart,
  RevenueVsExpensesChart,
} from "@/features/dashboard/components/revenue-vs-expenses-chart";
import { StoreMasthead } from "@/features/dashboard/components/store-masthead";
import { fadeUpVariants, staggerVariants } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function DashboardView() {
  const { hasPermission } = useAuth();
  const { data, isPending, isError, error, refetch, isFetching } = useDashboard();

  const canWriteCredit = hasPermission("credit:write");

  const header = (
    <StoreMasthead
      actions={
        canWriteCredit ? (
          <Link href="/credits/new" className={cn(buttonVariants({ variant: "primary" }))}>
            <PlusCircle aria-hidden="true" className="size-4" />
            New credit
          </Link>
        ) : null
      }
    />
  );

  if (isPending) {
    return (
      <div className="space-y-6">
        {header}
        <DashboardSkeleton />
      </div>
    );
  }

  if (isError) {
    const parsed = parseApiError(error);
    return (
      <div className="space-y-6">
        {header}
        <Alert variant="destructive" title="Could not load your dashboard">
          <p>{parsed.message}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            leftIcon={<RefreshCw />}
            isLoading={isFetching}
            onClick={() => void refetch()}
          >
            Try again
          </Button>
        </Alert>
      </div>
    );
  }

  const { summary } = data;
  // A business with no customers and no credits has nothing to plot. Seven zeroed
  // stat cards and three empty charts is a broken-looking product; a first run
  // should look like a beginning, not a failure.
  const isBrandNew = summary.totalCredits === 0 && summary.totalCustomers === 0;

  if (isBrandNew) {
    return (
      <div className="space-y-6">
        {header}
        <GettingStarted canWriteCredit={canWriteCredit} />
      </div>
    );
  }

  return (
    <motion.div
      variants={staggerVariants}
      initial="hidden"
      animate="visible"
      // Hold the previous render at reduced opacity on a refetch. A skeleton flash
      // on a background refresh is a layout jump for no new information.
      className={cn("space-y-6 transition-opacity", isFetching && "opacity-70")}
    >
      {header}

      {/* Today first: it is the question a shop owner opens the app to answer. */}
      <motion.section variants={fadeUpVariants} aria-label="Today">
        <TodayCards accounting={data.accounting} />
      </motion.section>

      <motion.section variants={fadeUpVariants} aria-label="This month">
        <MonthCards accounting={data.accounting} />
      </motion.section>

      <motion.section variants={fadeUpVariants} aria-label="Summary">
        <StatCards summary={summary} />
      </motion.section>

      <motion.section
        variants={fadeUpVariants}
        aria-label="Trends"
        className="grid grid-cols-1 gap-4 lg:grid-cols-3"
      >
        <MonthlyChart data={data.monthly} />
        <OverdueTrendChart data={data.overdueTrend} />
      </motion.section>

      <motion.section
        variants={fadeUpVariants}
        aria-label="Money in and out"
        className="grid grid-cols-1 gap-4 lg:grid-cols-2"
      >
        <RevenueVsExpensesChart data={data.accounting.monthly} />
        <CashFlowTrendChart data={data.accounting.monthly} />
      </motion.section>

      <motion.section
        variants={fadeUpVariants}
        aria-label="Spending"
        className="grid grid-cols-1 gap-4 lg:grid-cols-3"
      >
        <TopExpenseCategoriesChart data={data.accounting.topExpenseCategories} />
        <RecentExpenses expenses={data.recentExpenses} />
        <OverdueCustomers customers={data.overdueCustomers} />
      </motion.section>

      <motion.section
        variants={fadeUpVariants}
        aria-label="Activity"
        className="grid grid-cols-1 gap-4 lg:grid-cols-3"
      >
        <LatestActivity items={data.latestActivity} />
        <UpcomingDue credits={data.upcomingDue} />
        <CollectionsByMethodChart data={data.collectionsByMethod} />
      </motion.section>

      <motion.section variants={fadeUpVariants} aria-label="Customers">
        <TopCustomers customers={data.topCustomers} />
      </motion.section>
    </motion.div>
  );
}

const STEPS = [
  {
    icon: UserPlus,
    title: "Add your first customer",
    body: "Name and phone number is enough. Everything else can wait.",
    href: "/customers",
    cta: "Add a customer",
  },
  {
    icon: Package,
    title: "Load your catalog",
    body: "Products and services you sell, so writing a credit is a few taps.",
    href: "/products",
    cta: "Add products",
  },
  {
    icon: Sparkles,
    title: "Write your first credit",
    body: "Pick the customer, add the lines, set a due date. We chase it for you.",
    href: "/credits/new",
    cta: "New credit",
  },
] as const;

function GettingStarted({ canWriteCredit }: { canWriteCredit: boolean }) {
  return (
    <Card className="mesh-gradient overflow-hidden">
      <CardHeader>
        <CardTitle as="h2" className="text-lg">
          Welcome — your credit book is empty
        </CardTitle>
        <CardDescription className="max-w-xl">
          Nothing has been recorded yet, so there is nothing to chart. Three steps and this
          page fills itself in: balances, due dates, collections, and who is late.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <ol className="grid gap-4 sm:grid-cols-3">
          {STEPS.map((step, index) => {
            const Icon = step.icon;
            const disabled = step.href === "/credits/new" && !canWriteCredit;

            return (
              <li
                key={step.title}
                className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4"
              >
                <span className="flex items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className="bg-primary-soft text-primary-soft-foreground flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4"
                  >
                    <Icon />
                  </span>
                  <span className="text-muted-foreground text-xs font-medium tabular">
                    Step {index + 1}
                  </span>
                </span>

                <span className="flex-1 space-y-1">
                  <span className="text-foreground block text-sm font-semibold">
                    {step.title}
                  </span>
                  <span className="text-muted-foreground block text-xs leading-relaxed">
                    {step.body}
                  </span>
                </span>

                {disabled ? null : (
                  <Link
                    href={step.href}
                    className={cn(
                      buttonVariants({ variant: "outline", size: "sm" }),
                      "w-full justify-between",
                    )}
                  >
                    {step.cta}
                    <ArrowRight aria-hidden="true" className="size-3.5" />
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
