"use client";

import { useRouter } from "next/navigation";
import type { ReservationListItem } from "@drezivo/contracts";
import { Table } from "@/components/ui/table";
import { ReservationStatusBadge } from "./reservation-status-badge";
import { formatPhp } from "@/lib/money";

const DATE_FORMAT = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Manila",
});

export function ReservationsTable({ reservations }: { reservations: ReservationListItem[] }) {
  const router = useRouter();

  return (
    <Table
      caption="Reservations"
      rows={reservations}
      getRowId={(reservation) => reservation.id}
      onRowClick={(reservation) => router.push(`/reservations/${reservation.id}`)}
      columns={[
        {
          key: "reference",
          header: "Reference",
          render: (reservation) => <span className="font-medium">{reservation.referenceNumber}</span>,
        },
        {
          key: "customer",
          header: "Customer",
          render: (reservation) => reservation.customerName,
        },
        {
          key: "pickup",
          header: "Pickup",
          render: (reservation) => DATE_FORMAT.format(new Date(reservation.pickupAt)),
        },
        {
          key: "return",
          header: "Return",
          render: (reservation) => DATE_FORMAT.format(new Date(reservation.returnAt)),
        },
        {
          key: "rental",
          header: "Rental",
          align: "right",
          render: (reservation) => formatPhp(reservation.rentalAmount),
        },
        {
          key: "status",
          header: "Status",
          render: (reservation) => <ReservationStatusBadge status={reservation.status} />,
        },
      ]}
    />
  );
}
