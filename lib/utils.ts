import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merges Tailwind class names, resolving conflicts via clsx and tailwind-merge. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
