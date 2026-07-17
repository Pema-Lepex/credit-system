"use client";

/**
 * The customer's account: what they owe, how it got there, and one way to settle it.
 *
 * THIS SCREEN IS THE POINT OF THE WHOLE MIGRATION.
 *
 * The balance is one number, read from one column — not a sum over 400 credits. And
 * "Record payment" asks for an amount and nothing else: no invoice picker, no
 * allocation grid, no "which of these 400 credits is this paying for?" A shopkeeper
 * on salary day types 10,000 and presses one button.
 *
 * The passbook below is deliberately shaped like a bank statement, because that is
 * the artefact a customer already knows how to read when they are arguing about a
 * balance. Charges in one column, payments in another, running balance on the right.
 */

import { ArrowDownLeft, ArrowUpRight, FileText, Wallet, Zap } from "lucide-react";
import { useState } from "react";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Pagination,
  SkeletonTable,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@/components/ui";
import { StatementsPanel } from "@/features/ledger/components/statements-panel";
import { QuickSaleDialog } from "@/features/ledger/components/quick-sale-dialog";
import { RecordAccountPaymentDialog } from "@/features/ledger/components/record-account-payment-dialog";
import { useCustomerLedger, type LedgerEntryRow } from "@/features/ledger/api";
import { downloadCustomerStatementPdf } from "@/features/credits/lib/rest";
import { useCurrency } from "@/features/common/use-currency";
import { useAuth } from "@/lib/auth/AuthProvider";
import { cn, formatDate } from "@/lib/utils";
import type { ID, Money } from "@/types";

interface CustomerAccountTabProps {
  customerId: ID;
  customerName: string;
  /** For the statement's filename — statement-CUST-0007.pdf reads better than a uuid. */
  customerCode: string;
  /** The ledger balance: NOT clamped. Negative means they have paid ahead. */
  balance: Money;
}

export function CustomerAccountTab({
  customerId,
  customerName,
  customerCode,
  balance,
}: CustomerAccountTabProps) {
  const [page, setPage] = useState(1);
  const [payOpen, setPayOpen] = useState(false);
  const [saleOpen, setSaleOpen] = useState(false);
  const { hasPermission } = useAuth();
  const canPay = hasPermission("payment:write");
  const canSell = hasPermission("credit:write");

  const ledger = useCustomerLedger(customerId, page);

  return (
    <div className="space-y-4">
      <BalanceCard
        balance={balance}
        customerName={customerName}
        canPay={canPay}
        canSell={canSell}
        onPay={() => setPayOpen(true)}
        onAddSale={() => setSaleOpen(true)}
      />

      <Card>
        <CardContent className="p-0">
          <div className="border-border flex flex-wrap items-center justify-between gap-3 border-b p-4">
            <div className="min-w-0">
              <h3 className="text-foreground text-sm font-semibold">Account history</h3>
              <p className="text-muted-foreground text-xs">
                Every charge and payment, with the balance after each one.
              </p>
            </div>
            <StatementButton
              customerId={customerId}
              customerCode={customerCode}
              customerName={customerName}
            />
          </div>

          {ledger.isPending ? (
            <div className="p-4">
              <SkeletonTable rows={6} columns={5} />
            </div>
          ) : ledger.isError ? (
            <div className="p-4">
              <Alert variant="destructive" title="Could not load the account history">
                {ledger.error instanceof Error ? ledger.error.message : "Please try again."}
              </Alert>
            </div>
          ) : ledger.data && ledger.data.items.length > 0 ? (
            <>
              <PassbookTable entries={ledger.data.items} />
              {ledger.data.pageInfo.pages > 1 && (
                <div className="border-border border-t p-3">
                  <Pagination
                    page={ledger.data.pageInfo.page}
                    pageSize={ledger.data.pageInfo.limit}
                    totalItems={ledger.data.pageInfo.total}
                    onPageChange={setPage}
                    isLoading={ledger.isFetching}
                  />
                </div>
              )}
            </>
          ) : (
            <div className="p-4">
              <EmptyState
                size="sm"
                icon={<Wallet />}
                title="Nothing on this account yet"
                description="Charges and payments will appear here as they happen."
              />
            </div>
          )}
        </CardContent>
      </Card>

      <StatementsPanel customerId={customerId} />

      <QuickSaleDialog
        open={saleOpen}
        onOpenChange={setSaleOpen}
        customerId={customerId}
        customerName={customerName}
        balance={balance}
      />

      <RecordAccountPaymentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        customerId={customerId}
        customerName={customerName}
        balance={balance}
      />
    </div>
  );
}

/**
 * Download the customer's account statement.
 *
 * A plain button rather than a menu: "show me what I owe" is one question with one
 * answer, and the paid-history variant is a rare enough want that it does not earn
 * a dropdown in front of the common case.
 */
