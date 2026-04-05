import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Dashboard } from "@/pages/Dashboard";
import { Packages } from "@/pages/Packages";
import { ToolManager } from "@/pages/ToolManager";
import { Policies } from "@/pages/Policies";
import { Credentials } from "@/pages/Credentials";
import { Tokens } from "@/pages/Tokens";
import { Sources } from "@/pages/Sources";
import { Audit } from "@/pages/Audit";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="packages" element={<Packages />} />
          <Route path="tools" element={<ToolManager />} />
          <Route path="policies" element={<Policies />} />
          <Route path="credentials" element={<Credentials />} />
          <Route path="tokens" element={<Tokens />} />
          <Route path="sources" element={<Sources />} />
          <Route path="audit" element={<Audit />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
