import React from 'react';
import { EmptyState } from '@/core/ui/ScreenState';
import { useTranslation } from 'react-i18next';

export default function AdminLedgerRoute() {
  const { t } = useTranslation();
  return <EmptyState title={t('ledger.title')} subtitle={t('app.subtitle')} icon="grid-outline" />;
}
