import { AppShell, Burger, Button, Group, NavLink, Stack, Text, UnstyledButton } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconAddressBook, IconFileInvoice, IconListDetails, IconLogout, IconPlus, IconSettings } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { api } from '../api/client';
import { useAppInfo, useAuthStatus } from '../api/hooks';

const NAV = [
  { to: '/', label: 'Documenti', icon: IconFileInvoice, match: (p: string) => p === '/' || p.startsWith('/documents') },
  { to: '/customers', label: 'Clienti', icon: IconAddressBook, match: (p: string) => p.startsWith('/customers') },
  { to: '/catalog', label: 'Catalogo voci', icon: IconListDetails, match: (p: string) => p.startsWith('/catalog') },
  { to: '/settings', label: 'Impostazioni', icon: IconSettings, match: (p: string) => p.startsWith('/settings') },
];

export function AppLayout() {
  const [opened, { toggle, close }] = useDisclosure();
  const location = useLocation();
  const navigate = useNavigate();
  const app = useAppInfo();
  const auth = useAuthStatus();
  const qc = useQueryClient();

  async function logout() {
    await api.post('/api/auth/logout');
    await qc.invalidateQueries();
  }

  return (
    <AppShell
      header={{ height: 52, collapsed: false }}
      navbar={{ width: 220, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="lg"
    >
      <AppShell.Header px="md" style={{ borderBottomColor: 'var(--o2b-line)' }}>
        <Group h="100%" justify="space-between">
          <Group gap="sm">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Menu" />
            <UnstyledButton component={Link} to="/" aria-label="Open2Bill, vai ai documenti">
              <Group gap={8}>
                <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={24} height={24} />
                <Text fw={600} size="lg">
                  Open2Bill
                </Text>
              </Group>
            </UnstyledButton>
          </Group>
          <Button
            leftSection={<IconPlus size={16} />}
            size="sm"
            onClick={() => {
              close();
              navigate('/documents/new');
            }}
          >
            Nuova fattura
          </Button>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm" style={{ borderRightColor: 'var(--o2b-line)' }}>
        <Stack justify="space-between" h="100%">
          <Stack gap={2}>
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                component={Link}
                to={item.to}
                label={item.label}
                leftSection={<item.icon size={18} stroke={1.6} />}
                active={item.match(location.pathname)}
                onClick={close}
                style={{ borderRadius: 4 }}
              />
            ))}
          </Stack>
          <Stack gap={4}>
            {auth.data?.mode === 'password' && (
              <NavLink label="Esci" leftSection={<IconLogout size={18} stroke={1.6} />} onClick={logout} />
            )}
            <Text size="xs" c="dimmed" px="sm">
              {app.data ? `v${app.data.version}${app.data.desktop ? ' (desktop)' : ''}` : ''}
            </Text>
          </Stack>
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
