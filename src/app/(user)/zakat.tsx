import React from 'react';
import { EmptyState } from '@/core/ui/ScreenState';
import { useTranslation } from 'react-i18next';

export default function UserZakatRoute() {
  const { t } = useTranslation();
  return <EmptyState title={t('zakat.title')} subtitle={t('zakat.separateNote')} icon="sparkles-outline" />;
}
