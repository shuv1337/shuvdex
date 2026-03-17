import { useState, useEffect, useCallback } from "react";
import {
  fetchSkills,
  activateSkill,
  deactivateSkill,
  syncSkills,
  fetchDriftReport,
  pullAll,
  type SkillActivation,
  type DriftReport,
} from "@/api/client";

export interface UseSkillsResult {
  skills: SkillActivation[];
  driftReport: DriftReport | null;
  loading: boolean;
  driftLoading: boolean;
  error: string | null;
  refresh: () => void;
  activate: (skill: string, hosts?: string[]) => Promise<void>;
  deactivate: (skill: string, hosts?: string[]) => Promise<void>;
  sync: (hosts?: string[]) => Promise<void>;
  pull: (hosts?: string[]) => Promise<void>;
  loadDrift: (referenceHost?: string) => Promise<void>;
}

export function useSkills(): UseSkillsResult {
  const [skills, setSkills] = useState<SkillActivation[]>([]);
  const [driftReport, setDriftReport] = useState<DriftReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [driftLoading, setDriftLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSkills();
      setSkills(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch skills");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activate = useCallback(async (skill: string, hosts?: string[]) => {
    await activateSkill(skill, hosts);
    await load();
  }, [load]);

  const deactivate = useCallback(async (skill: string, hosts?: string[]) => {
    await deactivateSkill(skill, hosts);
    await load();
  }, [load]);

  const sync = useCallback(async (hosts?: string[]) => {
    await syncSkills(hosts);
    await load();
  }, [load]);

  const pull = useCallback(async (hosts?: string[]) => {
    await pullAll(hosts);
  }, []);

  const loadDrift = useCallback(async (referenceHost?: string) => {
    setDriftLoading(true);
    try {
      const report = await fetchDriftReport(referenceHost);
      setDriftReport(report);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch drift report");
    } finally {
      setDriftLoading(false);
    }
  }, []);

  return {
    skills,
    driftReport,
    loading,
    driftLoading,
    error,
    refresh: () => void load(),
    activate,
    deactivate,
    sync,
    pull,
    loadDrift,
  };
}
