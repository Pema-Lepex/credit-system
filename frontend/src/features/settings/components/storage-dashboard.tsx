"use client";

import {
  CreditCard,
  Database,
  Download,
  FileArchive,
  HardDrive,
  Image as ImageIcon,
  Package,
  Receipt,
  Sparkles,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@/components/ui";
import {
  MAINTENANCE_ACTIONS,
  useRunMaintenance,
  useStorageUsage,
  type MaintenanceAction,
  type StorageUsage,
} from "@/features/settings/api/storage";
import { downloadFile } from "@/features/settings/lib/http";
import { useChartColors } from "@/features/reports/lib/chart-theme";
import { useAuth } from "@/lib/auth/AuthProvider";
import { GraphQLRequestError } from "@/lib/graphql/client";
import { cn, formatBytes, formatNumber } from "@/lib/utils";

export function StorageDashboard() {
  const { data, isLoading, isError, error } = useStorageUsage();
  const { hasPermission } = useAuth();
  const canMaintain = hasPermission("storage:maintain");

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <Alert variant="destructive" title="Could not load your storage usage">
        {error instanceof Error ? error.message : "Please try again."}
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <QuotaCard usage={data} />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <BreakdownCard usage={data} />
        <CountsCard usage={data} />
      </div>
      <MaintenanceCard canMaintain={canMaintain} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quota
// ---------------------------------------------------------------------------
function QuotaCard({ usage }: { usage: StorageUsage }) {
  // percentUsed comes from the server — never recompute it from bytes here, or the
  // bar and the number can disagree by a rounding step.
  const percent = Math.min(100, Math.max(0, usage.percentUsed));
  const tone = usage.overQuota
    ? "bg-destructive"
    : percent >= 80
      ? "bg-warning"
      : "bg-primary";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardDrive className="size-4" aria-hidden="true" />
          Storage used
        </CardTitle>
        <CardDescription>
          {formatBytes(usage.totalBytes)} of {formatBytes(usage.quotaBytes)}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {usage.overQuota ? (
          <Alert variant="destructive" title="You are over your storage quota">
            New uploads will be refused until you free some space. The maintenance tools below
            are the quickest way to do that.
          </Alert>
        ) : null}

        <div className="space-y-2">
          {/* A meter, not a progressbar: it reports a measurement within a known
              range, which is exactly what role="meter" is for. */}
          <div
            role="meter"
            aria-valuenow={Math.round(percent)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Storage used, as a percentage of your quota"
            className="bg-muted h-3 w-full overflow-hidden rounded-full"
          >
            <div
              className={cn("h-full rounded-full transition-[width] duration-500", tone)}
              style={{ width: `${Math.max(percent, percent > 0 ? 1 : 0)}%` }}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-foreground font-medium tabular">
              {percent.toFixed(percent < 1 ? 2 : 1)}% used
            </span>
            <span className="text-muted-foreground tabular">
              {formatBytes(Math.max(0, usage.quotaBytes - usage.totalBytes))} free
            </span>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Figure label="Database" value={formatBytes(usage.databaseBytes)} icon={Database} />
          <Figure label="Uploads" value={formatBytes(usage.uploadsBytes)} icon={ImageIcon} />
          <Figure label="Total" value={formatBytes(usage.totalBytes)} icon={HardDrive} />
        </div>

        {/* A genuinely nice thing to tell someone on a free tier. */}
        {usage.bytesSavedByCompression > 0 ? (
          <Alert variant="success" icon={<Sparkles className="size-4" />}>
            Image compression has saved you{" "}
            <strong>{formatBytes(usage.bytesSavedByCompression)}</strong> — space you would
            otherwise be paying for.
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Figure({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
}) {
  return (
    <div className="border-border rounded-lg border p-3">
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </div>
      <p className="text-foreground mt-1 text-lg font-semibold tabular">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Breakdown
// ---------------------------------------------------------------------------
interface Slice {
  label: string;
  bytes: number;
  count: number;
}

function BreakdownCard({ usage }: { usage: StorageUsage }) {
  const colors = useChartColors();

  // The server's breakdown covers uploads. When there are no uploads at all it is
  // empty — and a chart of nothing is a lie, so fall back to the one split that is
  // always true: database vs uploads.
  const slices: Slice[] =
    usage.breakdown.length > 0
      ? usage.breakdown.map((b) => ({ label: b.label, bytes: b.bytes, count: b.count }))
      : [
          { label: "Database", bytes: usage.databaseBytes, count: 0 },
          { label: "Uploads", bytes: usage.uploadsBytes, count: usage.imageCount },
        ];

  const total = slices.reduce((sum, slice) => sum + slice.bytes, 0);
  const hasData = total > 0;

  return (
    // min-w-0: this card is a grid item holding a Recharts ResponsiveContainer and a
    // table, both of which force the grid column wider than the phone (and overflow
    // the page) unless the item is allowed to shrink below its content width.
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>What is using the space</CardTitle>
        <CardDescription>
          {usage.breakdown.length > 0
            ? "Your uploaded files, by type."
            : "You have not uploaded any files yet — this is your database."}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {!hasData ? (
          <EmptyState size="sm" icon={<FileArchive />} title="Nothing stored yet" />
        ) : (
          <>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={slices}
                    dataKey="bytes"
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    innerRadius={48}
                    outerRadius={76}
                    // A 2px gap in the surface colour between segments — adjacent
                    // fills must never touch, or the boundary reads as a third colour.
                    paddingAngle={2}
                    stroke={colors.surface}
                    strokeWidth={2}
                    isAnimationActive={false}
                  >
                    {slices.map((slice, index) => (
                      <Cell
                        key={slice.label}
                        fill={colors.series[index % colors.series.length]}
                      />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    contentStyle={{
                      background: colors.surface,
                      border: `1px solid ${colors.border}`,
                      borderRadius: 8,
                      fontSize: 12,
                      color: colors.foreground,
                    }}
                    // Recharts types the tooltip value as ValueType|undefined, so the
                    // parameter has to be wider than `number` to stay contravariant.
                    formatter={(value: unknown, name: unknown): [string, string] => [
                      formatBytes(typeof value === "number" ? value : 0),
                      String(name),
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* The table IS the legend — identity is never colour-alone. */}
            <TableContainer>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead align="right">Files</TableHead>
                    <TableHead align="right">Size</TableHead>
                    <TableHead align="right">Share</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {slices.map((slice, index) => (
                    <TableRow key={slice.label}>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className="size-2.5 shrink-0 rounded-[3px]"
                            style={{
                              background: colors.series[index % colors.series.length],
                            }}
                          />
                          {slice.label}
                        </span>
                      </TableCell>
                      <TableCell numeric>
                        {slice.count > 0 ? formatNumber(slice.count) : "—"}
                      </TableCell>
                      <TableCell numeric>{formatBytes(slice.bytes)}</TableCell>
                      <TableCell numeric>
                        {total > 0 ? `${((slice.bytes / total) * 100).toFixed(1)}%` : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------
function CountsCard({ usage }: { usage: StorageUsage }) {
  const tiles: { label: string; value: number; icon: LucideIcon }[] = [
    { label: "Customers", value: usage.customerCount, icon: Users },
    { label: "Credits", value: usage.creditCount, icon: CreditCard },
    { label: "Payments", value: usage.paymentCount, icon: Receipt },
    { label: "Products", value: usage.productCount, icon: Package },
    { label: "Services", value: usage.serviceCount, icon: Wrench },
    { label: "Images", value: usage.imageCount, icon: ImageIcon },
    { label: "Exports", value: usage.exportCount, icon: FileArchive },
  ];

  return (
    // min-w-0 so this grid item can shrink alongside its sibling on narrow screens.
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>What you have stored</CardTitle>
        <CardDescription>Every record in your business, counted.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {tiles.map((tile) => (
            <div key={tile.label} className="border-border rounded-lg border p-3">
              <dt className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
                <tile.icon className="size-3.5" aria-hidden="true" />
                {tile.label}
              </dt>
              <dd className="text-foreground mt-1 text-xl font-semibold tabular">
                {formatNumber(tile.value)}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------
function MaintenanceCard({ canMaintain }: { canMaintain: boolean }) {
  const runMaintenance = useRunMaintenance();
  const [pending, setPending] = useState<MaintenanceAction | null>(null);
  const [isBackingUp, setBackingUp] = useState(false);
  const [running, setRunning] = useState<string | null>(null);

  const run = async (action: MaintenanceAction) => {
    setRunning(action.operation);
    try {
      const result = await runMaintenance.mutateAsync(action.operation);
      const detail = [
        result.bytesFreed > 0 ? `${formatBytes(result.bytesFreed)} freed` : null,
        result.rowsAffected > 0 ? `${formatNumber(result.rowsAffected)} rows` : null,
      ]
        .filter(Boolean)
        .join(" · ");

      if (result.success) {
        toast.success(result.message, { description: detail || undefined });
      } else {
        toast.error(result.message, { description: detail || undefined });
      }
    } catch (error) {
      toast.error(
        error instanceof GraphQLRequestError
          ? error.message
          : `Could not run ${action.label.toLowerCase()}.`,
      );
    } finally {
      setRunning(null);
      setPending(null);
    }
  };

  const backup = async () => {
    setBackingUp(true);
    try {
      await downloadFile("/api/storage/backup", "credit-system-backup.db");
      toast.success("Backup downloaded.", {
        description: "Keep it somewhere safe — it contains everything.",
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not download the backup.");
    } finally {
      setBackingUp(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Maintenance</CardTitle>
        <CardDescription>
          Housekeeping tools. Nothing here touches your customers, credits or payments.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {!canMaintain ? (
          <Alert variant="neutral">
            Your role can view storage usage but not run maintenance or download a backup.
          </Alert>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          {MAINTENANCE_ACTIONS.map((action) => (
            <div
              key={action.operation}
              className="border-border flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 space-y-0.5">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {action.label}
                  {action.destructive ? (
                    <Badge variant="warning" size="sm">
                      Deletes data
                    </Badge>
                  ) : (
                    <Badge variant="neutral" size="sm">
                      Safe
                    </Badge>
                  )}
                </p>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {action.description}
                </p>
              </div>

              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                disabled={!canMaintain || running !== null}
                isLoading={running === action.operation}
                onClick={() => (action.destructive ? setPending(action) : void run(action))}
              >
                Run
              </Button>
            </div>
          ))}
        </div>

        <div className="border-border flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium">Download a database backup</p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              A complete snapshot of your data. Take one before you run anything destructive.
            </p>
          </div>
          <Button
            variant="secondary"
            leftIcon={<Download />}
            className="shrink-0"
            disabled={!canMaintain}
            isLoading={isBackingUp}
            loadingText="Preparing…"
            onClick={() => void backup()}
          >
            Download backup
          </Button>
        </div>
      </CardContent>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={() => setPending(null)}
        title={`Run "${pending?.label}"?`}
        description={`${pending?.description ?? ""} This cannot be undone. Your customers, credits and payments are never touched by maintenance — but if you want to be certain, download a backup first.`}
        confirmLabel="Run it"
        destructive
        isLoading={running !== null}
        onConfirm={() => {
          if (pending) void run(pending);
        }}
      />
    </Card>
  );
}
