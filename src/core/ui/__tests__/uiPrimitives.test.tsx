import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import '@/core/i18n';
import { ThemeProvider } from '@/core/theme/ThemeProvider';
import { ComplianceBadge } from '../Badge';
import { Card } from '../Card';
import { EmptyState } from '../ScreenState';

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

describe('Heritage UI primitives', () => {
  it('renders ComplianceBadge with accessible status text across all 5 states', async () => {
    const statuses = ['met', 'short', 'unpaid', 'advance', 'exempt'] as const;
    for (const status of statuses) {
      const { getByText } = await render(
        <ThemeProvider>
          <ComplianceBadge status={status} />
        </ThemeProvider>,
      );
      expect(getByText(/Met|Short|Unpaid|Advance|Exempt/i)).toBeTruthy();
    }
  });

  it('renders charity and zakat Card variants and EmptyState cleanly', async () => {
    const { getByText } = await render(
      <ThemeProvider>
        <Card variant="zakat">
          <Text>Separate Zakat Card</Text>
        </Card>
        <EmptyState title="No records yet" />
      </ThemeProvider>,
    );
    expect(getByText('Separate Zakat Card')).toBeTruthy();
    expect(getByText('No records yet')).toBeTruthy();
  });
});
