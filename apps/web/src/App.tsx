import { Center, Loader } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { UNAUTHORIZED_EVENT } from './api/client';
import { keys, useAuthStatus } from './api/hooks';
import { AppLayout } from './components/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { CatalogPage } from './pages/CatalogPage';
import { CustomersPage } from './pages/CustomersPage';
import { DocumentPage } from './pages/DocumentPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { SettingsPage } from './pages/SettingsPage';

const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { path: '/', element: <DocumentsPage /> },
      { path: '/documents/new', element: <DocumentPage /> },
      { path: '/documents/:id', element: <DocumentPage /> },
      { path: '/customers', element: <CustomersPage /> },
      { path: '/catalog', element: <CatalogPage /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

export function App() {
  const auth = useAuthStatus();
  const qc = useQueryClient();

  useEffect(() => {
    const onUnauthorized = () => qc.invalidateQueries({ queryKey: keys.auth });
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [qc]);

  if (auth.isPending) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }
  if (auth.data && !auth.data.authenticated) {
    return <LoginPage mode={auth.data.mode} />;
  }
  return <RouterProvider router={router} />;
}
