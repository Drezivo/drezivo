import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function ReservationsLoadingState() {
  return (
    <div
      className="overflow-hidden"
      role="status"
      aria-busy="true"
      aria-label="Loading reservations"
    >
      <span className="sr-only">Loading reservations</span>
      <Table aria-label="Loading reservations">
        <TableHeader>
          <TableRow className="bg-dashboard-surface hover:bg-dashboard-surface">
            <TableHead className="pl-4">Reservation</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Clothing</TableHead>
            <TableHead className="hidden md:table-cell">Pickup</TableHead>
            <TableHead className="hidden lg:table-cell">Return</TableHead>
            <TableHead className="hidden lg:table-cell">Fulfillment</TableHead>
            <TableHead>Payment</TableHead>
            <TableHead className="pr-4">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 7 }, (_, index) => (
            <TableRow key={index}>
              <TableCell className="pl-4">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="mt-2 h-3 w-20" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-24" />
                <Skeleton className="mt-2 h-3 w-32" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-32" />
                <Skeleton className="mt-2 h-3 w-20" />
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <Skeleton className="h-4 w-24" />
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                <Skeleton className="h-4 w-24" />
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                <Skeleton className="h-5 w-16 rounded-full" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-16 rounded-full" />
              </TableCell>
              <TableCell className="pr-4">
                <Skeleton className="h-5 w-20 rounded-full" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
