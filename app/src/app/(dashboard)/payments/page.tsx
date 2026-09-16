"use client";

import { useState } from "react";
import { useOrganization } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import type { PaymentEvidence, PaginatedResponse } from "@drezivo/contracts";
import { useApiClient } from "@/lib/api-client";
import { Table } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TableSkeleton } from "@/components/ui/skeleton";
import { EvidenceReviewDialog } from "@/components/payments/evidence-review-dialog";
import { formatPhp } from "@/lib/money";
import { can } from "@/lib/permissions";
import { useStaffRole } from "@/lib/use-staff-role";

const DATE_FORMAT = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" });

export default function PaymentsPage() {
  const { organization } = useOrganization();
  const api = useApiClient();
  const staffRole = useStaffRole();
  const [reviewing, setReviewing] = useState<PaymentEvidence | null>(null);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ["payments", organization?.id],
    queryFn: () => api.get<PaginatedResponse<PaymentEvidence>>("/payments?status=under_review"),
    enabled: Boolean(organization),
  });

  const canVerify = Boolean(staffRole) && can({ role: staffRole as NonNullable<typeof staffRole> }, "payments.verify_evidence");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-ink-900">Payments</h1>
        <p className="text-sm text-ink-500">
          Cash and QR evidence awaiting review. Verifying records what you actually confirmed, separate from the
          rental charge and refundable deposit (TRD §6).
        </p>
      </div>

      {isPending && <TableSkeleton columns={5} />}

      {isError && (
        <EmptyState
          heading="Couldn't load payment evidence"
          description={error instanceof Error ? error.message : "Try refreshing the page."}
        />
      )}

      {data && data.items.length === 0 && (
        <EmptyState
          heading="Nothing to review"
          description="Payment evidence appears here as soon as a guest uploads a receipt or you record cash collection."
        />
      )}

      {data && data.items.length > 0 && (
        <Table
          caption="Payment evidence under review"
          rows={data.items}
          getRowId={(evidence) => evidence.id}
          columns={[
            { key: "reference", header: "Reference", render: (e) => e.referenceNumber },
            { key: "customer", header: "Customer", render: (e) => e.customerName },
            { key: "claimed", header: "Claimed amount", align: "right", render: (e) => formatPhp(e.amountClaimed) },
            { key: "submitted", header: "Submitted", render: (e) => DATE_FORMAT.format(new Date(e.submittedAt)) },
            {
              key: "action",
              header: "",
              render: (e) =>
                canVerify ? (
                  <Button variant="secondary" onClick={() => setReviewing(e)}>
                    Review
                  </Button>
                ) : (
                  <Badge tone="neutral">View only</Badge>
                ),
            },
          ]}
        />
      )}

      <EvidenceReviewDialog evidence={reviewing} onClose={() => setReviewing(null)} />
    </div>
  );
}
