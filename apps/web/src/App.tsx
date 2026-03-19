import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { ToolManager } from "@/pages/ToolManager";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/tools" replace />} />
          <Route path="tools" element={<ToolManager />} />
          <Route path="*" element={<Navigate to="/tools" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
