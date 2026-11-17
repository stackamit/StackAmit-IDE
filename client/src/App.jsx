import { BrowserRouter, HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { NotificationProvider } from './components/ui/Notification.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { UserAuthProvider } from './context/UserAuthContext.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import PublicLayout from './components/layout/PublicLayout.jsx';
import Home from './pages/Home.jsx';
import About from './pages/About.jsx';
import AiAbout from './pages/AiAbout.jsx';
import Contact from './pages/Contact.jsx';
import Download from './pages/Download.jsx';
import Workspace from './pages/Workspace.jsx';
import IdeApp from './pages/IdeApp.jsx';
import SnippetView from './pages/SnippetView.jsx';
import Login from './pages/Login.jsx';
import AdminDashboard from './pages/AdminDashboard.jsx';
import AccountAuth from './pages/AccountAuth.jsx';
import AccountLifecycle from './pages/AccountLifecycle.jsx';
import NotFound from './pages/NotFound.jsx';
import UserDashboard from './pages/UserDashboard.jsx';
import UserProtectedRoute from './components/UserProtectedRoute.jsx';
import PublicInfoPage from './pages/PublicInfoPage.jsx';
import { isDesktopMode } from './services/workspace.js';

export default function App() {
  // Electron loads the renderer over file://, where history routing + reloads
  // break; use a hash router there. The web build keeps clean BrowserRouter URLs.
  const desktop = isDesktopMode();
  const Router = desktop ? HashRouter : BrowserRouter;
  return (
    <NotificationProvider>
      <AuthProvider>
        <UserAuthProvider>
          <Router>
            <Routes>
            {/* Public marketing pages (root opens straight into the IDE on desktop) */}
            <Route element={<PublicLayout />}>
              <Route path="/" element={desktop ? <Navigate to="/ide" replace /> : <Home />} />
              <Route path="/about" element={<About />} />
              <Route path="/ai" element={<AiAbout />} />
              <Route path="/download" element={<Download />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/privacy-policy" element={<PublicInfoPage section="privacy" />} />
              <Route path="/terms" element={<PublicInfoPage section="terms" />} />
              <Route path="/support" element={<PublicInfoPage section="support" />} />
            </Route>

            {/* IDE + shared snippets */}
            <Route path="/editor" element={<Workspace />} />
            <Route path="/ide" element={<IdeApp />} />
            <Route path="/snippet/:id" element={<SnippetView />} />

            {/* Admin (login reachable only by direct URL) */}
            <Route path="/login" element={<Login />} />
            <Route path="/account/login" element={<AccountAuth />} />
            <Route path="/account/register" element={<AccountAuth registerMode />} />
            <Route path="/account/verify" element={<AccountLifecycle />} />
            <Route path="/account/reset-password" element={<AccountLifecycle reset />} />
            <Route path="/account/dashboard" element={<UserProtectedRoute><UserDashboard /></UserProtectedRoute>} />
            <Route
              path="/admin"
              element={
                <ProtectedRoute>
                  <AdminDashboard />
                </ProtectedRoute>
              }
            />

            <Route path="*" element={<NotFound />} />
            </Routes>
          </Router>
        </UserAuthProvider>
      </AuthProvider>
    </NotificationProvider>
  );
}
