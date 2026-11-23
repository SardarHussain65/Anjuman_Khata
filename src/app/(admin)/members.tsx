import React from 'react';
import { EmptyState } from '@/core/ui/ScreenState';
import { useTranslation } from 'react-i18next';

export default function AdminMembersRoute() {
  const { t } = useTranslation();
  return <EmptyState title={t('members.title')} subtitle={t('common.emptySubtitle')} icon="people-outline" />;
}
