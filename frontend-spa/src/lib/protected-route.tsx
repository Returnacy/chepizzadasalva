import React from "react";
import { useAuth } from "../hooks/use-auth";
import { getTenantContext, getRolesForContext, isTenantMember } from "./authz";
import { Loader2 } from "lucide-react";
import { Redirect, Route } from "wouter";
import { NotEnrolledScreen } from "../features/auth/components/NotEnrolledScreen";

interface ProtectedRouteProps {
  path: string;
  component: () => JSX.Element;
  allowedRoles?: string[];
  requireAuth?: boolean;
}

export function ProtectedRoute({
  path,
  component: Component,
  allowedRoles,
  requireAuth = true,
}: ProtectedRouteProps) {
  const { user, isLoading, logoutMutation } = useAuth();
  const ctx = getTenantContext();
  const roles = getRolesForContext(user as any, ctx);

  if (isLoading) {
    return (
      <Route path={path}>
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-brand-blue" />
        </div>
      </Route>
    );
  }

  // If authentication is required but user is not logged in
  if (requireAuth && !user) {
    return (
      <Route path={path}>
        <Redirect to="/auth" />
      </Route>
    );
  }

  // Logged in, but not a member of this brand: nothing here would load for them.
  if (user && !isTenantMember(user as any, ctx)) {
    return (
      <Route path={path}>
        <NotEnrolledScreen onLogout={() => logoutMutation.mutate()} loggingOut={logoutMutation.isPending} />
      </Route>
    );
  }

  // If specific roles are required, check if user has permission
  if (allowedRoles && user) {
    const allowed = allowedRoles.map(r => r.toLowerCase());
    const has = roles.some(r => allowed.includes(r));
    if (!has) {
    return (
      <Route path={path}>
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center space-y-4">
            <h1 className="text-2xl font-bold text-gray-900">Accesso Negato</h1>
            <p className="text-gray-600">Non hai i permessi necessari per accedere a questa pagina.</p>
            <p className="text-sm text-gray-500">
              Ruoli richiesti: {allowedRoles.join(", ")} | I tuoi ruoli (tenant): {roles.join(", ") || 'nessuno'}
            </p>
          </div>
        </div>
      </Route>
    );
    }
  }

  return (
    <Route path={path}>
      <Component />
    </Route>
  );
}