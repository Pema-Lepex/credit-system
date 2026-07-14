import { Construction } from "lucide-react";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export interface ComingSoonProps {
  title: string;
  description?: string;
  /** What the feature agent will build here. Keeps the placeholder informative. */
  note?: ReactNode;
}

/**
 * Placeholder for a route that exists so no nav link 404s, but whose feature is
 * owned by another agent. Delete the whole file once every route is real.
 */
export function ComingSoon({ title, description, note }: ComingSoonProps) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />
      <Card>
        <CardContent className="pt-6">
          <EmptyState
            icon={<Construction />}
            title="Coming soon"
            description={note ?? "This section is being built. It will appear here shortly."}
          />
        </CardContent>
      </Card>
    </div>
  );
}
