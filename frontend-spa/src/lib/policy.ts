import { makeAuthorizer, Role } from './authz';

// Resource/action → minimum role policy
// Adjust as needed for your domain.
export const policy: Record<string, Record<string, Role>> = {
  nav: {
    customer: 'user',
    scanQr: 'staff',
    dashboard: 'manager',
    insights: 'manager',
    crm: 'staff',
    marketing: 'manager',
    team: 'brand_manager',
    kpi: 'admin',
  },
  campaigns: {
    view: 'staff',
    update: 'manager',
    launch: 'manager',
    publish: 'admin',
  },
  crm: {
    addCustomer: 'staff',
    // Was 'manager' before 2026-07-05; opened to 'staff' so STAFF has full CRM access.
    deleteCustomer: 'staff',
    redeemCoupon: 'staff',
  },
};

export const authorizer = makeAuthorizer(policy);
