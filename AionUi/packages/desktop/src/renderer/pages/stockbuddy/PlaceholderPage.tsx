import React from 'react';
import { useTranslation } from 'react-i18next';

interface PlaceholderPageProps {
  /** Small eyebrow label above the title, e.g. the product area name. */
  eyebrow?: string;
  /** Main page title. */
  title: string;
  /** Optional description; falls back to the shared under-construction copy. */
  description?: string;
}

/**
 * Shared under-construction page used as the skeleton target for StockBuddy
 * routes that are implemented in later phases.
 */
const PlaceholderPage: React.FC<PlaceholderPageProps> = ({ eyebrow, title, description }) => {
  const { t } = useTranslation();

  return (
    <div className='flex flex-col items-center justify-center size-full gap-12px p-24px bg-1'>
      {eyebrow && <div className='text-13px text-t-secondary'>{eyebrow}</div>}
      <h1 className='text-22px font-semibold text-t-primary'>{title}</h1>
      <p className='text-13px text-t-secondary max-w-360px text-center'>
        {description ?? t('stockbuddy.nav.placeholderDescription')}
      </p>
      <div className='px-12px py-4px rd-full bg-fill-2 text-12px text-t-tertiary'>
        {t('stockbuddy.nav.placeholder')}
      </div>
    </div>
  );
};

export default PlaceholderPage;
