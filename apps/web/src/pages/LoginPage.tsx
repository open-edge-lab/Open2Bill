import { Alert, Button, Center, Paper, PasswordInput, Stack, Text, Title } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api/client';

export function LoginPage({ mode }: { mode: 'none' | 'token' | 'password' }) {
  const qc = useQueryClient();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (mode === 'token') {
    return (
      <Center h="100vh">
        <Text c="dimmed">Sessione desktop scaduta: riavvia Open2Bill.</Text>
      </Center>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/login', { password });
      await qc.invalidateQueries();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Center h="100vh">
      <Paper withBorder p="xl" w={360}>
        <form onSubmit={submit}>
          <Stack>
            <div>
              <Title order={1}>Open2Bill</Title>
              <Text c="dimmed" size="sm">
                Inserisci la password per accedere alle tue fatture.
              </Text>
            </div>
            {error && <Alert color="red">{error}</Alert>}
            <PasswordInput
              label="Password"
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              autoFocus
              required
            />
            <Button type="submit" loading={busy}>
              Accedi
            </Button>
          </Stack>
        </form>
      </Paper>
    </Center>
  );
}
