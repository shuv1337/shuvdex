import { useState, useCallback } from "react";
import {
  issueToken,
  verifyToken,
  revokeToken,
  type IssueTokenInput,
  type TokenResponse,
  type TokenClaims,
} from "@/api/client";

export interface UseTokensResult {
  loading: boolean;
  error: string | null;
  issue: (input: IssueTokenInput) => Promise<TokenResponse | null>;
  verify: (token: string) => Promise<TokenClaims | null>;
  revoke: (jti: string) => Promise<boolean>;
  lastIssued: TokenResponse | null;
  lastVerified: TokenClaims | null;
}

export function useTokens(): UseTokensResult {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastIssued, setLastIssued] = useState<TokenResponse | null>(null);
  const [lastVerified, setLastVerified] = useState<TokenClaims | null>(null);

  const issue = useCallback(async (input: IssueTokenInput) => {
    setLoading(true);
    setError(null);
    try {
      const result = await issueToken(input);
      setLastIssued(result);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to issue token");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const verify = useCallback(async (token: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await verifyToken(token);
      setLastVerified(result);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to verify token");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const revoke = useCallback(async (jti: string) => {
    setLoading(true);
    setError(null);
    try {
      await revokeToken(jti);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to revoke token");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    loading,
    error,
    issue,
    verify,
    revoke,
    lastIssued,
    lastVerified,
  };
}
