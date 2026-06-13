import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/components/ThemeProvider";
import { OrganizationThemeProvider } from "@/components/OrganizationThemeProvider";
import ProtectedRoute from "@/components/ProtectedRoute";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// Pages
import Auth from "./pages/Auth";
import SetPassword from "./pages/SetPassword";
import ResetPassword from "./pages/ResetPassword";
import Dashboard from "./pages/Dashboard";
import Buildings from "./pages/Buildings";
import BuildingForm from "./pages/BuildingForm";
import BuildingDetails from "./pages/BuildingDetails";
import Checklists from "./pages/Checklists";
import Issues from "./pages/Issues";
import NewIssue from "./pages/NewIssue";
import MapView from "./pages/MapView";
import Reports from "./pages/Reports";
import FortressReportEditor from "./components/reports/fortress/FortressReportEditor";
import AuditArchive from "./pages/AuditArchive";
import FormsLibrary from "./pages/FormsLibrary";
import UserManagement from "./pages/UserManagement";
import Settings from "./pages/Settings";
import Profile from "./pages/Profile";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <ErrorBoundary>
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <OrganizationThemeProvider>
            <Routes>
              {/* Public routes (outside ProtectedRoute) */}
              <Route path="/auth" element={<Auth />} />
              <Route path="/set-password" element={<SetPassword />} />
              <Route path="/reset" element={<ResetPassword />} />

            {/* Protected Routes with Dashboard Layout */}
            <Route path="/" element={
              <ProtectedRoute>
                <DashboardLayout><Dashboard /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/buildings" element={
              <ProtectedRoute>
                <DashboardLayout><Buildings /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/buildings/new" element={
              <ProtectedRoute allowedRoles={['admin', 'manager']}>
                <DashboardLayout><BuildingForm /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/buildings/:id/edit" element={
              <ProtectedRoute allowedRoles={['admin', 'manager']}>
                <DashboardLayout><BuildingForm /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/buildings/:id" element={
              <ProtectedRoute>
                <DashboardLayout><BuildingDetails /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/checklists" element={
              <ProtectedRoute>
                <DashboardLayout><Checklists /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/issues" element={
              <ProtectedRoute>
                <DashboardLayout><Issues /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/issues/new" element={
              <ProtectedRoute>
                <DashboardLayout><NewIssue /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/map" element={
              <ProtectedRoute>
                <DashboardLayout><MapView /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/reports" element={
              <ProtectedRoute>
                <DashboardLayout><Reports /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/reports/fortress/:id" element={
              <ProtectedRoute>
                <DashboardLayout><FortressReportEditor /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/audit" element={
              <ProtectedRoute>
                <DashboardLayout><AuditArchive /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/forms" element={
              <ProtectedRoute>
                <DashboardLayout><FormsLibrary /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/users" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <DashboardLayout><UserManagement /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/settings" element={
              <ProtectedRoute allowedRoles={['admin', 'manager']}>
                <DashboardLayout><Settings /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/profile" element={
              <ProtectedRoute>
                <DashboardLayout><Profile /></DashboardLayout>
              </ProtectedRoute>
            } />
            
            <Route path="*" element={<NotFound />} />
            </Routes>
            </OrganizationThemeProvider>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
