import React from 'react';
import { EmptyState } from '@/core/ui/ScreenState';
import { useTranslation } from 'react-i18next';

export default function UserHistoryRoute() {
  const { t } = useTranslation();
  return <EmptyState title={t('tabs.history')} subtitle={t('common.emptySubtitle')} icon="receipt-outline" />;
}
