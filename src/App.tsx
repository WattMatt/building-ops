import { lazy, Suspense } from "react";
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
import RouteFallback from "@/components/RouteFallback";

// Pages. Public/auth pages, the role-shaped home and 404 are small and on the
// first-paint path, so they stay in the shell chunk. Everything else is loaded on
// demand: each `lazy()` becomes its own route chunk, which keeps the PWA's first
// install small and lets heavy vendors (xlsx, pdfmake, mapbox-gl, recharts,
// heic2any) download only when a page that needs them is opened.
import Auth from "./pages/Auth";
import SetPassword from "./pages/SetPassword";
import ResetPassword from "./pages/ResetPassword";
import Onboarding from "./pages/Onboarding";
import RoleHome from "./pages/RoleHome";
import NotFound from "./pages/NotFound";

// MyDay is lazy because its task/issue dialogs pull PhotoCapture (heic2any).
const MyDay = lazy(() => import("./pages/MyDay"));
const Buildings = lazy(() => import("./pages/Buildings"));
const BuildingForm = lazy(() => import("./pages/BuildingForm"));
const BuildingDetails = lazy(() => import("./pages/BuildingDetails"));
const Checklists = lazy(() => import("./pages/Checklists"));
const CalendarPage = lazy(() => import("./pages/CalendarPage"));
const Issues = lazy(() => import("./pages/Issues"));
const NewIssue = lazy(() => import("./pages/NewIssue"));
const MapView = lazy(() => import("./pages/MapView"));
const Reports = lazy(() => import("./pages/Reports"));
const FortressReportEditor = lazy(() => import("./components/reports/fortress/FortressReportEditor"));
const FortressReports = lazy(() => import("./pages/FortressReports"));
const FormsLibrary = lazy(() => import("./pages/FormsLibrary"));
const MySignoffs = lazy(() => import("./pages/MySignoffs"));
const Inbox = lazy(() => import("./pages/Inbox"));
const UserManagement = lazy(() => import("./pages/UserManagement"));
const Contractors = lazy(() => import("./pages/Contractors"));
const Settings = lazy(() => import("./pages/Settings"));
const Profile = lazy(() => import("./pages/Profile"));

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
            <Suspense fallback={<RouteFallback />}>
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
            {/* Every role: RLS scopes the events to the buildings the viewer can see. */}
            <Route path="/calendar" element={
              <ProtectedRoute>
                <DashboardLayout><CalendarPage /></DashboardLayout>
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
            {/* The contractor register: reads are org-wide under RLS, but the page is a
                management surface, so it is gated like Settings. */}
            <Route path="/contractors" element={
              <ProtectedRoute allowedRoles={['admin', 'manager']}>
                <DashboardLayout><Contractors /></DashboardLayout>
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
            </Suspense>
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
