import { useState, useEffect, useCallback } from "react";
import {
  fetchPolicies,
  upsertPolicy,
  deletePolicy,
  type CapabilitySubjectPolicy,
} from "@/api/client";

export interface UsePoliciesResult {
  policies: CapabilitySubjectPolicy[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  addPolicy: (policy: CapabilitySubjectPolicy) => Promise<CapabilitySubjectPolicy>;
  editPolicy: (policy: CapabilitySubjectPolicy) => Promise<CapabilitySubjectPolicy>;
  removePolicy: (policyId: string) => Promise<void>;
}

export function usePolicies(): UsePoliciesResult {
  const [policies, setPolicies] = useState<CapabilitySubjectPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPolicies();
      setPolicies(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch policies");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const addPolicy = useCallback(async (policy: CapabilitySubjectPolicy) => {
    const created = await upsertPolicy(policy);
    setPolicies((prev) => [...prev, created]);
    return created;
  }, []);

  const editPolicy = useCallback(async (policy: CapabilitySubjectPolicy) => {
    const updated = await upsertPolicy(policy);
    setPolicies((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    return updated;
  }, []);

  const removePolicy = useCallback(async (policyId: string) => {
    await deletePolicy(policyId);
    setPolicies((prev) => prev.filter((p) => p.id !== policyId));
  }, []);

  return {
    policies,
    loading,
    error,
    refresh: () => void load(),
    addPolicy,
    editPolicy,
    removePolicy,
  };
}
