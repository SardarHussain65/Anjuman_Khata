import React from 'react';
import { EmptyState } from '@/core/ui/ScreenState';
import { useTranslation } from 'react-i18next';

export default function AdminAuditLogRoute() {
  const { t } = useTranslation();
  return <EmptyState title={t('settings.auditLog')} icon="shield-checkmark-outline" />;
}
