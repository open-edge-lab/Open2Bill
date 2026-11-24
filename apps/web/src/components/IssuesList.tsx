import { Alert, List, Text } from '@mantine/core';
import { IconAlertTriangle, IconCircleX } from '@tabler/icons-react';
import type { ValidationIssue } from '@open2bill/core';

// Elenco di errori e avvisi. Gli errori bloccano l'emissione, gli avvisi no.

export function IssuesList({ issues }: { issues: ValidationIssue[] }) {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  if (issues.length === 0) return null;
  return (
    <>
      {errors.length > 0 && (
        <Alert color="red" variant="light" icon={<IconCircleX size={18} />} title="Da completare prima di emettere" p="sm">
          <List size="sm" spacing={2}>
            {errors.map((i, idx) => (
              <List.Item key={`${i.path}-${idx}`}>{i.message}</List.Item>
            ))}
          </List>
        </Alert>
      )}
      {warnings.length > 0 && (
        <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={18} />} p="sm">
          <List size="sm" spacing={2}>
            {warnings.map((i, idx) => (
              <List.Item key={`${i.path}-${idx}`}>
                <Text size="sm">{i.message}</Text>
              </List.Item>
            ))}
          </List>
        </Alert>
      )}
    </>
  );
}
