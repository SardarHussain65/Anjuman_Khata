import React from 'react';
import { EmptyState } from '@/core/ui/ScreenState';
import { useTranslation } from 'react-i18next';

export default function UserDashboardRoute() {
  const { t } = useTranslation();
  return <EmptyState title={t('tabs.home')} subtitle={t('app.subtitle')} icon="home-outline" />;
}