function StatementButton({
  customerId,
  customerCode,
  customerName,
}: {
  customerId: ID;
  customerCode: string;
  customerName: string;
}) {
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      await downloadCustomerStatementPdf(customerId, customerCode);
      toast.success("Statement downloaded", {
        description: `Everything ${customerName} still owes, on one page.`,
      });
    } catch (error) {
      toast.error("Could not download the statement", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      leftIcon={<FileText />}
      isLoading={busy}
      className="shrink-0"
      onClick={() => void download()}
    >
      Statement
    </Button>
  );
}

// ---------------------------------------------------------------------------
// The number the whole screen exists for
// ---------------------------------------------------------------------------
function BalanceCard({
  balance,
  customerName,
  canPay,
  canSell,
  onPay,
  onAddSale,
}: {
  balance: Money;
  customerName: string;
  canPay: boolean;
  canSell: boolean;
  onPay: () => void;
  onAddSale: () => void;
}) {
  const currency = useCurrency();
  const amount = Number(balance);
  const inCredit = amount < 0;
  const settled = amount === 0;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {inCredit ? "Paid in advance" : "Account balance"}
          </p>
          {/* Big on purpose: this is the number the shopkeeper turns the phone
              around to show the customer. */}
          <p
            className={cn(
              "text-foreground mt-1 text-3xl font-semibold tabular sm:text-4xl",
              inCredit && "text-success",
            )}
          >
            {currency.format(inCredit ? String(Math.abs(amount)) : balance)}
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            {settled
              ? `${customerName} owes nothing.`
              : inCredit
                ? `You are holding an advance for ${customerName}.`
                : `${customerName} owes this in total — across every purchase.`}
          </p>
        </div>

        {/* Add sale is PRIMARY and always shown: it runs 15x a day, Record payment
            runs once a month. The button sizes should follow the frequency, not the
            amount of money involved. */}
        <div className="flex shrink-0 flex-wrap gap-2">
          {canSell ? (
            <Button size="md" leftIcon={<Zap />} onClick={onAddSale}>
              Add sale
            </Button>
          ) : null}
          {canPay ? (
            <Button
              size="md"
              variant={settled || inCredit ? "ghost" : "secondary"}
              leftIcon={<Wallet />}
              onClick={onPay}
            >
              Record payment
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The passbook
// ---------------------------------------------------------------------------
function PassbookTable({ entries }: { entries: LedgerEntryRow[] }) {
  const currency = useCurrency();

  return (
    <TableContainer>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Detail</TableHead>
            <TableHead align="right">Charge</TableHead>
            <TableHead align="right">Payment</TableHead>
            <TableHead align="right">Balance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => {
            const amount = Number(entry.amount);
            const isCharge = amount > 0;
            const reversed = entry.entryType === "REVERSAL";

            return (
              <TableRow key={entry.id}>
                <TableCell className="whitespace-nowrap">
                  {/* occurredAt, not postedAt: the customer cares when it happened,
                      not when it was typed in. */}
                  <span className="text-sm">{formatDate(entry.occurredAt)}</span>
                </TableCell>

                <TableCell className="min-w-0">
                  <span className="flex items-center gap-2">
                    {isCharge ? (
                      <ArrowUpRight aria-hidden="true" className="text-muted-foreground size-3.5 shrink-0" />
                    ) : (
                      <ArrowDownLeft aria-hidden="true" className="text-success size-3.5 shrink-0" />
                    )}
                    <span className="text-sm">{entry.memo ?? entryLabel(entry.entryType)}</span>
                    {reversed && (
                      <Badge variant="warning" size="sm">
                        Reversed
                      </Badge>
                    )}
                  </span>
                </TableCell>

                <TableCell numeric>
                  {isCharge ? currency.format(entry.amount) : ""}
                </TableCell>
                <TableCell numeric className={cn(!isCharge && "text-success font-medium")}>
                  {!isCharge ? currency.format(String(Math.abs(amount))) : ""}
                </TableCell>
                <TableCell numeric className="font-medium">
                  {currency.format(entry.balanceAfter)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/** Fallback when an entry has no memo — never show the raw enum to a shopkeeper. */
function entryLabel(type: LedgerEntryRow["entryType"]): string {
  switch (type) {
    case "OPENING_BALANCE":
      return "Balance brought forward";
    case "CHARGE":
      return "Goods taken on credit";
    case "PAYMENT":
      return "Payment received";
    case "ADJUSTMENT":
      return "Adjustment";
    case "WRITE_OFF":
      return "Written off";
    case "REVERSAL":
      return "Correction";
  }
}
