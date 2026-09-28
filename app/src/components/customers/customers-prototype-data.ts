export interface CustomerDashboardSummaryPrototype {
  all_customers: number;
  new_this_month: number;
  returning_customers: number;
  upcoming_customers: number;
}

export const CUSTOMER_DASHBOARD_SUMMARY_PROTOTYPE: CustomerDashboardSummaryPrototype = {
  all_customers: 128,
  new_this_month: 14,
  returning_customers: 42,
  upcoming_customers: 19,
};
