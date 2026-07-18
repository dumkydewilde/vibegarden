import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";

export function legacyClientDestination(destination: string, hash: string) {
  const target = new URL(destination, "https://vibegarden.invalid");
  target.hash = hash;
  return `${target.pathname}${target.search}${target.hash}`;
}

/** Redirects after hydration so browser-only URL fragments are retained. */
export function LegacyClubRedirect({ destination }: { destination: string }) {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    navigate(legacyClientDestination(destination, location.hash), {
      replace: true,
    });
  }, [destination, location.hash, navigate]);

  return null;
}
