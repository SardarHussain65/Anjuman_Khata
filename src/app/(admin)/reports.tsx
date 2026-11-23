import React from 'react';
import { EmptyState } from '@/core/ui/ScreenState';
import { useTranslation } from 'react-i18next';

export default function AdminReportsRoute() {
  const { t } = useTranslation();
  return <EmptyState title={t('reports.title')} icon="document-text-outline" />;
}
