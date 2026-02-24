import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";

export default function RequirePerm({ perm, children, redirectTo = "/dashboard" }) {
  const { hasPerm } = useAuth();
  const location = useLocation();

  if (!perm || hasPerm(perm)) {
    return children;
  }

  return (
    <Navigate
      to="/access-denied"
      replace
      state={{ from: location.pathname, redirectTo }}
    />
  );
}
