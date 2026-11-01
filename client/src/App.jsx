import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import ErrorBoundary from './components/ErrorBoundary';
import LoginPage from './pages/LoginPage';
import UploadPage from './pages/UploadPage';
import RecordsListPage from './pages/RecordsListPage';
import ReviewPage from './pages/ReviewPage';
import SemanticSearchPage from './pages/SemanticSearchPage';

export default function App() {
  return (
    <BrowserRouter>
      <div className="app-layout">
        <Navbar />
        <main className="main-content">
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Navigate to="/records" replace />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/upload" element={<UploadPage />} />
              <Route path="/records" element={<RecordsListPage />} />
              <Route path="/search" element={<SemanticSearchPage />} />
              <Route path="/records/:id" element={<ReviewPage />} />
              <Route path="*" element={<Navigate to="/records" replace />} />
            </Routes>
          </ErrorBoundary>
        </main>
      </div>
    </BrowserRouter>
  );
}
