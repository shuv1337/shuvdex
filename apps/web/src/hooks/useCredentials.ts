import { useState, useEffect, useCallback } from "react";
import {
  fetchCredentials,
  createCredential,
  deleteCredential,
  fetchCredentialBindings,
  createCredentialBinding,
  deleteCredentialBinding,
  type CredentialRecord,
  type CredentialBinding,
} from "@/api/client";

export interface UseCredentialsResult {
  credentials: CredentialRecord[];
  bindings: CredentialBinding[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  addCredential: (credential: Omit<CredentialRecord, "createdAt" | "updatedAt">) => Promise<CredentialRecord>;
  removeCredential: (credentialId: string) => Promise<void>;
  addBinding: (binding: Omit<CredentialBinding, "createdAt" | "updatedAt">) => Promise<CredentialBinding>;
  removeBinding: (bindingId: string) => Promise<void>;
}

export function useCredentials(): UseCredentialsResult {
  const [credentials, setCredentials] = useState<CredentialRecord[]>([]);
  const [bindings, setBindings] = useState<CredentialBinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [credsData, bindingsData] = await Promise.all([
        fetchCredentials(),
        fetchCredentialBindings(),
      ]);
      setCredentials(credsData);
      setBindings(bindingsData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch credentials");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const addCredential = useCallback(async (credential: Omit<CredentialRecord, "createdAt" | "updatedAt">) => {
    const created = await createCredential(credential);
    setCredentials((prev) => [...prev, created]);
    return created;
  }, []);

  const removeCredential = useCallback(async (credentialId: string) => {
    await deleteCredential(credentialId);
    setCredentials((prev) => prev.filter((c) => c.credentialId !== credentialId));
    setBindings((prev) => prev.filter((b) => b.credentialId !== credentialId));
  }, []);

  const addBinding = useCallback(async (binding: Omit<CredentialBinding, "createdAt" | "updatedAt">) => {
    const created = await createCredentialBinding(binding);
    setBindings((prev) => [...prev, created]);
    return created;
  }, []);

  const removeBinding = useCallback(async (bindingId: string) => {
    await deleteCredentialBinding(bindingId);
    setBindings((prev) => prev.filter((b) => b.bindingId !== bindingId));
  }, []);

  return {
    credentials,
    bindings,
    loading,
    error,
    refresh: () => void load(),
    addCredential,
    removeCredential,
    addBinding,
    removeBinding,
  };
}
