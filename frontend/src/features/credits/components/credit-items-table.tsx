"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";
import { useMoney } from "@/features/credits/hooks/use-business-settings";
import type { CreditItemRow } from "@/features/credits/queries";
import { formatNumber } from "@/lib/format";

/**
 * The lines, exactly as they were priced AT SALE TIME.
 *
 * `name` and `unitPrice` are snapshots, not joins — the catalog can raise its price
 * tomorrow and this credit still says what the customer actually agreed to. That is
 * deliberate in the backend (see models/credit.py) and it is why this table never
 * links back to the live product.
 */
export function CreditItemsTable({ items }: { items: CreditItemRow[] }) {
  const money = useMoney();
  const sorted = [...items].sort((a, b) => a.position - b.position);

  return (
    <>
      <TableContainer className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead align="right">Qty</TableHead>
              <TableHead align="right">Unit price</TableHead>
              <TableHead align="right">Discount</TableHead>
              <TableHead align="right">Tax</TableHead>
              <TableHead align="right">Line total</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {sorted.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <span className="text-foreground block font-medium">{item.name}</span>
                  {item.description ? (
                    <span className="text-muted-foreground block text-xs">
                      {item.description}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell numeric>
                  {formatNumber(item.quantity, money.locale, { maximumFractionDigits: 3 })}
                  <span className="text-muted-foreground ml-1 text-xs">{item.unit}</span>
                </TableCell>
                <TableCell numeric>{money.format(item.unitPrice)}</TableCell>
                <TableCell numeric className="text-muted-foreground">
                  {money.format(item.discountAmount)}
                </TableCell>
                <TableCell numeric className="text-muted-foreground">
                  {money.format(item.taxAmount)}
                  <span className="ml-1 text-xs">({item.taxPercentage}%)</span>
                </TableCell>
                <TableCell numeric className="font-medium">
                  {money.format(item.lineTotal)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* On a phone, six numeric columns is a scroll bar, not a table. */}
      <ul className="divide-border border-border divide-y rounded-lg border sm:hidden">
        {sorted.map((item) => (
          <li key={item.id} className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-foreground truncate font-medium">{item.name}</p>
                <p className="text-muted-foreground text-xs tabular">
                  {formatNumber(item.quantity, money.locale, { maximumFractionDigits: 3 })}{" "}
                  {item.unit} × {money.format(item.unitPrice)}
                </p>
              </div>
              <p className="text-foreground tabular shrink-0 font-medium">
                {money.format(item.lineTotal)}
              </p>
            </div>

            <p className="text-muted-foreground text-xs tabular">
              Discount {money.format(item.discountAmount)} · Tax {money.format(item.taxAmount)} (
              {item.taxPercentage}%)
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}
