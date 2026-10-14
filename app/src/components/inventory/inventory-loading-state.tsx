import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function InventorySummaryLoadingState() {
  return (
    <div
      aria-label="Loading clothing summary"
      aria-busy="true"
      className="grid grid-cols-2 gap-2 max-sm:order-last xl:grid-cols-4"
      role="status"
    >
      {Array.from({ length: 4 }).map((_, index) => (
        <Card key={index} className="gap-0 py-0">
          <CardContent className="flex min-h-20 items-center gap-3 p-3">
            <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
            <span className="flex-1 space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-6 w-12" />
            </span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function InventoryLoadingState() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading clothing">
      <span className="sr-only">Loading clothing…</span>
      <Table aria-label="Loading clothing catalogue">
        <TableHeader>
          <TableRow className="bg-dashboard-surface hover:bg-dashboard-surface">
            <TableHead className="w-14 px-2 sm:px-4">Photo</TableHead>
            <TableHead className="px-2 sm:px-4">Clothing</TableHead>
            <TableHead className="hidden md:table-cell">Category</TableHead>
            <TableHead className="hidden md:table-cell">Sizes</TableHead>
            <TableHead className="hidden lg:table-cell">Availability</TableHead>
            <TableHead className="hidden xl:table-cell">Rental Price</TableHead>
            <TableHead className="hidden xl:table-cell">Active Pieces</TableHead>
            <TableHead className="w-12 px-2 sm:px-4" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 7 }).map((_, index) => (
            <TableRow key={index}>
              <TableCell className="px-2 sm:px-4">
                <Skeleton className="h-12 w-10 rounded-lg" />
              </TableCell>
              <TableCell className="min-w-0 px-2 sm:px-4">
                <Skeleton className="h-4 w-40 max-w-full" />
                <Skeleton className="mt-2 h-3 w-24" />
                <div className="mt-3 grid grid-cols-2 gap-3 md:hidden">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <Skeleton className="h-4 w-24" />
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="mt-2 h-3 w-12" />
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="mt-2 h-3 w-28" />
              </TableCell>
              <TableCell className="hidden xl:table-cell">
                <Skeleton className="h-4 w-20" />
              </TableCell>
              <TableCell className="hidden xl:table-cell">
                <Skeleton className="h-4 w-14" />
              </TableCell>
              <TableCell className="px-2 sm:px-4">
                <Skeleton className="ml-auto h-8 w-8 rounded-md" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
