"use client";

import {
  AlertTriangle,
  ArrowLeft,
  CreditCard,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Receipt,
  ShieldAlert,
  StickyNote,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  buttonVariants,
} from "@/components/ui";
import { toServerError } from "@/features/common/errors";
import { assetUrl } from "@/features/common/media";
import { useCurrency } from "@/features/common/use-currency";
import { useAuth } from "@/lib/auth/AuthProvider";
import { CUSTOMER_STATUS_STYLES, cn, formatDate, formatRelativeDate } from "@/lib/utils";
import type { ID, Money } from "@/types";

import { useCustomer, useCustomerScore } from "../queries";
import { CreditScorePanel } from "./credit-score";
import { CustomerCreditsTab } from "./customer-credits-tab";
import { CustomerPaymentsTab } from "./customer-payments-tab";

export function CustomerDetail({ id }: { id: ID }) {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const currency = useCurrency();
  const [tab, setTab] = useState("credits");

  const { data: customer, isLoading, error } = useCustomer(id);
  const { data: score, isLoading: scoreLoading } = useCustomerScore(id);

  if (error) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive" title="Could not load this customer">
          {toServerError(error).message}
        </Alert>
        <Link href="/customers" className={buttonVariants({ variant: "outline" })}>
          <ArrowLeft />
          Back to customers
        </Link>
      </div>
    );
  }

  if (isLoading || !customer) return <CustomerDetailSkeleton />;

  const style = CUSTOMER_STATUS_STYLES[customer.status];
  const overLimit =
    customer.creditLimit != null &&
    Number(customer.creditLimit) > 0 &&
    Number(customer.outstandingBalance) > Number(customer.creditLimit);

  return (
    <div className="space-y-6">
      <Button
        variant="ghost"
        size="sm"
        leftIcon={<ArrowLeft />}
        onClick={() => router.back()}
        className="-ml-2"
      >
        Back
      </Button>

      {/* --------------------------------------------------------- profile */}
      <Card>
        <CardContent className="p-5 sm:p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            <Avatar
              size="xl"
              src={assetUrl(customer.photoUrl)}
              name={customer.name}
              seed={customer.id}
              className="size-20 text-xl sm:size-24"
            />

            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-foreground truncate text-xl font-semibold tracking-tight">
                  {customer.name}
                </h2>
                <Badge className={style.className} dot>
                  {style.label}
                </Badge>
                <span className="text-muted-foreground tabular text-sm">{customer.code}</span>
              </div>

              <dl className="text-muted-foreground grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <Detail icon={<Phone />} label="Phone" value={customer.phone} />
                <Detail icon={<Mail />} label="Email" value={customer.email} />
                <Detail
                  icon={<MapPin />}
                  label="Address"
                  value={[customer.address, customer.city].filter(Boolean).join(", ") || null}
                />
                <Detail
                  icon={<ShieldAlert />}
                  label="Emergency contact"
                  value={
                    customer.emergencyContactName
                      ? [
                          customer.emergencyContactName,
                          customer.emergencyContactRelation
                            ? `(${customer.emergencyContactRelation})`
                            : null,
                          customer.emergencyContactPhone,
                        ]
                          .filter(Boolean)
                          .join(" ")
                      : null
                  }
                />
              </dl>
            </div>

            <div className="flex flex-wrap gap-2 sm:flex-col">
              {hasPermission("customer:write") ? (
                <Link
                  href={`/customers/${customer.id}/edit`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  <Pencil />
                  Edit
                </Link>
              ) : null}
              {hasPermission("credit:write") ? (
                <Link
                  href={`/credits/new?customerId=${customer.id}`}
                  className={buttonVariants({ size: "sm" })}
                >
                  <CreditCard />
                  New credit
                </Link>
              ) : null}
              {hasPermission("payment:write") ? (
                <Link
                  href={`/payments/new?customerId=${customer.id}`}
                  className={buttonVariants({ variant: "secondary", size: "sm" })}
                >
                  <Receipt />
                  Record payment
                </Link>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      {overLimit ? (
        <Alert variant="warning" title="Over their credit limit">
          {customer.name} owes {currency.format(customer.outstandingBalance)} against a limit of{" "}
          {currency.format(customer.creditLimit)}.
        </Alert>
      ) : null}

      {/* ----------------------------------------------------------- stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Total credit" value={currency.format(customer.totalCredit)} />
        <Stat label="Total paid" value={currency.format(customer.totalPaid)} tone="success" />
        <Stat
          label="Outstanding"
          value={currency.format(customer.outstandingBalance)}
          tone={Number(customer.outstandingBalance) > 0 ? "warning" : "muted"}
        />
        <Stat label="Credits" value={String(customer.creditCount)} />
        <Stat
          label="Overdue"
          value={String(customer.overdueCount)}
          tone={customer.overdueCount > 0 ? "destructive" : "muted"}
          icon={customer.overdueCount > 0 ? <AlertTriangle className="size-4" /> : undefined}
        />
      </div>

      {/* ------------------------------------------------------ tabs + score */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Tabs value={tab} defaultValue="credits" onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="credits">Credits ({customer.creditCount})</TabsTrigger>
              <TabsTrigger value="payments">Payments</TabsTrigger>
              <TabsTrigger value="notes">Notes</TabsTrigger>
            </TabsList>

            <TabsContent value="credits">
              <CustomerCreditsTab customerId={customer.id} />
            </TabsContent>

            <TabsContent value="payments">
              <CustomerPaymentsTab customerId={customer.id} />
            </TabsContent>

            <TabsContent value="notes">
              <Card>
                <CardContent className="p-5 sm:p-6">
                  {customer.notes ? (
                    <div className="space-y-3">
                      <p className="text-foreground text-sm leading-relaxed whitespace-pre-wrap">
                        {customer.notes}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        Added when the record was last edited ·{" "}
                        {formatRelativeDate(customer.createdAt)}
                      </p>
                    </div>
                  ) : (
                    <EmptyState
                      size="sm"
                      icon={<StickyNote />}
                      title="No notes"
                      description="Anything your staff should know before extending more credit goes here."
                      action={
                        hasPermission("customer:write") ? (
                          <Link
                            href={`/customers/${customer.id}/edit`}
                            className={buttonVariants({ variant: "outline", size: "sm" })}
                          >
                            Add a note
                          </Link>
                        ) : null
                      }
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-6">
          <CreditScorePanel
            score={score?.score ?? customer.creditScore}
            reasons={score?.reasons}
            isLoading={scoreLoading}
          />

          <Card>
            <CardContent className="space-y-3 p-5 text-sm sm:p-6">
              <Row label="Credit limit" value={currency.format(customer.creditLimit)} />
              <Row label="Last credit" value={formatDate(customer.lastCreditAt)} />
              <Row label="Last payment" value={formatDate(customer.lastPaymentAt)} />
              <Row label="Customer since" value={formatDate(customer.createdAt)} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Detail({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
}) {
  return (
    <div className="flex items-start gap-2">
      <span aria-hidden="true" className="mt-0.5 shrink-0 [&_svg]:size-4">
        {icon}
      </span>
      <dt className="sr-only">{label}</dt>
      <dd className="text-foreground min-w-0 break-words">{value ?? "—"}</dd>
    </div>
  );
}

const TONES = {
  muted: "text-muted-foreground",
  success: "text-success-soft-foreground",
  warning: "text-warning-soft-foreground",
  destructive: "text-destructive-soft-foreground",
  default: "text-foreground",
} as const;

function Stat({
  label,
  value,
  tone = "default",
  icon,
}: {
  label: string;
  value: string;
  tone?: keyof typeof TONES;
  icon?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
          {label}
        </p>
        <p
          className={cn(
            "tabular mt-1 flex items-center gap-1.5 text-lg font-semibold",
            TONES[tone],
          )}
        >
          {icon}
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string | Money }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular text-foreground font-medium">{value}</span>
    </div>
  );
}

function CustomerDetailSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-busy="true">
      <span className="sr-only">Loading customer</span>
      <Skeleton className="h-40 w-full rounded-lg" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-72 rounded-lg lg:col-span-2" />
        <Skeleton className="h-72 rounded-lg" />
      </div>
    </div>
  );
}
