import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import { AuthProvider } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import UploadPage from './pages/UploadPage';
import RecordsListPage from './pages/RecordsListPage';
import ReviewPage from './pages/ReviewPage';
import AdminUsersPage from './pages/AdminUsersPage';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <div className="app-layout">
          <Navbar />
          <main className="main-content">
            <Routes>
              <Route path="/" element={<Navigate to="/records" replace />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/records" element={<ProtectedRoute><RecordsListPage /></ProtectedRoute>} />
              <Route path="/records/:id" element={<ProtectedRoute><ReviewPage /></ProtectedRoute>} />
              <Route path="/upload" element={<ProtectedRoute roles={['Citizen', 'Admin']}><UploadPage /></ProtectedRoute>} />
              <Route path="/admin/users" element={<ProtectedRoute roles={['Admin']}><AdminUsersPage /></ProtectedRoute>} />
              <Route path="*" element={<Navigate to="/records" replace />} />
            </Routes>
          </main>
        </div>
      </AuthProvider>
    </BrowserRouter>
  );
}
