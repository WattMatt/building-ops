import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PersistedQueryProvider } from "@/components/PersistedQueryProvider";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { HintsProvider } from "@/hooks/useHints";
import { ThemeProvider } from "@/components/ThemeProvider";
import { OrganizationThemeProvider } from "@/components/OrganizationThemeProvider";
import ProtectedRoute from "@/components/ProtectedRoute";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// Pages
import Auth from "./pages/Auth";
import SetPassword from "./pages/SetPassword";
import ResetPassword from "./pages/ResetPassword";
import Onboarding from "./pages/Onboarding";
import RoleHome from "./pages/RoleHome";
import MyDay from "./pages/MyDay";
import Buildings from "./pages/Buildings";
import BuildingForm from "./pages/BuildingForm";
import BuildingDetails from "./pages/BuildingDetails";
import Checklists from "./pages/Checklists";
import Issues from "./pages/Issues";
import NewIssue from "./pages/NewIssue";
import MapView from "./pages/MapView";
import Reports from "./pages/Reports";
import FortressReportEditor from "./components/reports/fortress/FortressReportEditor";
import FortressReports from "./pages/FortressReports";
import FormsLibrary from "./pages/FormsLibrary";
import MySignoffs from "./pages/MySignoffs";
import Inbox from "./pages/Inbox";
import UserManagement from "./pages/UserManagement";
import Settings from "./pages/Settings";
import Profile from "./pages/Profile";
import NotFound from "./pages/NotFound";

const App = () => (
  <ErrorBoundary>
  <PersistedQueryProvider>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <HintsProvider>
            <OrganizationThemeProvider>
            <Routes>
              {/* Public routes (outside ProtectedRoute) */}
              <Route path="/auth" element={<Auth />} />
              <Route path="/set-password" element={<SetPassword />} />
              <Route path="/reset" element={<ResetPassword />} />
              {/* First-run gate target (needs a session; enforces its own
                  entry conditions — wrapping it in ProtectedRoute would loop) */}
              <Route path="/onboarding" element={<Onboarding />} />

            {/* Protected Routes with Dashboard Layout */}
            {/* `/` is role-shaped: site roles land on My Day, managers on the dashboard. */}
            <Route path="/" element={
              <ProtectedRoute>
                <DashboardLayout><RoleHome /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/my-day" element={
              <ProtectedRoute>
                <DashboardLayout><MyDay /></DashboardLayout>
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
              <ProtectedRoute allowedRoles={['admin', 'manager']}>
                <DashboardLayout><Reports /></DashboardLayout>
              </ProtectedRoute>
            } />
            {/* Static path first so it is never captured by the :id route below. */}
            <Route path="/reports/fortress" element={
              <ProtectedRoute>
                <DashboardLayout><FortressReports /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/reports/fortress/:id" element={
              <ProtectedRoute>
                <DashboardLayout><FortressReportEditor /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/forms" element={
              <ProtectedRoute>
                <DashboardLayout><FormsLibrary /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/my-signoffs" element={
              <ProtectedRoute>
                <DashboardLayout><MySignoffs /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/inbox" element={
              <ProtectedRoute>
                <DashboardLayout><Inbox /></DashboardLayout>
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
            </HintsProvider>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </PersistedQueryProvider>
  </ErrorBoundary>
);

export default App;
