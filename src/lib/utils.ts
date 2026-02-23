import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const truncate = (value: string | number | null | undefined, maxLength = 24): string => {
  if (value == null) return '';
  const str = String(value);
  if (str.length <= maxLength) return str;
  if (maxLength <= 3) return str.slice(0, maxLength);

  const keepStart = Math.ceil((maxLength - 3) / 2);
  const keepEnd = Math.floor((maxLength - 3) / 2);
  return `${str.slice(0, keepStart)}...${str.slice(str.length - keepEnd)}`;
};
