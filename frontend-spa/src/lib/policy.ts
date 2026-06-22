import { makeAuthorizer, Role } from './authz';

// Resource/action → minimum role policy
// Adjust as needed for your domain.
export const policy: Record<string, Record<string, Role>> = {
  nav: {
    customer: 'user',
    scanQr: 'staff',
    dashboard: 'manager',
    insights: 'manager',
    crm: 'manager',
    marketing: 'manager',
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
    deleteCustomer: 'manager',
    redeemCoupon: 'staff',
  },
};

export const authorizer = makeAuthorizer(policy);
