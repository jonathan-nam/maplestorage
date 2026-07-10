"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

type PingResponse = { userId: string; dbTimestamp: string };

// M0's end-to-end proof, not a permanent UI: unauthenticated /health confirms
// the ALB -> ECS path works at all; authenticated /api/ping confirms a real
// Clerk JWT verifies against Ktor's JWKS check and a value comes back from RDS.
export function BackendStatus() {
  const { getToken } = useAuth();
  const [health, setHealth] = useState<string>("checking...");
  const [ping, setPing] = useState<string>("checking...");

  useEffect(() => {
    if (!API_BASE_URL) {
      setHealth("NEXT_PUBLIC_API_BASE_URL is not set");
      setPing("NEXT_PUBLIC_API_BASE_URL is not set");
      return;
    }

    fetch(`${API_BASE_URL}/health`)
      .then((res) => res.json())
      .then((data) => setHealth(JSON.stringify(data)))
      .catch((err) => setHealth(`error: ${String(err)}`));

    getToken()
      .then((token) =>
        fetch(`${API_BASE_URL}/api/ping`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      )
      .then((res) => res.json())
      .then((data: PingResponse) => setPing(JSON.stringify(data)))
      .catch((err) => setPing(`error: ${String(err)}`));
  }, [getToken]);

  return (
    <dl>
      <dt>GET /health</dt>
      <dd>{health}</dd>
      <dt>GET /api/ping (authenticated)</dt>
      <dd>{ping}</dd>
    </dl>
  );
}
