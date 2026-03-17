import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Dashboard } from "@/pages/Dashboard";
import { ToolManager } from "@/pages/ToolManager";
import { HostManager } from "@/pages/HostManager";
import { SkillOps } from "@/pages/SkillOps";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="tools" element={<ToolManager />} />
          <Route path="hosts" element={<HostManager />} />
          <Route path="skills" element={<SkillOps />} />
          {/* Catch-all → dashboard */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
