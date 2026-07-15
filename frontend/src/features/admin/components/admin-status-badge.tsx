import { Badge } from "@/components/ui";
import { APPROVAL_STATUS_STYLES, cn } from "@/lib/utils";
import type { ApprovalStatus } from "@/types";

/** The approval-state chip, used in the table, the cards and the detail header. */
export function AdminStatusBadge({ status }: { status: ApprovalStatus }) {
  const style = APPROVAL_STATUS_STYLES[status];
  return (
    <Badge className={cn(style.className)} dot>
      {style.label}
    </Badge>
  );
}
