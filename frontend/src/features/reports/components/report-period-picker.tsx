"use client";

import { useMemo, useState } from "react";

import { Card, CardContent, FormField, Select } from "@/components/ui";
import type { ReportInput } from "@/features/reports/api";
import { REPORT_PERIODS, type ReportPeriod } from "@/types";

/** Plain language over jargon, per the spec — "This month", not "MONTHLY". */
export const PERIOD_LABELS: Record<ReportPeriod, string> = {
  DAILY: "Today",
  WEEKLY: "This week",
  MONTHLY: "This month",
  YEARLY: "This year",
  CUSTOM: "Custom range",
};

export interface ReportPeriodState {
  period: ReportPeriod;
  startDate: string;
  endDate: string;
  setPeriod: (period: ReportPeriod) => void;
  setStartDate: (value: string) => void;
  setEndDate: (value: string) => void;
  /** The variables to send. Stable across renders. */
  input: ReportInput;
  /** A CUSTOM range with a missing end — hold the query rather than 400. */
  incomplete: boolean;
}

/**
 * The period control every report shares.
 *
 * Split out because four reports needed the identical picker, the identical
 * "custom range needs both dates" guard, and the identical memoised input. Four
 * copies is four chances for one of them to send a range the server cannot resolve.
 */
export function useReportPeriod(initial: ReportPeriod = "MONTHLY"): ReportPeriodState {
  const [period, setPeriod] = useState<ReportPeriod>(initial);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const incomplete = period === "CUSTOM" && (startDate === "" || endDate === "");

  const input = useMemo<ReportInput>(
    () => ({
      period,
      startDate: period === "CUSTOM" && startDate ? startDate : null,
      endDate: period === "CUSTOM" && endDate ? endDate : null,
    }),
    [period, startDate, endDate],
  );

  return {
    period,
    startDate,
    endDate,
    setPeriod,
    setStartDate,
    setEndDate,
    input,
    incomplete,
  };
}

export interface ReportPeriodPickerProps {
  state: ReportPeriodState;
  /** Download buttons, or anything else that belongs on the right. */
  actions?: React.ReactNode;
}

export function ReportPeriodPicker({ state, actions }: ReportPeriodPickerProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid flex-1 gap-4 sm:grid-cols-3">
            <FormField label="Period">
              <Select
                value={state.period}
                onChange={(event) => state.setPeriod(event.target.value as ReportPeriod)}
                options={REPORT_PERIODS.map((value) => ({
                  value,
                  label: PERIOD_LABELS[value],
                }))}
              />
            </FormField>

            {state.period === "CUSTOM" ? (
              <>
                <FormField label="From">
                  <input
                    type="date"
                    value={state.startDate}
                    onChange={(event) => state.setStartDate(event.target.value)}
                    className="border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
                  />
                </FormField>
                <FormField label="To">
                  <input
                    type="date"
                    value={state.endDate}
                    onChange={(event) => state.setEndDate(event.target.value)}
                    className="border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
                  />
                </FormField>
              </>
            ) : null}
          </div>

          {actions}
        </div>
      </CardContent>
    </Card>
  );
}
